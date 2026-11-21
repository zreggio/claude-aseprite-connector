import type { HeadlessBridge } from "./headless.js";
import { BridgeError, unwrap } from "./types.js";

/** Commands that can run without a working file. */
const NO_FILE_NEEDED = new Set(["status", "new_sprite", "open_sprite"]);

/** Runs each command in a background Aseprite process against the current working file. */
export class Router {
  constructor(readonly headless: HeadlessBridge) {}

  async call(cmd: string, params: Record<string, unknown> = {}): Promise<any> {
    const fresh = cmd === "new_sprite" || cmd === "open_sprite";
    const file = fresh ? undefined : this.headless.currentFile;
    if (!file && !NO_FILE_NEEDED.has(cmd)) {
      throw new BridgeError("no_sprite", "No working file is set. Use new_sprite or open_sprite first.");
    }
    const resp = await this.headless.run([{ cmd, params }], file);
    const r = resp.results?.[0];
    if (!r) throw new BridgeError("headless_failed", "Aseprite returned no result.");
    return unwrap(r);
  }
}
