-- Minimal, dependency-free JSON encoder/decoder for the Claude Bridge.
-- Aseprite ships a `json` global, but it decodes into proxy objects; this
-- module works with plain Lua tables so handlers can use ipairs/pairs freely.

local json = {}

-- Sentinels -----------------------------------------------------------------
json.null = setmetatable({}, { __tostring = function() return "null" end, __jsontype = "null" })

local OBJECT_MT = { __jsontype = "object" }
local ARRAY_MT = { __jsontype = "array" }

--- Mark a table so it always encodes as a JSON object (even when empty).
function json.object(t) return setmetatable(t or {}, OBJECT_MT) end
--- Mark a table so it always encodes as a JSON array (even when empty).
function json.array(t) return setmetatable(t or {}, ARRAY_MT) end

-- Encoding -------------------------------------------------------------------
local escapes = {
  ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
  ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function encode_string(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return escapes[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function is_array(t)
  local mt = getmetatable(t)
  if mt and mt.__jsontype == "array" then return true end
  if mt and mt.__jsontype == "object" then return false end
  local n = 0
  for k in pairs(t) do
    if math.type(k) ~= "integer" or k < 1 then return false end
    n = n + 1
  end
  for i = 1, n do
    if t[i] == nil then return false end
  end
  return true -- empty tables encode as []
end

local encode_value

local function encode_table(t, out, seen)
  if seen[t] then error("json.encode: circular reference") end
  seen[t] = true
  if is_array(t) then
    out[#out + 1] = "["
    for i = 1, #t do
      if i > 1 then out[#out + 1] = "," end
      encode_value(t[i], out, seen)
    end
    out[#out + 1] = "]"
  else
    out[#out + 1] = "{"
    -- Sort keys for deterministic output (helps tests and diffs).
    local keys = {}
    for k in pairs(t) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    for i, k in ipairs(keys) do
      if i > 1 then out[#out + 1] = "," end
      out[#out + 1] = encode_string(k)
      out[#out + 1] = ":"
      local v = t[k]
      if v == nil then v = t[tonumber(k)] end
      encode_value(v, out, seen)
    end
    out[#out + 1] = "}"
  end
  seen[t] = nil
end

encode_value = function(v, out, seen)
  local tv = type(v)
  if v == nil or v == json.null then
    out[#out + 1] = "null"
  elseif tv == "boolean" then
    out[#out + 1] = v and "true" or "false"
  elseif tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then
      out[#out + 1] = "null"
    elseif math.type(v) == "integer" then
      out[#out + 1] = string.format("%d", v)
    elseif v == math.floor(v) and math.abs(v) < 2^53 then
      out[#out + 1] = string.format("%d", math.floor(v))
    else
      out[#out + 1] = string.format("%.10g", v)
    end
  elseif tv == "string" then
    out[#out + 1] = encode_string(v)
  elseif tv == "table" then
    encode_table(v, out, seen)
  else
    out[#out + 1] = encode_string(tostring(v))
  end
end

function json.encode(v)
  local out = {}
  encode_value(v, out, {})
  return table.concat(out)
end

-- Decoding -------------------------------------------------------------------
local function decode_error(str, pos, msg)
  error(string.format("json.decode: %s at position %d", msg, pos), 0)
end

local function skip_ws(str, pos)
  return str:find("[^ \t\r\n]", pos) or #str + 1
end

local decode_value

local function codepoint_to_utf8(n)
  if n < 0x80 then return string.char(n) end
  return utf8.char(n)
end

local function decode_string(str, pos)
  local out = {}
  local i = pos + 1
  while true do
    local c = str:sub(i, i)
    if c == "" then decode_error(str, i, "unterminated string") end
    if c == '"' then return table.concat(out), i + 1 end
    if c == "\\" then
      local e = str:sub(i + 1, i + 1)
      local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
      if map[e] then
        out[#out + 1] = map[e]
        i = i + 2
      elseif e == "u" then
        local hex = str:sub(i + 2, i + 5)
        local n = tonumber(hex, 16)
        if not n then decode_error(str, i, "bad unicode escape") end
        i = i + 6
        if n >= 0xD800 and n <= 0xDBFF and str:sub(i, i + 1) == "\\u" then
          local lo = tonumber(str:sub(i + 2, i + 5), 16)
          if lo and lo >= 0xDC00 and lo <= 0xDFFF then
            n = 0x10000 + ((n - 0xD800) << 10) + (lo - 0xDC00)
            i = i + 6
          end
        end
        out[#out + 1] = codepoint_to_utf8(n)
      else
        decode_error(str, i, "bad escape")
      end
    else
      local j = str:find('["\\]', i)
      if not j then decode_error(str, i, "unterminated string") end
      out[#out + 1] = str:sub(i, j - 1)
      i = j
    end
  end
end

local function decode_number(str, pos)
  local s, e = str:find("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
  if not s then decode_error(str, pos, "bad number") end
  local text = str:sub(s, e)
  local n = math.tointeger(tonumber(text)) or tonumber(text)
  if n == nil then decode_error(str, pos, "bad number") end
  return n, e + 1
end

decode_value = function(str, pos)
  pos = skip_ws(str, pos)
  local c = str:sub(pos, pos)
  if c == "{" then
    local obj = json.object({})
    pos = skip_ws(str, pos + 1)
    if str:sub(pos, pos) == "}" then return obj, pos + 1 end
    while true do
      pos = skip_ws(str, pos)
      if str:sub(pos, pos) ~= '"' then decode_error(str, pos, "expected key") end
      local key
      key, pos = decode_string(str, pos)
      pos = skip_ws(str, pos)
      if str:sub(pos, pos) ~= ":" then decode_error(str, pos, "expected ':'") end
      local val
      val, pos = decode_value(str, pos + 1)
      obj[key] = val
      pos = skip_ws(str, pos)
      local d = str:sub(pos, pos)
      if d == "}" then return obj, pos + 1 end
      if d ~= "," then decode_error(str, pos, "expected ',' or '}'") end
      pos = pos + 1
    end
  elseif c == "[" then
    local arr = json.array({})
    pos = skip_ws(str, pos + 1)
    if str:sub(pos, pos) == "]" then return arr, pos + 1 end
    local n = 0
    while true do
      local val
      val, pos = decode_value(str, pos)
      n = n + 1
      arr[n] = val
      pos = skip_ws(str, pos)
      local d = str:sub(pos, pos)
      if d == "]" then return arr, pos + 1 end
      if d ~= "," then decode_error(str, pos, "expected ',' or ']'") end
      pos = pos + 1
    end
  elseif c == '"' then
    return decode_string(str, pos)
  elseif c == "-" or c:match("%d") then
    return decode_number(str, pos)
  elseif str:sub(pos, pos + 3) == "true" then
    return true, pos + 4
  elseif str:sub(pos, pos + 4) == "false" then
    return false, pos + 5
  elseif str:sub(pos, pos + 3) == "null" then
    return nil, pos + 4
  end
  decode_error(str, pos, "unexpected character '" .. c .. "'")
end

function json.decode(str)
  local v, pos = decode_value(str, 1)
  pos = skip_ws(str, pos)
  if pos <= #str then decode_error(str, pos, "trailing garbage") end
  return v
end

return json
