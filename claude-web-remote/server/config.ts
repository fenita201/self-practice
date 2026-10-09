import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const jsonStringArray = z.string().transform((raw, ctx) => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed as string[];
  } catch {
    /* handled below */
  }
  ctx.addIssue({ code: 'custom', message: 'phải là JSON array các string, ví dụ ["node_modules",".git"]' });
  return z.NEVER;
});

const intIn = (min: number, max: number) =>
  z.coerce.number().int().min(min, `phải >= ${min}`).max(max, `phải <= ${max}`);

const schema = z.object({
  APP_NAME: z.string().default('Claude Remote'),
  SERVER_LABEL: z.string().default('server'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: intIn(1, 65535).default(3000),
  DEV_UI_PORT: intIn(1, 65535).default(5173),
  PUBLIC_URL: z.string().url('phải là URL đầy đủ, ví dụ http://10.147.17.5:3000').optional(),
  DATA_DIR: z.string().default('./data'),
  WORKSPACE_ROOT: z.string().min(1, 'bắt buộc'),
  CLAUDE_BIN: z.string().default('claude'),
  CLAUDE_CONFIG_DIR: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  DEFAULT_PERMISSION_MODE: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk', 'auto']).default('default'),
  MAX_ACTIVE_SESSIONS: intIn(1, 50).default(3),
  SESSION_IDLE_TIMEOUT_MIN: intIn(1, 24 * 60).default(10),
  INPUT_WAIT_TIMEOUT_MIN: intIn(1, 24 * 60).default(10),
  FILE_MAX_VIEW_BYTES: intIn(1024, 50 * 1024 * 1024).default(2 * 1024 * 1024),
  FILE_MAX_SAVE_BYTES: intIn(1024, 50 * 1024 * 1024).default(2 * 1024 * 1024),
  TREE_HIDDEN: jsonStringArray.default(['node_modules', '.git', 'dist', 'build', 'vendor', '.venv', '__pycache__']),
  SESSION_TTL_HOURS: intIn(1, 24 * 365).default(24),
  JOURNAL_RETENTION_DAYS: intIn(1, 3650).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema> & {
  dataDir: string;
  workspaceRoot: string;
  publicOrigin: string | null;
};

/** Empty strings in env files mean "unset" so defaults apply. */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(cleanEnv(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Cấu hình không hợp lệ (kiểm tra file .env):\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  const workspaceRoot = path.resolve(c.WORKSPACE_ROOT);
  if (!existsSync(workspaceRoot) || !statSync(workspaceRoot).isDirectory()) {
    throw new ConfigError(
      `WORKSPACE_ROOT=${workspaceRoot} không tồn tại hoặc không phải thư mục. Tạo nó trước: mkdir -p ${workspaceRoot}`,
    );
  }
  const dataDir = path.resolve(c.DATA_DIR);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    ...c,
    dataDir,
    workspaceRoot,
    publicOrigin: c.PUBLIC_URL ? new URL(c.PUBLIC_URL).origin : null,
  };
}

/** Minimal .env loader (KEY=VALUE, # comments, optional quotes). Real env vars win. */
export function loadDotEnv(file: string, target: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (target[key] === undefined) target[key] = value;
  }
}
