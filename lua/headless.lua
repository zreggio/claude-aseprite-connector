-- Claude Bridge headless runner.
--   Aseprite.exe -b --script-param request=<req.json> --script-param response=<resp.json> --script headless.lua
--
-- Request:  { "file": "C:/.../art.aseprite" | null, "ops": [{ "cmd": "...", "params": {...} }], "allow_lua": false }
-- Response: { "results": [{ "ok": true, "result": ... } | { "ok": false, "error": {...} }], "file": "...", "saved": true }

local function scriptDir()
  local src = debug.getinfo(1, "S").source
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  return app.fs.filePath(src)
end

local root = scriptDir()
local core = dofile(app.fs.joinPath(root, "core", "init.lua"))(root)
local json = core.json

local function readAll(path)
  local f = assert(io.open(path, "rb"))
  local s = f:read("a")
  f:close()
  return s
end

local function writeAll(path, text)
  local f = assert(io.open(path, "wb"))
  f:write(text)
  f:close()
end

-- Aseprite doesn't save selections in .aseprite files, so headless mode keeps
-- the selection in a sprite property between runs (as row runs "x,y,w;...").
local SEL_KEY = "claude_bridge_selection"

local function restoreSelection(s)
  local ok, runs = pcall(function() return s.properties[SEL_KEY] end)
  if not ok or type(runs) ~= "string" or runs == "" then return end
  local sel = Selection()
  for x, y, w in runs:gmatch("(%-?%d+),(%-?%d+),(%d+)") do
    sel:add(Rectangle(tonumber(x), tonumber(y), tonumber(w), 1))
  end
  s.selection = sel
end

local function storeSelection(s)
  local sel = s.selection
  local runs = {}
  if sel and not sel.isEmpty then
    local b = sel.bounds
    for y = b.y, b.y + b.height - 1 do
      local start
      for x = b.x, b.x + b.width do
        local hit = x < b.x + b.width and sel:contains(x, y)
        if hit and not start then start = x
        elseif not hit and start then runs[#runs + 1] = start .. "," .. y .. "," .. (x - start); start = nil end
      end
    end
  end
  local value = table.concat(runs, ";")
  pcall(function()
    if (s.properties[SEL_KEY] or "") ~= value then s.properties[SEL_KEY] = value end
  end)
end

local respPath = app.params.response
local ok, err = pcall(function()
  local req = json.decode(readAll(app.params.request))
  local ctx = { mode = "headless", allow_lua = req.allow_lua == true }
  local results = json.array({})
  local file = req.file

  if file and file ~= "" then
    if not app.fs.isFile(file) then
      results[1] = { ok = false, error = { code = "file_not_found", message = "The headless working file no longer exists: " .. file .. ". Use open_sprite or new_sprite." } }
      writeAll(respPath, json.encode({ results = results }))
      return
    end
    local s = app.open(file)
    if not s then error("Aseprite could not open " .. file) end
    app.sprite = s
    ctx.current_file = s.filename
    restoreSelection(s)
  end

  local allOk = true
  for i, op in ipairs(req.ops or {}) do
    local r = core.dispatch(op.cmd, op.params, ctx)
    results[i] = r
    if not r.ok then allOk = false break end
  end

  local saved = false
  if allOk and ctx.mutated and app.sprite and not ctx.saved then
    local target = app.sprite.filename
    local ext = (app.fs.fileExtension(target or "") or ""):lower()
    if target and target ~= "" and app.fs.filePath(target) ~= "" and (ext == "aseprite" or ext == "ase") then
      storeSelection(app.sprite)
      app.sprite:saveAs(target)
      saved = true
    end
  end

  writeAll(respPath, json.encode({
    results = results,
    file = app.sprite and app.sprite.filename or ctx.current_file,
    saved = saved or ctx.saved or false,
  }))
end)

if not ok then
  writeAll(respPath, json.encode({
    results = { { ok = false, error = { code = "headless_error", message = tostring(err) } } },
  }))
end
