import { randomUUID } from 'node:crypto';
import type { Journal } from '../journal.js';
import { DeltaTracker, ItemAssembler } from './items.js';
import type { ClaudeSdk, Options, PermissionMode, PermissionResult, PermissionUpdate, QueryLike, SDKMessage, SDKUserMessage } from './sdk.js';

export type RunnerState = 'starting' | 'running' | 'waiting_input' | 'idle' | 'ended';

export type EndReason =
  | 'user_end'
  | 'idle_timeout'
  | 'input_timeout'
  | 'server_shutdown'
  | 'process_exit'
  | 'start_failed'
  | 'evicted';

export type PendingKind = 'question' | 'plan' | 'tool';

export type PendingRequest = {
  requestId: string;
  toolUseId: string;
  toolName: string;
  kind: PendingKind;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
  canAlwaysAllow: boolean;
  createdAt: number;
  expiresAt: number;
};

export type Answer =
  | { type: 'allow' }
  | { type: 'allow_always' }
  | { type: 'deny'; message?: string }
  | { type: 'answers'; answers: Record<string, string>; notes?: Record<string, string> }
  | { type: 'plan_approve' }
  | { type: 'plan_reject'; message?: string };

type PendingInternal = PendingRequest & {
  resolve: (r: PermissionResult) => void;
  suggestions?: PermissionUpdate[];
};

export type RunnerHooks = {
  onSessionId(sessionId: string): void;
  onState(state: RunnerState, deadlineAt: number | null): void;
  onSubmission(clientRequestId: string, status: 'started' | 'completed' | 'failed' | 'unknown' | 'cancelled', error?: string): void;
  onEnded(reason: EndReason): void;
};

export type RunnerOptions = {
  sdk: ClaudeSdk;
  journal: Journal;
  hooks: RunnerHooks;
  project: string;
  cwd: string;
  resume?: string;
  model?: string;
  effort?: string;
  permissionMode: PermissionMode;
  claudeBin?: string;
  idleTimeoutMs: number;
  inputTimeoutMs: number;
  log: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; debug(o: unknown, m?: string): void };
};

/** Async queue feeding the SDK's streaming-input iterable. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiter: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(m: SDKUserMessage): void {
    if (this.closed) throw new Error('input closed');
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: m, done: false });
    } else this.items.push(m);
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((r) => (this.waiter = r));
      },
    };
  }
}

const TIMEOUT_DENY_MESSAGE =
  'Người dùng không phản hồi trong thời gian cho phép nên session đã tạm dừng. Không thực hiện hành động này; chờ người dùng quay lại.';

/**
 * Owns one long-lived SDK Query (streaming input mode) for one Claude session,
 * the pending permission/question requests, and the idle/input timeouts.
 * A browser disconnecting never affects a runner.
 */
export class SessionRunner {
  sessionId: string | null;
  state: RunnerState = 'starting';
  deadlineAt: number | null = null;
  endReason: EndReason | null = null;
  readonly project: string;
  model: string | undefined;
  effort: string | undefined;
  permissionMode: PermissionMode;
  lastActivityAt = Date.now();

  private readonly input = new InputQueue();
  private q: QueryLike | null = null;
  private readonly pending = new Map<string, PendingInternal>();
  /** clientRequestIds sent but without a result yet. */
  private readonly outstanding = new Set<string>();
  private readonly assembler = new ItemAssembler();
  private readonly deltas = new DeltaTracker();
  private idleTimer: NodeJS.Timeout | null = null;
  private inputTimer: NodeJS.Timeout | null = null;
  private sessionIdWaiters: Array<(id: string) => void> = [];
  private loopDone: Promise<void> | null = null;
  private ending = false;

  constructor(private readonly o: RunnerOptions) {
    this.sessionId = o.resume ?? null;
    this.project = o.project;
    this.model = o.model;
    this.effort = o.effort;
    this.permissionMode = o.permissionMode;
  }

  get pendingRequests(): PendingRequest[] {
    return [...this.pending.values()].map(({ resolve: _r, suggestions: _s, ...p }) => p);
  }

  get busy(): boolean {
    return this.state === 'running' || this.state === 'waiting_input' || this.state === 'starting';
  }

  start(): void {
    const options: Options = {
      cwd: this.o.cwd,
      permissionMode: this.o.permissionMode,
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      canUseTool: (name, input, opts) => this.canUseTool(name, input, opts),
      stderr: (data: string) => this.o.log.debug({ project: this.project, stderr: data.slice(0, 2000) }, 'claude stderr'),
      ...(this.o.resume ? { resume: this.o.resume } : {}),
      ...(this.o.model ? { model: this.o.model } : {}),
      ...(this.o.effort ? { effort: this.o.effort as Options['effort'] } : {}),
      ...(this.o.claudeBin ? { pathToClaudeCodeExecutable: this.o.claudeBin } : {}),
    };
    this.q = this.o.sdk.query({ prompt: this.input, options });
    this.loopDone = this.loop();
  }

  /** Resolves once Claude has told us the session id (immediately when resuming). */
  waitForSessionId(timeoutMs: number): Promise<string> {
    if (this.sessionId) return Promise.resolve(this.sessionId);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Claude không trả về session id kịp thời')), timeoutMs);
      this.sessionIdWaiters.push((id) => {
        clearTimeout(t);
        resolve(id);
      });
    });
  }

  send(clientRequestId: string, text: string): void {
    if (this.state === 'ended') throw new Error('session ended');
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      uuid: clientRequestId as SDKUserMessage['uuid'],
      session_id: this.sessionId ?? '',
    };
    this.outstanding.add(clientRequestId);
    this.input.push(msg);
    this.touch();
    if (this.sessionId) this.o.journal.append(this.sessionId, 'item', { kind: 'user', key: `u:${clientRequestId}`, text, at: new Date().toISOString() }, `u:${clientRequestId}`);
    else this.preSessionUserItems.push({ clientRequestId, text });
    this.setState(this.pending.size ? 'waiting_input' : 'running');
  }

  private preSessionUserItems: Array<{ clientRequestId: string; text: string }> = [];

  answer(requestId: string, answer: Answer): void {
    const p = this.pending.get(requestId);
    if (!p) throw Object.assign(new Error('Yêu cầu này đã được trả lời hoặc đã hết hạn'), { status: 409, code: 'not_pending' });
    let result: PermissionResult;
    switch (answer.type) {
      case 'allow':
        result = { behavior: 'allow', updatedInput: p.input };
        break;
      case 'allow_always':
        result = { behavior: 'allow', updatedInput: p.input, ...(p.suggestions?.length ? { updatedPermissions: p.suggestions } : {}) };
        break;
      case 'deny':
        result = { behavior: 'deny', message: answer.message?.trim() || 'Người dùng từ chối thao tác này.' };
        break;
      case 'answers':
        if (p.kind !== 'question') throw Object.assign(new Error('Yêu cầu này không phải câu hỏi'), { status: 400 });
        result = {
          behavior: 'allow',
          updatedInput: {
            ...p.input,
            answers: answer.answers,
            ...(answer.notes && Object.keys(answer.notes).length
              ? { annotations: Object.fromEntries(Object.entries(answer.notes).map(([q, notes]) => [q, { notes }])) }
              : {}),
          },
        };
        break;
      case 'plan_approve':
        result = { behavior: 'allow', updatedInput: p.input };
        break;
      case 'plan_reject':
        result = { behavior: 'deny', message: answer.message?.trim() || 'Người dùng chưa duyệt plan, hãy điều chỉnh.' };
        break;
    }
    this.resolvePending(p, result, { by: 'user', answer });
  }

  async interrupt(): Promise<void> {
    for (const p of [...this.pending.values()]) {
      this.resolvePending(p, { behavior: 'deny', message: 'Người dùng đã bấm Dừng.', interrupt: true }, { by: 'interrupt' });
    }
    if (this.q && (this.state === 'running' || this.state === 'waiting_input')) {
      await withTimeout(this.q.interrupt(), 10_000).catch((err) => this.o.log.warn({ err: String(err) }, 'interrupt failed'));
    }
  }

  async end(reason: EndReason): Promise<void> {
    if (this.state === 'ended' || this.ending) return;
    this.ending = true;
    this.endReason = reason;
    const message = reason === 'input_timeout' ? TIMEOUT_DENY_MESSAGE : 'Session đã được kết thúc.';
    for (const p of [...this.pending.values()]) {
      this.resolvePending(p, { behavior: 'deny', message, interrupt: true }, { by: reason === 'input_timeout' ? 'timeout' : 'session_end' });
    }
    if (this.q && (this.state === 'running' || this.state === 'waiting_input')) {
      await withTimeout(this.q.interrupt(), 10_000).catch(() => undefined);
    }
    for (const id of this.outstanding) this.o.hooks.onSubmission(id, 'cancelled');
    this.outstanding.clear();
    this.input.close();
    try {
      this.q?.close();
    } catch {
      /* already closed */
    }
    await withTimeout(this.loopDone ?? Promise.resolve(), 10_000).catch(() => undefined);
    this.finish(reason);
  }

  async setModel(model: string | undefined): Promise<void> {
    this.model = model;
    if (this.q && this.state !== 'ended') await this.q.setModel(model);
  }

  async setEffort(effort: string | undefined): Promise<void> {
    this.effort = effort;
    if (this.q && this.state !== 'ended') await this.q.applyFlagSettings({ effortLevel: effort ?? null });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
    if (this.q && this.state !== 'ended') await this.q.setPermissionMode(mode);
  }

  // ---- internals -------------------------------------------------------------

  private async loop(): Promise<void> {
    try {
      for await (const m of this.q!) {
        this.handle(m);
      }
      if (!this.ending) {
        this.o.log.warn({ project: this.project, sessionId: this.sessionId }, 'claude process stream ended unexpectedly');
        this.crash('Process Claude đã dừng.');
      }
    } catch (err) {
      if (!this.ending) {
        this.o.log.warn({ err: String(err), sessionId: this.sessionId }, 'claude query failed');
        this.crash(String((err as Error)?.message ?? err));
      }
    }
  }

  private crash(message: string): void {
    if (this.sessionId) this.o.journal.append(this.sessionId, 'error', { message });
    for (const id of this.outstanding) this.o.hooks.onSubmission(id, 'unknown', message);
    this.outstanding.clear();
    for (const p of [...this.pending.values()]) {
      this.resolvePending(p, { behavior: 'deny', message: 'Process đã dừng.' }, { by: 'process_exit' });
    }
    this.input.close();
    this.endReason = 'process_exit';
    this.finish('process_exit');
  }

  private finish(reason: EndReason): void {
    this.clearTimers();
    this.state = 'ended';
    this.deadlineAt = null;
    if (this.sessionId) {
      this.o.journal.append(this.sessionId, 'state', { state: 'ended', reason, deadlineAt: null }, 'state');
    }
    this.o.hooks.onEnded(reason);
    // Unblock anyone still waiting for an id that will never come.
    this.sessionIdWaiters = [];
  }

  private handle(m: SDKMessage): void {
    const anyMsg = m as unknown as { session_id?: string; type: string; subtype?: string };
    if (!this.sessionId && anyMsg.session_id) this.adoptSessionId(anyMsg.session_id);
    const sid = this.sessionId;
    if (!sid) return;

    switch (anyMsg.type) {
      case 'stream_event': {
        const d = this.deltas.handle((m as { event: Parameters<DeltaTracker['handle']>[0] }).event);
        if (d) this.o.journal.ephemeral(`s:${sid}`, 'delta', d);
        this.touch();
        return;
      }
      case 'assistant':
      case 'user': {
        const msg = m as Parameters<ItemAssembler['ingest']>[0] & { error?: string };
        for (const item of this.assembler.ingest(msg)) this.o.journal.append(sid, 'item', item, item.key);
        if (anyMsg.type === 'assistant' && msg.error) this.o.journal.append(sid, 'error', { message: `Lỗi từ API: ${msg.error}`, code: msg.error });
        this.touch();
        return;
      }
      case 'result': {
        const r = m as Extract<SDKMessage, { type: 'result' }>;
        const ids = (r as { user_message_uuids?: string[]; user_message_uuid?: string }).user_message_uuids ??
          ((r as { user_message_uuid?: string }).user_message_uuid ? [(r as { user_message_uuid?: string }).user_message_uuid!] : []);
        const finished = ids.length ? ids : [...this.outstanding];
        for (const id of finished) {
          if (this.outstanding.delete(id)) this.o.hooks.onSubmission(id, r.is_error ? 'failed' : 'completed', r.is_error ? summarizeErrors(r) : undefined);
        }
        this.o.journal.append(sid, 'result', {
          key: `r:${r.uuid}`,
          subtype: r.subtype,
          isError: r.is_error,
          numTurns: r.num_turns,
          durationMs: r.duration_ms,
          totalCostUsd: r.total_cost_usd,
          usage: r.usage,
          stopReason: r.stop_reason,
          terminalReason: (r as { terminal_reason?: string }).terminal_reason,
          errors: 'errors' in r ? r.errors : undefined,
          permissionDenials: r.permission_denials?.length ?? 0,
          userMessageIds: ids,
        });
        this.touch();
        if (!this.outstanding.size && !this.pending.size) this.setState('idle');
        return;
      }
      case 'rate_limit_event':
        this.o.journal.append(sid, 'rate_limit', (m as { rate_limit_info: unknown }).rate_limit_info, 'rate_limit');
        return;
      case 'system': {
        if (anyMsg.subtype === 'init') {
          const init = m as Extract<SDKMessage, { type: 'system'; subtype: 'init' }>;
          this.o.journal.append(
            sid,
            'init',
            { model: init.model, permissionMode: init.permissionMode, apiKeySource: init.apiKeySource, claudeCodeVersion: init.claude_code_version, cwd: init.cwd, effort: init.effort ?? null },
            'init',
          );
        } else if (anyMsg.subtype === 'status') {
          const s = m as { status: string | null; permissionMode?: string };
          this.o.journal.ephemeral(`s:${sid}`, 'status', { status: s.status, permissionMode: s.permissionMode });
          if (s.permissionMode && s.permissionMode !== this.permissionMode) {
            this.permissionMode = s.permissionMode as PermissionMode;
            this.o.journal.append(sid, 'permission_mode', { permissionMode: s.permissionMode }, 'permission_mode');
          }
        } else if (anyMsg.subtype === 'compact_boundary') {
          this.o.journal.append(sid, 'notice', { key: `n:${randomUUID()}`, text: 'Claude đã nén (compact) ngữ cảnh hội thoại.' });
        } else if (anyMsg.subtype === 'permission_denied') {
          const d = m as { tool_name: string; message: string; tool_use_id: string };
          this.o.journal.append(sid, 'notice', { key: `n:${d.tool_use_id}`, text: `Bị chặn bởi quy tắc quyền: ${d.tool_name} — ${d.message}` });
        }
        return;
      }
      default: {
        if (anyMsg.type === 'command_lifecycle') {
          const c = m as unknown as { command_uuid?: string; state?: string };
          if (c.command_uuid && c.state === 'started' && this.outstanding.has(c.command_uuid)) this.o.hooks.onSubmission(c.command_uuid, 'started');
          if (c.command_uuid && c.state === 'cancelled' && this.outstanding.delete(c.command_uuid)) this.o.hooks.onSubmission(c.command_uuid, 'cancelled');
        }
        if (anyMsg.type === 'tool_progress') {
          const t = m as { tool_use_id: string; elapsed_time_seconds: number; tool_name: string };
          this.o.journal.ephemeral(`s:${sid}`, 'tool_progress', { toolUseId: t.tool_use_id, elapsed: t.elapsed_time_seconds, toolName: t.tool_name });
          this.touch();
        }
      }
    }
  }

  private adoptSessionId(id: string): void {
    this.sessionId = id;
    this.o.hooks.onSessionId(id);
    for (const u of this.preSessionUserItems) {
      this.o.journal.append(id, 'item', { kind: 'user', key: `u:${u.clientRequestId}`, text: u.text, at: new Date().toISOString() }, `u:${u.clientRequestId}`);
    }
    this.preSessionUserItems = [];
    this.publishState();
    for (const w of this.sessionIdWaiters) w(id);
    this.sessionIdWaiters = [];
  }

  private canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID: string; title?: string; description?: string; decisionReason?: string; blockedPath?: string; suppressAlwaysAllowRule?: boolean },
  ): Promise<PermissionResult> {
    if (this.ending || this.state === 'ended') return Promise.resolve({ behavior: 'deny', message: 'Session đã kết thúc.' });
    const kind: PendingKind = toolName === 'AskUserQuestion' ? 'question' : toolName === 'ExitPlanMode' ? 'plan' : 'tool';
    const now = Date.now();
    const req: PendingInternal = {
      requestId: randomUUID(),
      toolUseId: opts.toolUseID,
      toolName,
      kind,
      input,
      title: opts.title,
      description: opts.description,
      decisionReason: opts.decisionReason,
      blockedPath: opts.blockedPath,
      canAlwaysAllow: kind === 'tool' && !opts.suppressAlwaysAllowRule && !!opts.suggestions?.length,
      createdAt: now,
      expiresAt: now + this.o.inputTimeoutMs,
      suggestions: opts.suggestions,
      resolve: () => undefined,
    };
    const promise = new Promise<PermissionResult>((resolve) => (req.resolve = resolve));
    this.pending.set(req.requestId, req);
    const { resolve: _r, suggestions: _s, ...publicReq } = req;
    if (this.sessionId) this.o.journal.append(this.sessionId, 'permission', { ...publicReq, status: 'pending' }, `p:${req.requestId}`);
    opts.signal.addEventListener('abort', () => {
      if (this.pending.has(req.requestId)) this.resolvePending(req, { behavior: 'deny', message: 'Đã huỷ.' }, { by: 'cancelled' });
    });
    this.touch();
    this.setState('waiting_input');
    return promise;
  }

  private resolvePending(p: PendingInternal, result: PermissionResult, meta: { by: string; answer?: Answer }): void {
    if (!this.pending.delete(p.requestId)) return;
    p.resolve(result);
    const { resolve: _r, suggestions: _s, ...publicReq } = p;
    if (this.sessionId) {
      this.o.journal.append(
        this.sessionId,
        'permission',
        { ...publicReq, status: 'resolved', decision: result.behavior, by: meta.by, answer: meta.answer ?? null, resolvedAt: Date.now() },
        `p:${p.requestId}`,
      );
    }
    if (this.state !== 'ended' && !this.ending) {
      this.touch();
      this.setState(this.pending.size ? 'waiting_input' : this.outstanding.size ? 'running' : 'idle');
    }
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
    if (this.state === 'idle' && !this.ending) {
      // Activity while idle (e.g. a late event) restarts the idle countdown.
      this.armTimers();
      this.publishState();
    }
  }

  private setState(state: RunnerState): void {
    if (this.state === 'ended' || this.ending) return;
    const changed = state !== this.state;
    this.state = state;
    this.armTimers();
    if (changed) this.publishState();
  }

  private publishState(): void {
    if (this.sessionId) {
      this.o.journal.append(this.sessionId, 'state', { state: this.state, deadlineAt: this.deadlineAt, reason: null }, 'state');
    }
    this.o.hooks.onState(this.state, this.deadlineAt);
  }

  /** Timers depend only on runner state, never on whether a browser is connected. */
  private armTimers(): void {
    this.clearTimers();
    if (this.state === 'idle') {
      this.deadlineAt = Date.now() + this.o.idleTimeoutMs;
      this.idleTimer = setTimeout(() => void this.end('idle_timeout'), this.o.idleTimeoutMs);
    } else if (this.state === 'waiting_input' && this.pending.size) {
      const first = Math.min(...[...this.pending.values()].map((p) => p.expiresAt));
      this.deadlineAt = first;
      this.inputTimer = setTimeout(() => void this.end('input_timeout'), Math.max(0, first - Date.now()));
    } else {
      this.deadlineAt = null;
    }
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.idleTimer = this.inputTimer = null;
  }
}

function summarizeErrors(r: unknown): string {
  const e = (r as { errors?: string[]; result?: string }).errors ?? [];
  return e.join('; ') || String((r as { result?: string }).result ?? 'error');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
