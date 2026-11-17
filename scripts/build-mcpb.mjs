// Builds dist/aseprite.mcpb for Claude Desktop:
//   manifest.json, icon.png, server/index.js (esbuild bundle), lua/ (headless runner + core)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PNG } from "pngjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "dist", "mcpb");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "server"), { recursive: true });

// 1. Bundle the server into one file (no node_modules needed at runtime).
await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: path.join(stage, "server", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
});

// 2. Lua runner + core.
fs.cpSync(path.join(root, "lua", "headless.lua"), path.join(stage, "lua", "headless.lua"));
fs.cpSync(path.join(root, "lua", "core"), path.join(stage, "lua", "core"), { recursive: true });

// 3. Icon (16x16 pixel-art palette/brush, upscaled to 512x512).
const art = [
  "................",
  "....oooooooo....",
  "..oowwwwwwwwoo..",
  ".owwrrwwwwyywwo.",
  ".owrrrrwwyyyywo.",
  "owwrrrrwwyyyywwo",
  "owwwrrwwwwyywwwo",
  "owggwwwwwwwwbbwo",
  "owgggwwwwwwbbbwo",
  "owwggwwoowwwbbwo",
  ".owwwwwoowwwwwo.",
  ".owwwwwwoooooo..",
  "..oowwwwo.......",
  "....ooooo.......",
  "................",
  "................",
];
const colors = { o: [26, 28, 44], w: [244, 244, 244], r: [177, 62, 83], y: [255, 205, 117], g: [56, 183, 100], b: [65, 166, 246] };
const S = 32;
const icon = new PNG({ width: 512, height: 512 });
for (let y = 0; y < 512; y++)
  for (let x = 0; x < 512; x++) {
    const c = colors[art[Math.floor(y / S)][Math.floor(x / S)]];
    const i = (y * 512 + x) * 4;
    if (c) [icon.data[i], icon.data[i + 1], icon.data[i + 2], icon.data[i + 3]] = [...c, 255];
  }
fs.writeFileSync(path.join(stage, "icon.png"), PNG.sync.write(icon));

// 4. Manifest (tool list generated from the real definitions).
const { buildTools } = await import(pathToFileURL(path.join(root, "dist", "tools", "definitions.js")).href);
const tools = [...buildTools({ allowLua: false }), { name: "batch", description: "Run several edit tools in one round trip as one undo step." }].map((t) => ({
  name: t.name,
  description: t.description.split(". ")[0].replace(/\.$/, "") + ".",
}));

const manifest = {
  manifest_version: "0.3",
  name: "aseprite",
  display_name: "Aseprite",
  version: pkg.version,
  description: "Create and edit 2D pixel art in Aseprite — live in the open app, or headless on .aseprite files.",
  long_description:
    "Lets Claude draw pixel-art assets in Aseprite: sprites, icons, tiles and items. Edits appear live in the Aseprite window (each one undoable) when the Claude Bridge Aseprite extension is installed; otherwise Claude edits .aseprite files in the background. Includes layers, palettes (all of Aseprite's presets), outlines, dithered gradients, symmetry, previews and quality analysis.",
  author: { name: "Zachary Reggio", url: "https://github.com/zreggio" },
  repository: { type: "git", url: "https://github.com/zreggio/claude-aseprite-connector.git" },
  homepage: "https://github.com/zreggio/claude-aseprite-connector",
  support: "https://github.com/zreggio/claude-aseprite-connector/issues",
  license: "MIT",
  keywords: ["aseprite", "pixel art", "sprites", "game assets"],
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: {
        ASEPRITE_PATH: "${user_config.aseprite_path}",
        ASEPRITE_MCP_WORKDIR: "${user_config.workdir}",
        ASEPRITE_MCP_PORT: "${user_config.port}",
        ASEPRITE_MCP_ALLOW_LUA: "${user_config.allow_lua}",
      },
    },
  },
  tools,
  prompts: [
    {
      name: "pixel_art_asset",
      description: "Step-by-step workflow to create a pixel-art asset.",
      arguments: ["asset", "size", "palette", "style"],
      text: "Create a pixel-art ${arguments.asset} (${arguments.size}) with palette ${arguments.palette} in style ${arguments.style} using the aseprite tools.",
    },
  ],
  user_config: {
    aseprite_path: {
      type: "file",
      title: "Aseprite executable",
      description: "Path to Aseprite.exe. Leave empty to auto-detect (Steam and standard installs).",
      required: false,
    },
    workdir: {
      type: "directory",
      title: "Working folder",
      description: "Where new sprites and exports are saved; relative paths resolve here.",
      required: false,
      default: "${DOCUMENTS}/Aseprite Claude",
    },
    port: {
      type: "number",
      title: "Bridge port",
      description: "Local port the Aseprite extension connects to (must match the extension's Status... dialog).",
      required: false,
      default: 47823,
      min: 1024,
      max: 65535,
    },
    allow_lua: {
      type: "boolean",
      title: "Allow run_lua",
      description: "Expose a tool that runs arbitrary Lua inside Aseprite (powerful; can access files).",
      required: false,
      default: false,
    },
  },
  compatibility: {
    platforms: ["win32", "darwin", "linux"],
    runtimes: { node: ">=20.0.0" },
  },
};
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// 5. Validate + pack with the official CLI.
const mcpb = path.join(root, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
const out = path.join(root, "dist", "aseprite.mcpb");
execFileSync(process.execPath, [mcpb, "validate", path.join(stage, "manifest.json")], { stdio: "inherit" });
execFileSync(process.execPath, [mcpb, "pack", stage, out], { stdio: "inherit" });
console.log(`built ${path.relative(root, out)}`);
