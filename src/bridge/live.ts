import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { BridgeError, type HelloInfo, type LuaResult } from "./types.js";

/**
 * Browsers always send an http(s):// (or "null") Origin that pages cannot
 * forge, so anything else is a native client. Aseprite's ixwebsocket client
 * sends "ws://127.0.0.1:<port>"; other native clients send none.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return /^wss?:\/\//i.test(origin.trim());
}

interface Pending {
  resolve: (r: LuaResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * WebSocket server the Aseprite "Claude Bridge" extension connects to.
 * Binds to 127.0.0.1 only and refuses browser connections (http/https/null Origin).
 */
export class LiveBridge extends EventEmitter {
  private wss?: WebSocketServer;
  private client?: WebSocket;
  private hello?: HelloInfo;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private heartbeat?: NodeJS.Timeout;
  private alive = false;
  listenError?: string;
  listening = false;

  constructor(
    private readonly port: number,
    private readonly timeoutMs: number,
    private readonly log: (msg: string) => void = () => {},
    private readonly allowLua = false,
    private readonly serverVersion = "1.0.0",
  ) {
    super();
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({
        host: "127.0.0.1",
        port: this.port,
        maxPayload: 64 * 1024 * 1024,
        verifyClient: (info: { req: IncomingMessage; origin?: string }) => {
          const ok = isAllowedOrigin(info.origin ?? info.req.headers.origin);
          if (!ok) this.log(`rejected connection from origin ${info.origin} (browsers may not drive Aseprite)`);
          return ok;
        },
      });
      wss.once("listening", () => {
        this.listening = true;
        this.log(`live bridge listening on ws://127.0.0.1:${this.port}`);
        resolve();
      });
      wss.on("error", (err: NodeJS.ErrnoException) => {
        this.listenError =
          err.code === "EADDRINUSE"
            ? `Port ${this.port} is already in use (another Claude session probably owns the Aseprite bridge). Using headless mode.`
            : `Live bridge error: ${err.message}`;
        this.log(this.listenError);
        resolve();
      });
      wss.on("connection", (ws) => this.onConnection(ws));
      this.wss = wss;
      this.heartbeat = setInterval(() => this.ping(), 15_000);
      this.heartbeat.unref();
    });
  }

  get connected(): boolean {
    return !!this.client && this.client.readyState === WebSocket.OPEN && !!this.hello;
  }

  get info(): HelloInfo | undefined {
    return this.hello;
  }

  private onConnection(ws: WebSocket) {
    if (this.client && this.client !== ws) {
      this.log("new Aseprite connection replaces the previous one");
      this.client.close(1000, "replaced");
      this.failAll(new BridgeError("disconnected", "Aseprite reconnected; the request was interrupted."));
    }
    this.client = ws;
    this.hello = undefined;
    this.alive = true;
    ws.on("pong", () => (this.alive = true));
    ws.on("message", (data) => this.onMessage(ws, data.toString()));
    ws.on("close", () => {
      if (this.client === ws) {
        this.client = undefined;
        this.hello = undefined;
        this.failAll(new BridgeError("disconnected", "Aseprite disconnected before replying."));
        this.log("Aseprite disconnected");
        this.emit("disconnected");
      }
    });
    ws.on("error", (e) => this.log(`socket error: ${e.message}`));
  }

  private onMessage(ws: WebSocket, text: string) {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      this.log(`ignoring non-JSON message: ${text.slice(0, 120)}`);
      return;
    }
    if (msg && msg.type === "hello") {
      this.hello = { bridge_version: msg.bridge_version, aseprite_version: msg.aseprite_version, api_version: msg.api_version };
      this.log(`Aseprite ${msg.aseprite_version ?? "?"} connected (bridge ${msg.bridge_version ?? "?"})`);
      ws.send(JSON.stringify({ type: "welcome", allow_lua: this.allowLua, server_version: this.serverVersion }));
      this.emit("connected", this.hello);
      return;
    }
    const id = typeof msg?.id === "number" ? msg.id : undefined;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (msg.ok) p.resolve({ ok: true, result: msg.result });
    else p.resolve({ ok: false, error: msg.error ?? { code: "unknown", message: "Unknown error from Aseprite" } });
  }

  private ping() {
    const ws = this.client;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!this.alive && this.pending.size === 0) {
      this.log("Aseprite stopped answering pings; dropping connection");
      ws.terminate();
      return;
    }
    this.alive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }

  private failAll(err: Error) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  request(cmd: string, params: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<LuaResult> {
    const ws = this.client;
    if (!ws || !this.connected) {
      return Promise.reject(new BridgeError("not_connected", "Aseprite is not connected."));
    }
    const id = this.nextId++;
    return new Promise<LuaResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeError(
            "timeout",
            `Aseprite did not answer '${cmd}' within ${Math.round(timeoutMs / 1000)}s. A modal dialog (e.g. the script security prompt) may be waiting in Aseprite.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, cmd, params }), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new BridgeError("send_failed", err.message));
        }
      });
    });
  }

  async stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.failAll(new BridgeError("shutdown", "Server shutting down"));
    this.client?.close();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
  }
}
