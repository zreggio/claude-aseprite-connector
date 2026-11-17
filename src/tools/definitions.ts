import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BridgeError } from "../bridge/types.js";
import { listPalettePresets, presetColors } from "../palettes.js";
import { renderPreview } from "../render/preview.js";
import {
  color,
  type Content,
  int,
  json,
  layer,
  preview,
  region,
  resolvePalette,
  resolvePath,
  respectSelection,
  sprite,
  stripUndefined,
  timestampName,
  type ToolContext,
  type ToolDef,
} from "./common.js";

const paletteFields = {
  palette: z.array(z.string()).max(256).optional().describe("Explicit palette as hex colors, e.g. ['#1a1c2c', '#5d275d', ...]."),
  palette_preset: z
    .string()
    .optional()
    .describe("Built-in palette id from list_palette_presets, e.g. 'DB32', 'PICO-8', 'EDG32', 'AAP-64', 'Zughy-32'. Case-sensitive."),
  palette_file: z.string().optional().describe("Path to a palette file (.gpl, .pal, .png, .ase)."),
};

// ---------------------------------------------------------------------------
// Preview rendering (shared by render_preview and the `preview` flag)
// ---------------------------------------------------------------------------
export async function previewContent(
  ctx: ToolContext,
  opts: { sprite?: string; layer?: string; region?: unknown; scale?: number; grid?: number; pixel_grid?: boolean; background?: string } = {},
): Promise<Content[]> {
  const r = await ctx.router.call("render", stripUndefined({ sprite: opts.sprite, layer: opts.layer, region: opts.region }));
  const rgba = Buffer.from(r.rgba, "base64");
  const out = renderPreview(rgba, r.width, r.height, {
    scale: opts.scale,
    grid: opts.grid,
    pixelGrid: opts.pixel_grid,
    background: opts.background,
  });
  return [
    { type: "image", data: out.png.toString("base64"), mimeType: "image/png" },
    json({
      region: { x: r.x, y: r.y, width: r.width, height: r.height },
      sprite_size: { width: r.sprite_width, height: r.sprite_height },
      preview_scale: out.scale,
      preview_size: { width: out.width, height: out.height },
    }),
  ];
}

function formatPixelGrid(r: any): Content[] {
  const legend = Object.entries(r.legend ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const header = `region x=${r.x} y=${r.y} ${r.width}x${r.height} · '${r.transparent_char}' = transparent`;
  return [{ type: "text", text: `${header}\nlegend: ${legend || "(empty)"}\nrows:\n${(r.rows ?? []).join("\n")}` }];
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export function buildTools(cfg: { allowLua: boolean }): ToolDef[] {
  const tools: ToolDef[] = [
    // ---------------- Session ----------------
    {
      name: "status",
      title: "Connector status",
      kind: "read",
      batchable: false,
      description:
        "Show how the connector reaches Aseprite (live = editing the open Aseprite window; headless = editing .aseprite files in the background), the open sprites, the active sprite/layer, and the working folder. Call this first.",
      shape: {},
      run: async (_args, ctx) => {
        const { router, cfg } = ctx;
        const node = {
          mode: router.mode,
          live: {
            connected: router.live.connected,
            listening: router.live.listening,
            port: cfg.port,
            error: router.live.listenError,
            aseprite: router.live.info,
          },
          headless: {
            available: router.headless.available,
            aseprite_path: cfg.asepritePath ?? null,
            working_file: router.headless.currentFile ?? null,
          },
          workdir: cfg.workdir,
          run_lua_enabled: cfg.allowLua,
          hint:
            router.mode === "live"
              ? "Edits appear live in Aseprite; each tool call is one undo step."
              : "Aseprite isn't connected. Edits are applied to the working .aseprite file on disk. To edit live, open Aseprite with the Claude Bridge extension installed.",
        };
        let aseprite: unknown = null;
        if (router.mode === "live" || router.headless.available) {
          try {
            aseprite = await router.call("status", {});
          } catch (e) {
            aseprite = { error: (e as Error).message };
          }
        }
        return [json({ ...node, aseprite })];
      },
    },

    // ---------------- Document ----------------
    {
      name: "new_sprite",
      title: "New sprite",
      kind: "file",
      batchable: false,
      description:
        "Create a new single-frame sprite (and make it active). Pixel-art assets are usually small: 16x16, 32x32, 48x48, 64x64. In indexed mode palette index 0 is reserved for transparency and your palette starts at index 1. In headless mode the file is saved immediately (to `path`, or a timestamped file in the working folder).",
      shape: {
        width: z.number().int().min(1).max(1024).describe("Canvas width in pixels."),
        height: z.number().int().min(1).max(1024).describe("Canvas height in pixels."),
        color_mode: z.enum(["rgb", "indexed", "gray"]).optional().describe("Default 'rgb'."),
        background: z.string().optional().describe("Opaque background color (creates a Background layer). Omit for transparent (best for game assets)."),
        layer_name: z.string().optional().describe("Name of the first drawing layer (default 'Layer 1')."),
        path: z.string().optional().describe("Where to save the .aseprite file (relative paths go to the working folder). Optional in live mode."),
        ...paletteFields,
      },
      prepare: (a, ctx) => {
        let p = resolvePath(ctx.cfg, a.path, ".aseprite");
        if (!p && ctx.router.mode === "headless") p = path.join(ctx.cfg.workdir, `${timestampName()}.aseprite`);
        return stripUndefined({
          width: a.width,
          height: a.height,
          color_mode: a.color_mode,
          background: a.background,
          layer_name: a.layer_name,
          path: p,
          ...resolvePalette(a, ctx),
        });
      },
    },
    {
      name: "open_sprite",
      title: "Open sprite",
      kind: "file",
      batchable: false,
      description: "Open an existing .aseprite/.ase/.png file (or switch to it if already open) and make it the active sprite.",
      shape: { path: z.string().describe("File path; relative paths resolve against the working folder.") },
      prepare: (a, ctx) => {
        const p = resolvePath(ctx.cfg, a.path)!;
        if (!fs.existsSync(p)) throw new BridgeError("file_not_found", `File not found: ${p}`);
        return { path: p };
      },
    },
    {
      name: "save_sprite",
      title: "Save sprite",
      kind: "file",
      description:
        "Save the sprite as .aseprite (keeps layers). Without `path`, saves to its current file, or to a timestamped file in the working folder if it was never saved. Use export_image for PNG.",
      shape: { sprite, path: z.string().optional().describe("Target .aseprite path (relative → working folder).") },
      prepare: (a, ctx) =>
        stripUndefined({
          sprite: a.sprite,
          path: resolvePath(ctx.cfg, a.path, ".aseprite"),
          default_path: path.join(ctx.cfg.workdir, `${timestampName()}.aseprite`),
        }),
    },
    {
      name: "export_image",
      title: "Export image",
      kind: "file",
      description:
        "Export the flattened visible image (or one layer) to PNG/GIF/BMP/etc for use in a game. Use `scale` for crisp nearest-neighbour upscales (e.g. 4 for store/preview art) and `trim` to crop transparent borders.",
      shape: {
        sprite,
        path: z.string().describe("Output file, e.g. 'sword.png' (relative → working folder; .png added if no extension)."),
        scale: z.number().int().min(1).max(32).optional().describe("Integer upscale factor (default 1)."),
        trim: z.boolean().optional().describe("Crop fully transparent borders."),
        layer,
        region,
      },
      prepare: (a, ctx) =>
        stripUndefined({ sprite: a.sprite, path: resolvePath(ctx.cfg, a.path, ".png"), scale: a.scale, trim: a.trim, layer: a.layer, region: a.region }),
    },
    {
      name: "resize_sprite",
      title: "Resize sprite",
      kind: "write",
      description: "Scale the whole sprite (all layers) with nearest-neighbour. Give width/height or a scale factor. Prefer canvas_size to add room without scaling art.",
      shape: {
        sprite,
        width: z.number().int().min(1).max(1024).optional(),
        height: z.number().int().min(1).max(1024).optional(),
        scale: z.number().positive().optional().describe("e.g. 2 doubles, 0.5 halves."),
        preview,
      },
    },
    {
      name: "canvas_size",
      title: "Canvas size",
      kind: "write",
      description:
        "Grow or shrink the canvas without scaling pixels. Either give the new width/height plus an anchor, or margins (left/top/right/bottom, negative values shrink).",
      shape: {
        sprite,
        width: z.number().int().min(1).max(1024).optional(),
        height: z.number().int().min(1).max(1024).optional(),
        anchor: z
          .enum(["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"])
          .optional()
          .describe("Where existing art stays (default center)."),
        left: z.number().int().optional(),
        top: z.number().int().optional(),
        right: z.number().int().optional(),
        bottom: z.number().int().optional(),
        preview,
      },
    },
    {
      name: "crop",
      title: "Crop",
      kind: "write",
      destructive: true,
      description: "Crop the canvas to a region, or (default) trim to the visible content plus an optional margin.",
      shape: {
        sprite,
        region,
        trim: z.boolean().optional().describe("Trim to visible content (default when no region is given)."),
        margin: z.number().int().min(0).optional().describe("Pixels of padding to keep around trimmed content."),
        layer: z.string().optional().describe("Trim based on this layer's content instead of all visible layers."),
        preview,
      },
    },

    // ---------------- Inspect ----------------
    {
      name: "render_preview",
      title: "Render preview",
      kind: "read",
      cmd: "render",
      batchable: false,
      description:
        "See the artwork: returns an upscaled PNG (nearest-neighbour, checkerboard = transparent). Use often to judge silhouette, readability and shading. `grid` draws magenta guide lines every N pixels; `pixel_grid` outlines each pixel to help count positions.",
      shape: {
        sprite,
        layer: z.string().optional().describe("Render only this layer/group (default: all visible layers)."),
        region,
        scale: z.number().int().min(1).max(64).optional().describe("Upscale factor (default: auto, ~512px)."),
        grid: z.number().int().min(2).max(256).optional().describe("Guide line every N sprite pixels (e.g. 8 or 16)."),
        pixel_grid: z.boolean().optional().describe("Faint line around every pixel (needs scale >= 6)."),
        background: z.string().optional().describe("'checker' (default) or a hex color to place behind transparency."),
      },
      run: (a, ctx) => previewContent(ctx, a),
    },
    {
      name: "read_pixels",
      title: "Read pixels",
      kind: "read",
      description:
        "Read exact pixel colors as a character grid + legend (same format draw_pixel_map accepts). '.' is transparent. Max 16384 pixels per call; read a region of large sprites.",
      shape: { sprite, layer: z.string().optional().describe("Read one layer (default: flattened visible image)."), region },
      format: (r) => formatPixelGrid(r),
    },
    {
      name: "analyze",
      title: "Analyze artwork",
      kind: "read",
      description:
        "Quality check: color count and usage, content bounds, stray/isolated pixels, near-duplicate colors, colors outside the palette and unused palette entries. Use before finishing an asset.",
      shape: {
        sprite,
        layer: z.string().optional().describe("Analyze one layer (default: flattened visible image)."),
        region,
        near_threshold: z.number().int().min(0).max(64).optional().describe("Max channel difference for near-duplicate colors (default 12)."),
      },
    },

    // ---------------- Draw ----------------
    {
      name: "draw_pixel_map",
      title: "Draw pixel map",
      kind: "write",
      description:
        "Main drawing tool. Paint a block of pixels from text rows: each character is one pixel, mapped through `legend` to a color. '.' and ' ' are skipped (left unchanged); map a character to 'transparent' to erase. All rows start at (x, y). Ideal for sprites, tiles and icons; build them in layers (e.g. outline/base/shading/highlights).",
      shape: {
        sprite,
        layer,
        x: z.number().int().optional().describe("Left of the block (default 0)."),
        y: z.number().int().optional().describe("Top of the block (default 0)."),
        rows: z.array(z.string().max(256)).min(1).max(256).describe("One string per pixel row, top to bottom."),
        legend: z.record(z.string(), color).describe("Single character → color, e.g. {\"o\": \"#1a1c2c\", \"r\": \"#b13e53\"}."),
        transparent_char: z.string().length(1).optional().describe("Character that means 'skip' (default '.')."),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "draw_pixels",
      title: "Draw pixels",
      kind: "write",
      description: "Set individual pixels. Each entry is {x, y, color?}; entries without color use the default `color`.",
      shape: {
        sprite,
        layer,
        color: color.optional().describe("Default color for entries without one."),
        pixels: z
          .array(z.object({ x: z.number().int(), y: z.number().int(), color: color.optional() }))
          .min(1)
          .max(65536),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "draw_line",
      title: "Draw line",
      kind: "write",
      description:
        "Draw 1px pixel-perfect lines (Bresenham, no doubled corners). Use x1,y1,x2,y2 for one segment or `points` for a polyline (`closed` to join the ends). Clean pixel-art slopes use 1:1, 1:2, 2:1 or 1:3 step patterns.",
      shape: {
        sprite,
        layer,
        color,
        x1: z.number().int().optional(),
        y1: z.number().int().optional(),
        x2: z.number().int().optional(),
        y2: z.number().int().optional(),
        points: z.array(z.tuple([z.number().int(), z.number().int()])).min(2).max(1024).optional().describe("Polyline as [[x,y], ...]."),
        closed: z.boolean().optional(),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "draw_rect",
      title: "Draw rectangle",
      kind: "write",
      description: "Draw a rectangle outline with `color` and/or fill it with `fill_color` (or `fill: true` to fill with `color`).",
      shape: {
        sprite,
        layer,
        x: int("Left"),
        y: int("Top"),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
        color: color.optional().describe("Outline color."),
        fill: z.boolean().optional(),
        fill_color: color.optional(),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "draw_ellipse",
      title: "Draw ellipse",
      kind: "write",
      description: "Draw an ellipse/circle inscribed in the bounding box (x, y, width, height): outline with `color`, fill with `fill_color` or `fill: true`.",
      shape: {
        sprite,
        layer,
        x: int("Bounding box left"),
        y: int("Bounding box top"),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
        color: color.optional().describe("Outline color."),
        fill: z.boolean().optional(),
        fill_color: color.optional(),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "fill",
      title: "Fill (paint bucket)",
      kind: "write",
      description: "Flood-fill from (x, y) on a layer. `contiguous: false` replaces every matching pixel on the layer. `tolerance` 0-255 (max channel difference).",
      shape: {
        sprite,
        layer,
        x: int("Start x"),
        y: int("Start y"),
        color,
        contiguous: z.boolean().optional().describe("Default true."),
        diagonal: z.boolean().optional().describe("Also spread diagonally (default false)."),
        tolerance: z.number().int().min(0).max(255).optional(),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "erase",
      title: "Erase",
      kind: "write",
      destructive: true,
      description: "Make pixels transparent: a list of `pixels`, a `region`, or (neither) the whole layer — limited to the selection if one exists.",
      shape: {
        sprite,
        layer,
        region,
        pixels: z.array(z.object({ x: z.number().int(), y: z.number().int() })).max(65536).optional(),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "replace_color",
      title: "Replace color",
      kind: "write",
      description: "Replace one color with another on a layer (or `all_layers`). Great for recoloring variants (e.g. red potion → blue potion).",
      shape: {
        sprite,
        layer,
        from: color,
        to: color,
        tolerance: z.number().int().min(0).max(255).optional(),
        region,
        all_layers: z.boolean().optional(),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "outline",
      title: "Outline",
      kind: "write",
      description:
        "Add a 1px outline around the opaque shape on a layer. mode 'outside' paints transparent pixels touching the shape; 'inside' recolors the shape's edge pixels. `corners: true` includes diagonal neighbours (thicker, rounder outline). Tip: draw the outline on its own layer by calling this on a copy, or run it on the shape layer.",
      shape: {
        sprite,
        layer,
        color,
        mode: z.enum(["outside", "inside"]).optional(),
        corners: z.boolean().optional(),
        respect_selection: respectSelection,
        preview,
      },
    },
    {
      name: "draw_gradient",
      title: "Dithered gradient",
      kind: "write",
      description:
        "Fill a rectangle with a gradient that uses ONLY the given colors (palette-safe), blended with ordered (Bayer) dithering. `only_opaque: true` paints only over existing pixels — use it to shade a shape. Use 2-4 neighbouring ramp colors for best results.",
      shape: {
        sprite,
        layer,
        x: int("Left"),
        y: int("Top"),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
        colors: z.array(color).min(2).max(16).describe("Ramp from start to end."),
        direction: z.enum(["horizontal", "vertical", "diagonal_down", "diagonal_up", "radial"]).optional().describe("Default vertical (top → bottom)."),
        dither: z.enum(["none", "bayer2", "bayer4", "bayer8"]).optional().describe("Default bayer4."),
        reverse: z.boolean().optional(),
        only_opaque: z.boolean().optional(),
        respect_selection: respectSelection,
        preview,
      },
    },

    // ---------------- Transform ----------------
    {
      name: "flip",
      title: "Flip",
      kind: "write",
      description: "Mirror pixels horizontally or vertically within a region (default: selection bounds, else whole canvas) on one layer.",
      shape: { sprite, layer, direction: z.enum(["horizontal", "vertical"]).optional(), region, respect_selection: respectSelection, preview },
    },
    {
      name: "rotate",
      title: "Rotate 90/180/270",
      kind: "write",
      description: "Rotate a layer's pixels clockwise by 90/180/270 degrees about the region's centre (default region: selection bounds, else the layer's content bounds). Pixels are never resampled.",
      shape: { sprite, layer, angle: z.union([z.literal(90), z.literal(180), z.literal(270)]), region, respect_selection: respectSelection, preview },
    },
    {
      name: "shift",
      title: "Shift / nudge",
      kind: "write",
      description: "Move a layer's pixels by (dx, dy) within a region (default: selection bounds, else whole canvas). `wrap: true` wraps around (useful for seamless tiles).",
      shape: { sprite, layer, dx: z.number().int().optional(), dy: z.number().int().optional(), wrap: z.boolean().optional(), region, respect_selection: respectSelection, preview },
    },
    {
      name: "mirror",
      title: "Mirror half",
      kind: "write",
      description:
        "Make a layer symmetric by copying one half onto the other (source left/right/top/bottom) within a region (default: selection bounds, else whole canvas). Draw half a symmetric object, then mirror.",
      shape: { sprite, layer, source: z.enum(["left", "right", "top", "bottom"]).optional().describe("Half to keep (default left)."), region, respect_selection: respectSelection, preview },
    },
    {
      name: "copy_region",
      title: "Copy region",
      kind: "write",
      description: "Copy a rectangle of pixels to another position and/or layer (optionally flipped). Transparent source pixels are skipped unless skip_transparent=false.",
      shape: {
        sprite,
        from_layer: z.string().optional().describe("Source layer (default active)."),
        to_layer: z.string().optional().describe("Destination layer (default same as source)."),
        x: int("Source left"),
        y: int("Source top"),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
        to_x: int("Destination left"),
        to_y: int("Destination top"),
        flip_horizontal: z.boolean().optional(),
        flip_vertical: z.boolean().optional(),
        skip_transparent: z.boolean().optional(),
        preview,
      },
    },

    // ---------------- Layers ----------------
    {
      name: "list_layers",
      title: "List layers",
      kind: "read",
      description: "List layers top-to-bottom with visibility, opacity, blend mode, depth (groups) and content bounds.",
      shape: { sprite },
    },
    {
      name: "add_layer",
      title: "Add layer",
      kind: "write",
      description: "Create an image layer or group (default: directly above the active layer) and make it active. Typical asset stack: Sketch, Outline, Base, Shading, Highlights.",
      shape: {
        sprite,
        name: z.string().optional(),
        type: z.enum(["image", "group"]).optional(),
        parent: z.string().optional().describe("Group to put it in ('' for top level)."),
        above: z.string().optional().describe("Place directly above this layer."),
        below: z.string().optional().describe("Place directly below this layer."),
        opacity: z.number().int().min(0).max(255).optional(),
        blend_mode: z.string().optional().describe("normal, multiply, screen, overlay, darken, lighten, color_dodge, color_burn, hard_light, soft_light, difference, exclusion, hue, saturation, color, luminosity, addition, subtract, divide"),
        activate: z.boolean().optional().describe("Default true."),
      },
    },
    {
      name: "update_layer",
      title: "Update layer",
      kind: "write",
      description: "Rename, show/hide, change opacity/blend mode, move (above/below/parent/stack_index) or activate a layer.",
      shape: {
        sprite,
        layer: z.string().describe("Layer to change."),
        name: z.string().optional(),
        visible: z.boolean().optional(),
        opacity: z.number().int().min(0).max(255).optional(),
        blend_mode: z.string().optional(),
        parent: z.string().optional(),
        above: z.string().optional(),
        below: z.string().optional(),
        stack_index: z.number().int().min(1).optional(),
        activate: z.boolean().optional(),
      },
    },
    {
      name: "delete_layer",
      title: "Delete layer",
      kind: "write",
      destructive: true,
      description: "Delete a layer or group (undoable in live mode).",
      shape: { sprite, layer: z.string().describe("Layer to delete.") },
    },
    {
      name: "duplicate_layer",
      title: "Duplicate layer",
      kind: "write",
      description: "Copy an image layer (placed above the original) — handy before risky edits or for color variants.",
      shape: { sprite, layer, name: z.string().optional() },
    },
    {
      name: "merge_down",
      title: "Merge down",
      kind: "write",
      destructive: true,
      description: "Merge a layer into the layer directly below it (respecting opacity and blend mode).",
      shape: { sprite, layer, preview },
    },
    {
      name: "flatten",
      title: "Flatten",
      kind: "write",
      destructive: true,
      description: "Merge all layers into one.",
      shape: { sprite, preview },
    },

    // ---------------- Palette ----------------
    {
      name: "get_palette",
      title: "Get palette",
      kind: "read",
      description: "List the sprite's palette (index → hex).",
      shape: { sprite },
    },
    {
      name: "set_palette",
      title: "Set palette",
      kind: "write",
      description:
        "Replace the sprite's palette with a hex list, a preset id or a palette file. A fixed, limited palette (8-32 colors) is key to cohesive pixel art. In indexed mode index 0 stays transparent and existing pixels keep their indices.",
      shape: { sprite, ...paletteFields },
      prepare: (a, ctx) => stripUndefined({ sprite: a.sprite, ...resolvePalette(a, ctx) }),
    },
    {
      name: "add_palette_colors",
      title: "Add palette colors",
      kind: "write",
      description: "Append colors to the palette (existing ones are reused). Returns each color's index.",
      shape: { sprite, colors: z.array(z.string()).min(1).max(256) },
    },
    {
      name: "list_palette_presets",
      title: "List palette presets",
      kind: "read",
      batchable: false,
      description:
        "List palette presets bundled with Aseprite (DawnBringer, Endesga, PICO-8, AAP, Arne, hardware palettes, …). Pass `id` to get that preset's colors.",
      shape: { id: z.string().optional().describe("Return the colors of this preset.") },
      run: async (a, ctx) => {
        const all = listPalettePresets(ctx.cfg.asepritePath);
        if (a.id) {
          const p = all.find((x) => x.id === a.id) ?? all.find((x) => x.id.toLowerCase() === String(a.id).toLowerCase());
          if (!p) throw new BridgeError("palette_not_found", `Unknown palette preset '${a.id}'.`);
          return [json({ id: p.id, extension: p.extension, colors: presetColors(p) ?? null })];
        }
        return [
          json({
            presets: all.map((p) => ({ id: p.id, colors: presetColors(p)?.length ?? null, extension: p.extension })),
            tip: "Popular choices: PICO-8 (16), DB16, DB32, EDG32, AAP-64, Zughy-32, ENOS16, Game Boy (4).",
          }),
        ];
      },
    },
    {
      name: "set_color_mode",
      title: "Set color mode",
      kind: "write",
      description: "Convert the sprite between rgb, indexed and gray. Converting to indexed maps colors onto the current palette.",
      shape: {
        sprite,
        mode: z.enum(["rgb", "indexed", "gray"]),
        dithering: z.enum(["none", "ordered", "old"]).optional().describe("Dithering used when converting to indexed (default none)."),
      },
    },

    // ---------------- Selection ----------------
    {
      name: "select",
      title: "Select",
      kind: "write",
      description:
        "Change the selection: kind rect | all | none | color (pixels matching `color`) | content (all opaque pixels). op replace | add | subtract | intersect. Drawing tools and transforms are limited to the selection while it exists — select none when done.",
      shape: {
        sprite,
        kind: z.enum(["rect", "all", "none", "color", "content"]).optional().describe("Default rect."),
        op: z.enum(["replace", "add", "subtract", "intersect"]).optional(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        width: z.number().int().min(1).optional(),
        height: z.number().int().min(1).optional(),
        color: color.optional(),
        tolerance: z.number().int().min(0).max(255).optional(),
        layer: z.string().optional().describe("For color/content: sample this layer instead of the flattened image."),
      },
    },

    // ---------------- History ----------------
    {
      name: "undo",
      title: "Undo",
      kind: "write",
      batchable: false,
      description: "Undo the last N operations in Aseprite (live mode only). Each tool call / batch is one step.",
      shape: { sprite, steps: z.number().int().min(1).max(100).optional(), preview },
    },
    {
      name: "redo",
      title: "Redo",
      kind: "write",
      batchable: false,
      description: "Redo N undone operations (live mode only).",
      shape: { sprite, steps: z.number().int().min(1).max(100).optional(), preview },
    },
  ];

  if (cfg.allowLua) {
    tools.push({
      name: "run_lua",
      title: "Run Lua script",
      kind: "write",
      destructive: true,
      description:
        "Escape hatch: run Lua inside Aseprite with the full scripting API (app, Sprite, Image, …) in one undo step. `sprite` is the active sprite, `print()` output is returned along with the chunk's return value. Prefer the dedicated tools when they fit.",
      shape: { sprite, code: z.string().min(1).describe("Lua source."), preview },
    });
  }

  return tools;
}
