// One-step setup after `npm run build` (run via `npm run setup`):
//  1. checks Node and finds Aseprite
//  2. warns if the old Claude Bridge extension is still installed
//  3. prints (or runs, with --claude-code) the command that connects Claude Code
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const ok = (m) => console.log(`  ✔ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const fwd = (p) => p.split(path.sep).join("/");

console.log("\nAseprite Connector setup\n");

// 1. Node + build output -------------------------------------------------------
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`  ✖ Node ${process.versions.node} is too old; install Node 20 or newer.`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

const serverEntry = path.join(root, "dist", "index.js");
if (!fs.existsSync(serverEntry)) {
  console.error("  ✖ dist/index.js is missing. Run `npm run setup` (or `npm run build` first).");
  process.exit(1);
}
ok(`MCP server built: ${fwd(serverEntry)}`);

const { findAseprite } = await import(pathToFileURL(path.join(root, "dist", "config.js")).href);
const aseprite = findAseprite(process.env.ASEPRITE_PATH);
if (aseprite) ok(`Aseprite found: ${aseprite}`);
else warn("Aseprite not found automatically. Set ASEPRITE_PATH to its executable (the connector runs it for every command).");

// 2. Leftover extension from older versions ----------------------------------
function asepriteConfigDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Aseprite");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Aseprite");
  return path.join(os.homedir(), ".config", "aseprite");
}
const oldExt = path.join(asepriteConfigDir(), "extensions", "claude-bridge");
if (fs.existsSync(oldExt)) {
  warn("The old Claude Bridge extension is still installed in Aseprite. It's no longer used:");
  console.log("    in Aseprite, go to Edit > Preferences > Extensions, select Claude Bridge and click Uninstall.");
}

// 3. Connect Claude Code --------------------------------------------------------
const nodeCmd = "node";
const entry = fwd(serverEntry);
const hasClaudeCli = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { stdio: "ignore" }).status === 0;

console.log("\nConnect Claude:\n");
console.log("  Claude Code (CLI or desktop Code tab):");
const addArgs = ["mcp", "add", "--scope", "user", "aseprite", "--", nodeCmd, entry];
if (args.has("--claude-code") && hasClaudeCli) {
  const r = spawnSync("claude", addArgs, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status === 0) ok("Registered with Claude Code (user scope). Start a new session to use it.");
  else warn("`claude mcp add` failed; run the command below manually.");
} else {
  console.log(`    claude ${addArgs.join(" ")}`);
  if (hasClaudeCli) console.log("    (or re-run with `npm run setup -- --claude-code` to do this for you)");
  console.log("    Without the CLI, add this under \"mcpServers\" in ~/.claude.json:");
  console.log(`    "aseprite": { "type": "stdio", "command": "${nodeCmd}", "args": ["${entry}"] }`);
}

console.log('\nThen ask Claude: "Call the aseprite status tool". It should report "aseprite_found": true.\n');
