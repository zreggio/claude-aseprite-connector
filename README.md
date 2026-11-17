# Aseprite Connector for Claude

Let Claude create and edit **2D pixel-art assets** (sprites, icons, items and tiles) in [Aseprite](https://www.aseprite.org/), either live in the open Aseprite window or in the background on `.aseprite` files.

<p align="center">
  <img src="docs/images/chest.png" width="192" alt="32x32 treasure chest">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/images/health-potion.png" width="192" alt="32x32 health potion">
  <br><sub>Example 32×32 assets made with the connector (shown at 6×).</sub>
</p>

**Scope:** static, single-frame pixel art. Animation (frames, tags, timelines) is out of scope.

## How it works

| Part | What it is |
|---|---|
| **MCP server** (`aseprite`) | A Node.js server that gives Claude ~40 tools for drawing, layers, palettes, previews and export. |
| **Claude Bridge** extension | An Aseprite extension that connects to the server so Claude can edit the **open Aseprite window live**. |

```
Claude ──MCP──▶ aseprite-mcp ──┬─ live:     WebSocket 127.0.0.1:47823 ◀── Claude Bridge (inside Aseprite)
                               └─ headless: Aseprite -b --script lua/headless.lua   (edits .aseprite files)
```

- **Live mode.** Aseprite is open with the extension connected. You watch Claude draw, and every tool call is a single **Ctrl+Z** step.
- **Headless mode.** The automatic fallback when Aseprite isn't open. Claude edits `.aseprite` files on disk by running Aseprite in batch mode.

---

## Setup on a new computer

### 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Aseprite 1.3 or newer** | Any edition: Steam, itch.io, aseprite.org, or self-compiled. Tested on 1.3.18. |
| **Node.js 20 or newer** | [nodejs.org](https://nodejs.org/). Check with `node --version`. |
| **Git** | To clone the repository. |
| **Claude** | Claude Code (CLI or the desktop app's Code tab) and/or Claude Desktop (chat). |

**Launch Aseprite once** before setup, then close it. That creates its settings folder, which the extension installer needs.

### 2. Clone and build

```bash
git clone https://github.com/zreggio/claude-aseprite-connector.git
cd claude-aseprite-connector
npm install
npm run setup
```

`npm run setup` does four things:
1. Builds the server and both packages:
   - `dist/index.js`: the MCP server
   - `dist/claude-bridge.aseprite-extension`: the Aseprite extension
   - `dist/aseprite.mcpb`: a one-click bundle for Claude Desktop
2. Finds your Aseprite install.
3. Installs the Claude Bridge extension into Aseprite.
4. Prints the exact commands to connect Claude on this machine.

If the extension wasn't installed automatically, use either method:
- Double-click `dist/claude-bridge.aseprite-extension`.
- In Aseprite, go to **Edit › Preferences › Extensions › Add Extension** and pick that file.

**Restart Aseprite.** A **File › Claude Bridge** menu should appear, and the extension connects automatically.

### 3. Connect Claude

**Claude Code (CLI or desktop Code tab).** Register the server for all your projects. Use the absolute path that `npm run setup` printed:

```bash
claude mcp add --scope user aseprite -- node /absolute/path/to/claude-aseprite-connector/dist/index.js
```

`npm run setup -- --claude-code` runs this for you if the `claude` CLI is on your PATH.

Without the CLI, add this under `"mcpServers"` in `~/.claude.json`:
```json
"aseprite": { "type": "stdio", "command": "node", "args": ["/absolute/path/to/claude-aseprite-connector/dist/index.js"] }
```
Then start a **new** Claude Code session.

**Claude Desktop (chat).** Double-click `dist/aseprite.mcpb`, and Claude Desktop opens its install dialog. That dialog lets you set:
- the Aseprite path (auto-detected when left empty)
- the working folder
- the bridge port
- whether to allow `run_lua`

### 4. Verify

1. Open Aseprite. In Aseprite, **File › Claude Bridge › Status…** shows `connected` once Claude is running.
2. Ask Claude: *"Call the aseprite status tool."* It should report `"mode": "live"`.
3. Ask: *"Make a 32×32 pixel-art sword icon using the PICO-8 palette."*

**First save prompt.** The first time Claude saves or exports a file, Aseprite's Security dialog asks whether the *Claude Bridge* script may write it. To stop being asked:
1. Tick **Give full trust to this script**.
2. Click **Allow Write Access**.

Only `core/handlers/document.lua` writes files: `new_sprite` with a path, `save_sprite` and `export_image`.

### Updating

```bash
git pull
npm install
npm run setup
```
Then restart Aseprite and your Claude app.

### Uninstalling

1. Remove the server from Claude Code with `claude mcp remove --scope user aseprite`, or uninstall the extension in Claude Desktop's settings.
2. In Aseprite, go to **Edit › Preferences › Extensions**, select **Claude Bridge**, and click **Uninstall**.

### Platform notes

**Aseprite auto-detection** looks in these places:

| OS | Locations checked |
|---|---|
| Windows | Steam (`Program Files (x86)\Steam\steamapps\common\Aseprite`), `Program Files\Aseprite` |
| macOS | `/Applications/Aseprite.app`, Steam's `~/Library/Application Support/Steam/...` |
| Linux | `/usr/bin/aseprite`, `/usr/local/bin/aseprite`, `~/.steam/steam/steamapps/common/Aseprite` |

Anywhere else, set `ASEPRITE_PATH`.

**Aseprite settings folder** (where the extension is installed):

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\Aseprite` |
| macOS | `~/Library/Application Support/Aseprite` |
| Linux | `~/.config/aseprite` |

**Steam edition.** Headless mode runs `Aseprite.exe -b` directly. Steam doesn't need to be running.

---

## Configuration

Set these as environment variables on the MCP server. In Claude Code, pass them with `claude mcp add -e KEY=value …`. In Claude Desktop, use the extension's settings.

| Variable | Default | Meaning |
|---|---|---|
| `ASEPRITE_PATH` | auto-detect | Aseprite executable, used for headless mode and palette presets |
| `ASEPRITE_MCP_WORKDIR` | `~/Documents/Aseprite Claude` | Where new and exported files go; relative paths resolve here |
| `ASEPRITE_MCP_PORT` | `47823` | Bridge port; must match the port in Aseprite's **File › Claude Bridge › Status…** |
| `ASEPRITE_MCP_ALLOW_LUA` | off | Set to `1` to expose the `run_lua` escape hatch (arbitrary Lua inside Aseprite) |

---

## Tools

| Group | Tools |
|---|---|
| Session | `status` |
| Document | `new_sprite`, `open_sprite`, `save_sprite`, `export_image`, `resize_sprite`, `canvas_size`, `crop` |
| Inspect | `render_preview` (upscaled PNG with optional grid), `read_pixels` (char grid + legend), `analyze` (stray pixels, color count, off-palette colors…) |
| Draw | `draw_pixel_map` (main tool), `draw_pixels`, `draw_line`, `draw_rect`, `draw_ellipse`, `fill`, `erase`, `replace_color`, `outline`, `draw_gradient` (Bayer-dithered, palette-safe) |
| Transform | `flip`, `rotate`, `shift`, `mirror`, `copy_region` |
| Layers | `list_layers`, `add_layer`, `update_layer`, `delete_layer`, `duplicate_layer`, `merge_down`, `flatten` |
| Palette | `get_palette`, `set_palette`, `add_palette_colors`, `list_palette_presets` (all of Aseprite's bundled palettes), `set_color_mode` |
| Selection | `select` (rect / all / none / color / content); drawing is clipped to the selection |
| History | `undo`, `redo` (live mode only) |
| Power | `batch` (many ops, one undo step, all-or-nothing), `run_lua` (opt-in) |

Every edit tool accepts `preview: true` to return an image of the result.

The server also provides:
- a **`pixel_art_asset`** prompt
- an **`aseprite://guide/pixel-art`** resource, a professional asset workflow covering palette ramps, hue shifting, outlines, shading, and cleanup of jaggies, banding and pillow shading

### `draw_pixel_map` / `read_pixels` format
```json
{ "x": 4, "y": 2,
  "legend": { "o": "#1a1c2c", "r": "#b13e53", "h": "#ef7d57" },
  "rows": ["..oooo..",
           ".orrrro.",
           "orhrrrro",
           ".orrrro.",
           "..oooo.."] }
```
- `.` means "leave unchanged".
- To erase, map a character to `"transparent"`.
- `read_pixels` returns this same format, so Claude can read, modify and write back.

### Colors

- Colors can be `#rrggbb`, `#rrggbbaa`, `transparent`, or a palette index.
- In **indexed** sprites, palette index 0 is reserved for transparency. Hex colors must exist in the palette; use `add_palette_colors` to add them.

---

## Development

```bash
npm run build            # compile TypeScript → dist/
npm test                 # build + unit tests + headless end-to-end tests (needs Aseprite, ~30s)
npm run test:unit        # unit tests only (no Aseprite needed)
npm run package          # build + .aseprite-extension + .mcpb
npm run install:extension  # copy lua/ into Aseprite's extensions folder (restart Aseprite after)
npm run inspect          # MCP Inspector, to call tools by hand
node tests/live/live-e2e.mjs        # live check: run, then open Aseprite (close other Claude sessions first)
node tests/live/sample-potion.mjs   # draws the sample potion through the connector
```

| Path | Contents |
|---|---|
| `src/` | MCP server: config, tool definitions, preview rendering, prompts |
| `src/bridge/` | Transports: `live.ts` (WebSocket), `headless.ts` (batch mode), `router.ts` |
| `lua/core/` | Shared Lua command core used by both modes (`handlers/*.lua`) |
| `lua/extension/` | The Aseprite extension (`main.lua`, `package.json`) |
| `lua/headless.lua` | Batch-mode runner |
| `scripts/` | Packaging, extension install and setup |
| `tests/` | Unit tests, headless end-to-end tests, live checks |

After changing anything in `lua/`:
1. Run `npm run install:extension`.
2. Restart Aseprite.

### Protocol

The extension is a WebSocket **client**, because Aseprite's Lua API only offers a client.

| From | Message |
|---|---|
| Lua → server | `{"type":"hello","bridge_version","aseprite_version","api_version"}` |
| Server → Lua | `{"type":"welcome","allow_lua","server_version"}` |
| Server → Lua (request) | `{"id","cmd","params"}` |
| Lua → server (reply) | `{"id","ok":true,"result"}` or `{"id","ok":false,"error":{"code","message"}}` |

Mutating commands run inside `app.transaction`, so a failed command rolls back everything it changed.

### Security

- The bridge listens on `127.0.0.1` only.
- It rejects handshakes from web pages: browsers always send an `http(s)://` or `null` Origin, while Aseprite's client sends `ws://…`.
- `run_lua` is off unless enabled.

---

## Troubleshooting

- **`status` says headless while Aseprite is open.**
  - Open **File › Claude Bridge › Status…** in Aseprite and check that the port matches.
  - Only one Claude app can own the port at a time. A second one (e.g. Claude Desktop while Claude Code is running) falls back to headless, and `status` explains why.
- **The File › Claude Bridge menu is missing.**
  - Check that the extension is listed and enabled in **Edit › Preferences › Extensions**.
  - Restart Aseprite after installing.
- **A tool call times out.** A dialog in Aseprite (usually the Security prompt) is probably waiting for you.
- **"Aseprite executable was not found".** Set `ASEPRITE_PATH`, or open Aseprite with the extension so live mode is used.
- **Selections in headless mode.** Aseprite doesn't save selections in `.aseprite` files, so headless mode keeps them in a sprite property between calls.

## License

[MIT](LICENSE)
