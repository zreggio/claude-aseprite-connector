export const SERVER_INSTRUCTIONS = `Aseprite connector: create and edit static 2D pixel-art assets in Aseprite (single frame; no animation).

How it works
- Call \`status\` first. mode "live" = you are editing the user's open Aseprite window (each tool call is one Ctrl+Z step). mode "headless" = edits are applied to an .aseprite file on disk.
- Coordinates are sprite pixels, origin top-left. Colors are '#rrggbb', '#rrggbbaa', 'transparent' or a palette index.
- \`draw_pixel_map\` is the main drawing tool (text rows + legend). \`read_pixels\` returns the same format, so you can read, edit and write back.
- Look at your work often with \`render_preview\`; check it with \`analyze\` before finishing.
- Use \`batch\` to apply many edits in one round trip and one undo step.
- Work in layers (e.g. Outline / Base / Shading / Highlights) and keep a small fixed palette.
- Read the resource aseprite://guide/pixel-art (or use the pixel_art_asset prompt) for the full asset workflow.`;

export const PIXEL_ART_GUIDE = `# Pixel-art asset workflow (Aseprite connector)

## 1. Plan the asset
- **Canvas**: pick the smallest size that reads well at game scale. Icons/items 16x16 or 32x32, characters 16x16 to 64x64, tiles 16x16 or 32x32 (keep tiles seamless with \`shift\` + wrap).
- **Palette**: choose a fixed palette before drawing (\`list_palette_presets\`). 8-32 colors is plenty. Build *ramps* (dark → light) per material: 3-5 steps each.
- **Hue shifting**: shadows shift toward cool/purple/blue and get more saturated; highlights shift toward warm/yellow and get less saturated. Avoid ramps that only change brightness.
- **Light source**: decide one (usually top-left) and stay consistent across a set of assets.

## 2. Block in the silhouette
- New layer "Base". Fill the silhouette with one mid-tone per material using \`draw_pixel_map\`.
- \`render_preview\` at 1x-scale thinking: is the shape instantly readable as a black silhouette? Fix the shape before adding detail.
- For symmetric objects draw half, then \`mirror\`.

## 3. Outline
- Use a dark, saturated hue (not pure black) or a darker shade of each material ("selective outline": darker where in shadow, lighter or missing where lit).
- \`outline\` (mode outside, corners false) gives a clean 1px outline. Put it on its own layer so it can be recolored.
- **Clean lines**: avoid "jaggies" (irregular steps). Slopes should use consistent segment lengths (1-1-1, 2-2-2, 1-2-1-2...). Avoid L-shaped "doubles" (pixels touching both orthogonally and diagonally in a line).

## 4. Shading
- New layer "Shading". Shade with the next-darker ramp color on the side away from the light, following the form (cylinders get bands, spheres get crescents).
- **Avoid pillow shading** (dark edges all around, light in the centre); shade from the light direction.
- **Avoid banding** (parallel stair-stepped lines of adjacent ramp colors that follow the outline).
- Dithering (\`draw_gradient\` with only_opaque) suits large flat areas, skies and retro styles; use it sparingly on small sprites.

## 5. Highlights and detail
- New layer "Highlights": the lightest ramp color on edges facing the light; a few single-pixel specular glints on shiny materials.
- Add an inner light rim or a few accent colors for focus. Remove anything that doesn't read at 1x.

## 6. Cleanup
- \`analyze\`: remove stray isolated pixels, merge near-duplicate colors, keep everything on the palette.
- Check the preview at small scale; small sprites must read at native size.
- Anti-aliasing (intermediate colors on curve steps) only between interior colors, never against transparency for game sprites.

## 7. Deliver
- \`save_sprite\` (keeps layers) and \`export_image\` (PNG, scale 1 for the game; scale 4-8 for showcase). Use \`trim\` for tight bounds if the engine expects it.
- Color variants: \`duplicate_layer\` / \`replace_color\` (e.g. red → blue potion).

## Reading/writing pixels
\`\`\`
draw_pixel_map { x: 4, y: 2, legend: { "o": "#1a1c2c", "r": "#b13e53", "h": "#ef7d57" },
  rows: [ "..oooo..",
          ".orrrro.",
          "orhrrrro",
          "orrrrrro",
          ".orrrro.",
          "..oooo.." ] }
\`\`\`
'.' = leave unchanged. Map a character to "transparent" to erase.
`;

export function assetPrompt(args: { asset: string; size?: string; palette?: string; style?: string }): string {
  return `Create a pixel-art game asset in Aseprite using the aseprite tools.

Asset: ${args.asset}
Canvas size: ${args.size ?? "choose an appropriate size (e.g. 32x32)"}
Palette: ${args.palette ?? "choose a fitting preset (list_palette_presets) or a small custom palette with hue-shifted ramps"}
Style: ${args.style ?? "clean, readable, game-ready pixel art with a top-left light source"}

Process:
1. Call status. Create the sprite with new_sprite (transparent background) and set the palette.
2. Add layers: Base, Outline, Shading, Highlights.
3. Block the silhouette on Base with draw_pixel_map; render_preview and refine the shape until it reads clearly.
4. Outline (outside, 1px, dark hue-shifted color; selective outline where lit).
5. Shade away from the light following the form; avoid pillow shading and banding.
6. Add highlights and a few accent details; remove anything that doesn't read at 1x.
7. Run analyze, fix stray pixels and off-palette colors, render_preview a final time.
8. save_sprite, then export_image as PNG (scale 1, plus a scale 4 showcase copy).

Follow the guide at aseprite://guide/pixel-art. Show me the final preview and summarize the palette and layer structure.`;
}
