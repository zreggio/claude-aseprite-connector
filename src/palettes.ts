import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PalettePreset {
  id: string;
  extension: string;
  file: string;
  colors?: string[];
}

function userExtensionsDir(): string | undefined {
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "Aseprite", "extensions");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Aseprite", "extensions");
  return path.join(os.homedir(), ".config", "aseprite", "extensions");
}

/** Parse a GIMP .gpl palette into hex colors. */
export function parseGpl(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^(GIMP|Name:|Columns:|Channels:)/i.test(line)) continue;
    const m = line.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(\d{1,3}))?/);
    if (!m) continue;
    const hex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
    let c = `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    // RGBA .gpl variants carry a 4th channel; keep it only when not opaque.
    if (m[4] !== undefined && Number(m[4]) < 255 && /Channels:\s*RGBA/i.test(text)) c += hex(m[4]);
    out.push(c);
  }
  return out;
}

let cache: PalettePreset[] | undefined;

/** Palettes contributed by Aseprite's bundled and user-installed extensions. */
export function listPalettePresets(asepritePath: string | undefined): PalettePreset[] {
  if (cache) return cache;
  const roots: string[] = [];
  if (asepritePath) {
    const base = process.platform === "darwin" ? path.resolve(path.dirname(asepritePath), "..", "Resources") : path.dirname(asepritePath);
    roots.push(path.join(base, "data", "extensions"));
  }
  const user = userExtensionsDir();
  if (user) roots.push(user);
  const presets: PalettePreset[] = [];
  for (const root of roots) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const pkgPath = path.join(root, d, "package.json");
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        for (const p of pkg?.contributes?.palettes ?? []) {
          if (!p?.id || !p?.path) continue;
          presets.push({ id: String(p.id), extension: String(pkg.displayName ?? pkg.name ?? d), file: path.resolve(root, d, p.path) });
        }
      } catch {
        /* not an extension folder */
      }
    }
  }
  cache = presets;
  return presets;
}

export function findPreset(asepritePath: string | undefined, id: string): PalettePreset | undefined {
  const all = listPalettePresets(asepritePath);
  return all.find((p) => p.id === id) ?? all.find((p) => p.id.toLowerCase() === id.toLowerCase());
}

/** Hex colors of a preset (only .gpl files are parsed; others return undefined). */
export function presetColors(preset: PalettePreset): string[] | undefined {
  if (preset.colors) return preset.colors;
  if (!/\.gpl$/i.test(preset.file)) return undefined;
  try {
    preset.colors = parseGpl(fs.readFileSync(preset.file, "utf8"));
    return preset.colors;
  } catch {
    return undefined;
  }
}
