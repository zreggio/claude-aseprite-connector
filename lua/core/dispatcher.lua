-- Command registry + dispatch. Mutating commands run inside one
-- app.transaction so each Claude operation is a single undo step, and a
-- failing command rolls back everything it changed.
return function(json, U)
  local D = { VERSION = "1.0.0" }
  local registry = {}

  --- Register a command.
  -- opts.mutates: wrap in a transaction on the target sprite.
  -- opts.label:   undo-history label (defaults to the command name).
  function D.def(name, opts, fn)
    registry[name] = { name = name, mutates = opts.mutates or false, label = opts.label, fn = fn, batchable = opts.batchable ~= false }
  end

  function D.commands()
    local names = {}
    for k in pairs(registry) do names[#names + 1] = k end
    table.sort(names)
    return names
  end

  function D.get(name) return registry[name] end

  local function normalize_error(err)
    if type(err) == "table" and err.code then
      return { code = err.code, message = err.message or err.code, details = err.details }
    end
    local msg = tostring(err)
    return { code = "lua_error", message = msg }
  end

  --- Run a command's function, wrapping in a transaction when it mutates.
  function D.invoke(entry, params, ctx)
    local result
    if entry.mutates then
      local sprite = U.sprite(params)
      app.sprite = sprite
      app.transaction("Claude: " .. (entry.label or entry.name:gsub("_", " ")), function()
        result = entry.fn(params, ctx)
      end)
      ctx.mutated = true
    else
      result = entry.fn(params, ctx)
    end
    return result
  end

  function D.dispatch(cmd, params, ctx)
    ctx = ctx or {}
    params = params or json.object({})
    local entry = registry[cmd]
    if not entry then
      return { ok = false, error = { code = "unknown_command", message = "Unknown command '" .. tostring(cmd) .. "'." } }
    end
    local ok, res = xpcall(function() return D.invoke(entry, params, ctx) end, function(e)
      if type(e) == "table" then return e end
      return debug.traceback(tostring(e), 2)
    end)
    if ok then
      if res == nil then res = json.object({}) end
      return { ok = true, result = res }
    end
    return { ok = false, error = normalize_error(res) }
  end

  return D
end
