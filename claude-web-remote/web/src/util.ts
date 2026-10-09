export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'vừa xong';
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} ngày trước`;
  return new Date(ms).toLocaleDateString('vi-VN');
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

/** Copy that also works on plain-http origins (navigator.clipboard needs a secure context). */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export const stateLabel: Record<string, string> = {
  starting: 'Đang khởi động',
  running: 'Đang chạy',
  waiting_input: 'Chờ bạn trả lời',
  idle: 'Đang chờ prompt',
  ended: 'Đã kết thúc',
  interrupted: 'Bị ngắt',
  external: 'Từ CLI/khác',
};

export const endReasonLabel: Record<string, string> = {
  user_end: 'bạn đã bấm Kết thúc',
  idle_timeout: 'không hoạt động quá thời gian chờ',
  input_timeout: 'không ai trả lời câu hỏi/approval kịp thời',
  server_shutdown: 'server dừng/khởi động lại',
  server_restart: 'server khởi động lại khi đang chạy',
  server_restart_idle: 'server khởi động lại',
  process_exit: 'process Claude dừng bất ngờ',
  start_failed: 'không khởi động được Claude',
  evicted: 'nhường chỗ cho session khác (MAX_ACTIVE_SESSIONS)',
};

// ---- minimal line diff (LCS), enough for conflict review --------------------------------

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

export function lineDiff(a: string, b: string, maxLines = 4000): DiffLine[] | null {
  const A = a.split('\n');
  const B = b.split('\n');
  if (A.length > maxLines || B.length > maxLines) return null;
  // Trim common prefix/suffix to keep the table small.
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const a2 = A.slice(start, endA);
  const b2 = B.slice(start, endB);
  const n = a2.length;
  const m = b2.length;
  if (n * m > 4_000_000) return null;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a2[i] === b2[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffLine[] = A.slice(0, start).map((text) => ({ type: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a2[i] === b2[j]) {
      out.push({ type: 'same', text: a2[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ type: 'del', text: a2[i++]! });
    else out.push({ type: 'add', text: b2[j++]! });
  }
  while (i < n) out.push({ type: 'del', text: a2[i++]! });
  while (j < m) out.push({ type: 'add', text: b2[j++]! });
  for (const text of A.slice(endA)) out.push({ type: 'same', text });
  return out;
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage */
  }
}

export function navigate(path: string): void {
  location.hash = path;
}
