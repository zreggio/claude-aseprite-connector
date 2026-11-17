// Builds a sample 32x32 health-potion icon through the connector (live if
// Aseprite is connected, otherwise headless), using the same tool calls Claude makes.
// Usage: node tests/live/sample-potion.mjs [outdir]
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "..");
const out = process.argv[2] ?? path.join(root, "assets");
fs.mkdirSync(out, { recursive: true });

const t = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
  env: { ...process.env, ASEPRITE_MCP_WORKDIR: out },
  stderr: "inherit",
});
const c = new Client({ name: "sample-potion", version: "1" });
await c.connect(t);
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${text}`);
  return r;
};

for (let i = 0; i < 20; i++) {
  const s = JSON.parse((await call("status")).content[0].text);
  if (s.mode === "live") break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log("mode:", JSON.parse((await call("status")).content[0].text).mode);

// Sweetie-16-style palette with hue-shifted ramps.
const P = {
  ink: "#1a1c2c", plum: "#5d275d", red: "#b13e53", orange: "#ef7d57", cream: "#ffcd75",
  glassDark: "#566c86", glass: "#94b0c2", white: "#f4f4f4", slate: "#333c57",
};

await call("new_sprite", { width: 32, height: 32, path: "health-potion.aseprite", layer_name: "Glass", palette: Object.values(P) });

// Glass flask: body, neck, rim; shade the side away from the top-left light, then outline.
await call("batch", { ops: [
  { tool: "draw_ellipse", args: { x: 8, y: 12, width: 16, height: 16, fill_color: P.glass } },
  { tool: "draw_rect", args: { x: 13, y: 9, width: 6, height: 5, fill_color: P.glass } },
  { tool: "draw_rect", args: { x: 12, y: 8, width: 8, height: 2, fill_color: P.white } },
  { tool: "draw_gradient", args: { x: 8, y: 8, width: 16, height: 20, colors: [P.glass, P.glass, P.glassDark], direction: "diagonal_down", dither: "none", only_opaque: true } },
  { tool: "outline", args: { color: P.ink } },
] });

// Liquid: inset 1px from the glass, filled up to a surface line, shaded with a dithered ramp.
await call("add_layer", { name: "Liquid" });
await call("batch", { ops: [
  { tool: "draw_ellipse", args: { x: 9, y: 13, width: 14, height: 14, fill_color: P.red } },
  { tool: "erase", args: { region: { x: 0, y: 0, width: 32, height: 17 } } },
  { tool: "draw_gradient", args: { x: 9, y: 17, width: 14, height: 10, colors: [P.red, P.red, P.plum], direction: "diagonal_down", dither: "none", only_opaque: true } },
  { tool: "draw_line", args: { x1: 10, y1: 17, x2: 21, y2: 17, color: P.orange } },
] });

// Cork with its own light/shadow and outline.
await call("add_layer", { name: "Cork" });
await call("batch", { ops: [
  { tool: "draw_pixel_map", args: { x: 13, y: 4, legend: { c: P.cream, o: P.orange, r: P.red }, rows: [
    "cccco.",
    "coooor",
    "ooooor",
    "ooooor",
  ] } },
  { tool: "outline", args: { color: P.ink } },
] });

// Highlights: glass glint (top-left), liquid sparkle, bubbles.
await call("add_layer", { name: "Highlights" });
await call("draw_pixel_map", { x: 10, y: 14, legend: { w: P.white, c: P.cream, o: P.orange }, rows: [
  "..w.........",
  ".w..........",
  "w...........",
  "w..c........",
  "...o........",
  "............",
  ".........o..",
  "........oc..",
  "............",
] });

const preview = await c.callTool({ name: "render_preview", arguments: { scale: 12, background: "#2a2f45" } });
const img = preview.content.find((x) => x.type === "image");
fs.writeFileSync(path.join(out, "health-potion-preview.png"), Buffer.from(img.data, "base64"));
const analysis = JSON.parse((await call("analyze")).content[0].text);
console.log("colors:", analysis.color_count, "isolated:", analysis.isolated_pixels.count, "off-palette:", analysis.colors_not_in_palette);
await call("save_sprite", {});
await call("export_image", { path: "health-potion.png" });
await call("export_image", { path: "health-potion@8x.png", scale: 8 });
console.log("done:", out);
await c.close();
