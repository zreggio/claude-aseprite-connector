import { describe, expect, it } from "vitest";
import { parseGpl } from "../../src/palettes.js";
import { findAseprite } from "../../src/config.js";
import { listPalettePresets, presetColors } from "../../src/palettes.js";

describe("palettes", () => {
  it("parses GIMP .gpl files", () => {
    const gpl = "GIMP Palette\nName: test\nColumns: 4\n#\n  0   0   0\tBlack\n255 128  15 Orange\n";
    expect(parseGpl(gpl)).toEqual(["#000000", "#ff800f"]);
  });

  it.skipIf(!findAseprite())("finds Aseprite's bundled presets", () => {
    const presets = listPalettePresets(findAseprite());
    const db32 = presets.find((p) => p.id === "DB32");
    expect(db32).toBeDefined();
    expect(presetColors(db32!)).toHaveLength(32);
    expect(presets.find((p) => p.id === "PICO-8")).toBeDefined();
  });
});
