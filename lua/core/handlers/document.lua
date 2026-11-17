-- Document-level commands: create/open/save/export, canvas size, crop.
return function(def, U, json)
  local MODES = { rgb = ColorMode.RGB, rgba = ColorMode.RGB, indexed = ColorMode.INDEXED, gray = ColorMode.GRAY, grayscale = ColorMode.GRAY }

  local function ensureDir(path)
    local dir = app.fs.filePath(path)
    if dir ~= "" and not app.fs.isDirectory(dir) then app.fs.makeAllDirectories(dir) end
  end

  local function isAsepriteFile(path)
    local ext = (app.fs.fileExtension(path) or ""):lower()
    return ext == "aseprite" or ext == "ase"
  end

  --- Build a Palette from a list of color strings. In indexed mode index 0 is
  -- reserved for transparency, so colors start at index 1.
  local function buildPalette(colors, indexed)
    local list = {}
    if indexed then list[1] = Color { r = 0, g = 0, b = 0, a = 0 } end
    for i, c in ipairs(colors) do
      local r, g, b, a = U.parseHex(c)
      if not r then U.fail("invalid_color", "Palette color #" .. i .. " ('" .. tostring(c) .. "') is not a valid hex color.") end
      list[#list + 1] = Color { r = r, g = g, b = b, a = a }
    end
    if #list > 256 then U.fail("invalid_params", "Palettes are limited to 256 colors.") end
    local pal = Palette(math.max(1, #list))
    for i, c in ipairs(list) do pal:setColor(i - 1, c) end
    return pal
  end
  U.buildPalette = buildPalette

  --- Load a palette from params.palette (list), params.palette_resource (id) or params.palette_file.
  function U.paletteFromParams(params, indexed)
    if params.palette and #params.palette > 0 then
      return buildPalette(params.palette, indexed)
    end
    local src
    if params.palette_resource and params.palette_resource ~= "" then
      local ok, p = pcall(function() return Palette { fromResource = params.palette_resource } end)
      if not ok or not p then
        U.fail("palette_not_found", "No palette preset with id '" .. params.palette_resource .. "'. Use list_palette_presets (ids are case-sensitive).")
      end
      src = p
    elseif params.palette_file and params.palette_file ~= "" then
      if not app.fs.isFile(params.palette_file) then U.fail("file_not_found", "Palette file not found: " .. params.palette_file) end
      local ok, p = pcall(function() return Palette { fromFile = params.palette_file } end)
      if not ok or not p then U.fail("palette_load_failed", "Could not load palette file " .. params.palette_file) end
      src = p
    end
    if not src then return nil end
    local colors = {}
    for i = 0, #src - 1 do
      local c = src:getColor(i)
      if not (indexed and c.alpha == 0) then
        colors[#colors + 1] = string.format("#%02x%02x%02x%02x", c.red, c.green, c.blue, c.alpha)
      end
    end
    return buildPalette(colors, indexed)
  end

  def("new_sprite", {}, function(p, ctx)
    local w = U.int(p.width, "width")
    local h = U.int(p.height, "height")
    if w < 1 or h < 1 or w > U.MAX_CANVAS or h > U.MAX_CANVAS then
      U.fail("invalid_params", "Canvas size must be between 1 and " .. U.MAX_CANVAS .. " pixels per side.")
    end
    local mode = MODES[(p.color_mode or "rgb"):lower()]
    if not mode then U.fail("invalid_params", "color_mode must be rgb, indexed or gray.") end
    local indexed = mode == ColorMode.INDEXED
    local pal = U.paletteFromParams(p, indexed)

    local s = Sprite(w, h, mode)
    app.sprite = s
    app.transaction("Claude: setup sprite", function()
      if pal then s:setPalette(pal) end
      local base = s.layers[1]
      if p.background and p.background ~= "" and p.background ~= "transparent" then
        local v = U.colorToPixel(s, p.background, "background")
        local img = Image(s.spec)
        img:clear(v)
        s:newCel(base, 1, img, Point(0, 0))
        app.layer = base
        app.command.BackgroundFromLayer()
        local top = s:newLayer()
        top.name = p.layer_name or "Layer 1"
        app.layer = top
      else
        base.name = p.layer_name or "Layer 1"
        app.layer = base
      end
    end)
    if p.path and p.path ~= "" then
      if not isAsepriteFile(p.path) then U.fail("invalid_params", "new_sprite path must end in .aseprite or .ase (use export_image for PNG).") end
      ensureDir(p.path)
      s:saveAs(p.path)
    end
    ctx.mutated = true
    ctx.current_file = s.filename
    return U.spriteInfo(s)
  end)

  def("open_sprite", {}, function(p, ctx)
    local path = p.path
    if not path or path == "" then U.fail("invalid_params", "Missing 'path'.") end
    local norm = path:lower():gsub("\\", "/")
    for _, s in ipairs(app.sprites) do
      if (s.filename or ""):lower():gsub("\\", "/") == norm then
        app.sprite = s
        ctx.current_file = s.filename
        return U.spriteInfo(s)
      end
    end
    if not app.fs.isFile(path) then U.fail("file_not_found", "File not found: " .. path) end
    local s = app.open(path)
    if not s then U.fail("open_failed", "Aseprite could not open " .. path) end
    app.sprite = s
    ctx.current_file = s.filename
    return U.spriteInfo(s)
  end)

  def("save_sprite", {}, function(p, ctx)
    local s = U.sprite(p)
    local path = p.path
    if not path or path == "" then
      local fn = s.filename or ""
      if fn ~= "" and app.fs.filePath(fn) ~= "" and isAsepriteFile(fn) then
        path = fn
      else
        path = p.default_path
      end
    end
    if not path or path == "" then U.fail("invalid_params", "This sprite has never been saved; pass a 'path' ending in .aseprite.") end
    if not isAsepriteFile(path) then
      U.fail("invalid_params", "save_sprite writes .aseprite/.ase files. Use export_image for PNG/GIF/etc.")
    end
    ensureDir(path)
    s:saveAs(path)
    ctx.current_file = s.filename
    ctx.saved = true
    return { saved = s.filename }
  end)

  def("export_image", {}, function(p, ctx)
    local s = U.sprite(p)
    local path = p.path
    if not path or path == "" then U.fail("invalid_params", "Missing 'path'.") end
    if isAsepriteFile(path) then U.fail("invalid_params", "Use save_sprite for .aseprite files; export_image writes PNG/GIF/BMP/etc.") end
    local scale = U.int(p.scale, "scale", 1)
    if scale < 1 or scale > 32 then U.fail("invalid_params", "scale must be 1..32") end
    local flat = U.flattenImage(s, p.layer)
    local rect = U.region(s, p.region)
    if p.trim then
      local tc = U.transparentPixel(s)
      local sub = Image(flat, Rectangle(rect.x, rect.y, rect.width, rect.height))
      if sub:isEmpty() then U.fail("empty_image", "Nothing to export: the image is fully transparent.") end
      local b = sub:shrinkBounds(tc)
      rect = { x = rect.x + b.x, y = rect.y + b.y, width = b.width, height = b.height }
    end
    local out = Image(rect.width * scale, rect.height * scale, ColorMode.RGB)
    out:clear(0)
    local pc = app.pixelColor
    for y = 0, rect.height - 1 do
      for x = 0, rect.width - 1 do
        local r, g, b, a = U.pixelToRGBA(s, flat:getPixel(rect.x + x, rect.y + y), false)
        if a > 0 then
          local v = pc.rgba(r, g, b, a)
          for yy = 0, scale - 1 do
            for xx = 0, scale - 1 do out:drawPixel(x * scale + xx, y * scale + yy, v) end
          end
        end
      end
    end
    ensureDir(path)
    out:saveAs(path)
    return { exported = path, width = out.width, height = out.height, scale = scale, source_region = rect }
  end)

  def("resize_sprite", { mutates = true, label = "resize sprite" }, function(p)
    local s = U.sprite(p)
    local w, h
    if p.scale then
      local f = tonumber(p.scale)
      if not f or f <= 0 then U.fail("invalid_params", "scale must be > 0") end
      w, h = math.floor(s.width * f + 0.5), math.floor(s.height * f + 0.5)
    else
      w = U.int(p.width, "width", s.width)
      h = U.int(p.height, "height", s.height)
    end
    if w < 1 or h < 1 or w > U.MAX_CANVAS or h > U.MAX_CANVAS then
      U.fail("invalid_params", "Size must be between 1 and " .. U.MAX_CANVAS)
    end
    s:resize(w, h)
    return U.spriteInfo(s)
  end)

  local ANCHORS = {
    ["top-left"] = { 0, 0 }, top = { 0.5, 0 }, ["top-right"] = { 1, 0 },
    left = { 0, 0.5 }, center = { 0.5, 0.5 }, right = { 1, 0.5 },
    ["bottom-left"] = { 0, 1 }, bottom = { 0.5, 1 }, ["bottom-right"] = { 1, 1 },
  }

  def("canvas_size", { mutates = true, label = "canvas size" }, function(p)
    local s = U.sprite(p)
    local x, y, w, h
    if p.left or p.top or p.right or p.bottom then
      local l, t = U.int(p.left, "left", 0), U.int(p.top, "top", 0)
      local r, b = U.int(p.right, "right", 0), U.int(p.bottom, "bottom", 0)
      x, y, w, h = -l, -t, s.width + l + r, s.height + t + b
    else
      w = U.int(p.width, "width", s.width)
      h = U.int(p.height, "height", s.height)
      local a = ANCHORS[(p.anchor or "center"):lower()]
      if not a then U.fail("invalid_params", "anchor must be one of top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right") end
      x = -math.floor((w - s.width) * a[1])
      y = -math.floor((h - s.height) * a[2])
    end
    if w < 1 or h < 1 or w > U.MAX_CANVAS or h > U.MAX_CANVAS then
      U.fail("invalid_params", "Resulting canvas must be between 1 and " .. U.MAX_CANVAS .. " pixels per side.")
    end
    s:crop(x, y, w, h)
    return U.spriteInfo(s)
  end)

  def("crop", { mutates = true, label = "crop" }, function(p)
    local s = U.sprite(p)
    local rect
    if p.trim or not p.region then
      local flat = U.flattenImage(s, p.layer)
      if flat:isEmpty() then U.fail("empty_image", "Nothing to trim: the image is fully transparent.") end
      local b = flat:shrinkBounds(U.transparentPixel(s))
      local m = U.int(p.margin, "margin", 0)
      rect = { x = b.x - m, y = b.y - m, width = b.width + 2 * m, height = b.height + 2 * m }
    else
      rect = U.region(s, p.region)
    end
    s:crop(rect.x, rect.y, rect.width, rect.height)
    return U.spriteInfo(s)
  end)
end
