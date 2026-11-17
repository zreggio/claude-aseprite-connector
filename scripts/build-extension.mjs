// Builds dist/claude-bridge.aseprite-extension:
//   package.json + main.lua (lua/extension) and core/ (lua/core)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walk, writeZip } from "./lib/zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "lua", "extension");
const core = path.join(root, "lua", "core");
const out = path.join(root, "dist", "claude-bridge.aseprite-extension");

const entries = [
  ...walk(ext).map((f) => ({ name: f.rel, data: fs.readFileSync(f.abs) })),
  ...walk(core).map((f) => ({ name: `core/${f.rel}`, data: fs.readFileSync(f.abs) })),
];
writeZip(out, entries);
console.log(`built ${path.relative(root, out)} (${entries.length} files)`);
