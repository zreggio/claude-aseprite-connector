-- Selection commands.
return function(def, U, json)
  --- Build a Selection from row-runs of pixels that satisfy pred(x, y).
  local function selectionFromPredicate(s, pred)
    local sel = Selection()
    for y = 0, s.height - 1 do
      local runStart
      for x = 0, s.width do
        local hit = x < s.width and pred(x, y)
        if hit and not runStart then runStart = x
        elseif not hit and runStart then
          sel:add(Rectangle(runStart, y, x - runStart, 1))
          runStart = nil
        end
      end
    end
    return sel
  end

  def("select", { mutates = true, label = "select" }, function(p)
    local s = U.sprite(p)
    local kind = p.kind or "rect"
    local op = p.op or "replace"
    local sel
    if kind == "none" then
      s.selection = Selection()
      return { selection = json.null, empty = true }
    elseif kind == "all" then
      sel = Selection(Rectangle(0, 0, s.width, s.height))
    elseif kind == "rect" then
      local r = U.region(s, { x = p.x, y = p.y, width = p.width, height = p.height })
      sel = Selection(Rectangle(r.x, r.y, r.width, r.height))
    elseif kind == "color" or kind == "content" then
      local layer = p.layer and U.layer(s, p, { drawable = false }) or nil
      local img = U.flattenImage(s, layer and U.layerPath(layer) or nil)
      local tol = U.int(p.tolerance, "tolerance", 0)
      if kind == "color" then
        local target = U.colorToPixel(s, p.color)
        sel = selectionFromPredicate(s, function(x, y) return U.pixelDistance(s, img:getPixel(x, y), target, false) <= tol end)
      else
        sel = selectionFromPredicate(s, function(x, y)
          local _, _, _, a = U.pixelToRGBA(s, img:getPixel(x, y), false)
          return a > 0
        end)
      end
    else
      U.fail("invalid_params", "kind must be rect, all, none, color or content")
    end

    local final
    local cur = s.selection
    if op == "replace" or not cur or cur.isEmpty then
      final = sel
      if op == "subtract" or op == "intersect" then final = Selection() end
    else
      final = Selection()
      final:add(cur)
      if op == "add" then final:add(sel)
      elseif op == "subtract" then final:subtract(sel)
      elseif op == "intersect" then final:intersect(sel)
      else U.fail("invalid_params", "op must be replace, add, subtract or intersect") end
    end
    s.selection = final
    if final.isEmpty then return { empty = true } end
    local b = final.bounds
    return { empty = false, bounds = { x = b.x, y = b.y, width = b.width, height = b.height } }
  end)
end
