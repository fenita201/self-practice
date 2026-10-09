// One deliberate, isolated CLI task. Uses only supported app-server history APIs to observe it.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../src/server/config.js";
import { Adapter } from "../src/server/adapter.js";
import { sources } from "../src/server/app.js";
const cfg = config();
const cwd = path.join(cfg.roots[0], ".codex-remote-cli-probe");
await mkdir(cwd, { recursive: true });
const adapter = new Adapter(cfg);
let child: ReturnType<typeof spawn> | undefined;
let foundId = "";
let notifications = 0;
let observedActive = false;
let historyDuring = 0;
const samples: any[] = [];
try {
  await adapter.start();
  if (!adapter.ready) throw new Error(adapter.error || "Not ready");
  const auth = await adapter.call("account/read", { refreshToken: false });
  if (!auth.account) throw new Error("Missing auth");
  let done = false;
  let exit: number | null = null;
  child = spawn(
    cfg.bin,
    [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-C",
      cwd,
      "Run the shell command sleep 8, then reply exactly CLI_PROBE_OK. Do not modify files.",
    ],
    {
      env: {
        ...process.env,
        ...(cfg.codexHome ? { CODEX_HOME: cfg.codexHome } : {}),
      },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  child.on("error", () => {
    done = true;
  });
  child.on("exit", (code) => {
    done = true;
    exit = code;
  });
  adapter.events.on("event", (e: any) => {
    if (e.params?.threadId === foundId) notifications++;
  });
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const r = await adapter.call("thread/list", {
      cwd,
      sourceKinds: sources as any,
      limit: 10,
      sortKey: "updated_at",
    });
    const thread = r.data[0];
    if (thread) {
      foundId = thread.id;
      const h = await adapter
        .call("thread/turns/list", {
          threadId: foundId,
          limit: 5,
          itemsView: "full",
        })
        .catch(() => ({ data: [] }));
      const itemCount = h.data.reduce(
        (n: number, t: any) => n + t.items.length,
        0,
      );
      if (!done) {
        observedActive = true;
        historyDuring = Math.max(historyDuring, itemCount);
      }
      samples.push({
        elapsedMs: Date.now() - start,
        processStillRunning: !done,
        runtimeStatus: thread.status?.type,
        items: itemCount,
      });
    }
    if (done) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!done) throw new Error("CLI timeout; no automatic replay");
  const report = {
    source: "real external codex exec + independent app-server",
    cwd,
    threadId: foundId,
    exitCode: exit,
    observedWhileProcessRunning: observedActive,
    maxPersistedItemsDuringProcess: historyDuring,
    externalNotifications: notifications,
    samples,
    liveSupported: notifications > 0,
    limitation:
      "No thread/resume, turn/start, raw JSONL or TUI scrape used. Persisted history is not proof of live subscription.",
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/external-cli-probe.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
  child?.kill("SIGTERM");
} finally {
  adapter.stop();
}
