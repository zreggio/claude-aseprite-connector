import type { HeadlessBridge } from "./headless.js";
import type { LiveBridge } from "./live.js";
import { BridgeError, unwrap } from "./types.js";

/** Commands that can run in headless mode without a working file. */
const NO_FILE_NEEDED = new Set(["status", "new_sprite", "open_sprite"]);

export type Mode = "live" | "headless";

/**
 * Sends commands to the open Aseprite (live) when the extension is connected,
 * otherwise runs them headlessly against the current working file.
 */
export class Router {
  constructor(
    readonly live: LiveBridge,
    readonly headless: HeadlessBridge,
  ) {}

  get mode(): Mode {
    return this.live.connected ? "live" : "headless";
  }

  async call(cmd: string, params: Record<string, unknown> = {}): Promise<any> {
    if (this.live.connected) {
      return unwrap(await this.live.request(cmd, params));
    }
    const fresh = cmd === "new_sprite" || cmd === "open_sprite";
    const file = fresh ? undefined : this.headless.currentFile;
    if (!file && !NO_FILE_NEEDED.has(cmd)) {
      throw new BridgeError(
        "no_sprite",
        "Aseprite isn't connected (headless mode) and no working file is set. Use new_sprite or open_sprite first, or open Aseprite with the Claude Bridge extension enabled.",
      );
    }
    const resp = await this.headless.run([{ cmd, params }], file);
    const r = resp.results?.[0];
    if (!r) throw new BridgeError("headless_failed", "Aseprite returned no result.");
    return unwrap(r);
  }
}
