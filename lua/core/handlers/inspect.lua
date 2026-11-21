-- Read-only inspection commands.
return function(def, U, json, D)
  local GRID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=?@^~!:;<>/|-_()[]{}"
  local MAX_READ = 128 * 128

  def("status", {}, function(p, ctx)
    local sprites = json.array({})
    for _, s in ipairs(app.sprites) do
      local info = U.spriteInfo(s)
      info.active = (s == app.sprite) or nil
      sprites[#sprites + 1] = info
    end
    local fg = app.fgColor
    return {
      bridge_version = D.VERSION,
      aseprite_version = tostring(app.version),
      api_version = app.apiVersion,
      sprites = sprites,
      active_sprite = app.sprite and U.spriteInfo(app.sprite) or nil,
      foreground_color = fg and U.colorToHex(fg) or nil,
    }
  end)

  def("render", {}, function(p)
    local s = U.sprite(p)
    local rect = U.region(s, p.region)
    local img = U.flattenImage(s, p.layer)
    local bytes
    if s.colorMode == ColorMode.RGB and rect.x == 0 and rect.y == 0
       and rect.width == img.width and rect.height == img.height
       and img.rowStride == img.width * 4 then
      bytes = img.bytes
    else
      bytes = U.rgbaBytes(s, img, rect, false)
    end
    return {
      x = rect.x, y = rect.y, width = rect.width, height = rect.height,
      sprite_width = s.width, sprite_height = s.height,
      rgba = U.base64(bytes),
    }
  end)

  def("read_pixels", {}, function(p)
    local s = U.sprite(p)
    local rect = U.region(s, p.region)
    if rect.width * rect.height > MAX_READ then
      U.fail("region_too_large", string.format("Region %dx%d is too large to read as text (max %d pixels). Read a smaller region or use render_preview.", rect.width, rect.height, MAX_READ))
    end
    local img = U.flattenImage(s, p.layer)
    local legend = json.object({})
    local charFor = {}
    local nextChar = 1
    local rows = json.array({})
    for y = rect.y, rect.y + rect.height - 1 do
      local line = {}
      for x = rect.x, rect.x + rect.width - 1 do
        local hex = U.pixelToHex(s, img:getPixel(x, y), false)
        local ch
        if hex == "transparent" then
          ch = "."
        else
          ch = charFor[hex]
          if not ch then
            if nextChar > #GRID_CHARS then
              U.fail("too_many_colors", "Region has more than " .. #GRID_CHARS .. " colors; read a smaller region or use render_preview.")
            end
            ch = GRID_CHARS:sub(nextChar, nextChar)
            nextChar = nextChar + 1
            charFor[hex] = ch
            legend[ch] = hex
          end
        end
        line[#line + 1] = ch
      end
      rows[#rows + 1] = table.concat(line)
    end
    return {
      x = rect.x, y = rect.y, width = rect.width, height = rect.height,
      transparent_char = ".", legend = legend, rows = rows,
    }
  end)

  def("analyze", {}, function(p)
    local s = U.sprite(p)
    local rect = U.region(s, p.region)
    local img = U.flattenImage(s, p.layer)
    local W, H = rect.width, rect.height
    -- Snapshot hex colors into a grid for neighbour checks.
    local grid = {}
    local counts = {}
    local opaque = 0
    local minx, miny, maxx, maxy = math.huge, math.huge, -1, -1
    for y = 0, H - 1 do
      local row = {}
      for x = 0, W - 1 do
        local hex = U.pixelToHex(s, img:getPixel(rect.x + x, rect.y + y), false)
        if hex ~= "transparent" then
          row[x] = hex
          counts[hex] = (counts[hex] or 0) + 1
          opaque = opaque + 1
          if x < minx then minx = x end
          if y < miny then miny = y end
          if x > maxx then maxx = x end
          if y > maxy then maxy = y end
        end
      end
      grid[y] = row
    end
    local function at(x, y)
      if x < 0 or y < 0 or x >= W or y >= H then return nil end
      return grid[y][x]
    end

    local colors = json.array({})
    for hex, n in pairs(counts) do colors[#colors + 1] = { color = hex, count = n } end
    table.sort(colors, function(a, b) if a.count ~= b.count then return a.count > b.count end return a.color < b.color end)

    local isolated = json.array({})
    local isolatedCount = 0
    local islands = json.array({})
    local islandCount = 0
    for y = 0, H - 1 do
      for x = 0, W - 1 do
        local c = grid[y][x]
        if c then
          local anyOpaque, sameColor = false, false
          for dy = -1, 1 do
            for dx = -1, 1 do
              if dx ~= 0 or dy ~= 0 then
                local n = at(x + dx, y + dy)
                if n then
                  anyOpaque = true
                  if n == c and (dx == 0 or dy == 0) then sameColor = true end
                end
              end
            end
          end
          if not anyOpaque then
            isolatedCount = isolatedCount + 1
            if #isolated < 50 then isolated[#isolated + 1] = { x = rect.x + x, y = rect.y + y, color = c } end
          elseif not sameColor then
            islandCount = islandCount + 1
            if #islands < 30 then islands[#islands + 1] = { x = rect.x + x, y = rect.y + y, color = c } end
          end
        end
      end
    end

    -- Near-duplicate colors (wasteful palette entries / accidental mismatches).
    local near = json.array({})
    local list = {}
    for hex in pairs(counts) do list[#list + 1] = hex end
    table.sort(list)
    local threshold = U.int(p.near_threshold, "near_threshold", 12)
    for i = 1, #list do
      local r1, g1, b1, a1 = U.parseHex(list[i])
      for j = i + 1, #list do
        local r2, g2, b2, a2 = U.parseHex(list[j])
        local d = math.max(math.abs(r1 - r2), math.abs(g1 - g2), math.abs(b1 - b2), math.abs(a1 - a2))
        if d <= threshold and #near < 20 then near[#near + 1] = { list[i], list[j] } end
      end
    end

    -- Palette relationship.
    local pal = U.palette(s)
    local inPalette = {}
    for i = 0, #pal - 1 do
      local c = pal:getColor(i)
      if c.alpha > 0 then inPalette[U.colorToHex(c)] = i end
    end
    local offPalette = json.array({})
    for _, hex in ipairs(list) do
      if inPalette[hex] == nil then offPalette[#offPalette + 1] = hex end
    end
    local unused = json.array({})
    for hex in pairs(inPalette) do
      if not counts[hex] then unused[#unused + 1] = hex end
    end
    table.sort(unused)

    return {
      region = rect,
      opaque_pixels = opaque,
      total_pixels = W * H,
      content_bounds = (maxx >= 0) and { x = rect.x + minx, y = rect.y + miny, width = maxx - minx + 1, height = maxy - miny + 1 } or nil,
      color_count = #colors,
      colors = colors,
      isolated_pixels = { count = isolatedCount, samples = isolated, note = "Opaque pixels with no opaque neighbours (stray pixels)." },
      single_pixel_color_islands = { count = islandCount, samples = islands, note = "Pixels with no same-colored orthogonal neighbour. Often intentional highlights; many of them can indicate noise." },
      near_duplicate_colors = near,
      colors_not_in_palette = offPalette,
      unused_palette_colors = unused,
    }
  end)
end
