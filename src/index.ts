#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HeadlessBridge } from "./bridge/headless.js";
import { LiveBridge } from "./bridge/live.js";
import { Router } from "./bridge/router.js";
import { SERVER_VERSION, createServer } from "./server.js";

// stdout is the MCP channel: all diagnostics go to stderr.
const log = (msg: string) => process.stderr.write(`[aseprite-mcp] ${msg}\n`);

async function main() {
  const cfg = loadConfig();
  log(`aseprite: ${cfg.asepritePath ?? "(not found)"} · workdir: ${cfg.workdir} · run_lua: ${cfg.allowLua ? "on" : "off"}`);

  const live = new LiveBridge(cfg.port, cfg.liveTimeoutMs, log, cfg.allowLua, SERVER_VERSION);
  await live.start();
  const headless = new HeadlessBridge(cfg.asepritePath, cfg.luaDir, cfg.headlessTimeoutMs, cfg.allowLua);
  const router = new Router(live, headless);

  const server = createServer(cfg, router);
  await server.connect(new StdioServerTransport());
  log("ready");

  const shutdown = async () => {
    await live.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

main().catch((e) => {
  log(`fatal: ${e?.stack ?? e}`);
  process.exit(1);
});
