/**
 * Set (or reset) the single web login password. Logs out every browser.
 *   npm run set-password                 (interactive, hidden input)
 *   CR_PASSWORD=... npm run set-password (non-interactive, e.g. provisioning)
 */
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setPassword } from '../auth.js';
import { ConfigError, loadConfig, loadDotEnv } from '../config.js';
import { openDb } from '../db.js';

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main(): Promise<void> {
  loadDotEnv(path.join(process.cwd(), '.env'));
  const config = loadConfig();
  let password = process.env.CR_PASSWORD ?? '';
  if (!password) {
    if (!process.stdin.isTTY) throw new Error('Không có TTY: đặt biến CR_PASSWORD để chạy không tương tác.');
    password = await ask('Password mới (>= 8 ký tự): ');
    const again = await ask('Nhập lại: ');
    if (password !== again) throw new Error('Hai lần nhập không khớp.');
  }
  const db = openDb(config.dataDir);
  await setPassword(db, password);
  db.close();
  console.log(`Đã đặt password. DB: ${path.join(config.dataDir, 'claude-remote.sqlite')}. Mọi phiên đăng nhập cũ đã bị đăng xuất.`);
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? err.message : `Lỗi: ${(err as Error).message}`);
  process.exit(1);
});
