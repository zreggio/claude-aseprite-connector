-- Shared helpers for Claude Bridge handlers: errors, colors, layers, images.
return function(json)
  local U = {}
  local pc = app.pixelColor

  U.MAX_CANVAS = 1024
  U.MAX_MAP = 256

  ---------------------------------------------------------------------------
  -- Errors
  ---------------------------------------------------------------------------
  --- Raise a structured error that the dispatcher turns into {code, message}.
  function U.fail(code, message, details)
    error({ code = code, message = message, details = details }, 0)
  end

  function U.check(cond, code, message)
    if not cond then U.fail(code, message) end
    return cond
  end

  function U.int(v, name, default)
    if v == nil then
      if default ~= nil then return default end
      U.fail("invalid_params", "Missing required integer '" .. name .. "'")
    end
    local n = math.tointeger(v) or (type(v) == "number" and math.floor(v + 0.5)) or nil
    if n == nil then U.fail("invalid_params", "'" .. name .. "' must be an integer") end
    return n
  end

  ---------------------------------------------------------------------------
  -- Sprite / layer resolution
  ---------------------------------------------------------------------------
  --- Resolve the target sprite: params.sprite (filename/title match) or the active sprite.
  function U.sprite(params)
    local want = params and params.sprite
    if want and want ~= "" then
      local lw = want:lower():gsub("\\", "/")
      for _, s in ipairs(app.sprites) do
        local fn = (s.filename or ""):lower():gsub("\\", "/")
        if fn == lw or app.fs.fileName(fn) == lw or app.fs.fileTitle(fn) == lw then
          app.sprite = s
          return s
        end
      end
      U.fail("sprite_not_found", "No open sprite matches '" .. want .. "'. Use status to list open sprites or open_sprite to open it.")
    end
    local s = app.sprite
    if not s then
      U.fail("no_sprite", "No sprite is open. Use new_sprite or open_sprite first.")
    end
    return s
  end

  local function walk_layers(layers, out, prefix)
    for _, l in ipairs(layers) do
      local path = prefix and (prefix .. "/" .. l.name) or l.name
      out[#out + 1] = { layer = l, path = path }
      if l.isGroup then walk_layers(l.layers, out, path) end
    end
    return out
  end

  --- Flat list of {layer, path} for every layer (bottom-to-top, depth-first).
  function U.allLayers(sprite)
    return walk_layers(sprite.layers, {}, nil)
  end

  --- Find a layer by name or "Group/Child" path. Returns nil if not found.
  function U.findLayer(sprite, name)
    local entries = U.allLayers(sprite)
    for _, e in ipairs(entries) do
      if e.path == name then return e.layer end
    end
    local found
    for _, e in ipairs(entries) do
      if e.layer.name == name then
        if found then
          U.fail("ambiguous_layer", "More than one layer is named '" .. name .. "'. Use the full path, e.g. 'Group/" .. name .. "'.")
        end
        found = e.layer
      end
    end
    return found
  end

  function U.layerPath(layer)
    local parts = { layer.name }
    local spr = layer.sprite
    local p = layer.parent
    while p and p ~= spr do
      table.insert(parts, 1, p.name)
      p = p.parent
    end
    return table.concat(parts, "/")
  end

  --- Resolve the target layer: params.layer or the active layer (must belong to sprite).
  function U.layer(sprite, params, opts)
    opts = opts or {}
    local l
    if params and params.layer and params.layer ~= "" then
      l = U.findLayer(sprite, params.layer)
      if not l then
        U.fail("layer_not_found", "No layer named '" .. params.layer .. "'. Use list_layers to see layer names.")
      end
    else
      l = app.layer
      if not l or l.sprite ~= sprite then
        -- Fall back to the top-most image layer.
        local entries = U.allLayers(sprite)
        for i = #entries, 1, -1 do
          if entries[i].layer.isImage then l = entries[i].layer break end
        end
      end
      if not l then U.fail("layer_not_found", "The sprite has no layers.") end
    end
    if opts.drawable ~= false then
      if l.isGroup then U.fail("not_drawable", "Layer '" .. l.name .. "' is a group; pick an image layer.") end
      if l.isTilemap then U.fail("not_drawable", "Layer '" .. l.name .. "' is a tilemap layer, which is not supported.") end
      if l.isReference then U.fail("not_drawable", "Layer '" .. l.name .. "' is a reference layer.") end
    end
    return l
  end

  ---------------------------------------------------------------------------
  -- Colors
  ---------------------------------------------------------------------------
  local function hex2(n) return string.format("%02x", n) end

  function U.rgbaToHex(r, g, b, a)
    if a == 0 then return "transparent" end
    if a == nil or a == 255 then return "#" .. hex2(r) .. hex2(g) .. hex2(b) end
    return "#" .. hex2(r) .. hex2(g) .. hex2(b) .. hex2(a)
  end

  function U.colorToHex(c)
    return U.rgbaToHex(c.red, c.green, c.blue, c.alpha)
  end

  --- Parse "#rgb", "#rrggbb", "#rrggbbaa" or "transparent" → r,g,b,a.
  function U.parseHex(s)
    if type(s) ~= "string" then return nil end
    local t = s:lower():gsub("^%s+", ""):gsub("%s+$", "")
    if t == "transparent" or t == "none" then return 0, 0, 0, 0 end
    t = t:gsub("^#", "")
    if #t == 3 then
      t = t:sub(1, 1):rep(2) .. t:sub(2, 2):rep(2) .. t:sub(3, 3):rep(2)
    end
    if #t == 6 then t = t .. "ff" end
    if #t ~= 8 or t:find("[^0-9a-f]") then return nil end
    return tonumber(t:sub(1, 2), 16), tonumber(t:sub(3, 4), 16),
           tonumber(t:sub(5, 6), 16), tonumber(t:sub(7, 8), 16)
  end

  function U.palette(sprite) return sprite.palettes[1] end

  --- Pixel value → r,g,b,a for the given sprite color mode.
  function U.pixelToRGBA(sprite, v, isBackground)
    local mode = sprite.colorMode
    if mode == ColorMode.RGB then
      return pc.rgbaR(v), pc.rgbaG(v), pc.rgbaB(v), pc.rgbaA(v)
    elseif mode == ColorMode.GRAY then
      local g = pc.grayaV(v)
      return g, g, g, pc.grayaA(v)
    else
      if v == sprite.transparentColor and not isBackground then return 0, 0, 0, 0 end
      local pal = U.palette(sprite)
      if v < 0 or v >= #pal then return 0, 0, 0, 0 end
      local c = pal:getColor(v)
      return c.red, c.green, c.blue, c.alpha
    end
  end

  function U.pixelToHex(sprite, v, isBackground)
    return U.rgbaToHex(U.pixelToRGBA(sprite, v, isBackground))
  end

  function U.packRGBA(r, g, b, a)
    return pc.rgba(r, g, b, a)
  end

  --- Find an exact palette entry for r,g,b (alpha must be 255). Returns index or nil.
  function U.paletteIndexOf(sprite, r, g, b, a)
    local pal = U.palette(sprite)
    for i = 0, #pal - 1 do
      if i ~= sprite.transparentColor then
        local c = pal:getColor(i)
        if c.red == r and c.green == g and c.blue == b and (a == nil or c.alpha == a) then return i end
      end
    end
    return nil
  end

  --- Color spec (hex string, "transparent", or integer palette index) → pixel value.
  function U.colorToPixel(sprite, spec, what)
    what = what or "color"
    local mode = sprite.colorMode
    if spec == nil then U.fail("invalid_params", "Missing " .. what) end
    if type(spec) == "number" then
      local idx = math.tointeger(spec)
      local pal = U.palette(sprite)
      if not idx or idx < 0 or idx >= #pal then
        U.fail("invalid_color", what .. ": palette index " .. tostring(spec) .. " is out of range 0.." .. (#pal - 1))
      end
      if mode == ColorMode.INDEXED then return idx end
      local c = pal:getColor(idx)
      if mode == ColorMode.RGB then return pc.rgba(c.red, c.green, c.blue, c.alpha) end
      return pc.graya(math.floor(0.299 * c.red + 0.587 * c.green + 0.114 * c.blue + 0.5), c.alpha)
    end
    local r, g, b, a = U.parseHex(spec)
    if not r then
      U.fail("invalid_color", what .. ": '" .. tostring(spec) .. "' is not a color. Use '#rrggbb', '#rrggbbaa', 'transparent' or a palette index.")
    end
    if mode == ColorMode.RGB then
      if a == 0 then return 0 end
      return pc.rgba(r, g, b, a)
    elseif mode == ColorMode.GRAY then
      if a == 0 then return 0 end
      return pc.graya(math.floor(0.299 * r + 0.587 * g + 0.114 * b + 0.5), a)
    else
      if a == 0 then return sprite.transparentColor end
      local idx = U.paletteIndexOf(sprite, r, g, b, 255)
      if not idx then
        U.fail("color_not_in_palette", what .. " " .. spec .. " is not in the sprite's palette (indexed mode). Add it with add_palette_colors or use a palette index.")
      end
      return idx
    end
  end

  function U.transparentPixel(sprite)
    if sprite.colorMode == ColorMode.INDEXED then return sprite.transparentColor end
    return 0
  end

  ---------------------------------------------------------------------------
  -- Images
  ---------------------------------------------------------------------------
  --- Full-canvas copy of the layer's frame-1 cel (transparent where there is no cel).
  function U.canvasImage(sprite, layer)
    local cel = layer:cel(1)
    if cel and cel.position.x == 0 and cel.position.y == 0
       and cel.image.width == sprite.width and cel.image.height == sprite.height then
      return cel.image:clone()
    end
    local img = Image(sprite.spec)
    img:clear(U.transparentPixel(sprite))
    if cel then
      local src = cel.image
      local ox, oy = cel.position.x, cel.position.y
      for it in src:pixels() do
        local x, y = it.x + ox, it.y + oy
        if x >= 0 and y >= 0 and x < sprite.width and y < sprite.height then
          img:drawPixel(x, y, it())
        end
      end
    end
    return img
  end

  --- Replace the layer's frame-1 cel with a full-canvas image (undoable inside a transaction).
  function U.commitImage(sprite, layer, img)
    sprite:newCel(layer, 1, img, Point(0, 0))
  end

  --- Flatten visible layers (or a single layer) into an image in the sprite's color mode.
  function U.flattenImage(sprite, layerName)
    if layerName and layerName ~= "" then
      local l = U.layer(sprite, { layer = layerName }, { drawable = false })
      if l.isGroup then
        -- Render only this group's children by hiding everything else temporarily is
        -- invasive; instead composite the group's image layers manually.
        local img = Image(sprite.spec)
        img:clear(U.transparentPixel(sprite))
        local function draw(layers)
          for _, c in ipairs(layers) do
            if c.isVisible then
              if c.isGroup then draw(c.layers)
              elseif c.isImage and c:cel(1) then
                local cel = c:cel(1)
                img:drawImage(cel.image, cel.position, (c.opacity or 255) * (cel.opacity or 255) // 255, c.blendMode)
              end
            end
          end
        end
        draw(l.layers)
        return img
      end
      return U.canvasImage(sprite, l)
    end
    local img = Image(sprite.spec)
    img:clear(U.transparentPixel(sprite))
    img:drawSprite(sprite, 1)
    return img
  end

  --- Is the layer the background layer?
  function U.isBg(layer) return layer and layer.isBackground end

  ---------------------------------------------------------------------------
  -- Rectangles / selection
  ---------------------------------------------------------------------------
  --- Region from params {x,y,width,height} clipped to the canvas (default: whole canvas).
  function U.region(sprite, r)
    local x, y, w, h = 0, 0, sprite.width, sprite.height
    if r then
      x = U.int(r.x, "region.x", 0)
      y = U.int(r.y, "region.y", 0)
      w = U.int(r.width, "region.width", sprite.width - x)
      h = U.int(r.height, "region.height", sprite.height - y)
    end
    local x0, y0 = math.max(0, x), math.max(0, y)
    local x1, y1 = math.min(sprite.width, x + w), math.min(sprite.height, y + h)
    if x1 <= x0 or y1 <= y0 then
      U.fail("empty_region", string.format("Region %d,%d %dx%d is outside the %dx%d canvas.", x, y, w, h, sprite.width, sprite.height))
    end
    return { x = x0, y = y0, width = x1 - x0, height = y1 - y0 }
  end

  --- Returns a predicate (x,y)->bool limiting writes to the selection, or nil when unrestricted.
  function U.selectionMask(sprite, params)
    if params and params.respect_selection == false then return nil end
    local sel = sprite.selection
    if not sel or sel.isEmpty then return nil end
    return function(x, y) return sel:contains(x, y) end
  end

  function U.inCanvas(sprite, x, y)
    return x >= 0 and y >= 0 and x < sprite.width and y < sprite.height
  end

  ---------------------------------------------------------------------------
  -- A pixel "painter" that tracks writes, clipping to canvas + selection.
  ---------------------------------------------------------------------------
  function U.painter(sprite, img, params)
    local mask = U.selectionMask(sprite, params)
    local P = { written = 0, clipped = 0 }
    function P.set(x, y, v)
      if not U.inCanvas(sprite, x, y) then P.clipped = P.clipped + 1 return end
      if mask and not mask(x, y) then P.clipped = P.clipped + 1 return end
      img:drawPixel(x, y, v)
      P.written = P.written + 1
    end
    function P.summary(extra)
      local t = { pixels_written = P.written }
      if P.clipped > 0 then t.pixels_clipped = P.clipped end
      if mask then t.clipped_to_selection = true end
      if extra then for k, v in pairs(extra) do t[k] = v end end
      return t
    end
    return P
  end

  ---------------------------------------------------------------------------
  -- Base64
  ---------------------------------------------------------------------------
  local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  local b64chars = {}
  for i = 1, 64 do b64chars[i - 1] = B64:sub(i, i) end

  function U.base64(data)
    local out = {}
    local n = #data
    local i = 1
    while i <= n - 2 do
      local a, b, c = data:byte(i, i + 2)
      local v = (a << 16) | (b << 8) | c
      out[#out + 1] = b64chars[(v >> 18) & 63] .. b64chars[(v >> 12) & 63] .. b64chars[(v >> 6) & 63] .. b64chars[v & 63]
      i = i + 3
    end
    local rem = n - i + 1
    if rem == 1 then
      local a = data:byte(i)
      local v = a << 16
      out[#out + 1] = b64chars[(v >> 18) & 63] .. b64chars[(v >> 12) & 63] .. "=="
    elseif rem == 2 then
      local a, b = data:byte(i, i + 1)
      local v = (a << 16) | (b << 8)
      out[#out + 1] = b64chars[(v >> 18) & 63] .. b64chars[(v >> 12) & 63] .. b64chars[(v >> 6) & 63] .. "="
    end
    return table.concat(out)
  end

  --- RGBA byte string for a region of an image in the sprite's color mode.
  function U.rgbaBytes(sprite, img, rect, isBackground)
    local parts = {}
    local char = string.char
    if sprite.colorMode == ColorMode.RGB then
      for y = rect.y, rect.y + rect.height - 1 do
        for x = rect.x, rect.x + rect.width - 1 do
          local v = img:getPixel(x, y)
          parts[#parts + 1] = char(pc.rgbaR(v), pc.rgbaG(v), pc.rgbaB(v), pc.rgbaA(v))
        end
      end
    else
      local cache = {}
      for y = rect.y, rect.y + rect.height - 1 do
        for x = rect.x, rect.x + rect.width - 1 do
          local v = img:getPixel(x, y)
          local s = cache[v]
          if not s then
            s = char(U.pixelToRGBA(sprite, v, isBackground))
            cache[v] = s
          end
          parts[#parts + 1] = s
        end
      end
    end
    return table.concat(parts)
  end

  ---------------------------------------------------------------------------
  -- Misc
  ---------------------------------------------------------------------------
  local modeNames = { [ColorMode.RGB] = "rgb", [ColorMode.GRAY] = "gray", [ColorMode.INDEXED] = "indexed" }
  function U.modeName(m) return modeNames[m] or tostring(m) end

  local blendNames = {}
  for name, v in pairs(BlendMode) do
    if type(v) == "number" then blendNames[v] = name:lower() end
  end
  function U.blendName(v) return blendNames[v] or tostring(v) end
  function U.blendValue(name)
    local v = BlendMode[(name or ""):upper():gsub("[%s%-]", "_")]
    if not v then U.fail("invalid_params", "Unknown blend mode '" .. tostring(name) .. "'.") end
    return v
  end

  function U.layerInfo(sprite, l)
    local info = {
      name = l.name,
      path = U.layerPath(l),
      type = l.isGroup and "group" or (l.isTilemap and "tilemap" or "image"),
      visible = l.isVisible,
      opacity = l.opacity,
      blend_mode = l.blendMode and U.blendName(l.blendMode) or nil,
      background = l.isBackground or nil,
      stack_index = l.stackIndex,
      active = (app.layer == l) or nil,
    }
    if l.isImage then
      local cel = l:cel(1)
      if cel and not cel.image:isEmpty() then
        local b = cel.image:shrinkBounds()
        info.content_bounds = { x = b.x + cel.position.x, y = b.y + cel.position.y, width = b.width, height = b.height }
      else
        info.empty = true
      end
    end
    return info
  end

  function U.spriteInfo(s)
    local sel = s.selection
    return {
      filename = s.filename,
      width = s.width,
      height = s.height,
      color_mode = U.modeName(s.colorMode),
      palette_size = #s.palettes[1],
      layer_count = #U.allLayers(s),
      modified = s.isModified,
      selection = (sel and not sel.isEmpty) and { x = sel.bounds.x, y = sel.bounds.y, width = sel.bounds.width, height = sel.bounds.height } or nil,
      active_layer = (app.layer and app.layer.sprite == s) and U.layerPath(app.layer) or nil,
    }
  end

  return U
end
