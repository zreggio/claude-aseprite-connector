import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { LiveBridge, isAllowedOrigin } from "../../src/bridge/live.js";

const PORT = 47900 + Math.floor(Math.random() * 50);
let bridge: LiveBridge | undefined;

afterEach(async () => {
  await bridge?.stop();
  bridge = undefined;
});

function fakeAseprite(port: number, handler: (msg: any) => any): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", bridge_version: "test", aseprite_version: "1.3.18" }));
      resolve(ws);
    });
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.type) return; // control messages (welcome)
      ws.send(JSON.stringify({ id: msg.id, ...handler(msg) }));
    });
    ws.on("error", reject);
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("live bridge", () => {
  it("round-trips requests by id after the hello handshake", async () => {
    bridge = new LiveBridge(PORT, 2000);
    await bridge.start();
    expect(bridge.connected).toBe(false);
    const ws = await fakeAseprite(PORT, (m) => ({ ok: true, result: { echo: m.cmd, n: m.params.n } }));
    await until(() => bridge!.connected);
    expect(bridge.info?.aseprite_version).toBe("1.3.18");
    const [a, b] = await Promise.all([bridge.request("one", { n: 1 }), bridge.request("two", { n: 2 })]);
    expect(a).toEqual({ ok: true, result: { echo: "one", n: 1 } });
    expect(b).toEqual({ ok: true, result: { echo: "two", n: 2 } });
    ws.close();
  });

  it("passes structured errors through", async () => {
    bridge = new LiveBridge(PORT + 1, 2000);
    await bridge.start();
    const ws = await fakeAseprite(PORT + 1, () => ({ ok: false, error: { code: "no_sprite", message: "nope" } }));
    await until(() => bridge!.connected);
    expect(await bridge.request("x", {})).toEqual({ ok: false, error: { code: "no_sprite", message: "nope" } });
    ws.close();
  });

  it("rejects browser connections (Origin header)", async () => {
    bridge = new LiveBridge(PORT + 2, 2000);
    await bridge.start();
    const result = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT + 2}`, { headers: { Origin: "https://evil.example" } });
      ws.on("open", () => resolve("open"));
      ws.on("error", () => resolve("rejected"));
    });
    expect(result).toBe("rejected");
  });

  it("accepts Aseprite's ws:// origin and native clients without one", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("ws://127.0.0.1:47823")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
  });

  it("accepts a client that sends Aseprite's ws:// Origin", async () => {
    bridge = new LiveBridge(PORT + 5, 2000);
    await bridge.start();
    const result = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT + 5}`, { headers: { Origin: `ws://127.0.0.1:${PORT + 5}` } });
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("error", () => resolve("rejected"));
    });
    expect(result).toBe("open");
  });

  it("reports a busy port instead of crashing", async () => {
    bridge = new LiveBridge(PORT + 3, 2000);
    await bridge.start();
    const second = new LiveBridge(PORT + 3, 2000);
    await second.start();
    expect(second.listening).toBe(false);
    expect(second.listenError).toMatch(/already in use/);
    await second.stop();
  });

  it("times out when Aseprite never answers", async () => {
    bridge = new LiveBridge(PORT + 4, 200);
    await bridge.start();
    const ws = new WebSocket(`ws://127.0.0.1:${PORT + 4}`);
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "hello" }));
    await until(() => bridge!.connected);
    await expect(bridge.request("slow", {})).rejects.toThrow(/did not answer/);
    ws.close();
  });
});
