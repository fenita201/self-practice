import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Runtime, RpcEvent, RpcMethod } from "../src/server/adapter.js";
import { RpcError } from "../src/server/adapter.js";
export class Fixture implements Runtime {
  ready = true;
  error: string | null = null;
  version = "fixture-0.161.0";
  pending = new Map<string, RpcEvent>();
  events = new EventEmitter();
  threads: any[] = [];
  histories = new Map<string, any[]>();
  calls: { method: string; params: any }[] = [];
  timers: NodeJS.Timeout[] = [];
  constructor(public root: string) {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 46; i++) {
      const cwd =
        i % 3 === 0
          ? path.dirname(root)
          : i % 2
            ? path.join(root, "beta")
            : path.join(root, "alpha");
      this.threads.push({
        id: "external-" + i,
        cwd,
        name: `CLI fixture ${i}`,
        preview: "Fixture persisted history",
        source: i % 2 ? "cli" : "appServer",
        updatedAt: now - i,
        createdAt: now - i,
        status: { type: "notLoaded" },
        model: "fixture-model",
        reasoningEffort: "low",
        turns: [],
      });
      this.histories.set("external-" + i, [
        {
          id: "history-" + i,
          items: [
            {
              id: "old-" + i,
              type: "agentMessage",
              text: "Lịch sử CLI fixture · chỉ đọc",
            },
          ],
          status: "completed",
          itemsView: "full",
        },
      ]);
    }
  }
  async start() {
    this.ready = true;
    this.events.emit("status");
  }
  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.ready = false;
    this.events.emit("status");
  }
  emit(method: string, params: any, id?: string | number) {
    const e = { method, params, ...(id !== undefined ? { id } : {}) };
    if (id !== undefined) this.pending.set(String(id), e);
    this.events.emit("event", e);
  }
  async call(method: RpcMethod, p: any = {}): Promise<any> {
    this.calls.push({ method, params: p });
    if (!this.ready) throw new Error("Fixture disconnected");
    switch (method) {
      case "account/read":
        return {
          account: { type: "chatgpt", planType: "fixture" },
          requiresOpenaiAuth: true,
        };
      case "account/rateLimits/read":
        return {
          rateLimits: {
            primary: {
              usedPercent: 20,
              windowDurationMins: 300,
              resetsAt: Math.floor(Date.now() / 1000) + 3600,
            },
            secondary: null,
          },
        };
      case "account/usage/read":
        return { usage: null };
      case "model/list":
        return {
          data: [
            {
              id: "fixture",
              model: "fixture-model",
              displayName: "Fixture model",
              defaultReasoningEffort: "low",
              isDefault: true,
              supportedReasoningEfforts: [
                { reasoningEffort: "low" },
                { reasoningEffort: "high" },
              ],
            },
          ],
        };
      case "thread/list": {
        const list = this.threads.filter(
          (t) =>
            this.histories.has(t.id) &&
            (!p.cwd || t.cwd === p.cwd) &&
            Boolean(p.archived) === Boolean(t.archived),
        );
        const offset = Number(p.cursor || 0),
          size = p.limit || 20;
        return {
          data: list.slice(offset, offset + size),
          nextCursor:
            offset + size < list.length ? String(offset + size) : null,
        };
      }
      case "thread/read": {
        const t = this.threads.find((t) => t.id === p.threadId);
        if (!t) throw new Error("Not found");
        return {
          thread: {
            ...t,
            turns: p.includeTurns ? this.histories.get(t.id) || [] : [],
          },
        };
      }
      case "thread/turns/list": {
        if (!this.histories.has(p.threadId))
          throw new RpcError(
            -32600,
            `thread ${p.threadId} is not materialized yet; thread/turns/list is unavailable before first user message`,
          );
        const h = [...(this.histories.get(p.threadId) || [])].reverse();
        const offset = Number(p.cursor || 0);
        return {
          data: h.slice(offset, offset + (p.limit || 10)),
          nextCursor: offset + 10 < h.length ? String(offset + 10) : null,
        };
      }
      case "thread/items/list":
        return {
          data: (this.histories.get(p.threadId) || []).flatMap((t) =>
            t.items.map((item: any) => ({ item, turnId: t.id })),
          ),
          nextCursor: null,
        };
      case "thread/start": {
        const t = {
          id: randomUUID(),
          cwd: p.cwd,
          name: null,
          preview: "Web fixture session",
          source: "appServer",
          status: { type: "idle" },
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
          model: "fixture-model",
          turns: [],
        };
        this.threads.unshift(t);
        return {
          thread: t,
          approvalPolicy: "on-request",
          sandbox: { type: "workspaceWrite" },
          model: "fixture-model",
          reasoningEffort: "low",
        };
      }
      case "thread/resume":
        return { thread: this.threads.find((t) => t.id === p.threadId) };
      case "turn/start": {
        const turn = {
          id: randomUUID(),
          status: "inProgress",
          items: [] as any[],
        };
        this.histories.set(p.threadId, [
          ...(this.histories.get(p.threadId) || []),
          turn,
        ]);
        this.emit("turn/started", { threadId: p.threadId, turn });
        const user = {
          id: randomUUID(),
          type: "userMessage",
          content: p.input,
        };
        turn.items.push(user);
        this.emit("item/completed", {
          threadId: p.threadId,
          turnId: turn.id,
          item: user,
        });
        const agent = {
          id: randomUUID(),
          type: "agentMessage",
          text: "",
          phase: "commentary",
        };
        turn.items.push(agent);
        this.emit("item/started", {
          threadId: p.threadId,
          turnId: turn.id,
          item: agent,
        });
        const tick = setTimeout(() => {
          agent.text = "Streaming fixture output";
          this.emit("item/agentMessage/delta", {
            threadId: p.threadId,
            turnId: turn.id,
            itemId: agent.id,
            delta: agent.text,
          });
          const request = {
            threadId: p.threadId,
            turnId: turn.id,
            itemId: agent.id,
            command: "echo fixture",
            reason: "Fixture approval",
          };
          this.emit(
            "item/commandExecution/requestApproval",
            request,
            "approval-" + turn.id,
          );
        }, 250);
        this.timers.push(tick);
        return { turn };
      }
      case "turn/interrupt": {
        const turn = (this.histories.get(p.threadId) || []).find(
          (t) => t.id === p.turnId,
        );
        turn.status = "interrupted";
        this.emit("turn/completed", { threadId: p.threadId, turn });
        return {};
      }
      case "turn/steer": {
        const turn = (this.histories.get(p.threadId) || []).find(
          (t) => t.id === p.expectedTurnId,
        );
        if (!turn || turn.status !== "inProgress")
          throw new RpcError(-32600, "No matching active turn");
        const user = {
          id: randomUUID(),
          type: "userMessage",
          content: p.input,
        };
        turn.items.push(user);
        this.emit("item/completed", {
          threadId: p.threadId,
          turnId: turn.id,
          item: user,
        });
        return { turnId: p.expectedTurnId };
      }
      case "thread/name/set":
        this.threads.find((t) => t.id === p.threadId).name = p.name;
        return {};
      case "thread/archive":
        this.threads.find((t) => t.id === p.threadId).archived = true;
        return {};
      default:
        throw new Error("Unsupported fixture method " + method);
    }
  }
  respond(id: string | number, result: any) {
    const request = this.pending.get(String(id));
    if (!request) throw new Error("No request");
    this.pending.delete(String(id));
    const { threadId, turnId } = request.params;
    const turn = (this.histories.get(threadId) || []).find(
      (t) => t.id === turnId,
    );
    if (
      request.method === "item/commandExecution/requestApproval" &&
      result.decision === "accept"
    ) {
      this.emit(
        "item/tool/requestUserInput",
        {
          threadId,
          turnId,
          questions: [
            {
              id: "color",
              header: "Màu",
              question: "Chọn màu?",
              options: [{ label: "Xanh", description: "Fixture option" }],
              isOther: true,
            },
          ],
        },
        "input-" + turnId,
      );
      return;
    }
    const text = result.answers
      ? "Đã nhận câu trả lời fixture"
      : "Approval bị từ chối";
    const item = {
      id: randomUUID(),
      type: "agentMessage",
      text,
      phase: "final_answer",
    };
    turn.items.push(item);
    this.emit("item/completed", { threadId, turnId, item });
    turn.status = "completed";
    this.emit("thread/tokenUsage/updated", {
      threadId,
      turnId,
      tokenUsage: {
        total: {
          inputTokens: 20,
          cachedInputTokens: 5,
          outputTokens: 10,
          totalTokens: 30,
        },
        last: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        modelContextWindow: null,
      },
    });
    this.emit("turn/completed", { threadId, turn });
  }
}
