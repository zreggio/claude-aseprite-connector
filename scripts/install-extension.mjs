// Developer install: copies the Claude Bridge extension (unzipped) into
// Aseprite's user extensions folder. Restart Aseprite afterwards.
// End users can instead double-click dist/claude-bridge.aseprite-extension.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function configDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Aseprite");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Aseprite");
  return path.join(os.homedir(), ".config", "aseprite");
}

const cfg = configDir();
if (!fs.existsSync(cfg)) {
  console.error(`Aseprite's config folder doesn't exist yet (${cfg}). Launch Aseprite once, close it, then run this again.`);
  process.exit(1);
}
const dest = path.join(cfg, "extensions", "claude-bridge");
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(root, "lua", "extension"), dest, { recursive: true });
fs.cpSync(path.join(root, "lua", "core"), path.join(dest, "core"), { recursive: true });
console.log(`Installed Claude Bridge to ${dest}. Restart Aseprite to load it.`);
