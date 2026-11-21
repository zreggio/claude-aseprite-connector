import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { BridgeError } from "./bridge/types.js";

export type ShowMethod = "file_association" | "macos_open" | "new_process";

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20_000, env: env ?? process.env }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** The program Windows opens a file extension with, e.g. `"C:\...\Aseprite.EXE"`; undefined if none. */
async function windowsOpenCommand(ext: string): Promise<string | undefined> {
  const assoc = await run("reg", ["query", `HKCR\\${ext}`, "/ve"]);
  const progId = /REG_SZ\s+(\S.*)$/m.exec(assoc.stdout)?.[1]?.trim();
  if (assoc.code !== 0 || !progId) return undefined;
  const cmd = await run("reg", ["query", `HKCR\\${progId}\\shell\\open\\command`, "/ve"]);
  return cmd.code === 0 ? /REG_SZ\s+(\S.*)$/m.exec(cmd.stdout)?.[1]?.trim() : undefined;
}

function launchDetached(exe: string, args: string[]) {
  const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => {});
  child.unref();
}

/**
 * Open a file in the Aseprite app the user sees.
 *
 * - Windows: .aseprite/.ase files go through the file association when it points at Aseprite.
 *   Aseprite registers a DDE "open" handler, so the file opens as a new tab in an Aseprite
 *   window that's already running, or starts Aseprite if none is.
 * - macOS: `open -a` hands the file to the running Aseprite app, or starts it.
 * - Otherwise (Linux, PNGs on Windows, no association): starts a new Aseprite process with the file.
 */
export async function showInAseprite(file: string, asepritePath: string | undefined): Promise<ShowMethod> {
  const ext = path.extname(file).toLowerCase();

  if (process.platform === "win32" && (ext === ".aseprite" || ext === ".ase")) {
    const command = await windowsOpenCommand(ext);
    if (command && /aseprite[^\\/]*\.exe/i.test(command)) {
      // Start-Process uses ShellExecute, which performs the DDE handshake with a running Aseprite.
      const r = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:ASEPRITE_SHOW_FILE"],
        { ...process.env, ASEPRITE_SHOW_FILE: file },
      );
      if (r.code === 0) return "file_association";
    }
  }

  if (!asepritePath) {
    throw new BridgeError("aseprite_not_found", "The Aseprite executable was not found. Set ASEPRITE_PATH to it.");
  }

  if (process.platform === "darwin") {
    const app = /^(.*?\.app)(\/|$)/.exec(asepritePath)?.[1];
    if (app) {
      const r = await run("open", ["-a", app, file]);
      if (r.code === 0) return "macos_open";
    }
  }

  launchDetached(asepritePath, [file]);
  return "new_process";
}
