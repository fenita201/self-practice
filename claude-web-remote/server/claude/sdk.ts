/**
 * Thin seam over @anthropic-ai/claude-agent-sdk so the runner/manager can be
 * tested with a fake. Only the members this app uses are declared here; the
 * real types come from the installed SDK (see docs/architecture.md for the
 * version this was written against).
 */
import type {
  CanUseTool,
  ModelInfo,
  Options,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';

export type { CanUseTool, ModelInfo, Options, PermissionMode, PermissionResult, PermissionUpdate, SDKMessage, SDKSessionInfo, SDKUserMessage, SessionMessage };

export interface QueryLike extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: Record<string, unknown>): Promise<void>;
  initializationResult(): Promise<{ models?: ModelInfo[]; account?: Record<string, unknown> }>;
  close(): void;
}

export interface ClaudeSdk {
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): QueryLike;
  listSessions(opts: { dir: string; includeWorktrees?: boolean }): Promise<SDKSessionInfo[]>;
  getSessionInfo(sessionId: string, opts: { dir: string }): Promise<SDKSessionInfo | undefined>;
  getSessionMessages(sessionId: string, opts: { dir: string; includeSystemMessages?: boolean }): Promise<SessionMessage[]>;
  renameSession(sessionId: string, title: string, opts: { dir: string }): Promise<void>;
}

export async function loadRealSdk(): Promise<ClaudeSdk> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return {
    query: (p) => sdk.query(p) as unknown as QueryLike,
    listSessions: (o) => sdk.listSessions(o),
    getSessionInfo: (id, o) => sdk.getSessionInfo(id, o),
    getSessionMessages: (id, o) => sdk.getSessionMessages(id, o),
    renameSession: (id, t, o) => sdk.renameSession(id, t, o),
  };
}
