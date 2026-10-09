import { config } from "../src/server/config.js";
import { createApp } from "../src/server/app.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hash } from "../src/server/store.js";
const original = config();
const project = path.join(original.roots[0], ".codex-remote-live-test");
await mkdir(project, { recursive: true });
await writeFile(
  path.join(project, "SMOKE.md"),
  "Codex Remote live smoke test\n",
  { flag: "wx" },
).catch((e) => {
  if (e.code !== "EEXIST") throw e;
});
const cfg = { ...original, data: path.join(original.data, "live-smoke") };
const { app, store, runtime, startRuntime } = await createApp(cfg);
const cookie = randomBytes(32).toString("hex"),
  csrf = randomBytes(32).toString("hex");
store.db
  .prepare("INSERT INTO sessions VALUES(?,?,?)")
  .run(hash(cookie), csrf, Date.now() + 600000);
const headers = {
  cookie: "session=" + cookie,
  origin: cfg.origin,
  "x-csrf-token": csrf,
};
let threadId = "",
  turnId = "";
const reconcileOnly = process.argv.includes("--reconcile");
const counts: Record<string, number> = {};
try {
  await startRuntime();
  if (!runtime.ready) throw new Error(runtime.error || "Missing binary");
  const auth = await runtime.call("account/read", { refreshToken: false });
  if (!auth.account) throw new Error("Missing auth; codex login");
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = app.listeningOrigin;
  const previous = reconcileOnly
    ? (store.db
        .prepare("SELECT * FROM submissions ORDER BY rowid DESC LIMIT 1")
        .get() as any)
    : null;
  if (reconcileOnly && !previous)
    throw new Error("No previous dispatched smoke");
  const create = await app.inject({
    method: previous ? "GET" : "POST",
    url: previous ? "/api/threads/" + previous.thread : "/api/threads",
    headers,
    ...(previous ? {} : { payload: { project } }),
  });
  if (create.statusCode !== 200) throw new Error(create.body);
  threadId = create.json().id;
  runtime.events.on("event", (e: any) => {
    if (e.params.threadId === threadId)
      counts[e.method] = (counts[e.method] || 0) + 1;
  });
  const payload = previous
    ? { ...JSON.parse(previous.payload), clientRequestId: previous.id }
    : {
        prompt:
          "Read SMOKE.md using a shell command, then reply exactly REMOTE_SMOKE_OK. Do not modify any files.",
        clientRequestId: randomBytes(16).toString("hex"),
      };
  const send = previous
    ? {
        statusCode: 200,
        json: () => JSON.parse(previous.result),
        body: "previous",
      }
    : await app.inject({
        method: "POST",
        url: `/api/threads/${threadId}/turn`,
        headers,
        payload,
      });
  if (send.statusCode !== 200) throw new Error(send.body);
  turnId = send.json().turn.id;
  const retry = await app.inject({
    method: "POST",
    url: `/api/threads/${threadId}/turn`,
    headers,
    payload,
  });
  if (!retry.json().deduplicated)
    throw new Error("Dedupe failed: " + retry.statusCode + " " + retry.body);
  const controller = new AbortController();
  const stream = await fetch(base + `/api/threads/${threadId}/events`, {
    headers: { cookie: headers.cookie },
    signal: controller.signal,
  });
  if (stream.status !== 200)
    throw new Error(
      "SSE failed: " + stream.status + " " + (await stream.text()),
    );
  const reader = stream.body!.getReader();
  await reader.read();
  controller.abort();
  await reader.cancel().catch(() => {});
  const started = Date.now();
  let after = 0;
  const seqs = new Set<number>();
  let finalState = "running";
  while (Date.now() - started < 120000) {
    const j = (
      await app.inject({
        url: `/api/threads/${threadId}/journal?after=${after}`,
        headers,
      })
    ).json();
    for (const row of j.data) {
      if (seqs.has(row.seq)) throw new Error("Duplicate replay");
      seqs.add(row.seq);
      after = row.seq;
    }
    finalState = store.thread(threadId)?.state || "unknown";
    if (
      [
        "idle",
        "failed",
        "interrupted",
        "waiting_input",
        "waiting_approval",
      ].includes(finalState)
    )
      break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (finalState !== "idle")
    throw new Error(`Turn ${finalState}; không tự resubmit`);
  const replay = (
    await app.inject({
      url: `/api/threads/${threadId}/journal?after=0`,
      headers,
    })
  ).json();
  if (replay.data.length !== seqs.size) throw new Error("Journal mismatch");
  const reconnectController = new AbortController();
  const reconnect = await fetch(
    base + `/api/threads/${threadId}/events?after=0`,
    { headers: { cookie: headers.cookie }, signal: reconnectController.signal },
  );
  const rr = reconnect.body!.getReader();
  const block = new TextDecoder().decode((await rr.read()).value);
  if (!block.includes("data:")) throw new Error("SSE replay missing");
  reconnectController.abort();
  await rr.cancel().catch(() => {});
  const h = (
    await app.inject({ url: `/api/threads/${threadId}/history`, headers })
  ).json();
  const has = h.data.some((t: any) =>
    t.items.some((i: any) => i.text?.includes("REMOTE_SMOKE_OK")),
  );
  if (!has) throw new Error("History final missing");
  const log = await app.inject({
    url: `/api/threads/${threadId}/log`,
    headers,
  });
  if (log.statusCode !== 200) throw new Error("Log download failed");
  const report = {
    pass: true,
    threadId,
    turnId,
    counts,
    journalEvents: seqs.size,
    historyTurns: h.data.length,
    dedupe: true,
    SSEDisconnectWithoutInterrupt: true,
    SSEReplay: true,
    source: "real backend + app-server",
    externalLive: "separate probe required",
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/live-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("PENDING/FAIL live smoke: " + (e as Error).message);
  process.exitCode = 1;
  if (
    turnId &&
    ["running", "waiting_input", "waiting_approval"].includes(
      store.thread(threadId)?.state || "",
    )
  )
    await runtime.call("turn/interrupt", { threadId, turnId }).catch(() => {});
} finally {
  await app.close();
}
