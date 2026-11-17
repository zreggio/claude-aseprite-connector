import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import type { Router } from "../bridge/router.js";
import { findPreset, presetColors } from "../palettes.js";
import { BridgeError } from "../bridge/types.js";

export type Content = CallToolResult["content"][number];

export interface ToolContext {
  cfg: Config;
  router: Router;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  /** Lua command to call (defaults to name). Omit together with `run` for Node-only tools. */
  cmd?: string;
  /** read: no changes · write: edits pixels/layers (undoable) · file: touches the filesystem. */
  kind: "read" | "write" | "file";
  destructive?: boolean;
  /** Can be used inside `batch` (default: true for Lua-backed tools). */
  batchable?: boolean;
  /** Turn validated tool args into Lua params. */
  prepare?: (args: any, ctx: ToolContext) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Format the Lua result into MCP content (default: compact JSON). */
  format?: (result: any, args: any, ctx: ToolContext) => Content[] | Promise<Content[]>;
  /** Fully custom implementation (Node-only tools). */
  run?: (args: any, ctx: ToolContext) => Promise<Content[]>;
}

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------
export const color = z
  .union([z.string(), z.number().int().min(0).max(255)])
  .describe("Color: '#rrggbb', '#rrggbbaa', 'transparent', or a palette index (0-based).");

export const sprite = z
  .string()
  .optional()
  .describe("Target an open sprite by filename or title. Defaults to the active sprite.");

export const layer = z.string().optional().describe("Layer name (or 'Group/Layer' path). Defaults to the active layer.");

export const respectSelection = z
  .boolean()
  .optional()
  .describe("When a selection exists, only pixels inside it are changed (default true). Set false to ignore the selection.");

export const preview = z.boolean().optional().describe("Also return a rendered preview image of the sprite after the change.");

export const region = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .optional()
  .describe("Rectangle in sprite pixel coordinates (origin top-left). Defaults to the whole canvas.");

export const int = (d: string) => z.number().int().describe(d);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function resolvePath(cfg: Config, p: string | undefined, defaultExt?: string): string | undefined {
  if (!p || !p.trim()) return undefined;
  let out = p.trim();
  if (out === "~" || out.startsWith("~/") || out.startsWith("~\\")) out = path.join(os.homedir(), out.slice(1));
  if (!path.isAbsolute(out)) out = path.join(cfg.workdir, out);
  if (defaultExt && !path.extname(out)) out += defaultExt;
  return path.normalize(out);
}

export function timestampName(prefix = "sprite"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Turn palette_preset into an explicit color list (falls back to Aseprite's resource loader). */
export function resolvePalette(args: any, ctx: ToolContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(args.palette) && args.palette.length) out.palette = args.palette;
  else if (args.palette_preset) {
    const preset = findPreset(ctx.cfg.asepritePath, args.palette_preset);
    if (!preset) {
      throw new BridgeError("palette_not_found", `Unknown palette preset '${args.palette_preset}'. Call list_palette_presets to see the available ids.`);
    }
    const colors = presetColors(preset);
    if (colors?.length) out.palette = colors;
    else out.palette_resource = preset.id;
  } else if (args.palette_file) {
    out.palette_file = resolvePath(ctx.cfg, args.palette_file);
  }
  return out;
}

export function json(value: unknown): Content {
  return { type: "text", text: JSON.stringify(value) };
}

export function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
