import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Auth } from './auth.js';
import { isPasswordSet } from './auth.js';
import type { SessionManager } from './claude/manager.js';
import type { Answer } from './claude/runner.js';
import type { PermissionMode } from './claude/sdk.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { FileService } from './files.js';
import { GLOBAL_CHANNEL, projectChannel, sessionChannel, type BusEvent, type Journal } from './journal.js';
import { HttpError } from './paths.js';
import type { Projects } from './projects.js';
import type { ProjectWatchers } from './watcher.js';

export type AppDeps = {
  config: Config;
  db: Db;
  auth: Auth;
  journal: Journal;
  manager: SessionManager;
  files: FileService;
  projects: Projects;
  watchers: ProjectWatchers;
  webDist: string | null;
  logger?: boolean | object;
};

type P = { p: string };
type PS = { p: string; id: string };

function body<T>(req: FastifyRequest): T {
  if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'Body phải là JSON object', 'bad_request');
  return req.body as T;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new HttpError(400, `Thiếu hoặc sai trường "${name}"`, 'bad_request');
  return v;
}

export async function buildApp(d: AppDeps): Promise<FastifyInstance> {
  const { config, auth, manager, files, projects, journal } = d;
  const app = Fastify({
    logger: d.logger ?? { level: config.LOG_LEVEL },
    bodyLimit: Math.max(config.FILE_MAX_SAVE_BYTES * 2 + 64 * 1024, 1024 * 1024),
    trustProxy: true,
    // SSE connections are long-lived; close them on shutdown instead of waiting forever.
    forceCloseConnections: true,
  });
  await app.register(cookie);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.message, code: err.code, ...((err as HttpError & { details?: object }).details ?? {}) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message, code: 'bad_request' });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'Lỗi server, xem log', code: 'internal' });
  });

  const authed = (mutation: boolean) => async (req: FastifyRequest) => {
    auth.require(req, { mutation });
  };
  const read = { preHandler: authed(false) };
  const write = { preHandler: authed(true) };

  // ---- probes (no auth, no sensitive detail) --------------------------------------
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (req, reply) => {
    const caps = await manager.capabilities();
    const loggedIn = !!auth.session(req.cookies['cr_sid']);
    const ready = caps.ok;
    reply.status(ready ? 200 : 503);
    return loggedIn
      ? { ready, claude: { ok: caps.ok, error: caps.error ?? null, auth: { method: caps.auth.method, subscriptionType: caps.auth.subscriptionType ?? null } }, activeSessions: manager.activeCount() }
      : { ready };
  });

  // ---- auth ------------------------------------------------------------------------
  app.get('/api/auth/me', async (req) => {
    const s = auth.session(req.cookies['cr_sid']);
    return { authenticated: !!s, csrf: s?.csrf ?? null, passwordSet: isPasswordSet(d.db), appName: config.APP_NAME, serverLabel: config.SERVER_LABEL };
  });
  app.post('/api/auth/login', async (req, reply) => {
    auth.checkOrigin(req);
    const { password } = body<{ password: unknown }>(req);
    const { token, session } = await auth.login(String(password ?? ''), req.ip);
    auth.setCookie(reply, req, token);
    return { ok: true, csrf: session.csrf };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    auth.checkOrigin(req);
    auth.logout(req.cookies['cr_sid']);
    auth.clearCookie(reply);
    return { ok: true };
  });

  // ---- meta ------------------------------------------------------------------------
  app.get('/api/meta', read, async (req) => {
    const force = (req.query as { refresh?: string }).refresh === '1';
    const caps = await manager.capabilities(force);
    return {
      appName: config.APP_NAME,
      serverLabel: config.SERVER_LABEL,
      workspaceRoot: config.workspaceRoot,
      capabilities: caps,
      limits: {
        idleTimeoutMin: config.SESSION_IDLE_TIMEOUT_MIN,
        inputTimeoutMin: config.INPUT_WAIT_TIMEOUT_MIN,
        maxActiveSessions: config.MAX_ACTIVE_SESSIONS,
        defaultPermissionMode: config.DEFAULT_PERMISSION_MODE,
        maxViewBytes: config.FILE_MAX_VIEW_BYTES,
        maxSaveBytes: config.FILE_MAX_SAVE_BYTES,
      },
      activeSessions: manager.activeCount(),
    };
  });

  // ---- projects --------------------------------------------------------------------
  app.get('/api/projects', read, async () => ({ projects: await projects.list() }));
  app.post('/api/projects', write, async (req) => {
    const b = body<{ name: unknown; gitInit?: unknown }>(req);
    const p = await projects.create(str(b.name, 'name').trim(), b.gitInit === true);
    journal.ephemeral(GLOBAL_CHANNEL, 'projects_changed', { name: p.name });
    return p;
  });

  // ---- sessions --------------------------------------------------------------------
  app.get<{ Params: P; Querystring: { q?: string; offset?: string; limit?: string } }>('/api/projects/:p/sessions', read, async (req) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));
    return manager.listSessions(req.params.p, { q: req.query.q, offset, limit });
  });
  app.post<{ Params: P }>('/api/projects/:p/sessions', write, async (req) => {
    const b = body<Record<string, unknown>>(req);
    return manager.createSession(req.params.p, {
      clientRequestId: str(b.clientRequestId, 'clientRequestId'),
      text: str(b.text, 'text'),
      model: typeof b.model === 'string' && b.model ? b.model : undefined,
      effort: typeof b.effort === 'string' && b.effort ? b.effort : undefined,
      permissionMode: typeof b.permissionMode === 'string' ? (b.permissionMode as PermissionMode) : undefined,
    });
  });
  app.get<{ Params: PS }>('/api/projects/:p/sessions/:id', read, async (req) => manager.sessionDetail(req.params.p, req.params.id));
  app.patch<{ Params: PS }>('/api/projects/:p/sessions/:id', write, async (req) => {
    const b = body<Record<string, unknown>>(req);
    if (typeof b.title === 'string') await manager.renameSession(req.params.p, req.params.id, b.title);
    const s: { model?: string | null; effort?: string | null; permissionMode?: PermissionMode } = {};
    if ('model' in b) s.model = typeof b.model === 'string' && b.model ? b.model : null;
    if ('effort' in b) s.effort = typeof b.effort === 'string' && b.effort ? b.effort : null;
    if (typeof b.permissionMode === 'string') s.permissionMode = b.permissionMode as PermissionMode;
    if (Object.keys(s).length) await manager.updateSettings(req.params.id, s);
    return { ok: true };
  });
  app.post<{ Params: PS }>('/api/projects/:p/sessions/:id/prompt', write, async (req) => {
    const b = body<Record<string, unknown>>(req);
    return manager.sendPrompt(req.params.p, req.params.id, {
      clientRequestId: str(b.clientRequestId, 'clientRequestId'),
      text: str(b.text, 'text'),
      force: b.force === true,
    });
  });
  app.post<{ Params: PS }>('/api/projects/:p/sessions/:id/answer', write, async (req) => {
    const b = body<{ requestId: unknown; answer: unknown }>(req);
    const answer = b.answer as Answer;
    const allowed = ['allow', 'allow_always', 'deny', 'answers', 'plan_approve', 'plan_reject'];
    if (!answer || typeof answer !== 'object' || !allowed.includes((answer as { type: string }).type)) {
      throw new HttpError(400, 'answer không hợp lệ', 'bad_request');
    }
    if (answer.type === 'answers' && (typeof answer.answers !== 'object' || !answer.answers)) throw new HttpError(400, 'Thiếu answers', 'bad_request');
    manager.answer(req.params.id, str(b.requestId, 'requestId'), answer);
    return { ok: true };
  });
  app.post<{ Params: PS }>('/api/projects/:p/sessions/:id/interrupt', write, async (req) => {
    await manager.interrupt(req.params.id);
    return { ok: true };
  });
  app.post<{ Params: PS }>('/api/projects/:p/sessions/:id/end', write, async (req) => {
    await manager.endSession(req.params.id, 'user_end');
    return { ok: true };
  });

  // ---- files -----------------------------------------------------------------------
  app.get<{ Params: P; Querystring: { path?: string; all?: string } }>('/api/projects/:p/tree', read, async (req) => {
    const dir = await projects.dir(req.params.p);
    return { entries: await files.tree(dir, req.query.path, req.query.all === '1') };
  });
  app.get<{ Params: P; Querystring: { path?: string } }>('/api/projects/:p/file', read, async (req, reply) => {
    const dir = await projects.dir(req.params.p);
    const f = await files.read(dir, str(req.query.path, 'path'));
    reply.header('etag', `"${f.etag}"`).header('cache-control', 'no-store');
    return f;
  });
  app.put<{ Params: P; Querystring: { path?: string } }>('/api/projects/:p/file', write, async (req) => {
    const dir = await projects.dir(req.params.p);
    const b = body<{ content: unknown }>(req);
    const ifMatch = String(req.headers['if-match'] ?? '').replace(/^W\//, '').replace(/"/g, '') || undefined;
    return files.write(dir, str(req.query.path, 'path'), str(b.content, 'content'), ifMatch);
  });
  app.post<{ Params: P }>('/api/projects/:p/files', write, async (req) => {
    const dir = await projects.dir(req.params.p);
    const b = body<{ path: unknown; type: unknown }>(req);
    if (b.type !== 'file' && b.type !== 'dir') throw new HttpError(400, 'type phải là "file" hoặc "dir"', 'bad_request');
    return files.create(dir, str(b.path, 'path'), b.type);
  });
  app.post<{ Params: P }>('/api/projects/:p/rename', write, async (req) => {
    const dir = await projects.dir(req.params.p);
    const b = body<{ from: unknown; to: unknown }>(req);
    return files.rename(dir, str(b.from, 'from'), str(b.to, 'to'));
  });

  // ---- live stream (SSE) -----------------------------------------------------------
  app.get<{ Querystring: { project?: string; session?: string; after?: string } }>('/api/stream', read, async (req, reply) => {
    const { project, session } = req.query;
    let projectDir: string | null = null;
    if (project) projectDir = await projects.dir(project);
    if (session && !/^[0-9a-f-]{36}$/i.test(session)) throw new HttpError(400, 'session không hợp lệ', 'bad_request');
    const lastEventId = Number(req.headers['last-event-id'] ?? req.query.after ?? 0) || 0;

    const channels = new Set<string>([GLOBAL_CHANNEL]);
    if (project) channels.add(projectChannel(project));
    if (session) channels.add(sessionChannel(session));

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (ev: BusEvent) => {
      const data = JSON.stringify({ channel: ev.channel, kind: ev.kind, itemKey: ev.itemKey ?? null, payload: ev.payload, at: ev.at, seq: ev.seq });
      res.write(`${ev.seq !== null ? `id: ${ev.seq}\n` : ''}data: ${data}\n\n`);
    };
    res.write('retry: 3000\n\n');

    // Subscribe first, buffer, replay persisted events, then flush the buffer (no gaps, no dupes).
    let replaying = true;
    let replayedUpTo = lastEventId;
    const buffer: BusEvent[] = [];
    const unsubscribe = journal.subscribe((ev) => {
      if (!channels.has(ev.channel)) return;
      if (replaying) buffer.push(ev);
      else if (ev.seq === null || ev.seq > replayedUpTo) write(ev);
    });
    if (session) {
      for (const ev of journal.since(session, lastEventId)) {
        write({ channel: sessionChannel(session), kind: ev.kind, seq: ev.seq, itemKey: ev.itemKey, payload: ev.payload, at: ev.at });
        replayedUpTo = ev.seq;
      }
      const live = manager.runnerState(session);
      res.write(`data: ${JSON.stringify({ kind: 'hello', payload: { session, live, replayedUpTo } })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ kind: 'hello', payload: { replayedUpTo } })}\n\n`);
    }
    replaying = false;
    for (const ev of buffer) if (ev.seq === null || ev.seq > replayedUpTo) write(ev);

    const release = project && projectDir ? d.watchers.acquire(project, projectDir) : () => undefined;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      release();
    });
  });

  // ---- frontend (production build) ---------------------------------------------------
  if (d.webDist && existsSync(path.join(d.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: d.webDist, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.type('text/html').sendFile('index.html');
      return reply.status(404).send({ error: 'Không tìm thấy', code: 'not_found' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Không tìm thấy (frontend chưa build?)', code: 'not_found' }));
  }

  return app;
}
