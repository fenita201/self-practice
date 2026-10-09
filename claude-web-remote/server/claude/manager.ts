import { tx, type Db } from '../db.js';
import { GLOBAL_CHANNEL, projectChannel, type Journal } from '../journal.js';
import { HttpError } from '../paths.js';
import { itemsFromTranscript, type TimelineItem } from './items.js';
import { SessionRunner, type Answer, type EndReason, type PendingRequest, type RunnerState } from './runner.js';
import type { ClaudeSdk, ModelInfo, PermissionMode, SDKSessionInfo } from './sdk.js';

export type ManagerConfig = {
  maxActiveSessions: number;
  idleTimeoutMs: number;
  inputTimeoutMs: number;
  defaultPermissionMode: PermissionMode;
  claudeBin?: string;
  /** Workspace root used for the capability probe. */
  probeCwd: string;
  /** External (not ours) sessions modified more recently than this are treated as possibly live. */
  externalBusyWindowMs: number;
};

type Logger = { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; debug(o: unknown, m?: string): void; error(o: unknown, m?: string): void };

export type ChatRow = {
  session_id: string;
  project: string;
  state: string;
  ended_reason: string | null;
  model: string | null;
  effort: string | null;
  permission_mode: string | null;
  deadline_at: number | null;
  created_at: number;
  updated_at: number;
};

export type SessionSummary = {
  sessionId: string;
  title: string;
  firstPrompt: string | null;
  lastModified: number;
  createdAt: number | null;
  gitBranch: string | null;
  cwd: string | null;
  managed: boolean; // created/driven by this instance
  state: RunnerState | 'interrupted' | 'external' | 'ended';
  endedReason: string | null;
  deadlineAt: number | null;
  pendingCount: number;
};

export type PromptInput = {
  clientRequestId: string;
  text: string;
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  force?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto'];

export type Capabilities = {
  checkedAt: number;
  ok: boolean;
  error?: string;
  models: Array<{ value: string; displayName: string; description: string; effortLevels: string[] }>;
  auth: { method: 'subscription' | 'api_key' | 'unknown' | 'none'; subscriptionType?: string; email?: string; organization?: string };
};

/**
 * Owns all SessionRunners. Enforces: one busy session per project, a cap on
 * live Claude processes, idempotent prompt submission (clientRequestId), and
 * never re-submitting a prompt on its own.
 */
export class SessionManager {
  private readonly runners = new Map<string, SessionRunner>();
  /** Runners that have not reported a session id yet, keyed by their first clientRequestId. */
  private readonly starting = new Map<string, SessionRunner>();
  private caps: Capabilities | null = null;
  private capsPromise: Promise<Capabilities> | null = null;

  constructor(
    private readonly db: Db,
    private readonly journal: Journal,
    private readonly sdk: ClaudeSdk,
    private readonly cfg: ManagerConfig,
    private readonly log: Logger,
    private readonly projectDir: (project: string) => Promise<string>,
  ) {}

  /** Called once at startup: nothing from a previous process is still running. */
  reconcileAfterRestart(): void {
    const now = Date.now();
    const rows = this.db.prepare("SELECT * FROM chats WHERE state NOT IN ('ended','interrupted')").all() as ChatRow[];
    for (const row of rows) {
      const wasBusy = row.state === 'running' || row.state === 'waiting_input' || row.state === 'starting';
      const state = wasBusy ? 'interrupted' : 'ended';
      const reason = wasBusy ? 'server_restart' : 'server_restart_idle';
      this.db.prepare('UPDATE chats SET state = ?, ended_reason = ?, deadline_at = NULL, updated_at = ? WHERE session_id = ?').run(state, reason, now, row.session_id);
      this.journal.append(row.session_id, 'state', { state, reason, deadlineAt: null }, 'state');
      // Close out permission cards that can no longer be answered.
      for (const ev of this.journal.since(row.session_id, 0)) {
        const p = ev.payload as { status?: string } & Record<string, unknown>;
        if (ev.kind === 'permission' && p.status === 'pending') {
          this.journal.append(row.session_id, 'permission', { ...p, status: 'resolved', decision: 'deny', by: 'server_restart', resolvedAt: now }, ev.itemKey);
        }
      }
    }
    const r = this.db
      .prepare("UPDATE submissions SET status = 'unknown', error = 'server restarted before the result was known', updated_at = ? WHERE status IN ('accepted','dispatched','started')")
      .run(now);
    if (rows.length || Number(r.changes)) this.log.warn({ chats: rows.length, submissions: Number(r.changes) }, 'reconciled state after restart');
  }

  // ---- capability probe --------------------------------------------------------

  /** Spawns Claude without sending a prompt (no model call) to read models + auth. Cached. */
  async capabilities(force = false): Promise<Capabilities> {
    if (this.caps && !force && Date.now() - this.caps.checkedAt < 10 * 60_000) return this.caps;
    if (this.capsPromise) return this.capsPromise;
    this.capsPromise = (async () => {
      const never: AsyncIterable<never> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) };
      let q: ReturnType<ClaudeSdk['query']> | null = null;
      try {
        q = this.sdk.query({
          prompt: never,
          options: { cwd: this.cfg.probeCwd, permissionMode: 'default', ...(this.cfg.claudeBin ? { pathToClaudeCodeExecutable: this.cfg.claudeBin } : {}) },
        });
        const init = await Promise.race([
          q.initializationResult(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Claude không phản hồi khi khởi tạo (30s)')), 30_000)),
        ]);
        const account = (init.account ?? {}) as Record<string, string | undefined>;
        const apiKey = !!process.env.ANTHROPIC_API_KEY;
        const method: Capabilities['auth']['method'] = apiKey ? 'api_key' : account.subscriptionType || account.email ? 'subscription' : account.apiKeySource ? 'api_key' : 'none';
        this.caps = {
          checkedAt: Date.now(),
          ok: method !== 'none',
          ...(method === 'none' ? { error: 'Claude chưa đăng nhập trên server. SSH vào server, chạy `claude` rồi `/login`.' } : {}),
          models: (init.models ?? []).map((m: ModelInfo) => ({
            value: m.value,
            displayName: m.displayName,
            description: m.description,
            effortLevels: m.supportedEffortLevels ?? [],
          })),
          auth: { method, subscriptionType: account.subscriptionType, email: account.email, organization: account.organization },
        };
      } catch (err) {
        this.caps = { checkedAt: Date.now(), ok: false, error: String((err as Error).message ?? err), models: [], auth: { method: 'unknown' } };
      } finally {
        try {
          q?.close();
        } catch {
          /* ignore */
        }
        this.capsPromise = null;
      }
      return this.caps!;
    })();
    return this.capsPromise;
  }

  // ---- queries -----------------------------------------------------------------

  async listSessions(project: string, opts: { q?: string; offset: number; limit: number }): Promise<{ total: number; items: SessionSummary[] }> {
    const dir = await this.projectDir(project);
    const infos = await this.sdk.listSessions({ dir, includeWorktrees: false });
    const chats = new Map((this.db.prepare('SELECT * FROM chats WHERE project = ?').all(project) as ChatRow[]).map((c) => [c.session_id, c]));
    // Include brand-new sessions whose transcript is not on disk yet.
    const known = new Set(infos.map((i) => i.sessionId));
    const extra: SDKSessionInfo[] = [...chats.values()]
      .filter((c) => !known.has(c.session_id))
      .map((c) => ({ sessionId: c.session_id, summary: '(phiên mới)', lastModified: c.updated_at, createdAt: c.created_at }));
    let all = [...infos, ...extra].map((i) => this.summarize(i, chats.get(i.sessionId)));
    const q = opts.q?.trim().toLowerCase();
    if (q) all = all.filter((s) => `${s.title} ${s.firstPrompt ?? ''} ${s.sessionId}`.toLowerCase().includes(q));
    all.sort((a, b) => b.lastModified - a.lastModified);
    return { total: all.length, items: all.slice(opts.offset, opts.offset + opts.limit) };
  }

  private summarize(info: SDKSessionInfo, chat: ChatRow | undefined): SessionSummary {
    const runner = this.runners.get(info.sessionId);
    const state: SessionSummary['state'] = runner ? runner.state : chat ? (chat.state as SessionSummary['state']) : 'external';
    return {
      sessionId: info.sessionId,
      title: info.customTitle || info.summary || info.firstPrompt?.slice(0, 80) || info.sessionId,
      firstPrompt: info.firstPrompt ?? null,
      lastModified: Math.max(info.lastModified, chat?.updated_at ?? 0),
      createdAt: info.createdAt ?? chat?.created_at ?? null,
      gitBranch: info.gitBranch ?? null,
      cwd: info.cwd ?? null,
      managed: !!chat,
      state,
      endedReason: runner ? runner.endReason : (chat?.ended_reason ?? null),
      deadlineAt: runner ? runner.deadlineAt : null,
      pendingCount: runner ? runner.pendingRequests.length : 0,
    };
  }

  async sessionDetail(project: string, sessionId: string): Promise<{ summary: SessionSummary; items: TimelineItem[]; journalSeq: number; pending: PendingRequest[]; settings: { model: string | null; effort: string | null; permissionMode: string } }> {
    assertSessionId(sessionId);
    const dir = await this.projectDir(project);
    const chat = this.chat(sessionId);
    if (chat && chat.project !== project) throw new HttpError(404, 'Session không thuộc project này', 'not_found');
    const info = await this.sdk.getSessionInfo(sessionId, { dir });
    if (!info && !chat) throw new HttpError(404, 'Không tìm thấy session', 'not_found');
    const messages = info ? await this.sdk.getSessionMessages(sessionId, { dir }) : [];
    const runner = this.runners.get(sessionId);
    return {
      summary: this.summarize(info ?? { sessionId, summary: '(phiên mới)', lastModified: chat!.updated_at }, chat),
      items: itemsFromTranscript(messages as Parameters<typeof itemsFromTranscript>[0]),
      journalSeq: 0,
      pending: runner?.pendingRequests ?? [],
      settings: {
        model: runner?.model ?? chat?.model ?? null,
        effort: runner?.effort ?? chat?.effort ?? null,
        permissionMode: runner?.permissionMode ?? chat?.permission_mode ?? this.cfg.defaultPermissionMode,
      },
    };
  }

  runnerState(sessionId: string): { state: string; deadlineAt: number | null; pending: PendingRequest[] } | null {
    const r = this.runners.get(sessionId);
    return r ? { state: r.state, deadlineAt: r.deadlineAt, pending: r.pendingRequests } : null;
  }

  // ---- commands ----------------------------------------------------------------

  /** Start a brand-new Claude session in `project` with a first prompt. Idempotent per clientRequestId. */
  async createSession(project: string, input: PromptInput): Promise<{ sessionId: string; duplicate: boolean }> {
    validatePrompt(input);
    const existing = this.submission(input.clientRequestId);
    if (existing) {
      if (existing.session_id) return { sessionId: existing.session_id, duplicate: true };
      const r = this.starting.get(input.clientRequestId);
      if (r) return { sessionId: await r.waitForSessionId(60_000), duplicate: true };
      throw new HttpError(409, 'Yêu cầu này đã được gửi trước đó nhưng không xác định được session. Kiểm tra danh sách session trước khi gửi lại.', 'unknown_submission');
    }
    const cwd = await this.projectDir(project);
    this.assertProjectFree(project, null);
    await this.ensureCapacity();
    this.insertSubmission(input.clientRequestId, project, null);

    const permissionMode = input.permissionMode ?? this.cfg.defaultPermissionMode;
    const runner = this.makeRunner(project, cwd, { model: input.model, effort: input.effort, permissionMode });
    this.starting.set(input.clientRequestId, runner);
    try {
      runner.start();
      runner.send(input.clientRequestId, input.text);
      this.setSubmission(input.clientRequestId, 'dispatched');
      const sessionId = await runner.waitForSessionId(60_000);
      return { sessionId, duplicate: false };
    } catch (err) {
      this.setSubmission(input.clientRequestId, 'unknown', String((err as Error).message ?? err));
      await runner.end('start_failed');
      throw new HttpError(502, `Không khởi động được Claude: ${(err as Error).message ?? err}`, 'start_failed');
    } finally {
      this.starting.delete(input.clientRequestId);
    }
  }

  /** Send a prompt to an existing session, resuming it if no process is alive. */
  async sendPrompt(project: string, sessionId: string, input: PromptInput): Promise<{ status: string; duplicate: boolean }> {
    assertSessionId(sessionId);
    validatePrompt(input);
    const existing = this.submission(input.clientRequestId);
    if (existing) return { status: existing.status, duplicate: true };

    let runner = this.runners.get(sessionId);
    const chat = this.chat(sessionId);
    if (chat && chat.project !== project) throw new HttpError(404, 'Session không thuộc project này', 'not_found');
    if (runner && runner.state === 'waiting_input') {
      throw new HttpError(409, 'Claude đang chờ bạn trả lời câu hỏi/approval. Hãy trả lời trước khi gửi prompt mới.', 'waiting_input');
    }
    if (!runner || runner.state === 'ended') {
      const cwd = await this.projectDir(project);
      if (!chat && !input.force) await this.assertExternalNotLive(sessionId, cwd);
      this.assertProjectFree(project, sessionId);
      await this.ensureCapacity();
      const info = await this.sdk.getSessionInfo(sessionId, { dir: cwd });
      if (!info && !chat) throw new HttpError(404, 'Không tìm thấy session', 'not_found');
      runner = this.makeRunner(project, cwd, {
        resume: sessionId,
        model: input.model ?? chat?.model ?? undefined,
        effort: input.effort ?? chat?.effort ?? undefined,
        permissionMode: input.permissionMode ?? (chat?.permission_mode as PermissionMode | null) ?? this.cfg.defaultPermissionMode,
      });
      this.runners.set(sessionId, runner);
      this.upsertChat(sessionId, project, runner);
      runner.start();
    } else {
      this.assertProjectFree(project, sessionId);
    }
    this.insertSubmission(input.clientRequestId, project, sessionId);
    runner.send(input.clientRequestId, input.text);
    this.setSubmission(input.clientRequestId, 'dispatched');
    return { status: 'dispatched', duplicate: false };
  }

  answer(sessionId: string, requestId: string, answer: Answer): void {
    const runner = this.runners.get(sessionId);
    if (!runner) throw new HttpError(409, 'Session không còn chạy; yêu cầu này đã hết hạn', 'not_pending');
    try {
      runner.answer(requestId, answer);
    } catch (err) {
      const e = err as Error & { status?: number; code?: string };
      throw new HttpError(e.status ?? 400, e.message, e.code);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const runner = this.runners.get(sessionId);
    if (!runner || runner.state === 'ended') throw new HttpError(409, 'Session không có tác vụ đang chạy', 'not_running');
    await runner.interrupt();
  }

  async endSession(sessionId: string, reason: EndReason = 'user_end'): Promise<void> {
    const runner = this.runners.get(sessionId);
    if (!runner) return;
    await runner.end(reason);
  }

  async updateSettings(sessionId: string, s: { model?: string | null; effort?: string | null; permissionMode?: PermissionMode }): Promise<void> {
    assertSessionId(sessionId);
    if (s.permissionMode && !PERMISSION_MODES.includes(s.permissionMode)) throw new HttpError(400, 'permissionMode không hợp lệ', 'bad_request');
    const runner = this.runners.get(sessionId);
    if (runner && runner.state !== 'ended') {
      if (s.model !== undefined) await runner.setModel(s.model ?? undefined);
      if (s.effort !== undefined) await runner.setEffort(s.effort ?? undefined);
      if (s.permissionMode) await runner.setPermissionMode(s.permissionMode);
    }
    const chat = this.chat(sessionId);
    if (chat) {
      this.db
        .prepare('UPDATE chats SET model = ?, effort = ?, permission_mode = ?, updated_at = ? WHERE session_id = ?')
        .run(s.model !== undefined ? s.model : chat.model, s.effort !== undefined ? s.effort : chat.effort, s.permissionMode ?? chat.permission_mode, Date.now(), sessionId);
    }
  }

  async renameSession(project: string, sessionId: string, title: string): Promise<void> {
    assertSessionId(sessionId);
    const t = title.trim();
    if (!t || t.length > 200) throw new HttpError(400, 'Tên session phải từ 1 đến 200 ký tự', 'bad_request');
    await this.sdk.renameSession(sessionId, t, { dir: await this.projectDir(project) });
    this.journal.ephemeral(projectChannel(project), 'sessions_changed', { sessionId });
  }

  activeCount(): number {
    return [...this.runners.values()].filter((r) => r.state !== 'ended').length;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.runners.values()].map((r) => r.end('server_shutdown')));
  }

  // ---- helpers -----------------------------------------------------------------

  private makeRunner(project: string, cwd: string, o: { resume?: string; model?: string; effort?: string; permissionMode: PermissionMode }): SessionRunner {
    let runner!: SessionRunner;
    runner = new SessionRunner({
      sdk: this.sdk,
      journal: this.journal,
      project,
      cwd,
      resume: o.resume,
      model: o.model,
      effort: o.effort,
      permissionMode: o.permissionMode,
      claudeBin: this.cfg.claudeBin,
      idleTimeoutMs: this.cfg.idleTimeoutMs,
      inputTimeoutMs: this.cfg.inputTimeoutMs,
      log: this.log,
      hooks: {
        onSessionId: (id) => {
          this.runners.set(id, runner);
          this.upsertChat(id, project, runner);
          this.db.prepare('UPDATE submissions SET session_id = ? WHERE session_id IS NULL AND project = ? AND status IN (\'accepted\',\'dispatched\',\'started\')').run(id, project);
          this.journal.ephemeral(projectChannel(project), 'sessions_changed', { sessionId: id });
        },
        onState: (state, deadlineAt) => {
          if (!runner.sessionId) return;
          this.db.prepare('UPDATE chats SET state = ?, deadline_at = ?, updated_at = ? WHERE session_id = ?').run(state, deadlineAt, Date.now(), runner.sessionId);
          this.journal.ephemeral(projectChannel(project), 'session_state', { sessionId: runner.sessionId, state, deadlineAt, pendingCount: runner.pendingRequests.length });
          this.journal.ephemeral(GLOBAL_CHANNEL, 'session_state', { project, sessionId: runner.sessionId, state, pendingCount: runner.pendingRequests.length });
        },
        onSubmission: (id, status, error) => this.setSubmission(id, status, error),
        onEnded: (reason) => {
          const id = runner.sessionId;
          if (id) {
            const state = reason === 'process_exit' ? 'interrupted' : 'ended';
            this.db.prepare('UPDATE chats SET state = ?, ended_reason = ?, deadline_at = NULL, updated_at = ? WHERE session_id = ?').run(state, reason, Date.now(), id);
            if (this.runners.get(id) === runner) this.runners.delete(id);
            this.journal.ephemeral(projectChannel(project), 'session_state', { sessionId: id, state, deadlineAt: null, pendingCount: 0, reason });
            this.journal.ephemeral(GLOBAL_CHANNEL, 'session_state', { project, sessionId: id, state, pendingCount: 0 });
          }
          this.log.info({ sessionId: id, project, reason }, 'session ended');
        },
      },
    });
    return runner;
  }

  private chat(sessionId: string): ChatRow | undefined {
    return this.db.prepare('SELECT * FROM chats WHERE session_id = ?').get(sessionId) as ChatRow | undefined;
  }

  private upsertChat(sessionId: string, project: string, r: SessionRunner): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO chats (session_id, project, state, ended_reason, model, effort, permission_mode, deadline_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET state = excluded.state, ended_reason = NULL, model = excluded.model,
           effort = excluded.effort, permission_mode = excluded.permission_mode, deadline_at = excluded.deadline_at, updated_at = excluded.updated_at`,
      )
      .run(sessionId, project, r.state, r.model ?? null, r.effort ?? null, r.permissionMode, r.deadlineAt, now, now);
  }

  private submission(id: string): { status: string; session_id: string | null } | undefined {
    return this.db.prepare('SELECT status, session_id FROM submissions WHERE client_request_id = ?').get(id) as { status: string; session_id: string | null } | undefined;
  }

  private insertSubmission(id: string, project: string, sessionId: string | null): void {
    const now = Date.now();
    tx(this.db, () => {
      this.db.prepare("INSERT INTO submissions (client_request_id, session_id, project, status, created_at, updated_at) VALUES (?, ?, ?, 'accepted', ?, ?)").run(id, sessionId, project, now, now);
    });
  }

  private setSubmission(id: string, status: string, error?: string): void {
    this.db.prepare('UPDATE submissions SET status = ?, error = ?, updated_at = ? WHERE client_request_id = ?').run(status, error ?? null, Date.now(), id);
  }

  /** MVP rule: at most one busy session per project, to avoid conflicting file edits. */
  private assertProjectFree(project: string, exceptSessionId: string | null): void {
    for (const r of this.runners.values()) {
      if (r.project === project && r.sessionId !== exceptSessionId && r.busy) {
        throw new HttpError(409, 'Project này đang có một session khác chạy. Chờ nó xong hoặc bấm Dừng trước.', 'project_busy');
      }
    }
    for (const r of this.starting.values()) {
      if (r.project === project) throw new HttpError(409, 'Project này đang khởi động một session khác.', 'project_busy');
    }
  }

  private async ensureCapacity(): Promise<void> {
    const live = [...this.runners.values()].filter((r) => r.state !== 'ended');
    if (live.length + this.starting.size < this.cfg.maxActiveSessions) return;
    const idle = live.filter((r) => r.state === 'idle').sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
    if (!idle) {
      throw new HttpError(429, `Đã đạt MAX_ACTIVE_SESSIONS=${this.cfg.maxActiveSessions} session đang chạy. Kết thúc bớt một session.`, 'capacity');
    }
    await idle.end('evicted');
  }

  private async assertExternalNotLive(sessionId: string, cwd: string): Promise<void> {
    const info = await this.sdk.getSessionInfo(sessionId, { dir: cwd });
    if (info && Date.now() - info.lastModified < this.cfg.externalBusyWindowMs) {
      throw new HttpError(
        409,
        'Session này không do web quản lý và vừa được cập nhật gần đây — có thể đang chạy trong một terminal. Web không tiếp quản process bên ngoài.',
        'external_maybe_live',
      );
    }
  }
}

function assertSessionId(id: string): void {
  if (!UUID_RE.test(id)) throw new HttpError(400, 'sessionId không hợp lệ', 'bad_request');
}

function validatePrompt(p: PromptInput): void {
  if (!UUID_RE.test(p.clientRequestId)) throw new HttpError(400, 'clientRequestId phải là UUID', 'bad_request');
  if (typeof p.text !== 'string' || !p.text.trim()) throw new HttpError(400, 'Prompt trống', 'bad_request');
  if (p.text.length > 200_000) throw new HttpError(413, 'Prompt quá dài', 'too_large');
  if (p.permissionMode && !PERMISSION_MODES.includes(p.permissionMode)) throw new HttpError(400, 'permissionMode không hợp lệ', 'bad_request');
}
