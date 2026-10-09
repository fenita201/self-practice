import { config } from "../src/server/config.js";
import { Store } from "../src/server/store.js";
import path from "node:path";
import { chmodSync, existsSync } from "node:fs";
const i = process.argv.indexOf("--out");
if (i < 0 || !process.argv[i + 1])
  throw new Error("Usage: npm run backup -- --out /safe/path/app.sqlite");
const out = path.resolve(process.argv[i + 1]);
if (existsSync(out)) throw new Error("Backup target tồn tại; chọn file mới");
const store = new Store(config().data);
try {
  store.db.prepare("VACUUM INTO ?").run(out);
  chmodSync(out, 0o600);
  console.log("SQLite snapshot đã lưu: " + out);
} finally {
  store.close();
}
