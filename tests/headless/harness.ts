import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { findAseprite } from "../../src/config.js";

export const hasAseprite = !!findAseprite(process.env.ASEPRITE_PATH);
export const ROOT = path.resolve(__dirname, "..", "..");

export interface Harness {
  client: Client;
  workdir: string;
  call: (name: string, args?: Record<string, unknown>) => Promise<any>;
  callRaw: (name: string, args?: Record<string, unknown>) => Promise<any>;
  text: (name: string, args?: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}

/** Start the built MCP server (dist/index.js) with its own working folder. */
export async function startServer(name: string, extraEnv: Record<string, string> = {}): Promise<Harness> {
  const workdir = path.join(ROOT, "tests", ".tmp", name);
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "dist", "index.js")],
    env: {
      ...(process.env as Record<string, string>),
      ASEPRITE_MCP_WORKDIR: workdir,
      ...extraEnv,
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);

  const callRaw = (n: string, args: Record<string, unknown> = {}) => client.callTool({ name: n, arguments: args });
  const text = async (n: string, args: Record<string, unknown> = {}) => {
    const r: any = await callRaw(n, args);
    const t = r.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    if (r.isError) throw new Error(t);
    return t;
  };
  const call = async (n: string, args: Record<string, unknown> = {}) => JSON.parse((await text(n, args)).split("\n")[0]);
  return { client, workdir, call, callRaw, text, close: () => client.close() };
}

/** Parse read_pixels text output back into rows + legend. */
export function parseGrid(t: string) {
  const lines = t.split("\n");
  const legend: Record<string, string> = {};
  for (const pair of lines[1].replace(/^legend: /, "").split(" ")) {
    const [k, v] = pair.split("=");
    if (v) legend[k] = v;
  }
  return { legend, rows: lines.slice(3) };
}

/** Map a grid to a color-per-pixel matrix for easy assertions. */
export function colorsOf(t: string): string[][] {
  const { legend, rows } = parseGrid(t);
  return rows.map((r) => [...r].map((ch) => (ch === "." ? "." : legend[ch])));
}
