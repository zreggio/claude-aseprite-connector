import { PNG } from "pngjs";

export interface PreviewOptions {
  /** Integer upscale factor; auto when omitted (target ~512px on the long side). */
  scale?: number;
  /** Draw a guide line every N sprite pixels (e.g. 8 or 16). */
  grid?: number;
  /** Draw a faint line between every pixel (only when scale >= 6). */
  pixelGrid?: boolean;
  /** "checker" (default) or a hex color to show behind transparent pixels. */
  background?: string;
}

export const MAX_PREVIEW_SIDE = 2048;

export function autoScale(w: number, h: number, requested?: number): number {
  const longSide = Math.max(w, h, 1);
  const maxScale = Math.max(1, Math.floor(MAX_PREVIEW_SIDE / longSide));
  if (requested && requested >= 1) return Math.min(Math.floor(requested), maxScale);
  return Math.max(1, Math.min(maxScale, 32, Math.floor(512 / longSide) || 1));
}

function parseHex(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Upscale raw RGBA pixels with nearest-neighbour, composite over a checkerboard
 * (or solid colour) and optionally overlay grid lines. Returns PNG bytes.
 */
export function renderPreview(rgba: Buffer, width: number, height: number, opts: PreviewOptions = {}) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Pixel buffer is ${rgba.length} bytes, expected ${width * height * 4}`);
  }
  const scale = autoScale(width, height, opts.scale);
  const W = width * scale;
  const H = height * scale;
  const png = new PNG({ width: W, height: H });
  const solid = opts.background && opts.background !== "checker" ? parseHex(opts.background) : undefined;
  const cell = Math.max(4, Math.min(16, scale * 2));
  const gridEvery = opts.grid && opts.grid > 0 ? Math.floor(opts.grid) : 0;
  const pixelGrid = opts.pixelGrid && scale >= 6;

  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const sx = Math.floor(x / scale);
      const si = (sy * width + sx) * 4;
      const a = rgba[si + 3] / 255;
      let br: number, bg: number, bb: number;
      if (solid) [br, bg, bb] = solid;
      else {
        const light = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        br = bg = bb = light ? 204 : 153;
      }
      let r = Math.round(rgba[si] * a + br * (1 - a));
      let g = Math.round(rgba[si + 1] * a + bg * (1 - a));
      let b = Math.round(rgba[si + 2] * a + bb * (1 - a));

      const onPixelLine = pixelGrid && (x % scale === 0 || y % scale === 0);
      const onGuide = gridEvery > 0 && ((x % (gridEvery * scale) === 0 && x > 0) || (y % (gridEvery * scale) === 0 && y > 0));
      if (onGuide) {
        // 60% magenta: visible on any art.
        r = Math.round(r * 0.4 + 255 * 0.6);
        g = Math.round(g * 0.4);
        b = Math.round(b * 0.4 + 255 * 0.6);
      } else if (onPixelLine) {
        r = Math.round(r * 0.75);
        g = Math.round(g * 0.75);
        b = Math.round(b * 0.75);
      }
      const di = (y * W + x) * 4;
      png.data[di] = r;
      png.data[di + 1] = g;
      png.data[di + 2] = b;
      png.data[di + 3] = 255;
    }
  }
  return { png: PNG.sync.write(png), scale, width: W, height: H };
}
