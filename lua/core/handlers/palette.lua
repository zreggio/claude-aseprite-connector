-- Palette and color-mode commands.
return function(def, U, json)
  local function paletteList(s)
    local pal = U.palette(s)
    local colors = json.array({})
    for i = 0, #pal - 1 do
      local c = pal:getColor(i)
      colors[#colors + 1] = string.format("#%02x%02x%02x", c.red, c.green, c.blue) .. (c.alpha < 255 and string.format("%02x", c.alpha) or "")
    end
    return colors
  end

  def("get_palette", {}, function(p)
    local s = U.sprite(p)
    return {
      colors = paletteList(s),
      size = #U.palette(s),
      color_mode = U.modeName(s.colorMode),
      transparent_index = s.colorMode == ColorMode.INDEXED and s.transparentColor or nil,
      note = "Index i in 'colors' is palette index i (0-based).",
    }
  end)

  def("set_palette", { mutates = true, label = "set palette" }, function(p)
    local s = U.sprite(p)
    local pal = U.paletteFromParams(p, s.colorMode == ColorMode.INDEXED)
    if not pal then U.fail("invalid_params", "Give 'palette' (list of hex colors), 'palette_resource' or 'palette_file'.") end
    s:setPalette(pal)
    return { colors = paletteList(s), size = #U.palette(s) }
  end)

  def("add_palette_colors", { mutates = true, label = "add palette colors" }, function(p)
    local s = U.sprite(p)
    local colors = p.colors
    if type(colors) ~= "table" or #colors == 0 then U.fail("invalid_params", "'colors' must be a non-empty list of hex colors.") end
    local pal = U.palette(s)
    local indices = json.object({})
    local added = 0
    local newPal = Palette(#pal)
    for i = 0, #pal - 1 do newPal:setColor(i, pal:getColor(i)) end
    for i, hex in ipairs(colors) do
      local r, g, b, a = U.parseHex(hex)
      if not r then U.fail("invalid_color", "colors[" .. i .. "] '" .. tostring(hex) .. "' is not a hex color.") end
      local existing
      for j = 0, #newPal - 1 do
        local c = newPal:getColor(j)
        if c.red == r and c.green == g and c.blue == b and c.alpha == a
           and not (s.colorMode == ColorMode.INDEXED and j == s.transparentColor) then existing = j break end
      end
      if existing then
        indices[hex] = existing
      else
        if #newPal >= 256 then U.fail("palette_full", "The palette already has 256 colors.") end
        newPal:resize(#newPal + 1)
        newPal:setColor(#newPal - 1, Color { r = r, g = g, b = b, a = a })
        indices[hex] = #newPal - 1
        added = added + 1
      end
    end
    s:setPalette(newPal)
    return { added = added, indices = indices, size = #U.palette(s) }
  end)

  def("set_color_mode", { mutates = true, label = "change color mode" }, function(p)
    local s = U.sprite(p)
    local mode = (p.mode or ""):lower()
    if mode == "grayscale" then mode = "gray" end
    if mode ~= "rgb" and mode ~= "indexed" and mode ~= "gray" then U.fail("invalid_params", "mode must be rgb, indexed or gray") end
    app.sprite = s
    app.command.ChangePixelFormat { format = mode, dithering = p.dithering or "none" }
    return U.spriteInfo(s)
  end)
end
