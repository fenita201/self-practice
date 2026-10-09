import Fastify from "fastify";
import { publicEvent, publicHistory, publicItem } from "../shared/timeline.js";
import cookie from "@fastify/cookie";
import serveStatic from "@fastify/static";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { watch } from "chokidar";
import type { Config } from "./config.js";
import { Store, hash, verifyPassword } from "./store.js";
import { Files, Locks, HttpError, inside, component } from "./paths.js";
import { Adapter, RpcError, type Runtime, type RpcEvent } from "./adapter.js";
import type { ThreadSourceKind } from "../shared/protocol/v2/ThreadSourceKind.js";
export const sources: ThreadSourceKind[] = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
];
const active = ["running", "waiting_approval", "waiting_input"];
export async function createApp(
  cfg: Config,
  runtime: Runtime = new Adapter(cfg),
) {
  const app = Fastify({
    logger: false,
    forceCloseConnections: true,
    bodyLimit: cfg.saveMax + 65536,
  });
  const store = new Store(cfg.data),
    files = new Files(cfg),
    locks = new Locks();
  let closing = false;
  store.db.exec(
    "UPDATE threads SET state='unknown',turn=NULL WHERE state IN ('running','waiting_input','waiting_approval'); UPDATE submissions SET state='unknown' WHERE state='dispatching';",
  );
  let journalBytes = store.bytes();
  const loaded = new Set<string>();
  const knownThreads = new Map<string, any>();
  const unlistedThreads = new Set<string>();
  let storageError: string | null = store.setting("journalDegraded") || null;
  const subscribers = new Map<string, Set<(event: any) => void>>();
  const watchers = new Map<
    string,
    { watcher: ReturnType<typeof watch>; listeners: Set<(e: any) => void> }
  >();
  const emit = (thread: string, event: any) => {
    try {
      if (
        journalBytes + Buffer.byteLength(JSON.stringify(event)) >
        cfg.journalMax
      )
        throw new Error(
          "Journal đạt hard limit; output mới không được persist",
        );
      const row = store.append(thread, event);
      journalBytes += Buffer.byteLength(JSON.stringify(event));
      for (const cb of subscribers.get(thread) || []) cb(row);
    } catch (e) {
      storageError = (e as Error).message;
      try {
        store.set("journalDegraded", storageError);
        store.set("incomplete:" + thread, storageError);
      } catch {}
      for (const cb of subscribers.get(thread) || [])
        cb({
          seq: 0,
          event: {
            method: "web/storageError",
            params: { message: storageError },
          },
        });
    }
  };
  runtime.events.on("event", (ev: RpcEvent) => {
    if (closing) return;
    ev = publicEvent(ev);
    if (!ev) return;
    const p = ev.params || {};
    const id = p.threadId || p.thread?.id;
    if (!id || !store.thread(id)) return;
    if (p.thread) knownThreads.set(id, p.thread);
    if (ev.method === "turn/started") store.state(id, "running", p.turn.id);
    if (ev.id !== undefined)
      store.state(
        id,
        ev.method.includes("requestUserInput")
          ? "waiting_input"
          : "waiting_approval",
        store.thread(id)?.turn || null,
      );
    if (ev.method === "turn/completed") {
      const s = p.turn.status;
      store.state(id, s === "completed" ? "idle" : s, p.turn.id);
      for (const [k, v] of runtime.pending)
        if (v.params.threadId === id) runtime.pending.delete(k);
    }
    if (ev.method === "thread/tokenUsage/updated")
      store.db
        .prepare("INSERT OR REPLACE INTO usage VALUES(?,?,?)")
        .run(id, Date.now(), JSON.stringify(p.tokenUsage));
    emit(id, ev);
  });
  runtime.events.on("status", () => {
    if (closing) return;
    if (!runtime.ready) {
      loaded.clear();
      knownThreads.clear();
      unlistedThreads.clear();
      store.db.exec(
        "UPDATE threads SET state='unknown',turn=NULL WHERE state IN ('running','waiting_approval','waiting_input')",
      );
    }
    for (const row of store.db.prepare("SELECT id FROM threads").all() as {
      id: string;
    }[])
      emit(row.id, {
        method: "web/runtimeStatus",
        params: { ready: runtime.ready, error: runtime.error },
      });
  });
  await app.register(cookie);
  app.setErrorHandler((error, req, reply) => {
    const code =
      (error as any).statusCode ||
      ((error as any).code === "ENOENT"
        ? 404
        : (error as any).code === "EEXIST"
          ? 409
          : 500);
    reply.code(code).send({
      error:
        code === 500
          ? "Thao tác thất bại: " + (error as Error).message
          : (error as Error).message,
    });
  });
  const attempts = new Map<string, { n: number; until: number }>();
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const origin = req.headers.origin;
    if (origin && origin !== cfg.origin)
      throw new HttpError(403, "Origin không hợp lệ");
    if (req.url === "/api/login") return;
    const token = req.cookies.session;
    if (!token) throw new HttpError(401, "Cần đăng nhập");
    const session = store.db
      .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now()) as { csrf: string } | undefined;
    if (!session) throw new HttpError(401, "Phiên đăng nhập hết hạn");
    (req as any).csrf = session.csrf;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (origin !== cfg.origin || req.headers["x-csrf-token"] !== session.csrf)
        throw new HttpError(403, "CSRF/Origin không hợp lệ");
    }
  });
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_, r) =>
    r.code(runtime.ready ? 200 : 503).send({ ready: runtime.ready }),
  );
  app.post("/api/login", async (req, reply) => {
    if (req.headers.origin !== cfg.origin)
      throw new HttpError(403, "Origin không hợp lệ");
    const ip = req.ip;
    const old = attempts.get(ip);
    if (old && old.until > Date.now() && old.n >= 8)
      throw new HttpError(429, "Quá nhiều lần thử; chờ 15 phút");
    const password = (req.body as any)?.password;
    const saved = store.setting("password");
    if (!saved)
      throw new HttpError(503, "Chạy npm run set-password trước khi đăng nhập");
    if (
      typeof password !== "string" ||
      password.length > 1024 ||
      !verifyPassword(password, saved)
    ) {
      attempts.set(ip, {
        n: (old?.until && old.until > Date.now() ? old.n : 0) + 1,
        until: Date.now() + 900000,
      });
      throw new HttpError(401, "Mật khẩu không đúng");
    }
    attempts.delete(ip);
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    store.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(hash(token), csrf, Date.now() + cfg.ttl);
    reply.setCookie("session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: cfg.secure,
      maxAge: cfg.ttl / 1000,
    });
    return { csrf };
  });
  app.get("/api/me", async (req) => ({
    csrf: (req as any).csrf,
    name: cfg.name,
    label: cfg.label,
    scope: cfg.scope,
  }));
  app.post("/api/logout", async (req, reply) => {
    store.db
      .prepare("DELETE FROM sessions WHERE token=?")
      .run(hash(req.cookies.session || ""));
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
  const assertRuntime = () => {
    if (!runtime.ready)
      throw new HttpError(503, runtime.error || "Codex chưa sẵn sàng");
  };
  const metadata = async (id: string) => {
    assertRuntime();
    const known = loaded.has(id) ? knownThreads.get(id) : undefined;
    const result = known
      ? { thread: known }
      : await runtime.call("thread/read", {
          threadId: id,
          includeTurns: false,
        });
    if (
      cfg.scope === "allowed_projects" &&
      !(await files.allowed(result.thread.cwd))
    )
      throw new HttpError(403, "Session bị lọc theo allowed_projects");
    return result.thread;
  };
  const decorate = async (t: any) => {
    const own = store.thread(t.id),
      allowed = await files.allowed(t.cwd);
    return {
      ...t,
      path: undefined,
      turns: undefined,
      ownership: own ? "Web quản lý" : "Bên ngoài / Chưa xác minh",
      state: own ? (runtime.ready ? own.state : "unknown") : "unknown",
      readonly: !own || !allowed,
      projectAllowed: allowed,
      reason: !allowed
        ? "Project ngoài roots hoặc đã mất"
        : !own
          ? "Chỉ lịch sử đã lưu, chưa có live output của terminal"
          : null,
      lastTurn: own?.turn,
      policy: own?.policy ? JSON.parse(own.policy) : null,
    };
  };
  const requireChat = async () => {
    assertRuntime();
    const result = await runtime.call("account/read", { refreshToken: false });
    if (result.requiresOpenaiAuth && !result.account)
      throw new HttpError(
        503,
        "Codex thiếu auth; chạy codex login bằng service user",
      );
  };
  const authorize = async (id: string) => {
    const t = await metadata(id),
      own = store.thread(id);
    if (!own || !(await files.allowed(t.cwd)))
      throw new HttpError(403, "Session chỉ đọc, ownership chưa được xác minh");
    return own;
  };
  const mutation = async <T>(cwd: string, fn: () => Promise<T>) =>
    locks.run(await files.project(cwd), async () => {
      const canonical = await files.project(cwd);
      const rows = store.db.prepare("SELECT cwd,state FROM threads").all() as {
        cwd: string;
        state: string;
      }[];
      if (
        rows.some(
          (r) =>
            (inside(r.cwd, canonical) || inside(canonical, r.cwd)) &&
            active.includes(r.state),
        )
      )
        throw new HttpError(
          423,
          "Codex đang chạy/chờ phản hồi trong project; chỉ sửa draft",
        );
      return fn();
    });
  app.get("/api/projects", async () => {
    const result: any[] = [];
    for (const root of cfg.roots) {
      result.push({ path: root, name: path.basename(root), root: true });
      for (const e of await readdir(root, { withFileTypes: true })) {
        if (e.isDirectory() && !cfg.hidden.includes(e.name))
          result.push({
            path: path.join(root, e.name),
            name: e.name,
            root: false,
          });
      }
    }
    return { roots: cfg.roots, data: result };
  });
  app.post("/api/projects", async (req) => {
    const b = req.body as any;
    if (!cfg.roots.includes(b.root))
      throw new HttpError(403, "Root không cho phép");
    component(b.name);
    const p = path.join(b.root, b.name);
    await mutation(b.root, () => mkdir(p));
    if (b.git) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["init", "--", p], { stdio: "ignore" });
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error("git init thất bại")),
        );
      });
    }
    return { path: p };
  });
  app.get("/api/tree", async (req) => {
    const q = req.query as any;
    return files.tree(q.project, q.path || "", q.hidden === "true");
  });
  app.get("/api/file", async (req) => {
    const q = req.query as any;
    return files.read(q.project, q.path);
  });
  app.put("/api/file", async (req) => {
    const b = req.body as any;
    return mutation(b.project, () =>
      files.save(b.project, b.path, b.text, b.version),
    );
  });
  app.post("/api/files", async (req) => {
    const b = req.body as any;
    await mutation(b.project, () =>
      files.create(b.project, b.path, b.folder === true),
    );
    return { ok: true };
  });
  app.post("/api/rename", async (req) => {
    const b = req.body as any;
    await mutation(b.project, () => files.rename(b.project, b.from, b.to));
    return { ok: true };
  });
  app.get("/api/threads", async (req) => {
    assertRuntime();
    const q = req.query as any;
    let cursor = q.cursor || null;
    const data: any[] = [];
    const seen = new Set<string>();
    let scanned = 0;
    const include = async (t: any) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      if (cfg.scope === "allowed_projects" && !(await files.allowed(t.cwd)))
        return;
      if (q.project && t.cwd !== q.project) return;
      const d = await decorate(t);
      if (
        q.search &&
        !`${t.name || ""} ${t.preview || ""}`
          .toLowerCase()
          .includes(q.search.toLowerCase())
      )
        return;
      if (q.state && d.state !== q.state) return;
      const source =
        typeof t.source === "string"
          ? t.source
          : Object.keys(t.source || {})[0] || "unknown";
      if (q.source && source !== q.source) return;
      data.push(d);
    };
    // Fresh threads are memory-only until their first user message. Keep them
    // visible while the runtime's persisted listing catches up.
    if (!cursor && q.archived !== "true") {
      for (const id of [...unlistedThreads].reverse()) {
        const t = knownThreads.get(id);
        if (t) await include(t);
      }
    }
    do {
      const page = await runtime.call("thread/list", {
        cursor,
        limit: 20,
        sortKey: "updated_at",
        sourceKinds: sources,
        archived: q.archived === "true",
        ...(q.project ? { cwd: q.project } : {}),
      });
      for (const t of page.data) {
        unlistedThreads.delete(t.id);
        if (seen.has(t.id)) {
          seen.delete(t.id);
          const index = data.findIndex((row) => row.id === t.id);
          if (index >= 0) data.splice(index, 1);
        }
        await include(t);
      }
      cursor = page.nextCursor;
      scanned++;
    } while (cursor && data.length < 20 && scanned < 200);
    return {
      data,
      nextCursor: cursor,
      searchScope: "Tên/preview",
      scope: cfg.scope,
    };
  });
  app.post("/api/threads", async (req) => {
    assertRuntime();
    const b = req.body as any;
    const cwd = await files.project(b.project);
    return mutation(cwd, async () => {
      const r = await runtime.call("thread/start", {
        cwd,
        ...(b.model ? { model: b.model } : {}),
      });
      store.db
        .prepare("INSERT INTO threads(id,cwd,state,policy) VALUES(?,?,?,?)")
        .run(
          r.thread.id,
          cwd,
          "idle",
          JSON.stringify({
            approvalPolicy: r.approvalPolicy,
            sandbox: r.sandbox,
            model: r.model,
            reasoningEffort: r.reasoningEffort,
          }),
        );
      loaded.add(r.thread.id);
      knownThreads.set(r.thread.id, r.thread);
      unlistedThreads.add(r.thread.id);
      return decorate(r.thread);
    });
  });
  app.get("/api/threads/:id", async (req) => {
    const id = (req.params as any).id;
    return decorate(await metadata(id));
  });
  app.get("/api/threads/:id/history", async (req) => {
    const id = (req.params as any).id;
    await metadata(id);
    const q = req.query as any;
    try {
      return publicHistory(
        await runtime.call("thread/turns/list", {
          threadId: id,
          cursor: q.cursor || null,
          limit: 10,
          sortDirection: "desc",
          itemsView: "full",
        }),
      );
    } catch (e) {
      // This is a valid empty chat, not a failed history request. Never hide
      // other RPC failures or start a turn to materialize it.
      if (
        e instanceof RpcError &&
        e.code === -32600 &&
        e.rpcMessage ===
          `thread ${id} is not materialized yet; thread/turns/list is unavailable before first user message`
      )
        return { data: [], nextCursor: null };
      throw e;
    }
  });
  app.get("/api/threads/:id/items", async (req) => {
    const id = (req.params as any).id;
    await metadata(id);
    const q = req.query as any;
    const result = await runtime.call("thread/items/list", {
      threadId: id,
      cursor: q.cursor || null,
      turnId: q.turnId || null,
      limit: 100,
      sortDirection: "asc",
    });
    return {
      ...result,
      data: result.data.map((entry: any) => ({
        ...entry,
        item: publicItem(entry.item),
      })),
    };
  });
  app.post("/api/threads/:id/turn", async (req) => {
    const id = (req.params as any).id,
      b = req.body as any;
    if (
      typeof b.clientRequestId !== "string" ||
      b.clientRequestId.length > 100 ||
      typeof b.prompt !== "string" ||
      !b.prompt.trim() ||
      b.prompt.length > 100000
    )
      throw new HttpError(400, "Prompt/clientRequestId không hợp lệ");
    const payload = JSON.stringify({
      id,
      prompt: b.prompt,
      model: b.model || null,
      effort: b.effort || null,
    });
    const old = store.db
      .prepare("SELECT * FROM submissions WHERE id=?")
      .get(b.clientRequestId) as any;
    if (old) {
      const own = store.thread(id);
      if (!own || !(await files.allowed(own.cwd)))
        throw new HttpError(403, "Session chỉ đọc");
      if (old.payload !== payload)
        throw new HttpError(409, "clientRequestId đã dùng cho nội dung khác");
      return {
        deduplicated: true,
        state: old.state,
        result: old.result ? JSON.parse(old.result) : null,
      };
    }
    await authorize(id);
    await requireChat();
    if (storageError) throw new HttpError(507, storageError);
    const own = store.thread(id)!;
    return mutation(own.cwd, async () => {
      store.db
        .prepare("INSERT INTO submissions VALUES(?,?,?,?,NULL)")
        .run(b.clientRequestId, id, payload, "dispatching");
      store.state(id, "running");
      try {
        let effectivePolicy = JSON.parse(own.policy || "{}");
        if (!loaded.has(id)) {
          const r = await runtime.call("thread/resume", {
            threadId: id,
            excludeTurns: true,
          });
          if (r.thread.status?.type === "active")
            throw new Error("Runtime báo thread active; không takeover");
          effectivePolicy = {
            ...effectivePolicy,
            ...(r.model ? { model: r.model } : {}),
            ...(r.reasoningEffort
              ? { reasoningEffort: r.reasoningEffort }
              : {}),
          };
          loaded.add(id);
          knownThreads.set(id, r.thread);
        }
        const r = await runtime.call("turn/start", {
          threadId: id,
          clientUserMessageId: b.clientRequestId,
          input: [{ type: "text", text: b.prompt, text_elements: [] }],
          ...(b.model ? { model: b.model } : {}),
          ...(b.effort ? { effort: b.effort } : {}),
        });
        if (store.thread(id)?.turn !== r.turn.id)
          store.state(id, "running", r.turn.id);
        const policy = {
          ...effectivePolicy,
          ...(b.model ? { model: b.model } : {}),
          ...(b.effort ? { reasoningEffort: b.effort } : {}),
        };
        store.db
          .prepare("UPDATE threads SET policy=? WHERE id=?")
          .run(JSON.stringify(policy), id);
        store.db
          .prepare("UPDATE submissions SET state=?,result=? WHERE id=?")
          .run(
            "dispatched",
            JSON.stringify({ ...r, policy }),
            b.clientRequestId,
          );
        return { ...r, policy };
      } catch (e) {
        store.state(id, "unknown");
        store.db
          .prepare("UPDATE submissions SET state=? WHERE id=?")
          .run("unknown", b.clientRequestId);
        throw e;
      }
    });
  });
  app.post("/api/threads/:id/interrupt", async (req) => {
    const own = await authorize((req.params as any).id);
    if (!own.turn || !active.includes(own.state))
      throw new HttpError(409, "Không có active turn");
    await runtime.call("turn/interrupt", {
      threadId: own.id,
      turnId: own.turn,
    });
    return { ok: true };
  });
  app.post("/api/threads/:id/steer", async (req) => {
    const own = await authorize((req.params as any).id),
      b = req.body as any;
    if (!own.turn || !active.includes(own.state))
      throw new HttpError(409, "Không có active turn");
    if (
      typeof b.clientRequestId !== "string" ||
      b.clientRequestId.length > 100 ||
      typeof b.prompt !== "string" ||
      !b.prompt.trim() ||
      b.prompt.length > 100000
    )
      throw new HttpError(400, "Prompt/clientRequestId không hợp lệ");
    const payload = JSON.stringify({
      action: "steer",
      thread: own.id,
      turn: own.turn,
      prompt: b.prompt,
    });
    return locks.run(own.cwd, async () => {
      const old = store.db
        .prepare("SELECT * FROM submissions WHERE id=?")
        .get(b.clientRequestId) as any;
      if (old) {
        if (old.payload !== payload)
          throw new HttpError(409, "clientRequestId đã dùng cho nội dung khác");
        return { deduplicated: true, state: old.state };
      }
      store.db
        .prepare("INSERT INTO submissions VALUES(?,?,?,?,NULL)")
        .run(b.clientRequestId, own.id, payload, "dispatching");
      try {
        const result = await runtime.call("turn/steer", {
          threadId: own.id,
          expectedTurnId: own.turn!,
          clientUserMessageId: b.clientRequestId,
          input: [{ type: "text", text: b.prompt, text_elements: [] }],
        });
        store.db
          .prepare("UPDATE submissions SET state=?,result=? WHERE id=?")
          .run("dispatched", JSON.stringify(result), b.clientRequestId);
        return result;
      } catch (e) {
        store.db
          .prepare("UPDATE submissions SET state=? WHERE id=?")
          .run("unknown", b.clientRequestId);
        throw e;
      }
    });
  });
  app.post("/api/threads/:id/name", async (req) => {
    const own = await authorize((req.params as any).id),
      b = req.body as any;
    component(b.name);
    if (active.includes(own.state)) throw new HttpError(423, "Turn đang chạy");
    await runtime.call("thread/name/set", { threadId: own.id, name: b.name });
    const known = knownThreads.get(own.id);
    if (known) knownThreads.set(own.id, { ...known, name: b.name });
    return { ok: true };
  });
  app.post("/api/threads/:id/archive", async (req) => {
    const own = await authorize((req.params as any).id);
    if (active.includes(own.state)) throw new HttpError(423, "Turn đang chạy");
    await runtime.call("thread/archive", { threadId: own.id });
    unlistedThreads.delete(own.id);
    return { ok: true };
  });
  app.get("/api/threads/:id/pending", async (req) => {
    const id = (req.params as any).id;
    await metadata(id);
    return [...runtime.pending.values()].filter(
      (e) => e.params.threadId === id,
    );
  });
  app.post("/api/threads/:id/respond", async (req) => {
    const id = (req.params as any).id;
    await authorize(id);
    const b = req.body as any,
      p = runtime.pending.get(String(b.id));
    if (!p || p.params.threadId !== id)
      throw new HttpError(409, "Request không còn hiệu lực");
    let result: any;
    if (p.method === "item/tool/requestUserInput") {
      if (!b.answers || typeof b.answers !== "object")
        throw new HttpError(400, "Thiếu answers");
      for (const q of p.params.questions || []) {
        const a = b.answers[q.id]?.answers;
        if (
          !Array.isArray(a) ||
          !a.length ||
          !a.every((v: unknown) => typeof v === "string" && v.length <= 10000)
        )
          throw new HttpError(400, "Answers không hợp lệ");
        if (
          q.options?.length &&
          !q.isOther &&
          !a.every((v: string) => q.options.some((o: any) => o.label === v))
        )
          throw new HttpError(
            400,
            "Câu hỏi chỉ cho phép các option được cung cấp",
          );
      }
      result = { answers: b.answers };
    } else if (
      [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
      ].includes(p.method)
    ) {
      if (!["accept", "decline", "cancel"].includes(b.decision))
        throw new HttpError(400, "Decision không hợp lệ");
      result = { decision: b.decision };
    } else
      throw new HttpError(
        422,
        `Chưa hỗ trợ trả lời ${p.method}; không tự approve`,
      );
    store.state(id, "running", store.thread(id)?.turn || null);
    runtime.respond(p.id!, result);
    emit(id, { method: "web/requestResolved", params: { id: p.id } });
    return { ok: true };
  });
  app.get("/api/threads/:id/journal", async (req) => {
    const id = (req.params as any).id;
    await metadata(id);
    const after = Math.max(0, Number((req.query as any).after) || 0);
    return {
      data: store.events(id, after),
      gap: store.gap(id, after) || !!store.setting("incomplete:" + id),
    };
  });
  app.get("/api/threads/:id/log", async (req, reply) => {
    const id = (req.params as any).id;
    await metadata(id);
    reply
      .header("Content-Type", "application/x-ndjson")
      .header("Content-Disposition", 'attachment; filename="codex-log.ndjson"');
    const rows = store.db
      .prepare("SELECT seq,at,event FROM events WHERE thread=? ORDER BY seq")
      .iterate(id);
    return reply.send(
      (async function* () {
        yield JSON.stringify({
          scope: "Output đã thu được của web",
          gap: store.gap(id, 0) || !!store.setting("incomplete:" + id),
          storageError,
        }) + "\n";
        for (const r of rows) yield JSON.stringify(r) + "\n";
      })(),
    );
  });
  const stream = (req: any, reply: any) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const sessionHash = hash(req.cookies.session);
    const heartbeat = setInterval(() => {
      if (
        !store.db
          .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
          .get(sessionHash, Date.now())
      )
        reply.raw.end();
      else reply.raw.write(": heartbeat\n\n");
    }, 15000);
    reply.raw.on("close", () => clearInterval(heartbeat));
    return (event: any) => {
      if (reply.raw.writableLength > 4 * 1024 * 1024) {
        reply.raw.end();
        return;
      }
      reply.raw.write(
        `id: ${event.seq || ""}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    };
  };
  app.get("/api/threads/:id/events", async (req, reply) => {
    const id = (req.params as any).id;
    await metadata(id);
    const after = Math.max(
      0,
      Number(req.headers["last-event-id"] || (req.query as any).after) || 0,
    );
    const send = stream(req, reply);
    if (store.gap(id, after) || store.setting("incomplete:" + id))
      send({
        seq: 0,
        event: {
          method: "web/gap",
          params: {
            message: "Cursor đã hết retention; lịch sử runtime cần tải lại",
          },
        },
      });
    let cursor = after;
    for (;;) {
      const rows = store.events(id, cursor);
      for (const r of rows) {
        send(r);
        cursor = r.seq;
      }
      if (rows.length < 500) break;
    }
    const listeners = subscribers.get(id) || new Set();
    listeners.add(send);
    subscribers.set(id, listeners);
    reply.raw.on("close", () => {
      listeners.delete(send);
      if (!listeners.size) subscribers.delete(id);
    });
  });
  app.get("/api/watch", async (req, reply) => {
    const cwd = await files.project((req.query as any).project);
    if (!watchers.has(cwd)) {
      if (watchers.size >= 8)
        throw new HttpError(429, "Giới hạn 8 project watchers");
      const watcher = watch(cwd, {
        ignoreInitial: true,
        usePolling: true,
        interval: 1000,
        depth: 6,
        ignored: (p) =>
          path
            .relative(cwd, p)
            .split(path.sep)
            .some(
              (s) => cfg.hidden.includes(s) || s.startsWith(".codex-remote-"),
            ),
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      });
      const entry = { watcher, listeners: new Set<(e: any) => void>() };
      watcher.on("all", (event, p) => {
        for (const cb of entry.listeners)
          cb({
            seq: 0,
            project: cwd,
            path: path.relative(cwd, p),
            type: event,
          });
      });
      watcher.on("error", () => {
        for (const cb of entry.listeners)
          cb({
            seq: 0,
            error: "Watcher lỗi; tải lại file để kiểm tra version",
          });
      });
      watchers.set(cwd, entry);
    }
    const send = stream(req, reply);
    const entry = watchers.get(cwd)!;
    entry.listeners.add(send);
    reply.raw.on("close", () => {
      entry.listeners.delete(send);
      if (!entry.listeners.size) {
        void entry.watcher.close();
        watchers.delete(cwd);
      }
    });
  });
  let cache: any = {
    at: null,
    source: "app-server metadata",
    stale: true,
    account: null,
    quota: null,
    accountUsage: null,
    models: [],
    errors: ["Chưa refresh"],
  };
  let refreshing: Promise<void> | null = null;
  const refreshUsage = async () => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (!runtime.ready) {
        cache = {
          ...cache,
          stale: true,
          errors: [runtime.error || "Codex chưa sẵn sàng"],
        };
        return;
      }
      const results = await Promise.allSettled([
        runtime.call("account/read", { refreshToken: false }),
        runtime.call("account/rateLimits/read", {}),
        runtime.call("account/usage/read", {}),
        runtime.call("model/list", {}),
      ]);
      const keys = ["account", "quota", "accountUsage", "models"];
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          let v = r.value;
          if (i === 0)
            v = {
              type: v.account?.type || null,
              planType: v.account?.planType || null,
              requiresOpenaiAuth: v.requiresOpenaiAuth,
            };
          if (i === 3) v = v.data;
          cache[keys[i]] = v;
        } else errors.push(`${keys[i]}: ${r.reason.message}`);
      });
      cache = { ...cache, at: Date.now(), stale: errors.length > 0, errors };
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
    }
  };
  app.get("/api/status", async (req) => {
    if (!cache.at || Date.now() - cache.at >= cfg.usageRefresh)
      await refreshUsage();
    const id = (req.query as any).thread;
    let usage: any = null;
    if (id) {
      if (runtime.ready) await metadata(id);
      else {
        const own = store.thread(id);
        if (
          cfg.scope === "allowed_projects" &&
          (!own || !(await files.allowed(own.cwd)))
        )
          throw new HttpError(403, "Session bị lọc theo allowed_projects");
      }
      const u = store.db
        .prepare("SELECT * FROM usage WHERE thread=?")
        .get(id) as any;
      usage = u
        ? {
            source: "thread/tokenUsage/updated",
            at: u.at,
            value: JSON.parse(u.value),
            stale: !runtime.ready,
          }
        : null;
    }
    const counts = store.db
      .prepare("SELECT state,COUNT(*) AS count FROM threads GROUP BY state")
      .all();
    return {
      ...cache,
      stale:
        cache.stale ||
        !runtime.ready ||
        !!(cache.at && Date.now() - cache.at > cfg.usageRefresh * 2),
      ready: runtime.ready,
      error: runtime.error,
      version: runtime.version,
      storageError,
      counts,
      threadId: id || null,
      sessionUsage: usage,
      scope: cfg.scope,
      externalLive: "Chỉ lịch sử đã lưu, chưa có live output của terminal",
      capabilities: {
        history: true,
        liveWeb: true,
        externalLive: false,
        approval: true,
        input: "experimental",
        steer: true,
      },
      now: Date.now(),
    };
  });
  const publicDir = path.resolve("dist/public");
  if (existsSync(publicDir)) {
    await app.register(serveStatic, { root: publicDir });
    app.setNotFoundHandler((req, r) =>
      req.url.startsWith("/api/")
        ? r.code(404).send({ error: "Không có endpoint" })
        : r.sendFile("index.html"),
    );
  }
  const cleanup = setInterval(() => {
    try {
      store.prune(Date.now() - cfg.retention);
      journalBytes = store.bytes();
      store.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    } catch (e) {
      storageError = (e as Error).message;
      try {
        store.set("journalDegraded", storageError);
      } catch {}
    }
  }, 60000);
  cleanup.unref();
  const polling = setInterval(() => void refreshUsage(), cfg.usageRefresh);
  polling.unref();
  app.addHook("onClose", async () => {
    closing = true;
    clearInterval(cleanup);
    clearInterval(polling);
    for (const callbacks of subscribers.values())
      for (const cb of callbacks)
        cb({
          seq: 0,
          event: {
            method: "web/runtimeStatus",
            params: { ready: false, error: "Service shutdown" },
          },
        });
    for (const entry of watchers.values()) await entry.watcher.close();
    runtime.stop();
    store.close();
  });
  return {
    app,
    store,
    runtime,
    files,
    locks,
    startRuntime: () => runtime.start(),
  };
}
