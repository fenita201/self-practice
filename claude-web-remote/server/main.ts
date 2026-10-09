import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { Auth } from './auth.js';
import { SessionManager } from './claude/manager.js';
import { loadRealSdk } from './claude/sdk.js';
import { ConfigError, loadConfig, loadDotEnv } from './config.js';
import { openDb } from './db.js';
import { FileService } from './files.js';
import { GLOBAL_CHANNEL, Journal } from './journal.js';
import { Projects } from './projects.js';
import { ProjectWatchers } from './watcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/main.js -> repo root is two levels up; server/main.ts (tsx dev) -> one level up.
const repoRoot = existsSync(path.join(here, '..', '..', 'package.json')) ? path.resolve(here, '..', '..') : path.resolve(here, '..');

/** Resolve CLAUDE_BIN: "builtin" = SDK-bundled CLI; a bare name is looked up on PATH. */
function resolveClaudeBin(value: string): string | undefined {
  if (value === 'builtin') return undefined;
  const candidates = value.includes('/') || value.includes('\\')
    ? [path.resolve(value)]
    : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap((d) => [path.join(d, value), path.join(d, `${value}.exe`), path.join(d, `${value}.cmd`)]);
  for (const c of candidates) {
    try {
      accessSync(c, constants.X_OK);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new ConfigError(
    `Không tìm thấy Claude CLI "${value}". systemd không dùng PATH của shell: đặt CLAUDE_BIN là đường dẫn tuyệt đối (xem: which claude), hoặc CLAUDE_BIN=builtin để dùng bản CLI đi kèm SDK.`,
  );
}

async function main(): Promise<void> {
  loadDotEnv(path.join(process.cwd(), '.env'));
  // An empty ANTHROPIC_API_KEY/CLAUDE_CONFIG_DIR must not reach the Claude process as "set".
  for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR']) if (process.env[k] !== undefined && !process.env[k]!.trim()) delete process.env[k];

  const config = loadConfig();
  const claudeBin = resolveClaudeBin(config.CLAUDE_BIN);
  const db = openDb(config.dataDir);
  const journal = new Journal(db);
  const projects = new Projects(config.workspaceRoot);
  const files = new FileService({ maxViewBytes: config.FILE_MAX_VIEW_BYTES, maxSaveBytes: config.FILE_MAX_SAVE_BYTES, hiddenNames: config.TREE_HIDDEN });

  const devOrigins = process.env.NODE_ENV === 'production' ? [] : [`http://localhost:${config.DEV_UI_PORT}`, `http://127.0.0.1:${config.DEV_UI_PORT}`];
  const auth = new Auth(db, {
    ttlMs: config.SESSION_TTL_HOURS * 3_600_000,
    allowedOrigins: () => [...(config.publicOrigin ? [config.publicOrigin] : []), ...devOrigins],
  });

  const sdk = await loadRealSdk();
  // Logger is created by Fastify; the manager logs through it once the app exists.
  const logRef: { current: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; debug: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void } } = {
    current: console as never,
  };
  const log = {
    info: (o: unknown, m?: string) => logRef.current.info(o, m),
    warn: (o: unknown, m?: string) => logRef.current.warn(o, m),
    debug: (o: unknown, m?: string) => logRef.current.debug(o, m),
    error: (o: unknown, m?: string) => logRef.current.error(o, m),
  };
  const manager = new SessionManager(
    db,
    journal,
    sdk,
    {
      maxActiveSessions: config.MAX_ACTIVE_SESSIONS,
      idleTimeoutMs: config.SESSION_IDLE_TIMEOUT_MIN * 60_000,
      inputTimeoutMs: config.INPUT_WAIT_TIMEOUT_MIN * 60_000,
      defaultPermissionMode: config.DEFAULT_PERMISSION_MODE,
      claudeBin,
      probeCwd: config.workspaceRoot,
      externalBusyWindowMs: 2 * 60_000,
    },
    log,
    (p) => projects.dir(p),
  );
  const watchers = new ProjectWatchers(journal, config.TREE_HIDDEN, log);

  const webDist = path.join(repoRoot, 'dist', 'web');
  const app = await buildApp({ config, db, auth, journal, manager, files, projects, watchers, webDist });
  logRef.current = app.log as never;

  manager.reconcileAfterRestart();
  const housekeeping = setInterval(() => {
    auth.pruneExpired();
    const n = journal.prune(config.JOURNAL_RETENTION_DAYS);
    if (n) app.log.info({ deleted: n }, 'pruned old journal events');
  }, 3_600_000);
  housekeeping.unref();

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      app.log.fatal(`Port ${config.PORT} trên ${config.HOST} đang bị process khác dùng. Đổi PORT trong .env hoặc dừng process đó (ss -ltnp | grep :${config.PORT}).`);
    } else if (code === 'EADDRNOTAVAIL') {
      app.log.fatal(`HOST=${config.HOST} không phải IP của máy này (ZeroTier đã lên chưa? kiểm tra: ip addr).`);
    } else {
      app.log.fatal({ err }, 'listen failed');
    }
    process.exit(1);
  }
  if (config.HOST === '0.0.0.0' || config.HOST === '::') {
    app.log.warn('HOST=0.0.0.0: web đang mở trên MỌI network interface, không chỉ ZeroTier.');
  }
  app.log.info({ workspace: config.workspaceRoot, claudeBin: claudeBin ?? 'builtin (SDK)', apiKeyFromEnv: !!process.env.ANTHROPIC_API_KEY }, `${config.APP_NAME} sẵn sàng`);
  if (!existsSync(path.join(webDist, 'index.html'))) app.log.warn('Chưa có frontend build (dist/web). Chạy: npm run build');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.warn({ signal }, 'shutting down: ending active Claude sessions');
    journal.ephemeral(GLOBAL_CHANNEL, 'server_shutdown', { signal });
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    await manager.shutdown().catch((err) => app.log.error({ err }, 'error ending sessions'));
    await watchers.closeAll().catch(() => undefined);
    await app.close().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`\n${err.message}\n`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});
