import { config } from "../src/server/config.js";
import { Adapter } from "../src/server/adapter.js";
import { Store } from "../src/server/store.js";
import { execFileSync } from "node:child_process";
let failed = false;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "PENDING"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
try {
  const cfg = config();
  check(
    "Config",
    true,
    `${cfg.host}:${cfg.port}; ${cfg.roots.length} roots hợp lệ`,
  );
  check("Node", process.versions.node.startsWith("24."), process.versions.node);
  const db = new Store(cfg.data);
  check(
    "Password",
    !!db.setting("password"),
    "Hash bootstrap " +
      (db.setting("password") ? "đã có" : "chưa có; npm run set-password"),
  );
  db.close();
  try {
    check(
      "Codex binary",
      true,
      execFileSync(cfg.bin, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    check("Codex binary", false, "Không tìm thấy; sửa CODEX_BIN / PATH");
  }
  const adapter = new Adapter(cfg);
  await adapter.start();
  check("Initialize", adapter.ready, adapter.error || adapter.version);
  if (adapter.ready) {
    const r = await adapter.call("account/read", { refreshToken: false });
    check(
      "Auth",
      !!r.account,
      "Loại: " +
        (r.account?.type || "Không có; chạy codex login bằng service user"),
    );
    const list = await adapter.call("thread/list", {
      limit: 1,
      sourceKinds: [
        "cli",
        "appServer",
        "exec",
        "vscode",
        "subAgent",
        "unknown",
      ],
    });
    check(
      "Thread list",
      Array.isArray(list.data),
      "Metadata truy xuất được; không in transcript",
    );
  }
  adapter.stop();
} catch (e) {
  check("Doctor", false, (e as Error).message);
}
process.exitCode = failed ? 1 : 0;
