-- Claude Bridge: Aseprite extension that connects to the Aseprite MCP server
-- (ws://127.0.0.1:<port>) and executes Claude's commands in this window.
--
-- Menu: File > Scripts > Claude Bridge > Connect / Disconnect / Status...

local DEFAULT_PORT = 47823

local core          -- shared command core (core/init.lua)
local ws            -- WebSocket client
local plugin_ref
local state = {
  status = "disconnected",
  connected = false,
  requests = 0,
  last_command = nil,
  last_error = nil,
  allow_lua = false,
  server_version = nil,
}

local function prefs() return plugin_ref.preferences end
local function port() return tonumber(prefs().port) or DEFAULT_PORT end

local function send(tbl)
  if ws and state.connected then ws:sendText(core.json.encode(tbl)) end
end

local function handleText(data)
  local ok, msg = pcall(core.json.decode, data)
  if not ok or type(msg) ~= "table" then return end

  if msg.type == "welcome" then
    state.allow_lua = msg.allow_lua == true
    state.server_version = msg.server_version
    return
  end
  if msg.id == nil or msg.cmd == nil then return end

  state.requests = state.requests + 1
  state.last_command = msg.cmd
  local res = core.dispatch(msg.cmd, msg.params, { mode = "live", live = true, allow_lua = state.allow_lua })
  res.id = msg.id
  if not res.ok then state.last_error = msg.cmd .. ": " .. tostring(res.error and res.error.message) end
  local sent, err = pcall(send, res)
  if not sent then
    -- Encoding failed (unexpected value in result): report it instead of hanging the request.
    send({ id = msg.id, ok = false, error = { code = "encode_failed", message = tostring(err) } })
  end
end

local function onreceive(kind, data)
  if kind == WebSocketMessageType.OPEN then
    state.connected = true
    state.status = "connected"
    send({
      type = "hello",
      bridge_version = core.VERSION,
      aseprite_version = tostring(app.version),
      api_version = app.apiVersion,
    })
  elseif kind == WebSocketMessageType.TEXT then
    handleText(data)
  elseif kind == WebSocketMessageType.CLOSE then
    if state.connected then state.status = "waiting for Claude (reconnecting)" end
    state.connected = false
  elseif kind == WebSocketMessageType.ERROR then
    state.last_error = tostring(data)
  end
end

local function connect()
  if ws then ws:close() end
  state.status = "waiting for Claude (connecting to port " .. port() .. ")"
  ws = WebSocket {
    url = "ws://127.0.0.1:" .. port(),
    onreceive = onreceive,
    deflate = false,
    minreconnectwait = 1,
    maxreconnectwait = 5,
  }
  ws:connect()
  prefs().autoconnect = true
end

local function disconnect()
  prefs().autoconnect = false
  if ws then
    ws:close()
    ws = nil
  end
  state.connected = false
  state.status = "disconnected"
end

local function showStatus()
  local dlg = Dialog { title = "Claude Bridge" }
  dlg:label { id = "status", label = "Status:", text = state.status }
  dlg:label { label = "Requests:", text = tostring(state.requests) }
  dlg:label { label = "Last command:", text = state.last_command or "-" }
  dlg:label { label = "Last error:", text = state.last_error or "-" }
  dlg:label { label = "run_lua:", text = state.allow_lua and "enabled by server" or "disabled" }
  dlg:number { id = "port", label = "Port:", text = tostring(port()), decimals = 0 }
  dlg:separator()
  dlg:button { id = "connect", text = state.connected and "Reconnect" or "Connect", onclick = function()
    prefs().port = math.floor(dlg.data.port)
    connect()
    dlg:close()
  end }
  dlg:button { id = "disconnect", text = "Disconnect", onclick = function()
    disconnect()
    dlg:close()
  end }
  dlg:button { id = "close", text = "Close" }
  dlg:show { wait = false }
end

function init(plugin)
  plugin_ref = plugin
  local root = plugin.path
  core = dofile(app.fs.joinPath(root, "core", "init.lua"))(root)

  local group, prefix = "file_scripts", "Claude Bridge: "
  if plugin.newMenuGroup then
    prefix = ""
    plugin:newMenuGroup { id = "claude_bridge_menu", title = "Claude Bridge", group = "file_scripts" }
    group = "claude_bridge_menu"
  end
  plugin:newCommand { id = "ClaudeBridgeConnect", title = prefix .. "Connect", group = group, onclick = connect }
  plugin:newCommand { id = "ClaudeBridgeDisconnect", title = prefix .. "Disconnect", group = group, onclick = disconnect }
  plugin:newCommand { id = "ClaudeBridgeStatus", title = prefix .. "Status...", group = group, onclick = showStatus }

  if prefs().autoconnect ~= false and app.isUIAvailable then
    connect()
  end
end

function exit(plugin)
  if ws then
    ws:close()
    ws = nil
  end
end
