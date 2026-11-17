// Live end-to-end check: start the MCP server (port 47823), wait for the
// Aseprite extension to connect, then drive a real editing session.
// Usage: node tests/live/live-e2e.mjs [workdir]   (then launch Aseprite)
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "..");
const workdir = process.argv[2] ?? path.join(root, "tests", ".tmp", "live");
fs.mkdirSync(workdir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const t = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
  env: { ...process.env, ASEPRITE_MCP_WORKDIR: workdir },
  stderr: "inherit",
});
const c = new Client({ name: "live-e2e", version: "1" });
await c.connect(t);
const raw = (name, args = {}) => c.callTool({ name, arguments: args });
const call = async (name, args = {}) => {
  const r = await raw(name, args);
  const text = r.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${text}`);
  try { return JSON.parse(text.split("\n")[0]); } catch { return text; }
};

log("waiting for Aseprite to connect (launch Aseprite now)...");
let st;
for (let i = 0; i < 180; i++) {
  st = await call("status");
  if (st.mode === "live") break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (st.mode !== "live") { log("FAIL: Aseprite never connected", JSON.stringify(st.live)); process.exit(1); }
log("connected:", JSON.stringify(st.live.aseprite));

const results = [];
const check = (name, cond, extra = "") => { results.push([name, !!cond]); log(cond ? "PASS" : "FAIL", name, extra); };

const ns = await call("new_sprite", { width: 16, height: 16, palette_preset: "DB16" });
check("new_sprite live", ns.width === 16);
await call("add_layer", { name: "Base" });
await call("draw_pixel_map", { x: 4, y: 4, rows: ["..rr..", ".rrrr.", "rrrrrr", "rrrrrr", ".rrrr.", "..rr.."], legend: { r: "#d04648" } });
const before = await call("read_pixels", {});
await call("outline", { color: "#140c1c" });
const withOutline = await call("read_pixels", {});
check("outline changed pixels", before !== withOutline);
await call("undo", {});
const afterUndo = await call("read_pixels", {});
check("one undo reverts exactly one tool call", afterUndo === before);
await call("redo", {});
check("redo restores", (await call("read_pixels", {})) === withOutline);

const b = await call("batch", { ops: [
  { tool: "draw_pixels", args: { pixels: [{ x: 6, y: 5, color: "#deeed6" }] } },
  { tool: "draw_pixels", args: { pixels: [{ x: 7, y: 5, color: "#deeed6" }] } },
] });
check("batch", b.count === 2);
await call("undo", {});
check("batch is one undo step", (await call("read_pixels", {})) === withOutline);

const pv = await raw("render_preview", { grid: 8 });
check("render_preview returns image", pv.content.some((x) => x.type === "image"));
const saved = await call("save_sprite", { path: "live-test.aseprite" });
check("save_sprite", fs.existsSync(path.join(workdir, "live-test.aseprite")), saved.saved);
const ex = await call("export_image", { path: "live-test.png", scale: 4 });
check("export_image", fs.existsSync(path.join(workdir, "live-test.png")) && ex.width === 64);
const final = await call("status");
check("status sees the sprite", final.aseprite.sprites.length >= 1);

const failed = results.filter(([, ok]) => !ok);
log(`${results.length - failed.length}/${results.length} live checks passed`);
await c.close();
process.exit(failed.length ? 1 : 0);
