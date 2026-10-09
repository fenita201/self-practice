/**
 * Client-side timeline model: merges the Claude transcript (authoritative
 * history read from disk) with journal events streamed from the backend.
 * Keys are shared with the server (see server/claude/items.ts), so applying
 * the same event twice, or an event for an item already in the transcript,
 * never duplicates anything.
 */

export type ToolResult = { text: string; isError: boolean; truncated: boolean; originalLength: number; structured?: { type?: string; filePath?: string; structuredPatch?: Array<{ oldStart: number; newStart: number; lines: string[] }> } };

export type UserItem = { kind: 'user'; key: string; text: string; at?: string };
export type TextItem = { kind: 'text'; key: string; text: string; parentToolUseId: string | null };
export type ThinkingItem = { kind: 'thinking'; key: string; text: string; parentToolUseId: string | null };
export type ToolItem = { kind: 'tool'; key: string; toolUseId: string; name: string; input: Record<string, unknown> | undefined; parentToolUseId: string | null; result?: ToolResult };
export type ResultItem = {
  kind: 'result';
  key: string;
  subtype: string;
  isError: boolean;
  numTurns: number;
  durationMs: number;
  totalCostUsd: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  errors?: string[];
  terminalReason?: string;
  userMessageIds: string[];
};
export type NoticeItem = { kind: 'notice'; key: string; text: string; level: 'info' | 'error' };

export type Permission = {
  requestId: string;
  toolUseId: string;
  toolName: string;
  kind: 'question' | 'plan' | 'tool';
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
  canAlwaysAllow: boolean;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'resolved';
  decision?: 'allow' | 'deny';
  by?: string;
  answer?: { type: string; answers?: Record<string, string>; message?: string } | null;
};

export type Entry = UserItem | TextItem | ThinkingItem | ToolItem | ResultItem | NoticeItem;

export type LiveState = { state: string; deadlineAt: number | null; reason: string | null };

export type Timeline = {
  order: string[];
  map: Record<string, Entry>;
  /** Streaming text not yet confirmed by a completed item (ephemeral). */
  drafts: Record<string, { kind: 'text' | 'thinking'; text: string }>;
  permissions: Record<string, Permission>; // by requestId
  live: LiveState | null;
  init: { model?: string; permissionMode?: string; apiKeySource?: string; claudeCodeVersion?: string; effort?: string | null } | null;
  rateLimit: { status: string; utilization?: number; rateLimitType?: string; resetsAt?: number } | null;
  status: string | null; // 'requesting' | 'compacting' | null
  lastSeq: number;
  toolProgress: Record<string, number>; // toolUseId -> elapsed seconds
};

export const emptyTimeline = (): Timeline => ({
  order: [],
  map: {},
  drafts: {},
  permissions: {},
  live: null,
  init: null,
  rateLimit: null,
  status: null,
  lastSeq: 0,
  toolProgress: {},
});

export function fromTranscript(items: Entry[]): Timeline {
  const t = emptyTimeline();
  for (const it of items) {
    if (!t.map[it.key]) t.order.push(it.key);
    t.map[it.key] = it;
  }
  return t;
}

export type StreamEvent = { kind: string; seq: number | null; itemKey?: string | null; payload: unknown; channel?: string };

function upsert(t: Timeline, item: Entry): Timeline {
  const exists = !!t.map[item.key];
  const drafts = t.drafts[item.key] ? { ...t.drafts } : t.drafts;
  if (drafts !== t.drafts) delete drafts[item.key];
  return { ...t, order: exists ? t.order : [...t.order, item.key], map: { ...t.map, [item.key]: item }, drafts };
}

/** Pure reducer for one stream event. */
export function applyEvent(t: Timeline, ev: StreamEvent): Timeline {
  if (ev.seq !== null && ev.seq !== undefined) t = { ...t, lastSeq: Math.max(t.lastSeq, ev.seq) };
  const p = ev.payload as Record<string, unknown>;
  switch (ev.kind) {
    case 'item':
      return upsert(t, p as unknown as Entry);
    case 'delta': {
      const d = p as { key: string; text: string; kind: 'text' | 'thinking' };
      if (t.map[d.key]) return t; // already finalised
      const prev = t.drafts[d.key];
      return { ...t, drafts: { ...t.drafts, [d.key]: { kind: d.kind, text: (prev?.text ?? '') + d.text } } };
    }
    case 'result':
      return upsert({ ...t, toolProgress: {}, status: null }, { kind: 'result', ...(p as object) } as ResultItem);
    case 'error':
      return upsert(t, { kind: 'notice', key: `e:${ev.seq ?? Math.random()}`, text: String(p.message ?? 'Lỗi'), level: 'error' });
    case 'notice':
      return upsert(t, { kind: 'notice', key: String(p.key), text: String(p.text), level: 'info' });
    case 'permission': {
      const perm = p as unknown as Permission;
      return { ...t, permissions: { ...t.permissions, [perm.requestId]: perm } };
    }
    case 'state':
      return { ...t, live: { state: String(p.state), deadlineAt: (p.deadlineAt as number | null) ?? null, reason: (p.reason as string | null) ?? null }, ...(p.state === 'ended' || p.state === 'idle' ? { drafts: {}, status: null } : {}) };
    case 'init':
      return { ...t, init: p as Timeline['init'] };
    case 'permission_mode':
      return { ...t, init: { ...(t.init ?? {}), permissionMode: String(p.permissionMode) } };
    case 'rate_limit':
      return { ...t, rateLimit: p as Timeline['rateLimit'] };
    case 'status':
      return { ...t, status: (p.status as string | null) ?? null };
    case 'tool_progress':
      return { ...t, toolProgress: { ...t.toolProgress, [String(p.toolUseId)]: Number(p.elapsed) } };
    default:
      return t;
  }
}

/**
 * Display order: transcript/journal order, except turn results are moved to the
 * end of the turn they belong to (just before the next user prompt).
 */
export function orderedEntries(t: Timeline): Entry[] {
  const results: ResultItem[] = [];
  const base: Entry[] = [];
  for (const k of t.order) {
    const e = t.map[k]!;
    if (e.kind === 'result') results.push(e);
    else base.push(e);
  }
  if (!results.length) return base;
  const out = [...base];
  for (const r of results) {
    const lastId = r.userMessageIds[r.userMessageIds.length - 1];
    const userIdx = lastId ? out.findIndex((e) => e.key === `u:${lastId}`) : -1;
    if (userIdx < 0) {
      out.push(r);
      continue;
    }
    let pos = out.length;
    for (let i = userIdx + 1; i < out.length; i++) {
      if (out[i]!.kind === 'user') {
        pos = i;
        break;
      }
    }
    out.splice(pos, 0, r);
  }
  return out;
}

export const pendingPermissions = (t: Timeline): Permission[] =>
  Object.values(t.permissions)
    .filter((p) => p.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);

export function permissionForTool(t: Timeline, toolUseId: string): Permission | undefined {
  let best: Permission | undefined;
  for (const p of Object.values(t.permissions)) {
    if (p.toolUseId === toolUseId && (!best || p.createdAt > best.createdAt)) best = p;
  }
  return best;
}

/** Permissions whose tool item is not in the timeline (e.g. arrived before the tool_use item). */
export function orphanPermissions(t: Timeline): Permission[] {
  return Object.values(t.permissions).filter((p) => !t.map[`t:${p.toolUseId}`] && p.status === 'pending');
}

/** The last question/approval that expired because nobody answered (to pre-fill the composer). */
export function lastTimedOutQuestion(t: Timeline): Permission | undefined {
  return Object.values(t.permissions)
    .filter((p) => p.status === 'resolved' && p.by === 'timeout')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}
