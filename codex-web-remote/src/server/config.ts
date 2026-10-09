import "dotenv/config";
import path from "node:path";
import { realpathSync, statSync } from "node:fs";
export function config(env: NodeJS.ProcessEnv = process.env) {
  const positive = (k: string, d: number, max = Number.MAX_SAFE_INTEGER) => {
    const n = Number(env[k] || d);
    if (!Number.isSafeInteger(n) || n <= 0 || n > max)
      throw new Error(`${k} phải là số nguyên 1–${max}`);
    return n;
  };
  const roots: unknown = JSON.parse(env.PROJECT_ROOTS || "[]");
  if (!Array.isArray(roots) || !roots.length)
    throw new Error(
      "PROJECT_ROOTS phải là mảng đường dẫn có thật. Chạy npm run setup.",
    );
  const resolved = roots.map((p) => {
    if (typeof p !== "string" || !path.isAbsolute(p) || p.includes("/USER/"))
      throw new Error("PROJECT_ROOTS không hợp lệ");
    const r = realpathSync(p);
    if (!statSync(r).isDirectory())
      throw new Error("Project root phải là thư mục");
    return r;
  });
  const port = positive("PORT", 3000, 65535),
    host = env.HOST || "127.0.0.1";
  const url = new URL(env.PUBLIC_URL || `http://${host}:${port}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("PUBLIC_URL phải là origin http(s)");
  const scope = env.SESSION_LIST_SCOPE || "all_codex_home";
  if (!["all_codex_home", "allowed_projects"].includes(scope))
    throw new Error("SESSION_LIST_SCOPE sai");
  const hidden: unknown = JSON.parse(
    env.TREE_HIDDEN ||
      '["node_modules",".git","dist","build","vendor",".venv","__pycache__"]',
  );
  if (!Array.isArray(hidden) || !hidden.every((x) => typeof x === "string"))
    throw new Error("TREE_HIDDEN sai");
  return {
    name: env.APP_NAME || "Codex Remote",
    label: env.SERVER_LABEL || "local",
    host,
    port,
    origin: url.origin,
    secure: url.protocol === "https:",
    data: path.resolve(env.DATA_DIR || "data"),
    bin: env.CODEX_BIN || "codex",
    codexHome: env.CODEX_HOME || undefined,
    roots: resolved,
    scope,
    ttl: positive("SESSION_TTL_HOURS", 24) * 3600_000,
    usageRefresh: positive("USAGE_REFRESH_SECONDS", 60) * 1000,
    retention: positive("EVENT_RETENTION_DAYS", 30) * 86400_000,
    journalMax: positive("EVENT_JOURNAL_MAX_BYTES", 1073741824),
    viewMax: positive("FILE_MAX_VIEW_BYTES", 2097152),
    saveMax: positive("FILE_MAX_SAVE_BYTES", 2097152),
    hidden: hidden as string[],
  };
}
export type Config = ReturnType<typeof config>;
