/**
 * Pure mapping from Claude SDK / transcript messages to timeline items.
 *
 * Item keys are stable across the live stream and the transcript read back from
 * disk, so the browser can merge both without duplicates:
 *   user prompt   u:<message uuid>              (we send uuid = clientRequestId)
 *   text/thinking a:<api message id>:<n>        (n = block ordinal within that API message)
 *   tool call     t:<tool_use_id>               (the tool_result is merged into the same item)
 */

export const MAX_RESULT_CHARS = 200_000;

export type UserItem = { kind: 'user'; key: string; text: string; at?: string };
export type TextItem = { kind: 'text'; key: string; text: string; parentToolUseId: string | null };
export type ThinkingItem = { kind: 'thinking'; key: string; text: string; parentToolUseId: string | null };
export type ToolItem = {
  kind: 'tool';
  key: string;
  toolUseId: string;
  name: string;
  input: unknown;
  parentToolUseId: string | null;
  result?: { text: string; isError: boolean; truncated: boolean; originalLength: number; structured?: unknown };
};
export type TimelineItem = UserItem | TextItem | ThinkingItem | ToolItem;

type Block = { type: string; [k: string]: unknown };

function contentBlocks(content: unknown): Block[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content.filter((b): b is Block => !!b && typeof b === 'object' && 'type' in b);
  return [];
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return contentBlocks(content)
    .map((b) => (b.type === 'text' ? String(b.text ?? '') : b.type === 'image' ? '[image]' : `[${b.type}]`))
    .join('\n');
}

/** Keep large tool output bounded, but say so explicitly instead of pretending it is complete. */
export function boundedResult(content: unknown, isError: boolean, structured?: unknown): NonNullable<ToolItem['result']> {
  const text = resultText(content);
  const truncated = text.length > MAX_RESULT_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_RESULT_CHARS) : text,
    isError,
    truncated,
    originalLength: text.length,
    ...(structured !== undefined ? { structured: slimStructured(structured) } : {}),
  };
}

/** Keep only small, useful parts of tool_use_result (e.g. Edit's structuredPatch); drop file bodies. */
function slimStructured(s: unknown): unknown {
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['type', 'filePath', 'structuredPatch', 'exitCode', 'interrupted', 'returnCodeInterpretation']) {
    if (k in o) out[k] = o[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Stateful per-session assembler: tracks block ordinals per API message id and
 * remembers tool items so results can be merged into them.
 */
export class ItemAssembler {
  private readonly ordinals = new Map<string, number>();
  readonly tools = new Map<string, ToolItem>();

  /** Returns items created/updated by this message (assistant or user). */
  ingest(msg: { type: string; uuid?: string; message?: unknown; parent_tool_use_id?: string | null; tool_use_result?: unknown; timestamp?: string }): TimelineItem[] {
    const m = (msg.message ?? {}) as { id?: string; role?: string; content?: unknown };
    const parent = msg.parent_tool_use_id ?? null;
    const out: TimelineItem[] = [];

    if (msg.type === 'assistant') {
      const apiId = m.id ?? msg.uuid ?? 'unknown';
      for (const b of contentBlocks(m.content)) {
        const n = this.ordinals.get(apiId) ?? 0;
        this.ordinals.set(apiId, n + 1);
        const key = `a:${apiId}:${n}`;
        if (b.type === 'text') {
          const text = String(b.text ?? '');
          if (text) out.push({ kind: 'text', key, text, parentToolUseId: parent });
        } else if (b.type === 'thinking') {
          // Only what the API exposes (often empty / omitted). Never invented.
          const text = String(b.thinking ?? '');
          if (text.trim()) out.push({ kind: 'thinking', key, text, parentToolUseId: parent });
        } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          const id = String(b.id);
          const item: ToolItem = { kind: 'tool', key: `t:${id}`, toolUseId: id, name: String(b.name), input: b.input, parentToolUseId: parent };
          const prev = this.tools.get(id);
          if (prev?.result) item.result = prev.result;
          this.tools.set(id, item);
          out.push(item);
        }
      }
      return out;
    }

    if (msg.type === 'user') {
      const blocks = contentBlocks(m.content);
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      for (const b of toolResults) {
        const id = String(b.tool_use_id);
        const existing = this.tools.get(id);
        const item: ToolItem = existing
          ? { ...existing }
          : { kind: 'tool', key: `t:${id}`, toolUseId: id, name: 'unknown', input: undefined, parentToolUseId: parent };
        item.result = boundedResult(b.content, b.is_error === true, toolResults.length === 1 ? msg.tool_use_result : undefined);
        this.tools.set(id, item);
        out.push(item);
      }
      if (!toolResults.length && parent === null) {
        const text = blocks
          .filter((b) => b.type === 'text')
          .map((b) => String(b.text ?? ''))
          .join('\n');
        if (text.trim() && msg.uuid) out.push({ kind: 'user', key: `u:${msg.uuid}`, text, at: msg.timestamp });
      }
    }
    return out;
  }
}

/** Build the whole timeline from a transcript (getSessionMessages), last write wins per key. */
export function itemsFromTranscript(messages: Array<{ type: string; uuid: string; message: unknown; parent_tool_use_id: string | null }>): TimelineItem[] {
  const asm = new ItemAssembler();
  const order: string[] = [];
  const byKey = new Map<string, TimelineItem>();
  for (const msg of messages) {
    for (const item of asm.ingest(msg)) {
      if (!byKey.has(item.key)) order.push(item.key);
      byKey.set(item.key, item);
    }
  }
  return order.map((k) => byKey.get(k)!);
}

export type StreamDelta = { key: string; text: string; kind: 'text' | 'thinking' };

/** Track stream_event frames to produce deltas keyed like the final items. */
export class DeltaTracker {
  private messageId: string | null = null;

  handle(event: { type: string; message?: { id?: string }; index?: number; delta?: { type: string; text?: string; thinking?: string } }): StreamDelta | null {
    if (event.type === 'message_start') {
      this.messageId = event.message?.id ?? null;
      return null;
    }
    if (event.type === 'content_block_delta' && this.messageId && event.delta && typeof event.index === 'number') {
      const key = `a:${this.messageId}:${event.index}`;
      if (event.delta.type === 'text_delta' && event.delta.text) return { key, text: event.delta.text, kind: 'text' };
      if (event.delta.type === 'thinking_delta' && event.delta.thinking) return { key, text: event.delta.thinking, kind: 'thinking' };
    }
    return null;
  }
}
