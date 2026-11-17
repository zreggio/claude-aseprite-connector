import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Router } from "./bridge/router.js";
import { BridgeError } from "./bridge/types.js";
import { buildTools, previewContent } from "./tools/definitions.js";
import { json, preview, sprite, type Content, type ToolContext, type ToolDef } from "./tools/common.js";
import { PIXEL_ART_GUIDE, SERVER_INSTRUCTIONS, assetPrompt } from "./prompts/guide.js";

export const SERVER_VERSION = "1.0.0";

function errorResult(e: unknown): CallToolResult {
  if (e instanceof BridgeError) {
    return { isError: true, content: [{ type: "text", text: `Error [${e.code}]: ${e.message}` }] };
  }
  if (e instanceof z.ZodError) {
    return { isError: true, content: [{ type: "text", text: `Invalid arguments: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }] };
  }
  return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error)?.message ?? String(e)}` }] };
}

/** Execute one tool definition (used by direct calls and by batch preparation). */
async function runTool(def: ToolDef, args: any, ctx: ToolContext): Promise<Content[]> {
  if (def.run) return def.run(args, ctx);
  const { preview: wantPreview, ...rest } = args ?? {};
  const params = def.prepare ? await def.prepare(rest, ctx) : rest;
  const result = await ctx.router.call(def.cmd ?? def.name, params);
  const content = def.format ? await def.format(result, args, ctx) : [json(result)];
  if (wantPreview) {
    try {
      content.push(...(await previewContent(ctx, { sprite: args.sprite })));
    } catch (e) {
      content.push({ type: "text", text: `(preview failed: ${(e as Error).message})` });
    }
  }
  return content;
}

export function createServer(cfg: Config, router: Router): McpServer {
  const server = new McpServer(
    { name: "aseprite", title: "Aseprite", version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { logging: {} } },
  );
  const ctx: ToolContext = { cfg, router };
  const tools = buildTools(cfg);
  const byName = new Map(tools.map((t) => [t.name, t]));

  for (const def of tools) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.shape,
        annotations: {
          title: def.title,
          readOnlyHint: def.kind === "read",
          destructiveHint: def.destructive ?? false,
          idempotentHint: def.kind === "read",
          openWorldHint: false,
        },
      },
      (async (args: any) => {
        try {
          return { content: await runTool(def, args, ctx) };
        } catch (e) {
          return errorResult(e);
        }
      }) as any,
    );
  }

  // ---------------- batch ----------------
  const batchable = tools.filter((t) => !t.run && t.batchable !== false).map((t) => t.name);
  server.registerTool(
    "batch",
    {
      title: "Batch operations",
      description:
        "Run several edit tools in one round trip as ONE undo step; if any op fails, all of them are rolled back. Each op is {tool, args} using the same args as the individual tool (without `preview`). " +
        `Allowed tools: ${batchable.join(", ")}.`,
      inputSchema: {
        sprite,
        ops: z
          .array(z.object({ tool: z.string(), args: z.record(z.string(), z.any()).optional() }))
          .min(1)
          .max(200),
        preview,
      },
      annotations: { title: "Batch operations", readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    (async (args: any) => {
      try {
        const ops = [];
        for (const [i, op] of (args.ops as Array<{ tool: string; args?: any }>).entries()) {
          const def = byName.get(op.tool);
          if (!def || !batchable.includes(op.tool)) {
            throw new BridgeError("invalid_params", `ops[${i}]: '${op.tool}' can't be used in batch. Allowed: ${batchable.join(", ")}`);
          }
          const parsed = z.object(def.shape).parse(op.args ?? {});
          const { preview: _p, ...rest } = parsed as any;
          const params = def.prepare ? await def.prepare(rest, ctx) : rest;
          ops.push({ cmd: def.cmd ?? def.name, params });
        }
        const result = await router.call("batch", { sprite: args.sprite, ops });
        const content: Content[] = [json(result)];
        if (args.preview) content.push(...(await previewContent(ctx, { sprite: args.sprite })));
        return { content };
      } catch (e) {
        return errorResult(e);
      }
    }) as any,
  );

  // ---------------- guide resource + prompt ----------------
  server.registerResource(
    "pixel-art-guide",
    "aseprite://guide/pixel-art",
    {
      title: "Pixel-art asset workflow",
      description: "Professional workflow and rules of thumb for creating game-ready pixel art with this connector.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: PIXEL_ART_GUIDE }] }),
  );

  server.registerPrompt(
    "pixel_art_asset",
    {
      title: "Create a pixel-art asset",
      description: "Step-by-step: plan, block in, outline, shade, highlight, clean up and export a pixel-art asset in Aseprite.",
      argsSchema: {
        asset: z.string().describe("What to make, e.g. 'health potion icon' or 'grass tile'."),
        size: z.string().optional().describe("Canvas size, e.g. '32x32'."),
        palette: z.string().optional().describe("Palette preset id or description."),
        style: z.string().optional().describe("Style notes."),
      },
    },
    (args) => ({
      messages: [
        { role: "user", content: { type: "text", text: assetPrompt(args) } },
        { role: "user", content: { type: "resource", resource: { uri: "aseprite://guide/pixel-art", mimeType: "text/markdown", text: PIXEL_ART_GUIDE } } },
      ],
    }),
  );

  return server;
}
