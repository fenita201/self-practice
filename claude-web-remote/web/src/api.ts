// Thin fetch wrapper: same-origin relative URLs only, CSRF header on mutations.

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => {
  csrfToken = t;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthListeners = new Set<Listener>();
export const onUnauthenticated = (l: Listener) => {
  unauthListeners.add(l);
  return () => unauthListeners.delete(l);
};

export async function api<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) h['x-csrf-token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Mất kết nối tới server', 'network');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string } & Record<string, unknown>;
    if (res.status === 401 && d.code === 'unauthenticated') unauthListeners.forEach((l) => l());
    throw new ApiError(res.status, d.error ?? `HTTP ${res.status}`, d.code, d);
  }
  return data as T;
}

export const enc = encodeURIComponent;

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts (plain http over ZeroTier IP): crypto.randomUUID needs HTTPS.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- shared types (mirror server responses) ------------------------------------------

export type ProjectInfo = { name: string; mtime: number; git: boolean };

export type SessionState = 'starting' | 'running' | 'waiting_input' | 'idle' | 'ended' | 'interrupted' | 'external';

export type SessionSummary = {
  sessionId: string;
  title: string;
  firstPrompt: string | null;
  lastModified: number;
  createdAt: number | null;
  gitBranch: string | null;
  managed: boolean;
  state: SessionState;
  endedReason: string | null;
  deadlineAt: number | null;
  pendingCount: number;
};

export type ModelOption = { value: string; displayName: string; description: string; effortLevels: string[] };

export type Meta = {
  appName: string;
  serverLabel: string;
  workspaceRoot: string;
  capabilities: {
    ok: boolean;
    error?: string;
    models: ModelOption[];
    auth: { method: string; subscriptionType?: string; email?: string; organization?: string };
  };
  limits: {
    idleTimeoutMin: number;
    inputTimeoutMin: number;
    maxActiveSessions: number;
    defaultPermissionMode: string;
    maxViewBytes: number;
    maxSaveBytes: number;
  };
  activeSessions: number;
};

export type TreeEntry = { name: string; path: string; type: 'file' | 'dir'; size: number; mtime: number; symlink: boolean; hiddenByDefault: boolean };

export type FileContent = {
  path: string;
  size: number;
  mtime: number;
  etag: string;
  binary: boolean;
  tooLarge: boolean;
  editable: boolean;
  eol: 'lf' | 'crlf';
  content: string | null;
};
