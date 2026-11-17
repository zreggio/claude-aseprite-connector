-- Undo / redo (live mode only; headless edits are saved to disk per call).
return function(def, U, json)
  local function step(p, ctx, fn, what)
    if ctx.mode ~= "live" then
      U.fail("not_available", what .. " is only available while Aseprite is open with the Claude Bridge connected (headless edits are saved to disk immediately).")
    end
    local s = U.sprite(p)
    app.sprite = s
    local n = U.int(p.steps, "steps", 1)
    if n < 1 or n > 100 then U.fail("invalid_params", "steps must be 1..100") end
    for _ = 1, n do fn() end
    ctx.mutated = true
    return { steps = n, sprite = U.spriteInfo(s) }
  end

  def("undo", {}, function(p, ctx) return step(p, ctx, app.undo, "Undo") end)
  def("redo", {}, function(p, ctx) return step(p, ctx, app.redo, "Redo") end)
end
