-- Drawing commands. All write into a full-canvas copy of the target layer
-- and commit it once, so each command is a single undoable change.
return function(def, U, json)
  --- Common boilerplate: resolve sprite/layer, get a working image + painter, run fn, commit.
  local function edit(p, fn)
    local s = U.sprite(p)
    local layer = U.layer(s, p)
    local img = U.canvasImage(s, layer)
    local P = U.painter(s, img, p)
    local extra = fn(s, layer, img, P)
    U.commitImage(s, layer, img)
    app.layer = layer
    local out = P.summary(extra)
    out.layer = U.layerPath(layer)
    return out
  end

  ---------------------------------------------------------------------------
  def("draw_pixel_map", { mutates = true, label = "draw pixel map" }, function(p)
    local rows = p.rows
    if type(rows) ~= "table" or #rows == 0 then U.fail("invalid_params", "'rows' must be a non-empty array of strings.") end
    if #rows > U.MAX_MAP then U.fail("invalid_params", "At most " .. U.MAX_MAP .. " rows per call.") end
    if type(p.legend) ~= "table" then U.fail("invalid_params", "'legend' must map single characters to colors.") end
    local ox, oy = U.int(p.x, "x", 0), U.int(p.y, "y", 0)
    local skip = p.transparent_char or "."
    return edit(p, function(s, layer, img, P)
      local values = {}
      for ch, color in pairs(p.legend) do
        if #ch ~= 1 then U.fail("invalid_params", "Legend keys must be single ASCII characters (got '" .. ch .. "').") end
        values[ch] = U.colorToPixel(s, color, "legend['" .. ch .. "']")
      end
      for ry, row in ipairs(rows) do
        if type(row) ~= "string" then U.fail("invalid_params", "Row " .. ry .. " is not a string.") end
        if #row > U.MAX_MAP then U.fail("invalid_params", "Row " .. ry .. " is longer than " .. U.MAX_MAP .. " characters.") end
        for rx = 1, #row do
          local ch = row:sub(rx, rx)
          if ch ~= skip and ch ~= " " then
            local v = values[ch]
            if v == nil then
              U.fail("invalid_params", string.format("Row %d column %d uses '%s', which is not in the legend.", ry, rx, ch))
            end
            P.set(ox + rx - 1, oy + ry - 1, v)
          end
        end
      end
    end)
  end)

  ---------------------------------------------------------------------------
  def("draw_pixels", { mutates = true, label = "draw pixels" }, function(p)
    return edit(p, function(s, layer, img, P)
      local default = p.color ~= nil and U.colorToPixel(s, p.color) or nil
      local list = p.pixels or {}
      if #list == 0 then U.fail("invalid_params", "'pixels' must be a non-empty array.") end
      if #list > 65536 then U.fail("invalid_params", "Too many pixels in one call (max 65536).") end
      local cache = {}
      for i, px in ipairs(list) do
        local x, y, c
        if px[1] ~= nil then x, y, c = px[1], px[2], px[3] else x, y, c = px.x, px.y, px.color end
        local v = default
        if c ~= nil then
          v = cache[c]
          if v == nil then v = U.colorToPixel(s, c, "pixels[" .. i .. "].color"); cache[c] = v end
        end
        if v == nil then U.fail("invalid_params", "pixels[" .. i .. "] has no color and no default 'color' was given.") end
        P.set(U.int(x, "x"), U.int(y, "y"), v)
      end
    end)
  end)

  ---------------------------------------------------------------------------
  local function bresenham(x0, y0, x1, y1, plot)
    local dx, dy = math.abs(x1 - x0), -math.abs(y1 - y0)
    local sx, sy = x0 < x1 and 1 or -1, y0 < y1 and 1 or -1
    local err = dx + dy
    while true do
      plot(x0, y0)
      if x0 == x1 and y0 == y1 then break end
      local e2 = 2 * err
      if e2 >= dy then err = err + dy; x0 = x0 + sx end
      if e2 <= dx then err = err + dx; y0 = y0 + sy end
    end
  end
  U.bresenham = bresenham

  def("draw_line", { mutates = true, label = "draw line" }, function(p)
    return edit(p, function(s, layer, img, P)
      local v = U.colorToPixel(s, p.color)
      local pts = {}
      if p.points then
        for i, pt in ipairs(p.points) do
          pts[#pts + 1] = { U.int(pt[1] or pt.x, "points[" .. i .. "].x"), U.int(pt[2] or pt.y, "points[" .. i .. "].y") }
        end
      else
        pts = { { U.int(p.x1, "x1"), U.int(p.y1, "y1") }, { U.int(p.x2, "x2"), U.int(p.y2, "y2") } }
      end
      if #pts < 2 then U.fail("invalid_params", "A line needs at least two points.") end
      local seen = {}
      for i = 1, #pts - 1 do
        bresenham(pts[i][1], pts[i][2], pts[i + 1][1], pts[i + 1][2], function(x, y)
          local k = y * 65536 + x
          if not seen[k] then seen[k] = true; P.set(x, y, v) end
        end)
      end
      if p.closed and #pts > 2 then
        bresenham(pts[#pts][1], pts[#pts][2], pts[1][1], pts[1][2], function(x, y)
          local k = y * 65536 + x
          if not seen[k] then seen[k] = true; P.set(x, y, v) end
        end)
      end
    end)
  end)

  ---------------------------------------------------------------------------
  def("draw_rect", { mutates = true, label = "draw rectangle" }, function(p)
    return edit(p, function(s, layer, img, P)
      local x, y = U.int(p.x, "x"), U.int(p.y, "y")
      local w, h = U.int(p.width, "width"), U.int(p.height, "height")
      if w < 1 or h < 1 then U.fail("invalid_params", "width and height must be >= 1") end
      local line = p.color ~= nil and U.colorToPixel(s, p.color) or nil
      local fill = p.fill_color ~= nil and U.colorToPixel(s, p.fill_color) or (p.fill and line) or nil
      if not line and not fill then U.fail("invalid_params", "Give 'color' (outline) and/or 'fill_color'.") end
      for yy = y, y + h - 1 do
        for xx = x, x + w - 1 do
          local edgePx = (xx == x or yy == y or xx == x + w - 1 or yy == y + h - 1)
          if edgePx and line then P.set(xx, yy, line)
          elseif fill then P.set(xx, yy, fill) end
        end
      end
    end)
  end)

  ---------------------------------------------------------------------------
  def("draw_ellipse", { mutates = true, label = "draw ellipse" }, function(p)
    return edit(p, function(s, layer, img, P)
      local x, y = U.int(p.x, "x"), U.int(p.y, "y")
      local w, h = U.int(p.width, "width"), U.int(p.height, "height")
      if w < 1 or h < 1 then U.fail("invalid_params", "width and height must be >= 1") end
      local line = p.color ~= nil and U.colorToPixel(s, p.color) or nil
      local fill = p.fill_color ~= nil and U.colorToPixel(s, p.fill_color) or (p.fill and line) or nil
      if not line and not fill then U.fail("invalid_params", "Give 'color' (outline) and/or 'fill_color'.") end
      local cx, cy = w / 2, h / 2
      local function inside(px, py)
        if px < 0 or py < 0 or px >= w or py >= h then return false end
        local dx = (px + 0.5 - cx) / cx
        local dy = (py + 0.5 - cy) / cy
        return dx * dx + dy * dy <= 1.0 + 1e-9
      end
      for py = 0, h - 1 do
        for px = 0, w - 1 do
          if inside(px, py) then
            local edgePx = not (inside(px - 1, py) and inside(px + 1, py) and inside(px, py - 1) and inside(px, py + 1))
            if edgePx and line then P.set(x + px, y + py, line)
            elseif fill then P.set(x + px, y + py, fill) end
          end
        end
      end
    end)
  end)

  ---------------------------------------------------------------------------
  --- RGBA distance (max channel delta) between two pixel values.
  local function distance(s, a, b, isBg)
    if a == b then return 0 end
    local r1, g1, b1, a1 = U.pixelToRGBA(s, a, isBg)
    local r2, g2, b2, a2 = U.pixelToRGBA(s, b, isBg)
    if a1 == 0 and a2 == 0 then return 0 end
    return math.max(math.abs(r1 - r2), math.abs(g1 - g2), math.abs(b1 - b2), math.abs(a1 - a2))
  end
  U.pixelDistance = distance

  def("fill", { mutates = true, label = "fill" }, function(p)
    return edit(p, function(s, layer, img, P)
      local v = U.colorToPixel(s, p.color)
      local sx, sy = U.int(p.x, "x"), U.int(p.y, "y")
      if not U.inCanvas(s, sx, sy) then U.fail("invalid_params", "Fill start point is outside the canvas.") end
      local tol = U.int(p.tolerance, "tolerance", 0)
      local isBg = layer.isBackground
      local target = img:getPixel(sx, sy)
      local W, H = s.width, s.height
      local diag = p.diagonal == true
      local function matches(x, y) return distance(s, img:getPixel(x, y), target, isBg) <= tol end
      local hits = {}
      if p.contiguous == false then
        for y = 0, H - 1 do
          for x = 0, W - 1 do
            if matches(x, y) then hits[#hits + 1] = { x, y } end
          end
        end
      else
        local seen = {}
        local stack = { { sx, sy } }
        seen[sy * W + sx] = true
        local dirs = diag and { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 }, { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } }
                          or { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }
        while #stack > 0 do
          local cur = table.remove(stack)
          hits[#hits + 1] = cur
          for _, d in ipairs(dirs) do
            local nx, ny = cur[1] + d[1], cur[2] + d[2]
            if nx >= 0 and ny >= 0 and nx < W and ny < H then
              local k = ny * W + nx
              if not seen[k] then
                seen[k] = true
                if matches(nx, ny) then stack[#stack + 1] = { nx, ny } end
              end
            end
          end
        end
      end
      for _, h in ipairs(hits) do P.set(h[1], h[2], v) end
    end)
  end)

  ---------------------------------------------------------------------------
  def("erase", { mutates = true, label = "erase" }, function(p)
    return edit(p, function(s, layer, img, P)
      if layer.isBackground then
        U.fail("not_drawable", "Can't erase on the Background layer (it has no transparency). Paint over it, or erase on another layer.")
      end
      local t = U.transparentPixel(s)
      if p.pixels then
        for i, px in ipairs(p.pixels) do
          local x, y = px[1] or px.x, px[2] or px.y
          P.set(U.int(x, "pixels[" .. i .. "].x"), U.int(y, "pixels[" .. i .. "].y"), t)
        end
      else
        local r = U.region(s, p.region)
        for y = r.y, r.y + r.height - 1 do
          for x = r.x, r.x + r.width - 1 do
            if img:getPixel(x, y) ~= t then P.set(x, y, t) end
          end
        end
      end
    end)
  end)

  ---------------------------------------------------------------------------
  local function replaceOn(s, layer, p, from, to, tol, rect)
    local img = U.canvasImage(s, layer)
    local P = U.painter(s, img, p)
    local isBg = layer.isBackground
    for y = rect.y, rect.y + rect.height - 1 do
      for x = rect.x, rect.x + rect.width - 1 do
        local cur = img:getPixel(x, y)
        if cur ~= to and distance(s, cur, from, isBg) <= tol then P.set(x, y, to) end
      end
    end
    if P.written > 0 then U.commitImage(s, layer, img) end
    return P.written
  end

  def("replace_color", { mutates = true, label = "replace color" }, function(p)
    local s = U.sprite(p)
    local from = U.colorToPixel(s, p.from, "from")
    local to = U.colorToPixel(s, p.to, "to")
    local tol = U.int(p.tolerance, "tolerance", 0)
    local rect = U.region(s, p.region)
    local total, layers = 0, json.array({})
    if p.all_layers then
      for _, e in ipairs(U.allLayers(s)) do
        if e.layer.isImage and not e.layer.isTilemap then
          local n = replaceOn(s, e.layer, p, from, to, tol, rect)
          if n > 0 then layers[#layers + 1] = e.path; total = total + n end
        end
      end
    else
      local layer = U.layer(s, p)
      total = replaceOn(s, layer, p, from, to, tol, rect)
      layers[1] = U.layerPath(layer)
    end
    return { pixels_changed = total, layers = layers }
  end)

  ---------------------------------------------------------------------------
  def("outline", { mutates = true, label = "outline" }, function(p)
    return edit(p, function(s, layer, img, P)
      local v = U.colorToPixel(s, p.color)
      local mode = p.mode or "outside"
      if mode ~= "outside" and mode ~= "inside" then U.fail("invalid_params", "mode must be 'outside' or 'inside'") end
      local corners = p.corners == true
      local isBg = layer.isBackground
      local W, H = s.width, s.height
      local snap = img:clone()
      local function opaque(x, y)
        if x < 0 or y < 0 or x >= W or y >= H then return false end
        local _, _, _, a = U.pixelToRGBA(s, snap:getPixel(x, y), isBg)
        return a > 0
      end
      local dirs = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }
      if corners then
        dirs[#dirs + 1] = { 1, 1 }; dirs[#dirs + 1] = { 1, -1 }; dirs[#dirs + 1] = { -1, 1 }; dirs[#dirs + 1] = { -1, -1 }
      end
      for y = 0, H - 1 do
        for x = 0, W - 1 do
          local o = opaque(x, y)
          if (mode == "outside" and not o) or (mode == "inside" and o) then
            for _, d in ipairs(dirs) do
              if opaque(x + d[1], y + d[2]) ~= o then
                P.set(x, y, v)
                break
              end
            end
          end
        end
      end
    end)
  end)

  ---------------------------------------------------------------------------
  local BAYER2 = { { 0, 2 }, { 3, 1 } }
  local BAYER4 = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
  --- Recursive Bayer construction: M(2n) = [[4M, 4M+2], [4M+3, 4M+1]].
  local function bayerDouble(m)
    local n = #m
    local out = {}
    for y = 1, 2 * n do out[y] = {} end
    for y = 1, n do
      for x = 1, n do
        local v = 4 * m[y][x]
        out[y][x] = v
        out[y][x + n] = v + 2
        out[y + n][x] = v + 3
        out[y + n][x + n] = v + 1
      end
    end
    return out
  end
  local function bayer8() return bayerDouble(BAYER4) end
  local BAYER8 = bayer8()

  def("draw_gradient", { mutates = true, label = "gradient" }, function(p)
    return edit(p, function(s, layer, img, P)
      local colors = p.colors
      if type(colors) ~= "table" or #colors < 2 then U.fail("invalid_params", "'colors' needs at least two colors (ordered from start to end).") end
      local vals = {}
      for i, c in ipairs(colors) do vals[i] = U.colorToPixel(s, c, "colors[" .. i .. "]") end
      local r = U.region(s, { x = p.x, y = p.y, width = p.width, height = p.height })
      local dir = p.direction or "vertical"
      local dither = p.dither or "bayer4"
      local matrix, n = nil, 1
      if dither == "bayer2" then matrix, n = BAYER2, 2
      elseif dither == "bayer4" then matrix, n = BAYER4, 4
      elseif dither == "bayer8" then matrix, n = BAYER8, 8
      elseif dither ~= "none" then U.fail("invalid_params", "dither must be none, bayer2, bayer4 or bayer8") end
      local onlyOpaque = p.only_opaque == true
      local isBg = layer.isBackground
      local K = #vals
      local x0, y0, w, h = r.x, r.y, r.width, r.height
      local cx, cy = x0 + (w - 1) / 2, y0 + (h - 1) / 2
      local maxR = math.sqrt(((w - 1) / 2) ^ 2 + ((h - 1) / 2) ^ 2)
      for py = y0, y0 + h - 1 do
        for px = x0, x0 + w - 1 do
          local skip = false
          if onlyOpaque then
            local _, _, _, a = U.pixelToRGBA(s, img:getPixel(px, py), isBg)
            skip = a == 0
          end
          if not skip then
            local tx = w > 1 and (px - x0) / (w - 1) or 0
            local ty = h > 1 and (py - y0) / (h - 1) or 0
            local t
            if dir == "horizontal" then t = tx
            elseif dir == "vertical" then t = ty
            elseif dir == "diagonal_down" then t = (tx + ty) / 2
            elseif dir == "diagonal_up" then t = (tx + (1 - ty)) / 2
            elseif dir == "radial" then t = maxR > 0 and math.min(1, math.sqrt((px - cx) ^ 2 + (py - cy) ^ 2) / maxR) or 0
            else U.fail("invalid_params", "direction must be horizontal, vertical, diagonal_down, diagonal_up or radial") end
            if p.reverse then t = 1 - t end
            local pos = t * (K - 1)
            local i = math.floor(pos)
            if i >= K - 1 then i = K - 1 end
            local f = pos - i
            local threshold = 0.5
            if matrix then threshold = (matrix[(py % n) + 1][(px % n) + 1] + 0.5) / (n * n) end
            local idx = (f > threshold and i + 1 <= K - 1) and i + 2 or i + 1
            P.set(px, py, vals[idx])
          end
        end
      end
    end)
  end)
end
