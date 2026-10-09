import { config } from "../src/server/config.js";
import { createApp } from "../src/server/app.js";
import { hash } from "../src/server/store.js";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
const root = path.resolve(".test-data/regression/projects");
await mkdir(root, { recursive: true });
const cfg = {
  ...config(),
  roots: [root],
  data: path.resolve(".test-data/regression/data"),
};
const { app, store, runtime, startRuntime } = await createApp(cfg);
const token = randomBytes(32).toString("hex"),
  csrf = randomBytes(32).toString("hex");
store.db
  .prepare("INSERT INTO sessions VALUES(?,?,?)")
  .run(hash(token), csrf, Date.now() + 600000);
const headers = {
  cookie: "session=" + token,
  origin: cfg.origin,
  "x-csrf-token": csrf,
};
const check = (r: any) => {
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json();
};
let id = "",
  turn = "";
const result: any = { at: new Date().toISOString(), testProject: root };
try {
  await startRuntime();
  if (!runtime.ready) throw new Error(runtime.error || "Runtime unavailable");
  const t = check(
    await app.inject({
      method: "POST",
      url: "/api/threads",
      headers,
      payload: { project: root },
    }),
  );
  id = t.id;
  result.thread = id;
  result.emptyHistory = check(
    await app.inject({ url: `/api/threads/${id}/history`, headers }),
  );
  result.freshSessionVisible = check(
    await app.inject({ url: "/api/threads", headers }),
  ).data.some((t: any) => t.id === id);
  const start = check(
    await app.inject({
      method: "POST",
      url: `/api/threads/${id}/turn`,
      headers,
      payload: {
        prompt:
          "Use a shell command to sleep 15 seconds, then reply REGRESSION_INITIAL. Do not read or modify files. Wait for the shell command before replying.",
        clientRequestId: randomBytes(16).toString("hex"),
      },
    }),
  );
  turn = start.turn.id;
  result.turn = turn;
  result.steer = check(
    await app.inject({
      method: "POST",
      url: `/api/threads/${id}/steer`,
      headers,
      payload: {
        prompt:
          "After the wait, replace the final reply with exactly STEER_REGRESSION_OK.",
        clientRequestId: randomBytes(16).toString("hex"),
      },
    }),
  );
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const s = store.thread(id);
    if (
      s?.state === "idle" ||
      s?.state === "failed" ||
      s?.state === "interrupted"
    )
      break;
    if (s?.state.startsWith("waiting"))
      throw new Error("Live test waiting for approval/input");
    await new Promise((r) => setTimeout(r, 500));
  }
  result.finalState = store.thread(id)?.state;
  const h = check(
    await app.inject({ url: `/api/threads/${id}/history`, headers }),
  );
  result.steerMessagePersisted = JSON.stringify(h).includes(
    "After the wait, replace the final reply",
  );
  result.finalMarker = JSON.stringify(h).includes("STEER_REGRESSION_OK");
  result.pass =
    result.emptyHistory.data.length === 0 &&
    result.freshSessionVisible &&
    result.finalState === "idle" &&
    result.steerMessagePersisted &&
    result.finalMarker;
  if (!result.pass) throw new Error("Live regression checks failed");
} catch (e) {
  result.error = (e as Error).message;
  result.pass = false;
  if (
    id &&
    turn &&
    ["running", "waiting_input", "waiting_approval"].includes(
      store.thread(id)?.state || "",
    )
  )
    await app.inject({
      method: "POST",
      url: `/api/threads/${id}/interrupt`,
      headers,
      payload: {},
    });
  process.exitCode = 1;
} finally {
  await writeFile(
    "docs/evidence/chat-session-steer-live.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}
