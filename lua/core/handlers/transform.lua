-- Pixel transforms on a layer, scoped to a region (default: selection bounds,
-- else the whole canvas; rotate defaults to the layer's content bounds).
return function(def, U, json)
  local function scopeRect(s, layer, img, p, useContent)
    if p.region then return U.region(s, p.region) end
    local sel = s.selection
    if sel and not sel.isEmpty and p.respect_selection ~= false then
      local b = sel.bounds
      return U.region(s, { x = b.x, y = b.y, width = b.width, height = b.height })
    end
    if useContent then
      if img:isEmpty() then U.fail("empty_image", "The layer is empty; nothing to transform.") end
      local b = img:shrinkBounds(U.transparentPixel(s))
      return { x = b.x, y = b.y, width = b.width, height = b.height }
    end
    return { x = 0, y = 0, width = s.width, height = s.height }
  end

  --- Read a region into a 2D table [y][x] (0-based offsets).
  local function grab(img, r)
    local g = {}
    for y = 0, r.height - 1 do
      local row = {}
      for x = 0, r.width - 1 do row[x] = img:getPixel(r.x + x, r.y + y) end
      g[y] = row
    end
    return g
  end

  local function prep(p, useContent)
    local s = U.sprite(p)
    local layer = U.layer(s, p)
    local img = U.canvasImage(s, layer)
    local r = scopeRect(s, layer, img, p, useContent)
    return s, layer, img, r
  end

  local function finish(s, layer, img, r, extra)
    U.commitImage(s, layer, img)
    local out = { layer = U.layerPath(layer), region = r }
    if extra then for k, v in pairs(extra) do out[k] = v end end
    return out
  end

  def("flip", { mutates = true, label = "flip" }, function(p)
    local s, layer, img, r = prep(p, false)
    local g = grab(img, r)
    local horiz = (p.direction or "horizontal") == "horizontal"
    for y = 0, r.height - 1 do
      for x = 0, r.width - 1 do
        local v = horiz and g[y][r.width - 1 - x] or g[r.height - 1 - y][x]
        img:drawPixel(r.x + x, r.y + y, v)
      end
    end
    return finish(s, layer, img, r, { direction = horiz and "horizontal" or "vertical" })
  end)

  def("rotate", { mutates = true, label = "rotate" }, function(p)
    local angle = U.int(p.angle, "angle")
    angle = angle % 360
    if angle ~= 90 and angle ~= 180 and angle ~= 270 then U.fail("invalid_params", "angle must be 90, 180 or 270 (clockwise).") end
    local s, layer, img, r = prep(p, true)
    local g = grab(img, r)
    local t = U.transparentPixel(s)
    for y = r.y, r.y + r.height - 1 do
      for x = r.x, r.x + r.width - 1 do img:drawPixel(x, y, t) end
    end
    local nw, nh = r.width, r.height
    if angle ~= 180 then nw, nh = r.height, r.width end
    -- Keep the region centred where it was.
    local nx = r.x + (r.width - nw) // 2
    local ny = r.y + (r.height - nh) // 2
    local clipped = 0
    for sy = 0, r.height - 1 do
      for sx = 0, r.width - 1 do
        local dx, dy
        if angle == 90 then dx, dy = r.height - 1 - sy, sx
        elseif angle == 180 then dx, dy = r.width - 1 - sx, r.height - 1 - sy
        else dx, dy = sy, r.width - 1 - sx end
        local X, Y = nx + dx, ny + dy
        if U.inCanvas(s, X, Y) then img:drawPixel(X, Y, g[sy][sx]) else clipped = clipped + 1 end
      end
    end
    return finish(s, layer, img, { x = nx, y = ny, width = nw, height = nh }, { angle = angle, pixels_clipped = clipped > 0 and clipped or nil })
  end)

  def("shift", { mutates = true, label = "shift" }, function(p)
    local dx, dy = U.int(p.dx, "dx", 0), U.int(p.dy, "dy", 0)
    local s, layer, img, r = prep(p, false)
    local g = grab(img, r)
    local t = U.transparentPixel(s)
    local wrap = p.wrap == true
    for y = 0, r.height - 1 do
      for x = 0, r.width - 1 do
        local sx, sy = x - dx, y - dy
        local v
        if wrap then
          v = g[sy % r.height][sx % r.width]
        elseif sx >= 0 and sy >= 0 and sx < r.width and sy < r.height then
          v = g[sy][sx]
        else
          v = t
        end
        img:drawPixel(r.x + x, r.y + y, v)
      end
    end
    return finish(s, layer, img, r, { dx = dx, dy = dy, wrap = wrap })
  end)

  def("mirror", { mutates = true, label = "mirror" }, function(p)
    local s, layer, img, r = prep(p, false)
    local source = p.source or "left"
    local g = grab(img, r)
    local W, H = r.width, r.height
    local n = 0
    if source == "left" or source == "right" then
      for y = 0, H - 1 do
        for x = 0, W // 2 - 1 do
          local src = source == "left" and x or (W - 1 - x)
          local dst = W - 1 - src
          img:drawPixel(r.x + dst, r.y + y, g[y][src]); n = n + 1
        end
      end
    elseif source == "top" or source == "bottom" then
      for y = 0, H // 2 - 1 do
        local src = source == "top" and y or (H - 1 - y)
        local dst = H - 1 - src
        for x = 0, W - 1 do
          img:drawPixel(r.x + x, r.y + dst, g[src][x]); n = n + 1
        end
      end
    else
      U.fail("invalid_params", "source must be left, right, top or bottom")
    end
    return finish(s, layer, img, r, { source = source, pixels_written = n })
  end)

  def("copy_region", { mutates = true, label = "copy region" }, function(p)
    local s = U.sprite(p)
    local from = p.from_layer and U.layer(s, { layer = p.from_layer }) or U.layer(s, p)
    local to = p.to_layer and U.layer(s, { layer = p.to_layer }) or from
    local r = U.region(s, { x = p.x, y = p.y, width = p.width, height = p.height })
    local srcImg = U.canvasImage(s, from)
    local g = grab(srcImg, r)
    local dstImg = (to == from) and srcImg or U.canvasImage(s, to)
    local tx, ty = U.int(p.to_x, "to_x"), U.int(p.to_y, "to_y")
    local skipT = p.skip_transparent ~= false
    local fh, fv = p.flip_horizontal == true, p.flip_vertical == true
    local P = U.painter(s, dstImg, { respect_selection = false })
    for y = 0, r.height - 1 do
      for x = 0, r.width - 1 do
        local sx = fh and (r.width - 1 - x) or x
        local sy = fv and (r.height - 1 - y) or y
        local v = g[sy][sx]
        local _, _, _, a = U.pixelToRGBA(s, v, from.isBackground)
        if not (skipT and a == 0) then P.set(tx + x, ty + y, v) end
      end
    end
    U.commitImage(s, to, dstImg)
    return P.summary({ from_layer = U.layerPath(from), to_layer = U.layerPath(to), source = r, to_x = tx, to_y = ty })
  end)
end
