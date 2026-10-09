import { memo, useState } from 'react';
import { Markdown } from './Markdown';
import type { Entry, Permission, ResultItem, Timeline, ToolItem } from './timeline';
import { permissionForTool } from './timeline';
import { copyText, fmtCountdown, fmtDuration } from './util';

export type AnswerFn = (requestId: string, answer: Record<string, unknown>) => Promise<void>;

type Ctx = {
  timeline: Timeline;
  now: number;
  onAnswer: AnswerFn;
  onOpenFile: (absOrRel: string) => void;
};

const TOOL_LABEL: Record<string, string> = {
  Bash: 'Chạy lệnh',
  Read: 'Đọc',
  Edit: 'Sửa',
  MultiEdit: 'Sửa',
  Write: 'Ghi',
  NotebookEdit: 'Sửa notebook',
  Glob: 'Tìm file',
  Grep: 'Tìm nội dung',
  WebFetch: 'Tải web',
  WebSearch: 'Tìm web',
  Task: 'Subagent',
  Agent: 'Subagent',
  TodoWrite: 'Kế hoạch',
  AskUserQuestion: 'Câu hỏi',
  ExitPlanMode: 'Plan',
};

const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

function toolSummary(t: ToolItem): string {
  const i = t.input ?? {};
  switch (t.name) {
    case 'Bash':
      return s(i.command);
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return s(i.file_path ?? i.notebook_path);
    case 'Glob':
    case 'Grep':
      return `${s(i.pattern)}${i.path ? ` trong ${s(i.path)}` : ''}`;
    case 'WebFetch':
      return s(i.url);
    case 'WebSearch':
      return s(i.query);
    case 'Task':
    case 'Agent':
      return s(i.description ?? i.prompt).slice(0, 120);
    case 'TodoWrite':
      return `${Array.isArray(i.todos) ? i.todos.length : 0} việc`;
    default:
      return JSON.stringify(i).slice(0, 140);
  }
}

export function TimelineEntry({ entry, ctx }: { entry: Entry; ctx: Ctx }) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="msg user">
          <div className="bubble">{entry.text}</div>
        </div>
      );
    case 'text':
      return (
        <div className={`msg assistant ${entry.parentToolUseId ? 'nested' : ''}`}>
          <Markdown text={entry.text} />
          <button className="copy-btn" title="Copy" onClick={() => void copyText(entry.text)}>
            ⧉
          </button>
        </div>
      );
    case 'thinking':
      return (
        <details className={`thinking ${entry.parentToolUseId ? 'nested' : ''}`}>
          <summary>Tóm tắt suy nghĩ</summary>
          <div className="muted pre-wrap">{entry.text}</div>
        </details>
      );
    case 'tool':
      return <ToolCard item={entry} ctx={ctx} />;
    case 'result':
      return <ResultLine r={entry} />;
    case 'notice':
      return <div className={`notice ${entry.level}`}>{entry.text}</div>;
  }
}

function ResultLine({ r }: { r: ResultItem }) {
  const u = r.usage ?? {};
  const tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  if (r.isError) {
    const why = r.subtype === 'error_max_turns' ? 'đạt giới hạn số lượt' : r.terminalReason === 'aborted_streaming' || r.terminalReason === 'aborted_tools' ? 'đã dừng' : (r.errors ?? []).join('; ') || r.subtype;
    return <div className="result-line error">✕ Kết thúc lượt: {why} · {fmtDuration(r.durationMs)}</div>;
  }
  return (
    <div className="result-line" title={`input ${tokens.toLocaleString()} (cache read ${(u.cache_read_input_tokens ?? 0).toLocaleString()}) · output ${(u.output_tokens ?? 0).toLocaleString()} tokens`}>
      ✓ Xong · {r.numTurns} bước · {fmtDuration(r.durationMs)}
      {typeof r.totalCostUsd === 'number' ? ` · ≈$${r.totalCostUsd.toFixed(3)}` : ''} · {Math.round(tokens / 1000)}k↑ {Math.round((u.output_tokens ?? 0) / 1000 * 10) / 10}k↓
    </div>
  );
}

const ToolCard = memo(function ToolCard({ item, ctx }: { item: ToolItem; ctx: Ctx }) {
  const perm = permissionForTool(ctx.timeline, item.toolUseId);
  const pending = perm?.status === 'pending';
  const [open, setOpen] = useState(false);
  const progress = ctx.timeline.toolProgress[item.toolUseId];

  if (item.name === 'AskUserQuestion') return <QuestionCard item={item} perm={perm} ctx={ctx} />;
  if (item.name === 'ExitPlanMode') return <PlanCard item={item} perm={perm} ctx={ctx} />;

  const status = pending ? 'ask' : item.result ? (item.result.isError ? 'err' : 'ok') : perm?.decision === 'deny' ? 'err' : 'run';
  const icon = { ask: '?', run: '…', ok: '✓', err: '✕' }[status];
  const path = s(item.input?.file_path ?? item.input?.notebook_path);
  const expanded = open || pending;

  return (
    <div className={`tool ${status} ${item.parentToolUseId ? 'nested' : ''}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={expanded}>
        <span className={`tool-icon ${status}`}>{icon}</span>
        <span className="tool-name">{TOOL_LABEL[item.name] ?? item.name}</span>
        <span className="tool-summary mono">{toolSummary(item)}</span>
        {status === 'run' && progress ? <span className="muted small">{Math.round(progress)}s</span> : null}
      </button>
      {expanded && (
        <div className="tool-body">
          <ToolInput item={item} onOpenFile={ctx.onOpenFile} />
          {item.result && <ToolOutput item={item} />}
          {perm && perm.status === 'resolved' && perm.kind === 'tool' && (
            <div className="muted small">
              {perm.decision === 'allow' ? 'Đã cho phép' : perm.by === 'timeout' ? 'Tự từ chối vì hết thời gian chờ' : perm.by === 'user' ? 'Bạn đã từ chối' : 'Đã huỷ'}
            </div>
          )}
        </div>
      )}
      {path && !expanded && (item.name === 'Edit' || item.name === 'Write' || item.name === 'MultiEdit') && item.result && !item.result.isError && (
        <button className="link small tool-open" onClick={() => ctx.onOpenFile(path)}>
          Mở file
        </button>
      )}
      {pending && perm && <PermissionBox perm={perm} ctx={ctx} />}
    </div>
  );
});

function ToolInput({ item, onOpenFile }: { item: ToolItem; onOpenFile: (p: string) => void }) {
  const i = item.input ?? {};
  if (item.name === 'Bash') {
    return (
      <>
        {i.description ? <div className="muted small">{s(i.description)}</div> : null}
        <pre className="code">$ {s(i.command)}</pre>
      </>
    );
  }
  if (item.name === 'Edit') {
    return (
      <>
        <button className="link mono small" onClick={() => onOpenFile(s(i.file_path))}>
          {s(i.file_path)}
        </button>
        <pre className="diff">
          {s(i.old_string)
            .split('\n')
            .map((l, k) => (
              <div key={`o${k}`} className="diff-del">
                - {l}
              </div>
            ))}
          {s(i.new_string)
            .split('\n')
            .map((l, k) => (
              <div key={`n${k}`} className="diff-add">
                + {l}
              </div>
            ))}
        </pre>
      </>
    );
  }
  if (item.name === 'Write') {
    const lines = s(i.content).split('\n');
    return (
      <>
        <button className="link mono small" onClick={() => onOpenFile(s(i.file_path))}>
          {s(i.file_path)}
        </button>
        <pre className="code">
          {lines.slice(0, 60).join('\n')}
          {lines.length > 60 ? `\n… (+${lines.length - 60} dòng)` : ''}
        </pre>
      </>
    );
  }
  if (item.name === 'TodoWrite' && Array.isArray(i.todos)) {
    return (
      <ul className="todos">
        {(i.todos as Array<{ content: string; status: string }>).map((t, k) => (
          <li key={k} className={t.status}>
            {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} {t.content}
          </li>
        ))}
      </ul>
    );
  }
  return <pre className="code">{JSON.stringify(i, null, 2)}</pre>;
}

function ToolOutput({ item }: { item: ToolItem }) {
  const r = item.result!;
  const [all, setAll] = useState(false);
  const lines = r.text.split('\n');
  const shown = all ? r.text : lines.slice(0, 40).join('\n');
  return (
    <div className={`tool-output ${r.isError ? 'error' : ''}`}>
      <pre className="code">{shown || '(không có output)'}</pre>
      {!all && lines.length > 40 && (
        <button className="link small" onClick={() => setAll(true)}>
          Xem toàn bộ ({lines.length} dòng)
        </button>
      )}
      {r.truncated && <div className="muted small">Output gốc dài {r.originalLength.toLocaleString()} ký tự; web chỉ lưu {r.text.length.toLocaleString()} ký tự đầu.</div>}
    </div>
  );
}

function Countdown({ perm, now }: { perm: Permission; now: number }) {
  const left = perm.expiresAt - now;
  return <span className={`countdown ${left < 60_000 ? 'urgent' : ''}`}>tự huỷ sau {fmtCountdown(left)}</span>;
}

function PermissionBox({ perm, ctx }: { perm: Permission; ctx: Ctx }) {
  const [reason, setReason] = useState('');
  const [denying, setDenying] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async (answer: Record<string, unknown>) => {
    setBusy(true);
    try {
      await ctx.onAnswer(perm.requestId, answer);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="perm-box" id={`perm-${perm.requestId}`}>
      <div className="perm-title">{perm.title ?? `Claude muốn dùng ${perm.toolName}`}</div>
      {perm.description && <div className="muted small">{perm.description}</div>}
      {perm.decisionReason && <div className="muted small">Lý do hỏi: {perm.decisionReason}</div>}
      {perm.blockedPath && <div className="muted small mono">Đường dẫn: {perm.blockedPath}</div>}
      {denying ? (
        <div className="col gap">
          <textarea className="input" rows={2} placeholder="Lý do / hướng dẫn thêm cho Claude (tuỳ chọn)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <div className="row gap wrap">
            <button className="btn danger" disabled={busy} onClick={() => void send({ type: 'deny', message: reason })}>
              Gửi từ chối
            </button>
            <button className="btn ghost" onClick={() => setDenying(false)}>
              Quay lại
            </button>
          </div>
        </div>
      ) : (
        <div className="row gap wrap">
          <button className="btn primary" disabled={busy} onClick={() => void send({ type: 'allow' })}>
            Cho phép
          </button>
          {perm.canAlwaysAllow && (
            <button className="btn" disabled={busy} onClick={() => void send({ type: 'allow_always' })}>
              Cho phép luôn trong session
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => setDenying(true)}>
            Từ chối…
          </button>
          <Countdown perm={perm} now={ctx.now} />
        </div>
      )}
    </div>
  );
}

type Question = { question: string; header: string; multiSelect: boolean; options: Array<{ label: string; description: string; preview?: string }> };

function QuestionCard({ item, perm, ctx }: { item: ToolItem; perm: Permission | undefined; ctx: Ctx }) {
  const questions = ((item.input?.questions as Question[] | undefined) ?? []).filter(Boolean);
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pending = perm?.status === 'pending';

  const answers = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const q of questions) {
      const parts = [...(sel[q.question] ?? [])];
      if (other[q.question]?.trim()) parts.push(other[q.question]!.trim());
      if (parts.length) out[q.question] = parts.join(', ');
    }
    return out;
  };
  const complete = questions.every((q) => answers()[q.question]);
  const toggle = (q: Question, label: string) =>
    setSel((s0) => {
      const cur = s0[q.question] ?? [];
      if (q.multiSelect) return { ...s0, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      return { ...s0, [q.question]: [label] };
    });

  const resolvedAnswers = perm?.answer?.answers ?? (item.input?.answers as Record<string, string> | undefined);

  return (
    <div className={`card question ${pending ? 'pending' : ''}`} id={perm ? `perm-${perm.requestId}` : undefined}>
      <div className="question-title">❓ Claude hỏi bạn</div>
      {questions.map((q) => (
        <div key={q.question} className="q">
          <div className="q-head">
            <span className="chip">{q.header}</span> <b>{q.question}</b> {q.multiSelect && <span className="muted small">(chọn nhiều)</span>}
          </div>
          {pending ? (
            <>
              <div className="options">
                {q.options.map((o) => {
                  const on = (sel[q.question] ?? []).includes(o.label);
                  return (
                    <button key={o.label} className={`option ${on ? 'on' : ''}`} onClick={() => toggle(q, o.label)} aria-pressed={on}>
                      <span className="opt-label">
                        {q.multiSelect ? (on ? '☑ ' : '☐ ') : on ? '◉ ' : '○ '}
                        {o.label}
                      </span>
                      <span className="opt-desc">{o.description}</span>
                      {o.preview && on && <pre className="code small">{o.preview}</pre>}
                    </button>
                  );
                })}
              </div>
              <input className="input" placeholder="Khác… (nhập câu trả lời của bạn)" value={other[q.question] ?? ''} onChange={(e) => setOther((x) => ({ ...x, [q.question]: e.target.value }))} />
            </>
          ) : (
            <div className="q-answer">
              {resolvedAnswers?.[q.question] ? (
                <>→ {resolvedAnswers[q.question]}</>
              ) : perm?.by === 'timeout' ? (
                <span className="error">Hết hạn — không ai trả lời</span>
              ) : perm ? (
                <span className="muted">Không có câu trả lời ({perm.by === 'user' ? 'đã từ chối' : 'đã huỷ'})</span>
              ) : item.result ? (
                <span className="muted pre-wrap">{item.result.text}</span>
              ) : (
                <span className="muted">Đang chờ…</span>
              )}
            </div>
          )}
        </div>
      ))}
      {pending && perm && (
        <div className="row gap wrap">
          <button
            className="btn primary"
            disabled={!complete || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await ctx.onAnswer(perm.requestId, { type: 'answers', answers: answers() });
              } finally {
                setBusy(false);
              }
            }}
          >
            Gửi trả lời
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void ctx.onAnswer(perm.requestId, { type: 'deny', message: 'Người dùng bỏ qua câu hỏi.' })}>
            Bỏ qua
          </button>
          <Countdown perm={perm} now={ctx.now} />
        </div>
      )}
    </div>
  );
}

function PlanCard({ item, perm, ctx }: { item: ToolItem; perm: Permission | undefined; ctx: Ctx }) {
  const plan = s(item.input?.plan);
  const pending = perm?.status === 'pending';
  const [feedback, setFeedback] = useState('');
  const [rejecting, setRejecting] = useState(false);
  return (
    <div className={`card plan ${pending ? 'pending' : ''}`} id={perm ? `perm-${perm.requestId}` : undefined}>
      <div className="question-title">📋 Plan của Claude</div>
      {plan ? <Markdown text={plan} /> : <div className="muted">(Plan nằm trong tin nhắn phía trên)</div>}
      {pending && perm ? (
        rejecting ? (
          <div className="col gap">
            <textarea className="input" rows={3} autoFocus placeholder="Cần sửa gì trong plan?" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <div className="row gap">
              <button className="btn" onClick={() => void ctx.onAnswer(perm.requestId, { type: 'plan_reject', message: feedback })}>
                Gửi yêu cầu sửa
              </button>
              <button className="btn ghost" onClick={() => setRejecting(false)}>
                Quay lại
              </button>
            </div>
          </div>
        ) : (
          <div className="row gap wrap">
            <button className="btn primary" onClick={() => void ctx.onAnswer(perm.requestId, { type: 'plan_approve' })}>
              Duyệt plan
            </button>
            <button className="btn" onClick={() => setRejecting(true)}>
              Yêu cầu sửa…
            </button>
            <Countdown perm={perm} now={ctx.now} />
          </div>
        )
      ) : perm ? (
        <div className="muted small">{perm.decision === 'allow' ? 'Đã duyệt' : perm.by === 'timeout' ? 'Hết hạn — không ai duyệt' : 'Đã yêu cầu sửa / huỷ'}</div>
      ) : null}
    </div>
  );
}

/** A pending request whose tool card is not visible (fallback so it can always be answered). */
export function OrphanPermission({ perm, ctx }: { perm: Permission; ctx: Ctx }) {
  const fake: ToolItem = { kind: 'tool', key: `t:${perm.toolUseId}`, toolUseId: perm.toolUseId, name: perm.toolName, input: perm.input, parentToolUseId: null };
  if (perm.kind === 'question') return <QuestionCard item={fake} perm={perm} ctx={ctx} />;
  if (perm.kind === 'plan') return <PlanCard item={fake} perm={perm} ctx={ctx} />;
  return (
    <div className="tool ask">
      <div className="tool-head">
        <span className="tool-icon ask">?</span>
        <span className="tool-name">{TOOL_LABEL[perm.toolName] ?? perm.toolName}</span>
        <span className="tool-summary mono">{toolSummary(fake)}</span>
      </div>
      <PermissionBox perm={perm} ctx={ctx} />
    </div>
  );
}
