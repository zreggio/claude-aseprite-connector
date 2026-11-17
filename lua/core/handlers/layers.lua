-- Layer management.
return function(def, U, json)
  local function listTopDown(layers, depth, out)
    for i = #layers, 1, -1 do
      local l = layers[i]
      local info = U.layerInfo(l.sprite, l)
      info.depth = depth
      out[#out + 1] = info
      if l.isGroup then listTopDown(l.layers, depth + 1, out) end
    end
    return out
  end

  def("list_layers", {}, function(p)
    local s = U.sprite(p)
    return { layers = listTopDown(s.layers, 0, json.array({})), order = "top-to-bottom" }
  end)

  local function findGroup(s, name)
    if name == nil then return nil end
    if name == "" then return s end
    local g = U.findLayer(s, name)
    if not g then U.fail("layer_not_found", "No group named '" .. name .. "'.") end
    if not g.isGroup then U.fail("invalid_params", "'" .. name .. "' is not a group layer.") end
    return g
  end

  local function place(s, l, p)
    if p.parent ~= nil then l.parent = findGroup(s, p.parent) end
    if p.above and p.above ~= "" then
      local ref = U.findLayer(s, p.above)
      if not ref then U.fail("layer_not_found", "No layer named '" .. p.above .. "'.") end
      l.parent = ref.parent
      l.stackIndex = ref.stackIndex + (l.stackIndex < ref.stackIndex and 0 or 1)
    elseif p.below and p.below ~= "" then
      local ref = U.findLayer(s, p.below)
      if not ref then U.fail("layer_not_found", "No layer named '" .. p.below .. "'.") end
      l.parent = ref.parent
      l.stackIndex = math.max(1, ref.stackIndex - (l.stackIndex < ref.stackIndex and 1 or 0))
    elseif p.stack_index then
      l.stackIndex = U.int(p.stack_index, "stack_index")
    end
  end

  def("add_layer", { mutates = true, label = "add layer" }, function(p)
    local s = U.sprite(p)
    local l = (p.type == "group") and s:newGroup() or s:newLayer()
    l.name = p.name or (p.type == "group" and "Group" or "Layer " .. #U.allLayers(s))
    if p.opacity then l.opacity = U.int(p.opacity, "opacity") end
    if p.blend_mode and not l.isGroup then l.blendMode = U.blendValue(p.blend_mode) end
    if p.above == nil and p.below == nil and p.parent == nil and p.stack_index == nil then
      -- Default: directly above the active layer, like Aseprite's New Layer.
      local active = app.layer
      if active and active.sprite == s and active ~= l then
        p = { above = U.layerPath(active) }
      end
    end
    place(s, l, p)
    if p.activate ~= false then app.layer = l end
    return U.layerInfo(s, l)
  end)

  def("update_layer", { mutates = true, label = "update layer" }, function(p)
    local s = U.sprite(p)
    local l = U.layer(s, p, { drawable = false })
    if p.name then l.name = p.name end
    if p.visible ~= nil then l.isVisible = p.visible end
    if p.opacity ~= nil then
      local o = U.int(p.opacity, "opacity")
      if o < 0 or o > 255 then U.fail("invalid_params", "opacity must be 0..255") end
      l.opacity = o
    end
    if p.blend_mode then l.blendMode = U.blendValue(p.blend_mode) end
    place(s, l, { parent = p.parent, above = p.above, below = p.below, stack_index = p.stack_index })
    if p.activate then app.layer = l end
    return U.layerInfo(s, l)
  end)

  def("delete_layer", { mutates = true, label = "delete layer" }, function(p)
    local s = U.sprite(p)
    if not p.layer then U.fail("invalid_params", "Name the layer to delete.") end
    local l = U.layer(s, p, { drawable = false })
    if #s.layers == 1 and l.parent == s then U.fail("invalid_params", "Can't delete the only layer.") end
    local name = U.layerPath(l)
    s:deleteLayer(l)
    return { deleted = name }
  end)

  def("duplicate_layer", { mutates = true, label = "duplicate layer" }, function(p)
    local s = U.sprite(p)
    local l = U.layer(s, p)
    local n = s:newLayer()
    n.name = p.name or (l.name .. " copy")
    n.parent = l.parent
    n.stackIndex = l.stackIndex + 1
    n.opacity = l.opacity
    n.blendMode = l.blendMode
    n.isVisible = l.isVisible
    local cel = l:cel(1)
    if cel then s:newCel(n, 1, cel.image:clone(), cel.position) end
    app.layer = n
    return U.layerInfo(s, n)
  end)

  def("merge_down", { mutates = true, label = "merge down" }, function(p)
    local s = U.sprite(p)
    local upper = U.layer(s, p)
    local siblings = upper.parent.layers
    local lower = siblings[upper.stackIndex - 1]
    if not lower then U.fail("invalid_params", "'" .. upper.name .. "' has no layer below it in the same group.") end
    if not lower.isImage or lower.isTilemap then U.fail("invalid_params", "The layer below ('" .. lower.name .. "') is not an image layer.") end
    local lowerImg = U.canvasImage(s, lower)
    if upper.isVisible then
      local ucel = upper:cel(1)
      if ucel then
        local op = (upper.opacity * ucel.opacity) // 255
        lowerImg:drawImage(ucel.image, ucel.position, op, upper.blendMode)
      end
    end
    U.commitImage(s, lower, lowerImg)
    s:deleteLayer(upper)
    app.layer = lower
    return U.layerInfo(s, lower)
  end)

  def("flatten", { mutates = true, label = "flatten" }, function(p)
    local s = U.sprite(p)
    s:flatten()
    app.layer = s.layers[1]
    return { layers = listTopDown(s.layers, 0, json.array({})) }
  end)
end
