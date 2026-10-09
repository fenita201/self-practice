import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { config } from "../src/server/config.js";
import { Store, passwordHash, verifyPassword } from "../src/server/store.js";
import { Files, Locks } from "../src/server/paths.js";
import { Adapter, RpcError } from "../src/server/adapter.js";
import { requestId } from "../src/shared/request-id.js";
import { reconcile, itemText } from "../src/shared/timeline.js";
import { createApp } from "../src/server/app.js";
import { Fixture } from "./fixture.js";
async function context() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-remote-test-"));
  const root = path.join(dir, "projects");
  await mkdir(root);
  await mkdir(path.join(root, "alpha"));
  await mkdir(path.join(root, "beta"));
  const cfg = config({
    PROJECT_ROOTS: JSON.stringify([root]),
    DATA_DIR: path.join(dir, "data"),
    PUBLIC_URL: "http://localhost:3000",
  });
  return { dir, root, cfg };
}
test("config validates positive limits and scope", async () => {
  const { root } = await context();
  assert.throws(() =>
    config({ PROJECT_ROOTS: JSON.stringify([root]), PORT: "65536" }),
  );
  assert.throws(() =>
    config({
      PROJECT_ROOTS: JSON.stringify([root]),
      FILE_MAX_SAVE_BYTES: "-1",
    }),
  );
  assert.throws(() =>
    config({
      PROJECT_ROOTS: JSON.stringify([root]),
      SESSION_LIST_SCOPE: "invalid",
    }),
  );
});
test("password uses salt and verifies safely", () => {
  const a = passwordHash("long-enough-password");
  assert.notEqual(a, passwordHash("long-enough-password"));
  assert(verifyPassword("long-enough-password", a));
  assert(!verifyPassword("wrong", a));
  assert(!verifyPassword("x", "bad"));
});
test("paths reject traversal, external symlink and write symlink ancestors", async () => {
  const { cfg, root, dir } = await context();
  const files = new Files(cfg);
  await writeFile(path.join(dir, "secret"), "private");
  await symlink(dir, path.join(root, "escape"));
  await symlink(path.join(root, "alpha"), path.join(root, "alias"));
  await assert.rejects(files.read(root, "../secret"));
  await assert.rejects(files.read(root, "escape/secret"));
  await assert.rejects(files.create(root, "escape/new", false));
  await assert.rejects(files.create(root, "alias/new", false));
  await assert.rejects(files.create(dir, "outside", false));
});
test("UTF8, size, etag conflict, CRLF and mode survive atomic save", async () => {
  const { cfg, root } = await context();
  const files = new Files(cfg);
  await writeFile(path.join(root, "code.ts"), "old\r\n", { mode: 0o640 });
  const f = await files.read(root, "code.ts");
  await files.save(root, "code.ts", "new\n", f.version);
  assert.equal(await readFile(path.join(root, "code.ts"), "utf8"), "new\r\n");
  assert.equal((await stat(path.join(root, "code.ts"))).mode & 0o777, 0o640);
  await assert.rejects(files.save(root, "code.ts", "lost", f.version), /đổi/);
  await writeFile(path.join(root, "bad"), Buffer.from([255, 254]));
  await assert.rejects(files.read(root, "bad"), /UTF-8/);
  await writeFile(path.join(root, "binary"), Buffer.from([0, 1]));
  await assert.rejects(files.read(root, "binary"), /binary/);
});
test("create/rename never overwrites target and cannot rename root", async () => {
  const { root, cfg } = await context();
  const f = new Files(cfg);
  await f.create(root, "a", false);
  await f.create(root, "b", false);
  await assert.rejects(f.create(root, "a", false));
  await assert.rejects(f.rename(root, "a", "b"), /tồn tại/);
  await assert.rejects(f.rename(root, "", "other"), /root/);
  await f.create(root, "dir", true);
  await f.rename(root, "dir", "renamed");
  assert((await f.tree(root)).some((e) => e.name === "renamed"));
});
test("project lock includes ancestor/child and releases on failure", async () => {
  const locks = new Locks();
  let release!: () => void;
  const p = locks.run("/a", () => new Promise<void>((r) => (release = r)));
  await assert.rejects(locks.run("/a/b", async () => {}));
  release();
  await p;
  await assert.rejects(
    locks.run("/a", async () => {
      throw new Error("fail");
    }),
  );
  await locks.run("/a", async () => {});
});
test("journal ordering, retention gap and active turn retention", async () => {
  const { cfg } = await context();
  const s = new Store(cfg.data);
  s.db
    .prepare("INSERT INTO threads(id,cwd,state) VALUES(?,?,?)")
    .run("a", "/a", "running");
  const a = s.append("a", { method: "delta" });
  s.append("b", { method: "delta" });
  s.prune(Date.now() + 1000);
  assert.equal(s.events("a", 0).length, 1);
  assert.equal(s.events("b", 0).length, 0);
  assert(s.gap("b", 0));
  assert.equal(s.events("a", 0)[0].seq, a.seq);
  s.close();
});
test("delta reconciliation final is authoritative and reasoning content is hidden", () => {
  let items: any[] = [];
  items = reconcile(items, {
    method: "item/agentMessage/delta",
    params: { itemId: "a", turnId: "t", delta: "hello" },
  });
  items = reconcile(items, {
    method: "item/agentMessage/delta",
    params: { itemId: "a", turnId: "t", delta: " world" },
  });
  assert.equal(items[0].text, "hello world");
  items = reconcile(items, {
    method: "item/completed",
    params: {
      turnId: "t",
      item: { id: "a", type: "agentMessage", text: "canonical" },
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "canonical");
  items = reconcile(items, {
    method: "item/completed",
    params: {
      turnId: "t",
      item: {
        id: "r",
        type: "reasoning",
        summary: ["public"],
        content: ["private"],
      },
    },
  });
  assert(!JSON.stringify(items).includes("private"));
  assert.equal(itemText(items[1]), "public");
});
test("adapter correlates reverse order responses and server requests", async () => {
  const { cfg } = await context();
  const a = new Adapter(cfg);
  const sent: string[] = [];
  a.child = {
    stdin: {
      writable: true,
      write: (s: string) => {
        sent.push(s);
        return true;
      },
    },
  } as any;
  const one = a.call("account/read", { refreshToken: false });
  const two = a.call("model/list", {});
  a.receive({ id: 2, result: { data: [] } });
  a.receive({ id: 1, result: { account: null } });
  assert.deepEqual(await one, { account: null });
  assert.deepEqual(await two, { data: [] });
  a.receive({
    id: "approve",
    method: "item/fileChange/requestApproval",
    params: { threadId: "t" },
  });
  a.respond("approve", { decision: "decline" });
  assert(!a.pending.size);
  assert(JSON.parse(sent[2]).result.decision === "decline");
  const pending = a.call("model/list", {});
  a.disconnected("crash");
  await assert.rejects(pending, /crash/);
});
test("auth CSRF access scopes pagination dedupe mutation locks usage and pending IDs", async () => {
  const { root, cfg } = await context();
  const runtime = new Fixture(root);
  const { app, store } = await createApp(cfg, runtime);
  store.set("password", passwordHash("test-password-safe"));
  await app.ready();
  try {
    for (const url of [
      "/api/projects",
      "/api/threads",
      "/api/status",
      "/api/file?project=" + root + "&path=x",
      "/api/threads/external-1/events",
      "/api/threads/external-1/log",
    ])
      assert.equal((await app.inject({ url })).statusCode, 401);
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: cfg.origin },
      payload: { password: "test-password-safe" },
    });
    assert.equal(login.statusCode, 200);
    const token = login.cookies[0].value;
    const headers = {
      cookie: "session=" + token,
      origin: cfg.origin,
      "x-csrf-token": login.json().csrf,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie: headers.cookie, origin: cfg.origin },
          payload: { root, name: "blocked" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/projects",
          headers: { ...headers, origin: "http://evil" },
        })
      ).statusCode,
      403,
    );
    const list = (await app.inject({ url: "/api/threads", headers })).json();
    assert.equal(list.data.length, 20);
    assert(list.nextCursor);
    const page2 = (
      await app.inject({
        url: "/api/threads?cursor=" + list.nextCursor,
        headers,
      })
    ).json();
    assert.equal(page2.data.length, 20);
    assert.notEqual(list.data[0].id, page2.data[0].id);
    assert(list.data.some((t: any) => t.source === "cli"));
    assert(list.data.some((t: any) => t.source === "appServer"));
    assert(list.data.find((t: any) => t.cwd === path.dirname(root)).readonly);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/threads/external-1/turn",
          headers,
          payload: { prompt: "no", clientRequestId: "no" },
        })
      ).statusCode,
      403,
    );
    assert(!runtime.calls.some((c) => c.method === "thread/resume"));
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/threads",
        headers,
        payload: { project: path.join(root, "alpha") },
      })
    ).json();
    assert.equal(created.state, "idle");
    const emptyHistory = await app.inject({
      url: `/api/threads/${created.id}/history`,
      headers,
    });
    assert.equal(emptyHistory.statusCode, 200, emptyHistory.body);
    assert.deepEqual(emptyHistory.json(), { data: [], nextCursor: null });
    const freshList = (
      await app.inject({ url: "/api/threads", headers })
    ).json();
    assert(freshList.data.some((t: any) => t.id === created.id));
    const archivedDraft = (
      await app.inject({
        method: "POST",
        url: "/api/threads",
        headers,
        payload: { project: path.join(root, "beta") },
      })
    ).json();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/threads/${archivedDraft.id}/archive`,
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert(
      !(await app.inject({ url: "/api/threads", headers }))
        .json()
        .data.some((t: any) => t.id === archivedDraft.id),
    );
    assert(
      !(await app.inject({ url: "/api/threads?archived=true", headers }))
        .json()
        .data.some((t: any) => t.id === created.id),
    );
    assert(
      !(
        await app.inject({
          url:
            "/api/threads?project=" +
            encodeURIComponent(path.join(root, "beta")),
          headers,
        })
      )
        .json()
        .data.some((t: any) => t.id === created.id),
    );
    const call = runtime.call.bind(runtime);
    runtime.call = async (method, params) => {
      if (method === "thread/turns/list")
        throw new RpcError(-32600, "unrelated history error");
      return call(method, params);
    };
    assert.equal(
      (await app.inject({ url: `/api/threads/${created.id}/history`, headers }))
        .statusCode,
      500,
    );
    runtime.call = call;
    const payload = {
      prompt: "fixture",
      clientRequestId: "unique",
      effort: "high",
    };
    const first = await app.inject({
      method: "POST",
      url: `/api/threads/${created.id}/turn`,
      headers,
      payload,
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().policy.reasoningEffort, "high");
    assert.equal(
      (await app.inject({ url: `/api/threads/${created.id}`, headers })).json()
        .policy.reasoningEffort,
      "high",
    );
    const again = await app.inject({
      method: "POST",
      url: `/api/threads/${created.id}/turn`,
      headers,
      payload,
    });
    assert.equal(again.json().deduplicated, true);
    assert.equal(
      runtime.calls.filter((c) => c.method === "turn/start").length,
      1,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/files",
          headers,
          payload: {
            project: path.join(root, "alpha"),
            path: "blocked",
            folder: false,
          },
        })
      ).statusCode,
      423,
    );
    const steerPayload = { prompt: "one steer", clientRequestId: "steer-once" };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/threads/" + created.id + "/steer",
          headers,
          payload: steerPayload,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/threads/" + created.id + "/steer",
          headers,
          payload: steerPayload,
        })
      ).json().deduplicated,
      true,
    );
    assert.equal(
      runtime.calls.filter((c) => c.method === "turn/steer").length,
      1,
    );
    await new Promise((r) => setTimeout(r, 350));
    const pending = (
      await app.inject({ url: `/api/threads/${created.id}/pending`, headers })
    ).json();
    assert.equal(pending.length, 1);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/threads/${created.id}/respond`,
          headers,
          payload: { id: "wrong", decision: "accept" },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/threads/${created.id}/respond`,
          headers,
          payload: { id: pending[0].id, decision: "decline" },
        })
      ).statusCode,
      200,
    );
    const usage = (
      await app.inject({ url: "/api/status?thread=" + created.id, headers })
    ).json();
    assert.equal(usage.threadId, created.id);
    assert.equal(usage.sessionUsage.value.total.totalTokens, 30);
    assert.equal(usage.accountUsage.usage, null);
    const n = runtime.calls.filter(
      (c) => c.method === "account/usage/read",
    ).length;
    await app.inject({ url: "/api/status", headers });
    assert.equal(
      runtime.calls.filter((c) => c.method === "account/usage/read").length,
      n,
    );
    runtime.ready = false;
    runtime.events.emit("status");
    const stale = (await app.inject({ url: "/api/status", headers })).json();
    assert.equal(stale.ready, false);
    assert.equal(stale.sessionUsage, null);
    const selectedStale = (
      await app.inject({ url: "/api/status?thread=" + created.id, headers })
    ).json();
    assert.equal(selectedStale.ready, false);
    assert.equal(selectedStale.stale, true);
    assert.equal(selectedStale.sessionUsage.value.total.totalTokens, 30);
    assert.equal(selectedStale.sessionUsage.stale, true);
  } finally {
    await app.close();
  }
});
test("submission IDs work when crypto.randomUUID is unavailable on HTTP LAN", () => {
  const ids = Array.from({ length: 100 }, () =>
    requestId({
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    }),
  );
  assert.equal(new Set(ids).size, 100);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});
test("allowed_projects filters across upstream pages and enforces history ID access", async () => {
  const { cfg, root } = await context();
  cfg.scope = "allowed_projects";
  const runtime = new Fixture(root);
  const { app, store } = await createApp(cfg, runtime);
  store.set("password", passwordHash("test-password-safe"));
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: cfg.origin },
    payload: { password: "test-password-safe" },
  });
  const headers = { cookie: "session=" + login.cookies[0].value };
  try {
    const r = (await app.inject({ url: "/api/threads", headers })).json();
    assert.equal(r.data.length, 26);
    assert(r.data.every((t: any) => t.cwd.startsWith(root)));
    assert(runtime.calls.filter((c) => c.method === "thread/list").length >= 2);
    assert.equal(
      (await app.inject({ url: "/api/threads/external-0/history", headers }))
        .statusCode,
      403,
    );
  } finally {
    await app.close();
  }
});

test("command outputDelta and public summaryTextDelta stream without private reasoning", () => {
  let items: any[] = [];
  items = reconcile(items, {
    method: "item/commandExecution/outputDelta",
    params: { itemId: "cmd", turnId: "t", delta: "live output" },
  });
  assert.equal(items[0].aggregatedOutput, "live output");
  items = reconcile(items, {
    method: "item/reasoning/summaryTextDelta",
    params: {
      itemId: "summary",
      turnId: "t",
      summaryIndex: 0,
      delta: "public",
    },
  });
  assert.equal(items[1].summary[0], "public");
  items = reconcile(items, {
    method: "item/reasoning/textDelta",
    params: { itemId: "private", turnId: "t", delta: "internal" },
  });
  assert.equal(items.length, 2);
});
test("delayed watcher/save response never overwrites edits typed during request", async () => {
  const { diskUpdate, savedUpdate } = await import("../src/shared/drafts.js");
  const draft = {
    text: "new typing",
    base: "old",
    version: "old-version",
    dirty: true,
  };
  const disk = diskUpdate(draft, {
    text: "external",
    version: "external-version",
  });
  assert.equal(disk.text, "new typing");
  assert(disk.changed);
  assert.equal(disk.version, "old-version");
  const saved = savedUpdate(draft, "old", {
    text: "old",
    version: "saved-version",
  });
  assert.equal(saved.text, "new typing");
  assert(saved.dirty);
  assert.equal(saved.version, "saved-version");
});
test("opening Store for doctor/password does not mark active turns unknown", async () => {
  const { cfg } = await context();
  const first = new Store(cfg.data);
  first.db
    .prepare("INSERT INTO threads(id,cwd,state) VALUES(?,?,?)")
    .run("active", "/a", "running");
  const second = new Store(cfg.data);
  assert.equal(second.thread("active")?.state, "running");
  second.close();
  first.close();
});
