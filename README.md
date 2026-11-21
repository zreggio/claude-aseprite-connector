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

Claude Code and Claude Desktop's chat keep **separate** connector lists. Set up whichever ones you use; registering one does not make the connector available in the other.

#### Claude Code (CLI or the desktop app's Code tab)

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

#### Claude Desktop (chat)

The connector installs into Claude Desktop as a desktop extension: `dist/aseprite.mcpb`, created by `npm run setup`. Claude Desktop ships with its own Node.js runtime, so the extension runs even on a computer without Node installed. You only need Node to build the file.

1. **Open the extensions page.**
   - In Claude Desktop, open **Settings › Desktop app** and click **Manage** next to **Extensions**.
   - In older versions, it's **Settings › Extensions**.
2. **Install the file.**
   1. Click **Advanced settings**.
   2. In the **Extension Developer** section, click **Install Extension…**.
   3. Select `dist/aseprite.mcpb` inside your clone, e.g. `C:\Users\<you>\claude-aseprite-connector\dist\aseprite.mcpb` or `~/claude-aseprite-connector/dist/aseprite.mcpb`.
3. **Review the settings** in the install dialog. The defaults are fine for most people:

   | Setting | Default | Change it when… |
   |---|---|---|
   | Aseprite executable | empty (auto-detect) | Aseprite isn't in a standard or Steam location; pick `Aseprite.exe` (or the app binary on macOS/Linux) |
   | Working folder | `Documents/Aseprite Claude` | You want new sprites and exports saved somewhere else |
   | Bridge port | `47823` | Something else uses that port; it must match Aseprite's **File › Claude Bridge › Status…** |
   | Allow run_lua | off | You want Claude to be able to run arbitrary Lua inside Aseprite |

   Click **Install**.
4. **Restart Claude Desktop completely.** Quit it from the system tray (Windows) or menu bar (macOS), not just by closing the window, then reopen it.
5. **Start a new chat.** Chats that were already open don't pick up newly installed extensions.
6. **Check it's connected.** Click the **+** button at the bottom of the chat box, then **Connectors**. **Aseprite** should be listed with its tools.

To change settings later, go to **Settings › Desktop app › Manage** (next to Extensions) and click **Aseprite**.
To update after a `git pull`, run `npm run setup` again and reinstall the new `dist/aseprite.mcpb` the same way.

Prefer not to build? Every CI run on GitHub (**Actions** tab › latest run › **Artifacts** › `packages`) includes a ready-made `aseprite.mcpb` and `claude-bridge.aseprite-extension`.

> **One app at a time.** Only one Claude app can drive Aseprite live at a time. If a Claude Code session already has the connector running, the Desktop chat falls back to headless mode (editing files on disk), and its `status` tool explains why. Close the other session to draw live from the chat.

### 4. Verify

1. Open Aseprite. In Aseprite, **File › Claude Bridge › Status…** shows `connected` once Claude is running.
2. Ask Claude: *"Call the aseprite status tool."* It should report `"mode": "live"`.
3. Ask: *"Make a 32×32 pixel-art sword icon using the PICO-8 palette."*

**First save prompt.** The first time Claude saves or exports a file, Aseprite's Security dialog asks whether the *Claude Bridge* script may write it. To stop being asked:
1. Tick **Give full trust to this script**.
2. Click **Allow Write Access**.

Only `core/handlers/document.lua` writes files: `new_sprite` with a path, `save_sprite` and `export_image`.

### Updating

New features and fixes are added to the `main` branch on GitHub. To get them, pull the changes into your clone, rebuild, then refresh each part that uses the connector.

#### 1. Check for updates

In your clone (the `claude-aseprite-connector` folder), run:

```bash
git fetch
git log --oneline HEAD..origin/main
```

If nothing is listed, you're up to date. Otherwise, each line is a change you don't have yet.

#### 2. Pull and rebuild

Close Aseprite first, so the extension files aren't in use. Then run:

```bash
git pull
npm install
npm run setup
```

- `git pull` downloads the latest code.
- `npm install` picks up any new or updated dependencies.
- `npm run setup` rebuilds the server, `dist/claude-bridge.aseprite-extension` and `dist/aseprite.mcpb`, and reinstalls the extension into Aseprite.

**If `git pull` refuses** because you have local changes, either set them aside with `git stash` (bring them back later with `git stash pop`) or discard them with `git checkout -- .`. Then run `git pull` again.

#### 3. Apply the update

Update each part you use:

| Part | What to do |
|---|---|
| **Aseprite extension** | Reopen Aseprite. `npm run setup` already reinstalled it. If it says the extension wasn't installed, double-click `dist/claude-bridge.aseprite-extension`. |
| **Claude Code** | Start a **new** session. No need to re-register, since the server path hasn't changed. |
| **Claude Desktop (chat)** | Reinstall `dist/aseprite.mcpb` the same way you [installed it](#claude-desktop-chat). Then fully quit and reopen Claude Desktop, and start a new chat. |

#### 4. Check it worked

Ask Claude to *"call the aseprite status tool"*. It should report `"mode": "live"` with Aseprite open. If anything misbehaves after an update, see [Troubleshooting](#troubleshooting).

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
- **A Claude Desktop chat says it has no Aseprite tools.**
  - Check **Settings › Desktop app › Manage** (next to Extensions). If **Aseprite** isn't listed, the `.mcpb` was never installed; follow the [Claude Desktop steps](#claude-desktop-chat).
  - Fully quit and reopen Claude Desktop, then start a **new** chat.
  - Registering the server for Claude Code does not install it in Claude Desktop.
- **The Aseprite extension is installed in Claude Desktop but fails to start.** Its status and logs are in the **Local MCP servers** section of the Extensions page (older versions: **Settings › Developer**). Turning on debug logging in Claude Desktop's settings adds more detail.
- **The File › Claude Bridge menu is missing.**
  - Check that the extension is listed and enabled in **Edit › Preferences › Extensions**.
  - Restart Aseprite after installing.
- **A tool call times out.** A dialog in Aseprite (usually the Security prompt) is probably waiting for you.
- **"Aseprite executable was not found".** Set `ASEPRITE_PATH`, or open Aseprite with the extension so live mode is used.
- **Selections in headless mode.** Aseprite doesn't save selections in `.aseprite` files, so headless mode keeps them in a sprite property between calls.

## Upcoming features

- **Stylization commands.** Tools that apply a pixel-art style to a sprite in one step.
- **One connector for Claude Desktop and Claude Code.** A single install that works in both apps, instead of setting each one up separately.
- **Auto-update the open Aseprite file.** Changes Claude makes to a file update automatically in the Aseprite window that has it open.

## License

[MIT](LICENSE)
