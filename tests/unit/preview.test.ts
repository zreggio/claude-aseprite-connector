import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { autoScale, renderPreview } from "../../src/render/preview.js";

describe("preview rendering", () => {
  it("auto-scales small sprites to ~512px", () => {
    expect(autoScale(16, 16)).toBe(32);
    expect(autoScale(32, 32)).toBe(16);
    expect(autoScale(64, 32)).toBe(8);
    expect(autoScale(1024, 1024)).toBe(1);
  });

  it("caps requested scale at 2048px output", () => {
    expect(autoScale(256, 256, 64)).toBe(8);
  });

  it("upscales nearest-neighbour and composites transparency over a checkerboard", () => {
    // 2x1: opaque red, fully transparent
    const rgba = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]);
    const out = renderPreview(rgba, 2, 1, { scale: 4 });
    const png = PNG.sync.read(out.png);
    expect(png.width).toBe(8);
    expect(png.height).toBe(4);
    const px = (x: number, y: number) => Array.from(png.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(3, 3)).toEqual([255, 0, 0, 255]);
    const t = px(4, 0);
    expect(t[0]).toBe(t[1]); // grey checker
    expect([204, 153]).toContain(t[0]);
  });

  it("uses a solid background colour when asked", () => {
    const out = renderPreview(Buffer.from([0, 0, 0, 0]), 1, 1, { scale: 2, background: "#00ff00" });
    const png = PNG.sync.read(out.png);
    expect(Array.from(png.data.subarray(0, 4))).toEqual([0, 255, 0, 255]);
  });

  it("rejects a mismatched buffer", () => {
    expect(() => renderPreview(Buffer.alloc(3), 1, 1)).toThrow();
  });
});
