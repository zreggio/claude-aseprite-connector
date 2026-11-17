-- Claude Bridge core loader. Shared by the Aseprite extension (live mode)
-- and lua/headless.lua (batch mode).
--
-- Usage: local core = dofile(joinPath(root, "core", "init.lua"))(root)
--        core.dispatch(cmd, params, ctx) -> { ok = true, result = ... } | { ok = false, error = {...} }

return function(root)
  local function load(rel)
    local path = app.fs.joinPath(root, "core", rel)
    local chunk, err = loadfile(path)
    if not chunk then error("Claude Bridge: cannot load " .. path .. ": " .. tostring(err)) end
    return chunk()
  end

  local json = load("json.lua")
  local U = load("util.lua")(json)
  local dispatcher = load("dispatcher.lua")(json, U)

  for _, name in ipairs({ "document", "inspect", "draw", "transform", "layers", "palette", "selection", "history", "power" }) do
    load(app.fs.joinPath("handlers", name .. ".lua"))(dispatcher.def, U, json, dispatcher)
  end

  return {
    VERSION = dispatcher.VERSION,
    json = json,
    util = U,
    dispatch = dispatcher.dispatch,
    commands = dispatcher.commands,
  }
end
