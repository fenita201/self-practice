import { config } from "./config.js";
import { createApp } from "./app.js";
import { instanceLock } from "./instance.js";
let release: (() => void) | undefined;
try {
  const cfg = config();
  release = instanceLock(cfg.data);
  const { app, startRuntime } = await createApp(cfg);
  await app.listen({ host: cfg.host, port: cfg.port });
  console.log(`Codex Remote: ${cfg.origin} (${cfg.host}:${cfg.port})`);
  void startRuntime();
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      void app.close().finally(() => {
        release?.();
        process.exit(0);
      });
    });
} catch (e) {
  release?.();
  console.error(
    (e as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? "PORT đang bận; đổi PORT và PUBLIC_URL hoặc dừng process cũ."
      : (e as Error).message,
  );
  process.exitCode = 1;
}
