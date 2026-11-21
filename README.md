# Aseprite Connector for Claude Code

Let [Claude Code](https://claude.com/claude-code) create and edit **2D pixel-art assets** (sprites, icons, items and tiles) as [Aseprite](https://www.aseprite.org/) files.

**Built for Claude Code**: the CLI, the desktop app's Code tab, or the IDE extensions. The connector is not packaged for Claude Desktop's chat.

<p align="center">
  <img src="docs/images/chest.png" width="192" alt="32x32 treasure chest">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/images/health-potion.png" width="192" alt="32x32 health potion">
  <br><sub>Example 32×32 assets made with the connector (shown at 6×).</sub>
</p>

**Scope:** static, single-frame pixel art. Animation (frames, tags, timelines) is out of scope.

## How it works

The connector is an **MCP server** (`aseprite`): a Node.js server that gives Claude ~40 tools for drawing, layers, palettes, previews and export. Nothing needs to be installed inside Aseprite.

```
Claude Code ──MCP──▶ aseprite-mcp ──▶ Aseprite -b --script lua/headless.lua   (edits .aseprite files)
```

- For every tool call, the server runs Aseprite in the background (batch mode, no window) on the current `.aseprite` file and saves the result.
- Claude sees its work through `render_preview`, which returns an image of the sprite.
- To see the result in Aseprite, ask Claude to **"show me this in Aseprite"**. It opens the file as a new tab in your Aseprite window, or starts Aseprite if it isn't running (see [`show_in_aseprite`](#show_in_aseprite)).
- If the file is already open in Aseprite, close its tab first: Aseprite doesn't reload files changed on disk.

> **Don't edit the same file in two places.** If you save a file in Aseprite while Claude is working on it, your save overwrites Claude's changes (and the other way round).

---

## Setup on a new computer

### 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Aseprite 1.3 or newer** | Any edition: Steam, itch.io, aseprite.org, or self-compiled. Tested on 1.3.18. |
| **Node.js 20 or newer** | [nodejs.org](https://nodejs.org/). Check with `node --version`. |
| **Git** | To clone the repository. |
| **Claude Code** | The CLI, the desktop app's Code tab, or an IDE extension. |

### 2. Clone and build

```bash
git clone https://github.com/zreggio/claude-aseprite-connector.git
cd claude-aseprite-connector
npm install
npm run setup
```

`npm run setup` does three things:
1. Builds the MCP server into `dist/index.js`.
2. Finds your Aseprite install. If it can't, set `ASEPRITE_PATH` (see [Configuration](#configuration)).
3. Prints the exact command to connect Claude Code on this machine.

### 3. Connect Claude Code

Register the server for all your projects. Use the absolute path that `npm run setup` printed:

```bash
claude mcp add --scope user aseprite -- node /absolute/path/to/claude-aseprite-connector/dist/index.js
```

`npm run setup -- --claude-code` runs this for you if the `claude` CLI is on your PATH.

Without the CLI, add this under `"mcpServers"` in `~/.claude.json`:
```json
"aseprite": { "type": "stdio", "command": "node", "args": ["/absolute/path/to/claude-aseprite-connector/dist/index.js"] }
```
Then start a **new** Claude Code session.

### 4. Verify

1. Ask Claude: *"Call the aseprite status tool."* It should report `"aseprite_found": true`.
2. Ask: *"Make a 32×32 pixel-art sword icon using the PICO-8 palette."*
3. Ask: *"Show me this in Aseprite."* The sprite should open in Aseprite.

### Updating

New features and fixes are added to the `main` branch on GitHub. To get them, pull the changes into your clone, rebuild, then start a new Claude Code session.

#### 1. Check for updates

In your clone (the `claude-aseprite-connector` folder), run:

```bash
git fetch
git log --oneline HEAD..origin/main
```

If nothing is listed, you're up to date. Otherwise, each line is a change you don't have yet.

#### 2. Pull and rebuild

```bash
git pull
npm install
npm run setup
```

- `git pull` downloads the latest code.
- `npm install` picks up any new or updated dependencies.
- `npm run setup` rebuilds the server.

**If `git pull` refuses** because you have local changes, either set them aside with `git stash` (bring them back later with `git stash pop`) or discard them with `git checkout -- .`. Then run `git pull` again.

#### 3. Apply the update

Start a **new** Claude Code session. Sessions that were already open keep running the old server. There's no need to re-register it, since its path hasn't changed.

#### 4. Check it worked

Ask Claude to *"call the aseprite status tool"*. It should report `"aseprite_found": true`. If anything misbehaves after an update, see [Troubleshooting](#troubleshooting).

#### Updating from a version with the Claude Bridge extension

Earlier versions also installed a **Claude Bridge** extension into Aseprite. It's no longer used, and `npm run setup` warns you if it's still there. To remove it, in Aseprite go to **Edit › Preferences › Extensions**, select **Claude Bridge**, and click **Uninstall**.

### Uninstalling

Remove the server from Claude Code:

```bash
claude mcp remove --scope user aseprite
```

Then delete your clone of the repository.

### Platform notes

**Aseprite auto-detection** looks in these places:

| OS | Locations checked |
|---|---|
| Windows | Steam (`Program Files (x86)\Steam\steamapps\common\Aseprite`), `Program Files\Aseprite` |
| macOS | `/Applications/Aseprite.app`, Steam's `~/Library/Application Support/Steam/...` |
| Linux | `/usr/bin/aseprite`, `/usr/local/bin/aseprite`, `~/.steam/steam/steamapps/common/Aseprite` |

Anywhere else, set `ASEPRITE_PATH`.

**Steam edition.** The server runs `Aseprite.exe -b` directly. Steam doesn't need to be running.

---

## Configuration

Set these as environment variables on the MCP server. Pass them with `claude mcp add -e KEY=value …`, or in the `"env"` field of the server's entry in `~/.claude.json`.

| Variable | Default | Meaning |
|---|---|---|
| `ASEPRITE_PATH` | auto-detect | Aseprite executable; runs every command and supplies palette presets |
| `ASEPRITE_MCP_WORKDIR` | `~/Documents/Aseprite Claude` | Where new and exported files go; relative paths resolve here |
| `ASEPRITE_MCP_ALLOW_LUA` | off | Set to `1` to expose the `run_lua` escape hatch (arbitrary Lua inside Aseprite) |

---

## Tools

| Group | Tools |
|---|---|
| Session | `status` |
| Document | `new_sprite`, `open_sprite`, `show_in_aseprite`, `save_sprite`, `export_image`, `resize_sprite`, `canvas_size`, `crop` |
| Inspect | `render_preview` (upscaled PNG with optional grid), `read_pixels` (char grid + legend), `analyze` (stray pixels, color count, off-palette colors…) |
| Draw | `draw_pixel_map` (main tool), `draw_pixels`, `draw_line`, `draw_rect`, `draw_ellipse`, `fill`, `erase`, `replace_color`, `outline`, `draw_gradient` (Bayer-dithered, palette-safe) |
| Transform | `flip`, `rotate`, `shift`, `mirror`, `copy_region` |
| Layers | `list_layers`, `add_layer`, `update_layer`, `delete_layer`, `duplicate_layer`, `merge_down`, `flatten` |
| Palette | `get_palette`, `set_palette`, `add_palette_colors`, `list_palette_presets` (all of Aseprite's bundled palettes), `set_color_mode` |
| Selection | `select` (rect / all / none / color / content); drawing is clipped to the selection |
| Power | `batch` (many ops in one call, all-or-nothing), `run_lua` (opt-in) |

Every edit tool accepts `preview: true` to return an image of the result.

There is no undo: each call is saved to the file straight away. Ask Claude to `save_sprite` a copy before big changes if you want to be able to go back.

### `show_in_aseprite`

Opens a file in the Aseprite app so you can see it. It's what Claude uses when you say *"show me this in Aseprite"*. Without a path, it shows the file Claude is working on.

| Platform | What happens |
|---|---|
| Windows | `.aseprite`/`.ase` files open through Windows' file association, which Aseprite registers. If Aseprite is already running, the file opens as a **new tab in that window**; otherwise Aseprite starts. PNGs, or a missing association, start a new Aseprite window instead. |
| macOS | `open -a Aseprite`, which hands the file to the running app (a new tab) or starts Aseprite. Not yet tested on a Mac. |
| Linux | Starts a new Aseprite window with the file. |

If the file is already open in Aseprite, Aseprite keeps showing the copy it loaded earlier. Close that tab and ask again to see Claude's latest changes.

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
npm run inspect          # MCP Inspector, to call tools by hand
```

| Path | Contents |
|---|---|
| `src/` | MCP server: config, tool definitions, preview rendering, prompts |
| `src/bridge/` | `headless.ts` (runs Aseprite in batch mode), `router.ts` (tracks the working file) |
| `lua/core/` | Lua command core (`handlers/*.lua`) |
| `lua/headless.lua` | Batch-mode runner |
| `scripts/` | Setup |
| `tests/` | Unit tests and headless end-to-end tests |

Changes in `lua/` take effect on the next tool call; no rebuild is needed.

### How a command runs

1. The server writes a request file: `{ "file", "ops": [{ "cmd", "params" }], "allow_lua" }`.
2. It runs `Aseprite -b --script-param request=… --script-param response=… --script lua/headless.lua`.
3. The script opens the file, runs each op, saves the file if anything changed, and writes a response: `{ "results": [{ "ok": true, "result" } | { "ok": false, "error": { "code", "message" } }], "file", "saved" }`.

Mutating commands run inside `app.transaction`, so a failed command rolls back everything it changed, and the file isn't saved.

### Security

- The server only talks to Claude Code over stdio; it opens no network ports.
- `run_lua` is off unless enabled.

---

## Troubleshooting

- **"Aseprite executable was not found".** Set `ASEPRITE_PATH` to the Aseprite executable.
- **Claude's changes don't show in Aseprite.** Aseprite doesn't reload files changed on disk. Close the file's tab in Aseprite, then ask Claude to show it again.
- **"Show me this in Aseprite" opens a second Aseprite window** (Windows). The tab-in-the-running-window behavior relies on the `.aseprite` file association that Aseprite registers. If double-clicking a `.aseprite` file in Explorer also opens a second window, the association is missing or was replaced by another program, and the connector falls back to starting a new window.
- **A tool call times out.** Each call starts Aseprite in the background; on a slow machine or a very large sprite this can take a while. The limit is 2 minutes per call.
- **Selections between calls.** Aseprite doesn't save selections in `.aseprite` files, so the connector keeps them in a sprite property between calls.

## Upcoming features

- **Stylization commands.** Tools that apply a pixel-art style to a sprite in one step.
- **Auto-update the open Aseprite file.** Changes Claude makes to a file update automatically in the Aseprite window that has it open. For now, close the file's tab and ask Claude to show it again.

  Aseprite can't be told from outside to reload a file: it doesn't watch files on disk, and its Windows "open" handler can't close or reload. The planned approach is a small **optional** Aseprite extension:
  1. After saving a file, the connector writes a "reload this file" note to a folder.
  2. The extension checks that folder about once a second.
  3. If the file is open and its tab has **no unsaved changes**, the extension closes and reopens it in place. Tabs with unsaved changes are left alone, so the user's work is never discarded.

  Without the extension, everything keeps working as it does today. Simulating keystrokes (Ctrl+W, then reopen) was ruled out: it's fragile and can discard unsaved work.

## License

[MIT](LICENSE)
