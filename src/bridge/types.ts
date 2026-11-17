/** Envelope every Lua command returns. */
export type LuaResult =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface LuaOp {
  cmd: string;
  params?: Record<string, unknown>;
}

/** Error raised when Aseprite reports a command failure (or the bridge itself fails). */
export class BridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function unwrap(r: LuaResult): any {
  if (r.ok) return r.result;
  throw new BridgeError(r.error.code, r.error.message, r.error.details);
}

export interface HelloInfo {
  bridge_version?: string;
  aseprite_version?: string;
  api_version?: number;
}
