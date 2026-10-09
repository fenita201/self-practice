import {
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
  unlinkSync,
  lstatSync,
} from "node:fs";
import path from "node:path";
export function instanceLock(data: string) {
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const file = path.join(data, "instance.lock");
  const acquire = () => {
    const fd = openSync(file, "wx", 0o600);
    writeFileSync(
      fd,
      JSON.stringify({ application: "codex-remote", pid: process.pid }),
    );
    closeSync(fd);
  };
  try {
    acquire();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (lstatSync(file).isSymbolicLink())
      throw new Error("Instance lock là symlink; kiểm tra data directory");
    const previous = JSON.parse(readFileSync(file, "utf8"));
    if (
      previous.application !== "codex-remote" ||
      !Number.isSafeInteger(previous.pid) ||
      previous.pid < 1
    )
      throw new Error("Instance lock không hợp lệ; kiểm tra thủ công");
    try {
      process.kill(previous.pid, 0);
      throw new Error(
        "DATA_DIR đang được một backend khác dùng; dừng instance cũ hoặc dùng DATA_DIR khác",
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
    unlinkSync(file);
    acquire();
  }
  return () => {
    try {
      const v = JSON.parse(readFileSync(file, "utf8"));
      if (v.pid === process.pid) unlinkSync(file);
    } catch {}
  };
}
