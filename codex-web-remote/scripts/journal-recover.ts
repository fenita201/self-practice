import { config } from "../src/server/config.js";
import { Store } from "../src/server/store.js";
import { existsSync } from "node:fs";
import path from "node:path";
const cfg = config();
if (existsSync(path.join(cfg.data, "instance.lock")))
  throw new Error(
    "Dừng app trước khi journal:recover; nếu crash kiểm tra stale lock trước.",
  );
const s = new Store(cfg.data);
try {
  if (s.bytes() >= cfg.journalMax)
    throw new Error(
      "Budget vẫn đầy; tăng EVENT_JOURNAL_MAX_BYTES hoặc kiểm tra retention, không xóa active events",
    );
  s.db.prepare("DELETE FROM settings WHERE key='journalDegraded'").run();
  console.log(
    "Đã mở lại journal. Badge incomplete của các thread từng thiếu output vẫn giữ.",
  );
} finally {
  s.close();
}
