import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSetting, setSetting, type Db } from './db.js';
import { HttpError } from './paths.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const COOKIE_NAME = 'cr_sid';
const PASSWORD_KEY = 'password_hash';
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64 };

// ---- password hashing (node:crypto scrypt, no native deps) -----------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const N = Number(n);
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N, r: Number(r), p: Number(p), maxmem: 128 * N * Number(r) * 2 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isPasswordSet(db: Db): boolean {
  return !!getSetting(db, PASSWORD_KEY);
}

export async function setPassword(db: Db, password: string): Promise<void> {
  if (password.length < 8) throw new Error('Password phải có ít nhất 8 ký tự');
  setSetting(db, PASSWORD_KEY, await hashPassword(password));
  db.prepare('DELETE FROM web_sessions').run(); // log out everywhere
}

// ---- web sessions --------------------------------------------------------------

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type WebSession = { id: string; csrf: string; expiresAt: number };

export class Auth {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly db: Db,
    private readonly opts: { ttlMs: number; allowedOrigins: () => string[] },
  ) {}

  async login(password: string, ip: string): Promise<{ token: string; session: WebSession }> {
    this.checkRate(ip);
    const stored = getSetting(this.db, PASSWORD_KEY);
    if (!stored) throw new HttpError(503, 'Chưa đặt password. Trên server chạy: npm run set-password', 'no_password');
    const ok = typeof password === 'string' && password.length <= 1024 && (await verifyPassword(password, stored));
    if (!ok) {
      this.recordFailure(ip);
      throw new HttpError(401, 'Sai password', 'bad_credentials');
    }
    this.failures.delete(ip);
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const now = Date.now();
    const expiresAt = now + this.opts.ttlMs;
    this.db.prepare('INSERT INTO web_sessions (id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), csrf, now, expiresAt);
    return { token, session: { id: sha256(token), csrf, expiresAt } };
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM web_sessions WHERE id = ?').run(sha256(token));
  }

  session(token: string | undefined): WebSession | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT id, csrf, expires_at FROM web_sessions WHERE id = ?').get(sha256(token)) as
      | { id: string; csrf: string; expires_at: number }
      | undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM web_sessions WHERE id = ?').run(row.id);
      return null;
    }
    return { id: row.id, csrf: row.csrf, expiresAt: row.expires_at };
  }

  pruneExpired(): void {
    this.db.prepare('DELETE FROM web_sessions WHERE expires_at < ?').run(Date.now());
  }

  /** 5 failed logins per IP per 15 minutes, 30 overall. */
  private checkRate(ip: string): void {
    const cutoff = Date.now() - 15 * 60_000;
    let total = 0;
    for (const [k, times] of this.failures) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length) this.failures.set(k, recent);
      else this.failures.delete(k);
      total += recent.length;
    }
    if ((this.failures.get(ip)?.length ?? 0) >= 5 || total >= 30) {
      throw new HttpError(429, 'Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.', 'rate_limited');
    }
  }

  private recordFailure(ip: string): void {
    const list = this.failures.get(ip) ?? [];
    list.push(Date.now());
    this.failures.set(ip, list);
  }

  // ---- request guards ------------------------------------------------------------

  /** Reject cross-site requests. Same-origin GETs may omit Origin; then rely on Sec-Fetch-Site. */
  checkOrigin(req: FastifyRequest): void {
    const origin = req.headers.origin;
    if (origin) {
      const self = `${req.protocol}://${req.headers.host}`;
      if (origin !== self && !this.opts.allowedOrigins().includes(origin)) {
        throw new HttpError(403, 'Origin không hợp lệ', 'bad_origin');
      }
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Yêu cầu cross-site bị chặn', 'bad_origin');
  }

  /** Require a logged-in session; for mutations also require the CSRF header. */
  require(req: FastifyRequest, opts: { mutation: boolean }): WebSession {
    this.checkOrigin(req);
    const s = this.session(req.cookies[COOKIE_NAME]);
    if (!s) throw new HttpError(401, 'Chưa đăng nhập', 'unauthenticated');
    if (opts.mutation) {
      const header = req.headers['x-csrf-token'];
      const given = Array.isArray(header) ? header[0] : header;
      if (!given || given.length !== s.csrf.length || !timingSafeEqual(Buffer.from(given), Buffer.from(s.csrf))) {
        throw new HttpError(403, 'CSRF token không hợp lệ, hãy tải lại trang', 'bad_csrf');
      }
    }
    return s;
  }

  setCookie(reply: FastifyReply, req: FastifyRequest, token: string): void {
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: Math.floor(this.opts.ttlMs / 1000),
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
  }
}
