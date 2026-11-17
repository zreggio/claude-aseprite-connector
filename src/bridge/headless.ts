import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeError, type LuaOp, type LuaResult } from "./types.js";

export interface HeadlessResponse {
  results: LuaResult[];
  file?: string;
  saved?: boolean;
}

/**
 * Runs commands by launching Aseprite in batch mode (-b) with lua/headless.lua.
 * Each run opens the working file, applies the ops, and saves it.
 * Runs are serialized so two tool calls never edit the same file concurrently.
 */
export class HeadlessBridge {
  currentFile?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private tmpDir = path.join(os.tmpdir(), "aseprite-mcp");

  constructor(
    private readonly asepritePath: string | undefined,
    private readonly luaDir: string,
    private readonly timeoutMs: number,
    private readonly allowLua: boolean,
  ) {}

  get available(): boolean {
    return !!this.asepritePath && existsSync(this.asepritePath);
  }

  run(ops: LuaOp[], file: string | undefined = this.currentFile): Promise<HeadlessResponse> {
    const job = this.queue.then(() => this.exec(ops, file));
    this.queue = job.catch(() => {});
    return job;
  }

  private async exec(ops: LuaOp[], file: string | undefined): Promise<HeadlessResponse> {
    if (!this.available) {
      throw new BridgeError(
        "aseprite_not_found",
        "Aseprite is not connected and its executable was not found for headless mode. Open Aseprite with the Claude Bridge extension, or set ASEPRITE_PATH.",
      );
    }
    await fs.mkdir(this.tmpDir, { recursive: true });
    const id = crypto.randomUUID();
    const reqPath = path.join(this.tmpDir, `${id}-req.json`);
    const respPath = path.join(this.tmpDir, `${id}-resp.json`);
    await fs.writeFile(reqPath, JSON.stringify({ file: file ?? null, ops, allow_lua: this.allowLua }), "utf8");
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          this.asepritePath!,
          [
            "-b",
            "--script-param",
            `request=${reqPath}`,
            "--script-param",
            `response=${respPath}`,
            "--script",
            path.join(this.luaDir, "headless.lua"),
          ],
          { timeout: this.timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
          (err, _stdout, stderr) => {
            if (err && !existsSync(respPath)) {
              reject(new BridgeError("headless_failed", `Aseprite batch run failed: ${err.message}${stderr ? `\n${stderr}` : ""}`));
            } else resolve();
          },
        );
      });
      let text: string;
      try {
        text = await fs.readFile(respPath, "utf8");
      } catch {
        throw new BridgeError("headless_failed", "Aseprite exited without writing a response (the script may have crashed).");
      }
      const resp = JSON.parse(text) as HeadlessResponse;
      if (resp.file && /\.(aseprite|ase)$/i.test(resp.file) && path.isAbsolute(resp.file)) {
        this.currentFile = resp.file;
      }
      return resp;
    } finally {
      await Promise.allSettled([fs.rm(reqPath, { force: true }), fs.rm(respPath, { force: true })]);
    }
  }
}
