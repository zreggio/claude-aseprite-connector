import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { colorsOf, hasAseprite, startServer, type Harness } from "./harness.js";

const R = "#ff0000";
const G = "#00ff00";
const B = "#0000ff";
const K = "#000000";

describe.skipIf(!hasAseprite)("headless tools (real Aseprite)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startServer("tools");
  });
  afterAll(async () => h?.close());

  const pixels = async (args: Record<string, unknown> = {}) => colorsOf(await h.text("read_pixels", args));

  it("lists the tool surface", async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["status", "new_sprite", "draw_pixel_map", "render_preview", "batch", "outline", "mirror"]) expect(names).toContain(n);
    expect(names).not.toContain("run_lua");
  });

  it("finds Aseprite and refuses work without a file", async () => {
    const s = await h.call("status");
    expect(s.aseprite_found).toBe(true);
    const r: any = await h.callRaw("draw_pixels", { pixels: [{ x: 0, y: 0, color: R }] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/no_sprite/);
  });

  it("creates a sprite and saves it to the working folder", async () => {
    const info = await h.call("new_sprite", { width: 8, height: 8, path: "test.aseprite", palette: [K, R, G, B] });
    expect(info.width).toBe(8);
    expect(fs.existsSync(path.join(h.workdir, "test.aseprite"))).toBe(true);
    const pal = await h.call("get_palette");
    expect(pal.colors).toEqual([K, R, G, B]);
  });

  it("draws a pixel map and reads it back exactly", async () => {
    await h.call("draw_pixel_map", { x: 1, y: 1, rows: ["rg", ".b"], legend: { r: R, g: G, b: B } });
    const px = await pixels({ region: { x: 0, y: 0, width: 3, height: 3 } });
    expect(px).toEqual([
      [".", ".", "."],
      [".", R, G],
      [".", ".", B],
    ]);
  });

  it("rejects unknown legend characters without changing anything", async () => {
    const r: any = await h.callRaw("draw_pixel_map", { rows: ["rx"], legend: { r: R } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not in the legend/);
    expect((await pixels({ region: { x: 0, y: 0, width: 1, height: 1 } }))[0][0]).toBe(".");
  });

  it("draws lines, rects and ellipses", async () => {
    await h.call("erase", {});
    await h.call("draw_line", { x1: 0, y1: 0, x2: 7, y2: 7, color: R });
    let px = await pixels();
    for (let i = 0; i < 8; i++) expect(px[i][i]).toBe(R);
    expect(px.flat().filter((c) => c === R)).toHaveLength(8);

    await h.call("erase", {});
    await h.call("draw_rect", { x: 1, y: 1, width: 4, height: 3, color: K, fill_color: G });
    px = await pixels();
    expect(px[1].slice(1, 5)).toEqual([K, K, K, K]);
    expect(px[2].slice(1, 5)).toEqual([K, G, G, K]);

    await h.call("erase", {});
    await h.call("draw_ellipse", { x: 0, y: 0, width: 8, height: 8, color: B, fill: true });
    px = await pixels();
    expect(px[0][0]).toBe(".");
    expect(px[4][4]).toBe(B);
    expect(px[0][3]).toBe(B);
  });

  it("flood fills contiguously and globally", async () => {
    await h.call("erase", {});
    await h.call("draw_rect", { x: 0, y: 0, width: 5, height: 5, color: K });
    await h.call("fill", { x: 2, y: 2, color: R });
    let px = await pixels();
    expect(px[2][2]).toBe(R);
    expect(px[6][6]).toBe(".");
    await h.call("fill", { x: 7, y: 7, color: G });
    px = await pixels();
    expect(px[7][7]).toBe(G);
    expect(px[2][2]).toBe(R);
    await h.call("fill", { x: 0, y: 0, color: B, contiguous: false });
    px = await pixels();
    expect(px.flat().includes(K)).toBe(false);
  });

  it("outlines a shape outside and inside", async () => {
    await h.call("erase", {});
    await h.call("draw_rect", { x: 3, y: 3, width: 2, height: 2, color: R, fill: true });
    await h.call("outline", { color: K });
    let px = await pixels();
    expect(px[2][3]).toBe(K);
    expect(px[3][2]).toBe(K);
    expect(px[2][2]).toBe(".");
    await h.call("outline", { color: B, mode: "inside" });
    px = await pixels();
    expect(px[2][3]).toBe(B);
  });

  it("mirrors, flips and shifts", async () => {
    await h.call("erase", {});
    await h.call("draw_pixels", { pixels: [{ x: 0, y: 0, color: R }, { x: 1, y: 2, color: G }] });
    await h.call("mirror", { source: "left" });
    let px = await pixels();
    expect(px[0][7]).toBe(R);
    expect(px[2][6]).toBe(G);
    await h.call("flip", { direction: "vertical" });
    px = await pixels();
    expect(px[7][0]).toBe(R);
    await h.call("shift", { dx: 1, dy: 0, wrap: true });
    px = await pixels();
    expect(px[7][1]).toBe(R);
    expect(px[7][0]).toBe(R);
  });

  it("rotates content 90 degrees", async () => {
    await h.call("erase", {});
    await h.call("draw_pixel_map", { x: 2, y: 3, rows: ["rgb"], legend: { r: R, g: G, b: B } });
    await h.call("rotate", { angle: 90 });
    const px = await pixels();
    expect([px[2][3], px[3][3], px[4][3]]).toEqual([R, G, B]);
  });

  it("dithers gradients using only the given colors", async () => {
    await h.call("erase", {});
    await h.call("draw_gradient", { x: 0, y: 0, width: 8, height: 8, colors: [K, B], direction: "vertical", dither: "bayer4" });
    const px = await pixels();
    expect(new Set(px.flat())).toEqual(new Set([K, B]));
    expect(px[0].every((c) => c === K)).toBe(true);
    expect(px[7].every((c) => c === B)).toBe(true);
  });

  it("manages layers", async () => {
    await h.call("add_layer", { name: "Shading" });
    await h.call("draw_pixels", { layer: "Shading", pixels: [{ x: 0, y: 0, color: G }] });
    const list = await h.call("list_layers");
    expect(list.layers.map((l: any) => l.name)).toEqual(["Shading", "Layer 1"]);
    await h.call("update_layer", { layer: "Shading", opacity: 128, name: "Shade" });
    await h.call("duplicate_layer", { layer: "Shade", name: "Shade 2" });
    expect((await h.call("list_layers")).layers.map((l: any) => l.name)).toEqual(["Shade 2", "Shade", "Layer 1"]);
    await h.call("delete_layer", { layer: "Shade 2" });
    await h.call("merge_down", { layer: "Shade" });
    expect((await h.call("list_layers")).layers).toHaveLength(1);
  });

  it("runs a batch atomically", async () => {
    await h.call("erase", {});
    const ok = await h.call("batch", {
      ops: [
        { tool: "draw_pixels", args: { pixels: [{ x: 0, y: 0, color: R }] } },
        { tool: "draw_pixels", args: { pixels: [{ x: 1, y: 0, color: G }] } },
      ],
    });
    expect(ok.count).toBe(2);
    const r: any = await h.callRaw("batch", {
      ops: [
        { tool: "draw_pixels", args: { pixels: [{ x: 2, y: 0, color: B }] } },
        { tool: "draw_pixel_map", args: { rows: ["?"], legend: {} } },
      ],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/rolled back/);
    const px = await pixels({ region: { x: 0, y: 0, width: 3, height: 1 } });
    expect(px[0]).toEqual([R, G, "."]);
  });

  it("selection clips drawing", async () => {
    await h.call("erase", {});
    await h.call("select", { kind: "rect", x: 0, y: 0, width: 2, height: 2 });
    const res = await h.call("draw_rect", { x: 0, y: 0, width: 8, height: 8, color: R, fill: true });
    expect(res.pixels_written).toBe(4);
    await h.call("select", { kind: "none" });
    const px = await pixels();
    expect(px.flat().filter((c) => c === R)).toHaveLength(4);
  });

  it("replaces colors and analyzes the art", async () => {
    await h.call("replace_color", { from: R, to: B });
    const a = await h.call("analyze");
    expect(a.colors).toEqual([{ color: B, count: 4 }]);
    expect(a.content_bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it("renders a preview image", async () => {
    const r: any = await h.callRaw("render_preview", { scale: 4, grid: 4 });
    const img = r.content.find((c: any) => c.type === "image");
    const png = PNG.sync.read(Buffer.from(img.data, "base64"));
    expect([png.width, png.height]).toEqual([32, 32]);
    expect(Array.from(png.data.subarray(0, 4))).toEqual([0, 0, 255, 255]);
  });

  it("returns a preview alongside an edit when asked", async () => {
    const r: any = await h.callRaw("draw_pixels", { pixels: [{ x: 7, y: 7, color: G }], preview: true });
    expect(r.content.some((c: any) => c.type === "image")).toBe(true);
  });

  it("resizes canvas and sprite", async () => {
    let info = await h.call("canvas_size", { width: 10, height: 10, anchor: "top-left" });
    expect([info.width, info.height]).toEqual([10, 10]);
    info = await h.call("resize_sprite", { scale: 2 });
    expect([info.width, info.height]).toEqual([20, 20]);
    const px = await pixels({ region: { x: 0, y: 0, width: 4, height: 4 } });
    expect(px.flat().every((c) => c === B)).toBe(true);
    info = await h.call("crop", { trim: true });
    expect(info.width).toBeLessThan(20);
  });

  it("exports PNGs at scale with trim", async () => {
    const r = await h.call("export_image", { path: "out/test.png", scale: 3, trim: true });
    const file = path.join(h.workdir, "out", "test.png");
    expect(fs.existsSync(file)).toBe(true);
    const png = PNG.sync.read(fs.readFileSync(file));
    expect(png.width).toBe(r.width);
    expect(png.width % 3).toBe(0);
  });

  it("loads palette presets and switches to indexed", async () => {
    const list = await h.call("list_palette_presets");
    expect(list.presets.some((p: any) => p.id === "PICO-8")).toBe(true);
    await h.call("set_palette", { palette_preset: "PICO-8" });
    const pal = await h.call("get_palette");
    expect(pal.colors).toHaveLength(16);
    await h.call("new_sprite", { width: 4, height: 4, color_mode: "indexed", palette_preset: "PICO-8", path: "idx.aseprite" });
    const ip = await h.call("get_palette");
    expect(ip.colors).toHaveLength(17);
    const bad: any = await h.callRaw("draw_pixels", { pixels: [{ x: 0, y: 0, color: "#123456" }] });
    expect(bad.content[0].text).toMatch(/color_not_in_palette/);
    await h.call("draw_pixels", { pixels: [{ x: 0, y: 0, color: "#ff004d" }, { x: 1, y: 0, color: 2 }] });
    const px = await pixels({ region: { x: 0, y: 0, width: 2, height: 1 } });
    expect(px[0][0]).toBe("#ff004d");
    expect(px[0][1]).toBe(ip.colors[2]);
  });

  it("re-opens files and tracks the working file", async () => {
    await h.call("open_sprite", { path: "test.aseprite" });
    const s = await h.call("status");
    expect(s.working_file).toMatch(/test\.aseprite$/);
    expect(s.aseprite.active_sprite.width).toBeGreaterThan(4);
    const saved = await h.call("save_sprite", { path: "copy.aseprite" });
    expect(fs.existsSync(path.join(h.workdir, "copy.aseprite"))).toBe(true);
    expect(saved.saved).toMatch(/copy\.aseprite$/);
  });
});

describe.skipIf(!hasAseprite)("run_lua opt-in", () => {
  it("is exposed and works only when enabled", async () => {
    const h = await startServer("lua", { ASEPRITE_MCP_ALLOW_LUA: "1" });
    try {
      const { tools } = await h.client.listTools();
      expect(tools.map((t) => t.name)).toContain("run_lua");
      await h.call("new_sprite", { width: 4, height: 4, path: "lua.aseprite" });
      const r = await h.call("run_lua", { code: "print(sprite.width) return { w = sprite.width }" });
      expect(r.output).toEqual(["4"]);
      expect(r.returned).toEqual({ w: 4 });
    } finally {
      await h.close();
    }
  });
});
