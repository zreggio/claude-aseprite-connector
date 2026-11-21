import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  /** Path to the Aseprite executable (runs every command and supplies palette presets). */
  asepritePath: string | undefined;
  /** Whether the run_lua tool is exposed. */
  allowLua: boolean;
  /** Default folder for new/saved/exported files; relative paths resolve here. */
  workdir: string;
  /** Folder containing headless.lua and core/. */
  luaDir: string;
  /** Timeout for one headless Aseprite process. */
  headlessTimeoutMs: number;
}

function candidateAsepritePaths(): string[] {
  const list: string[] = [];
  if (process.platform === "win32") {
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    list.push(
      path.join(pf86, "Steam", "steamapps", "common", "Aseprite", "Aseprite.exe"),
      path.join(pf, "Steam", "steamapps", "common", "Aseprite", "Aseprite.exe"),
      path.join(pf, "Aseprite", "Aseprite.exe"),
      path.join(pf86, "Aseprite", "Aseprite.exe"),
    );
  } else if (process.platform === "darwin") {
    list.push(
      "/Applications/Aseprite.app/Contents/MacOS/aseprite",
      path.join(os.homedir(), "Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite"),
    );
  } else {
    list.push(
      "/usr/bin/aseprite",
      "/usr/local/bin/aseprite",
      path.join(os.homedir(), ".steam/steam/steamapps/common/Aseprite/aseprite"),
    );
  }
  return list;
}

export function findAseprite(explicit?: string): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  return candidateAsepritePaths().find((p) => fs.existsSync(p));
}

function truthy(v: string | undefined): boolean {
  return v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());
}

/** Locate the lua/ folder: next to dist/ in the repo. */
function findLuaDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "..", "lua"), path.resolve(here, "lua"), path.resolve(here, "..", "..", "lua")];
  return candidates.find((c) => fs.existsSync(path.join(c, "headless.lua"))) ?? candidates[0];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const workdir = env.ASEPRITE_MCP_WORKDIR?.trim()
    ? path.resolve(env.ASEPRITE_MCP_WORKDIR.trim())
    : path.join(os.homedir(), "Documents", "Aseprite Claude");
  return {
    asepritePath: findAseprite(env.ASEPRITE_PATH),
    allowLua: truthy(env.ASEPRITE_MCP_ALLOW_LUA),
    workdir,
    luaDir: findLuaDir(),
    headlessTimeoutMs: 120_000,
  };
}
