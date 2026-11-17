// One-step setup after `npm run package` (run via `npm run setup`):
//  1. checks Node and finds Aseprite
//  2. installs the Claude Bridge extension into Aseprite (if Aseprite has been run once)
//  3. prints (or runs, with --claude-code) the commands that connect Claude
import { execFileSync, spawnSync } from "node:child_process";
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
  console.error("  ✖ dist/index.js is missing. Run `npm run setup` (or `npm run package` first).");
  process.exit(1);
}
ok(`MCP server built: ${fwd(serverEntry)}`);

const { findAseprite } = await import(pathToFileURL(path.join(root, "dist", "config.js")).href);
const aseprite = findAseprite(process.env.ASEPRITE_PATH);
if (aseprite) ok(`Aseprite found: ${aseprite}`);
else warn("Aseprite not found automatically. Set ASEPRITE_PATH to its executable (needed for headless mode and palette presets).");

// 2. Aseprite extension --------------------------------------------------------
function asepriteConfigDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Aseprite");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Aseprite");
  return path.join(os.homedir(), ".config", "aseprite");
}
const cfgDir = asepriteConfigDir();
const extFile = path.join(root, "dist", "claude-bridge.aseprite-extension");
if (args.has("--skip-extension")) {
  warn("Skipped installing the Aseprite extension (--skip-extension).");
} else if (fs.existsSync(cfgDir)) {
  execFileSync(process.execPath, [path.join(root, "scripts", "install-extension.mjs")], { stdio: "pipe" });
  ok(`Claude Bridge extension installed in ${fwd(path.join(cfgDir, "extensions", "claude-bridge"))}`);
  console.log("    Restart Aseprite to load it (File > Claude Bridge appears in the menu).");
} else {
  warn(`Aseprite's settings folder doesn't exist yet (${cfgDir}).`);
  console.log("    Launch Aseprite once, then either run `npm run install:extension`,");
  console.log(`    or double-click ${fwd(extFile)}.`);
}

// 3. Connect Claude -------------------------------------------------------------
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

console.log("\n  Claude Desktop (chat):");
console.log(`    Double-click ${fwd(path.join(root, "dist", "aseprite.mcpb"))} (Claude Desktop opens an install dialog)`);

console.log("\nThen open Aseprite and ask Claude: \"Call the aseprite status tool\" — it should report mode \"live\".\n");
