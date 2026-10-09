import { config } from "../src/server/config.js";
import { Store, passwordHash } from "../src/server/store.js";
async function hidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(
      "Cần terminal để nhập password kín. Automation: dùng --stdin và truyền hai dòng qua stdin an toàn.",
    );
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const data = (b: Buffer) => {
      for (const c of b.toString()) {
        if (c === "\u0003") {
          cleanup();
          reject(new Error("Đã hủy"));
          return;
        }
        if (c === "\r" || c === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (c === "\u007f") value = value.slice(0, -1);
        else if (c >= " ") value += c;
      }
    };
    const cleanup = () => {
      process.stdin.off("data", data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    process.stdin.on("data", data);
  });
}
let first: string, second: string;
if (process.argv.includes("--stdin")) {
  let data = "";
  for await (const b of process.stdin) data += b;
  [first, second] = data.replace(/\r?\n$/, "").split(/\r?\n/);
} else {
  first = await hidden("Password (ít nhất 12 ký tự): ");
  second = await hidden("Xác nhận: ");
}
if (!first || first.length < 12 || first !== second)
  throw new Error("Password ngắn hoặc xác nhận không khớp");
const store = new Store(config().data);
try {
  store.set("password", passwordHash(first));
  store.db.exec("DELETE FROM sessions");
  console.log("Đã lưu hash; các phiên đăng nhập cũ đã bị thu hồi.");
} finally {
  store.close();
}
