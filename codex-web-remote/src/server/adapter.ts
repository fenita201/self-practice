import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type { Config } from "./config.js";
import type { ClientRequest } from "../shared/protocol/ClientRequest.js";
export type RpcMethod = ClientRequest["method"];
export class RpcError extends Error {
  constructor(
    public code: number,
    public rpcMessage: string,
  ) {
    super(`RPC ${code}: ${rpcMessage}`);
  }
}
export type Params<M extends RpcMethod> =
  Extract<ClientRequest, { method: M }> extends { params: infer P }
    ? P
    : Record<string, never>;
export type RpcEvent = {
  method: string;
  params: Record<string, any>;
  id?: string | number;
};
export interface Runtime {
  ready: boolean;
  error: string | null;
  version: string;
  pending: Map<string, RpcEvent>;
  events: EventEmitter;
  start(): Promise<void>;
  call<M extends RpcMethod>(method: M, params?: Params<M>): Promise<any>;
  respond(id: string | number, result: unknown): void;
  stop(): void;
}
export class Adapter implements Runtime {
  ready = false;
  error: string | null = null;
  version = "unknown";
  pending = new Map<string, RpcEvent>();
  events = new EventEmitter();
  child?: ChildProcessWithoutNullStreams;
  next = 1;
  requests = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(public cfg: Config) {}
  async start() {
    try {
      this.child = spawn(this.cfg.bin, ["app-server", "--listen", "stdio://"], {
        env: {
          ...process.env,
          ...(this.cfg.codexHome ? { CODEX_HOME: this.cfg.codexHome } : {}),
        },
        stdio: "pipe",
      });
      this.child.on("error", (e) => this.disconnected(e.message));
      this.child.on("exit", () => this.disconnected("Codex process đã dừng"));
      this.child.stderr.on("data", () => {
        /* Do not log credentials or personal diagnostic payloads. */
      });
      const reader = createInterface({ input: this.child.stdout });
      reader.on("line", (line) => {
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.disconnected("Invalid app-server JSON");
        }
      });
      const r = await this.call("initialize", {
        clientInfo: {
          name: "codex_remote_web",
          title: "Codex Remote",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      this.version = r.userAgent || "0.161.0";
      this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
      this.ready = true;
      this.error = null;
      this.events.emit("status");
    } catch (e) {
      this.disconnected((e as Error).message);
      this.child?.kill();
    }
  }
  receive(message: any) {
    if (message.id !== undefined && !message.method) {
      const req = this.requests.get(message.id);
      if (!req) return;
      clearTimeout(req.timer);
      this.requests.delete(message.id);
      if (message.error)
        req.reject(new RpcError(message.error.code, message.error.message));
      else req.resolve(message.result);
      return;
    }
    if (message.method) {
      if (message.id !== undefined)
        this.pending.set(String(message.id), message);
      this.events.emit("event", message);
    }
  }
  disconnected(reason: string) {
    this.ready = false;
    this.error = reason;
    for (const r of this.requests.values()) {
      clearTimeout(r.timer);
      r.reject(new Error(reason));
    }
    this.requests.clear();
    this.pending.clear();
    this.events.emit("status");
  }
  call<M extends RpcMethod>(method: M, params?: Params<M>): Promise<any> {
    if (!this.child?.stdin.writable)
      return Promise.reject(new Error("Codex chưa sẵn sàng"));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(
          new Error(
            `${method}: timeout; kết quả chưa xác minh, không tự gửi lại`,
          ),
        );
      }, 30000);
      this.requests.set(id, { resolve, reject, timer });
      this.child!.stdin.write(
        JSON.stringify({ id, method, params: params ?? {} }) + "\n",
      );
    });
  }
  respond(id: string | number, result: unknown) {
    if (!this.pending.has(String(id)))
      throw new Error("Request không còn hiệu lực");
    this.child?.stdin.write(JSON.stringify({ id, result }) + "\n");
    this.pending.delete(String(id));
  }
  stop() {
    this.child?.kill("SIGTERM");
    this.disconnected("Service đã dừng");
  }
}
