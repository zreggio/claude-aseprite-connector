-- batch (many ops, one round trip, one undo step) and run_lua (opt-in).
return function(def, U, json, D)
  local NOT_BATCHABLE = { batch = true, undo = true, redo = true, new_sprite = true, open_sprite = true, status = true }

  def("batch", { mutates = true, label = "batch" }, function(p, ctx)
    local ops = p.ops
    if type(ops) ~= "table" or #ops == 0 then U.fail("invalid_params", "'ops' must be a non-empty array of {cmd, params}.") end
    if #ops > 200 then U.fail("invalid_params", "At most 200 ops per batch.") end
    local results = json.array({})
    for i, op in ipairs(ops) do
      local entry = D.get(op.cmd)
      if not entry then U.fail("unknown_command", "ops[" .. i .. "]: unknown command '" .. tostring(op.cmd) .. "'.") end
      if NOT_BATCHABLE[op.cmd] then U.fail("invalid_params", "ops[" .. i .. "]: '" .. op.cmd .. "' can't be used inside batch.") end
      local params = op.params or json.object({})
      if params.sprite == nil then params.sprite = p.sprite end
      local ok, res = pcall(entry.fn, params, ctx)
      if not ok then
        if type(res) == "table" and res.code then
          U.fail(res.code, "ops[" .. i .. "] (" .. op.cmd .. "): " .. (res.message or res.code) .. " — the whole batch was rolled back.")
        end
        U.fail("lua_error", "ops[" .. i .. "] (" .. op.cmd .. "): " .. tostring(res) .. " — the whole batch was rolled back.")
      end
      results[#results + 1] = res or json.object({})
    end
    return { results = results, count = #results }
  end)

  def("run_lua", { mutates = true, label = "script" }, function(p, ctx)
    if not ctx.allow_lua then
      U.fail("not_allowed", "run_lua is disabled. Set ASEPRITE_MCP_ALLOW_LUA=1 in the connector's settings to enable it.")
    end
    local code = p.code
    if type(code) ~= "string" or code == "" then U.fail("invalid_params", "'code' must be a non-empty Lua string.") end
    local printed = {}
    local env = setmetatable({
      print = function(...)
        local parts = {}
        for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
        printed[#printed + 1] = table.concat(parts, "\t")
      end,
      sprite = app.sprite,
      U = U,
      json = json,
    }, { __index = _G })
    local chunk, err = load(code, "run_lua", "t", env)
    if not chunk then U.fail("lua_syntax", tostring(err)) end
    local ok, ret = pcall(chunk)
    if not ok then U.fail("lua_error", tostring(ret)) end
    local function safe(v, depth)
      depth = depth or 0
      local t = type(v)
      if t == "nil" or t == "boolean" or t == "number" or t == "string" then return v end
      if t == "table" and depth < 6 then
        local out = {}
        for k, val in pairs(v) do out[k] = safe(val, depth + 1) end
        return out
      end
      return tostring(v)
    end
    return { returned = safe(ret), output = printed }
  end)
end
