import { existsSync } from "node:fs";
import { writeFile, mkdir, chmod, realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
const args = process.argv.slice(2);
const option = (key: string) => {
  const i = args.indexOf("--" + key);
  return i >= 0 ? args[i + 1] : undefined;
};
if (existsSync(".env")) {
  console.log(".env đã tồn tại; không ghi đè. Sửa thủ công nếu cần.");
  process.exit(0);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
async function ask(key: string, label: string, fallback: string) {
  const supplied = option(key);
  if (supplied) return supplied;
  if (!process.stdin.isTTY) return fallback;
  return (await rl.question(`${label} [${fallback}]: `)).trim() || fallback;
}
try {
  const root = await ask(
    "root",
    "Project root (không tự chọn toàn home)",
    path.resolve("workspace"),
  );
  if (root === path.resolve("workspace"))
    await mkdir(root, { recursive: true });
  const resolved = await realpath(root);
  if (resolved === process.cwd())
    throw new Error("Không tự dùng repo triển khai làm workspace Codex");
  const host = await ask("host", "Listen host", "127.0.0.1");
  const port = await ask("port", "Port", "3000");
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("Port phải từ 1–65535");
  const origin = await ask(
    "public-url",
    "Public URL",
    `http://${host}:${port}`,
  );
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Public URL không hợp lệ");
  if (/[\r\n]/.test(host)) throw new Error("Host sai");
  const env = `APP_NAME=Codex Remote\nSERVER_LABEL=local\nHOST=${host}\nPORT=${port}\nPUBLIC_URL=${url.origin}\nDATA_DIR=./data\nCODEX_BIN=codex\nCODEX_HOME=\nPROJECT_ROOTS=${JSON.stringify([resolved])}\nSESSION_LIST_SCOPE=all_codex_home\nSESSION_TTL_HOURS=24\nUSAGE_REFRESH_SECONDS=60\nEVENT_RETENTION_DAYS=30\nEVENT_JOURNAL_MAX_BYTES=1073741824\nFILE_MAX_VIEW_BYTES=2097152\nFILE_MAX_SAVE_BYTES=2097152\nTREE_HIDDEN=["node_modules",".git","dist","build","vendor",".venv","__pycache__"]\n`;
  await writeFile(".env", env, { flag: "wx", mode: 0o600 });
  await chmod(".env", 0o600);
  await mkdir("data", { recursive: true, mode: 0o700 });
  console.log(
    `Đã tạo .env. Root: ${resolved}; URL: ${url.origin}. Chạy npm run set-password.`,
  );
  if (host === "0.0.0.0")
    console.log(
      "HOST=0.0.0.0 listen trên mọi interface; cấu hình ZeroTier/IP cụ thể để giới hạn.",
    );
} finally {
  rl.close();
}
