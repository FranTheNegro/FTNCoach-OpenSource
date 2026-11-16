--[[
  Skins por categoría (TC, TN, TCR, TP, F1, WRC…): las mismas carpetas que usa el
  dashboard de la tablet (app/skins/<id>/skin.json + logo.png). FTN Coach las
  copia a apps/lua/FTNCoach/skins al instalar la app.

  Una skin solo cambia la presentación: los colores de superficie y de la
  categoría, el estilo de las etiquetas, la cursiva de los números y el logo.
  Los colores de dato (mejor, récord, alerta, error) no cambian: dicen algo.
]]

local T = require('lib.theme')
local config = require('lib.config')

local M = { list = {}, byId = {}, current = nil }

local DIR = ac.getFolder(ac.FolderID.ScriptOrigin) .. '/skins'

-- Paleta FTN original, para volver a ella
local FTN = {}
for k, v in pairs(T.C) do FTN[k] = rgbm(v.r, v.g, v.b, v.mult) end
local FTN_FONTS = {}
for k, v in pairs(T.F) do FTN_FONTS[k] = v end

local HEX = '^#%x%x%x%x%x%x$'

local function color(v, fallback)
  if type(v) == 'string' and v:match(HEX) then return T.hex(v) end
  return fallback
end

local function mix(a, b, t)
  return rgbm(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1)
end

--- Lee una skin; lo que falte toma el valor de FTN (igual que en el dashboard).
local function load(id)
  local ok, text = pcall(io.load, DIR .. '/' .. id .. '/skin.json')
  if not ok or type(text) ~= 'string' then return nil end
  local okJ, j = pcall(JSON.parse, text)
  if not okJ or type(j) ~= 'table' or type(j.name) ~= 'string' then return nil end
  local c = type(j.colors) == 'table' and j.colors or {}
  local fonts = type(j.fonts) == 'table' and j.fonts or {}
  local logo = type(j.logo) == 'string' and j.logo ~= '' and (DIR .. '/' .. id .. '/' .. j.logo) or nil
  if logo and not io.fileExists(logo) then logo = nil end
  return {
    id = id,
    name = j.name,
    short = type(j.short) == 'string' and j.short ~= '' and j.short or j.name:sub(1, 4):upper(),
    labels = (j.labels == 'underline' or j.labels == 'tab') and j.labels or 'plain',
    logo = logo,
    fonts = fonts,
    colors = {
      background = color(c.background, FTN.carbono),
      panel = color(c.panel, FTN.carbono2),
      line = color(c.line, FTN.grafito),
      text = color(c.text, FTN.blanco),
      muted = color(c.muted, FTN.niebla),
      accent = color(c.accent, FTN.azul),
      accent2 = color(c.accent2, FTN.ultramar),
      label = color(c.label, FTN.niebla),
      number = color(c.number, FTN.blanco),
      redline = color(c.redline, FTN.error),
    },
  }
end

--- Busca las skins instaladas (carpetas con skin.json).
function M.scan()
  M.list, M.byId = {}, {}
  local ids = {}
  pcall(io.scanDir, DIR, '*', function(name, attrs)
    if attrs and attrs.isDirectory then ids[#ids + 1] = name end
  end)
  local order = { tc = 1, tn = 2, tcr = 3, tp = 4, f1 = 5, wrc = 6 }
  table.sort(ids, function(a, b)
    local ia, ib = order[a] or 99, order[b] or 99
    if ia ~= ib then return ia < ib end
    return a < b
  end)
  for _, id in ipairs(ids) do
    local sk = load(id)
    if sk then
      M.list[#M.list + 1] = sk
      M.byId[id] = sk
    end
  end
end

-- ── Fuentes ──

--- Fuente de la skin: la de su carpeta si trae archivo; si no, la de FTN (Segoe UI o
--- Consolas) con o sin cursiva. Se arma una fuente nueva para no tocar las de FTN.
local function font(spec, family, weight, base, folder)
  if type(spec) ~= 'table' then return base end
  if type(spec.file) == 'string' and type(spec.family) == 'string' then
    local ok, f = pcall(function()
      return ui.DWriteFont(spec.family, folder):weight(weight)
    end)
    if ok and f then return f end
  end
  if spec.italic then
    local ok, f = pcall(function()
      return ui.DWriteFont(family, '@System'):weight(weight):style(ui.DWriteFont.Style.Italic)
    end)
    if ok and f then return f end
  end
  return base
end

-- ── Aplicar ──

--- Cambia los colores en el mismo T.C (los overlays guardan esa tabla) y las fuentes.
function M.apply(id)
  local sk = id and M.byId[id] or nil
  M.current = sk
  for k, v in pairs(FTN) do T.C[k] = rgbm(v.r, v.g, v.b, v.mult) end
  for k, v in pairs(FTN_FONTS) do T.F[k] = v end
  T.SK = nil
  if not sk then return end
  local c = sk.colors
  T.C.carbono = c.background
  T.C.carbono2 = c.panel
  T.C.grafito = c.line
  T.C.acero = mix(c.line, c.muted, 0.3)
  T.C.niebla = c.muted
  T.C.plata = mix(c.text, c.muted, 0.35)
  T.C.blanco = c.text
  T.C.azul = c.accent
  T.C.azulClaro = mix(c.accent, c.text, 0.3)
  T.SK = { accent = c.accent, accent2 = c.accent2, label = c.label, number = c.number, redline = c.redline, labels = sk.labels, logo = sk.logo, short = sk.short, name = sk.name }
  local folder = DIR .. '/' .. sk.id
  T.F.display = font(sk.fonts.display, 'Segoe UI', ui.DWriteFont.Weight.Black, FTN_FONTS.display, folder)
  T.F.bold = font(sk.fonts.display, 'Segoe UI', ui.DWriteFont.Weight.Bold, FTN_FONTS.bold, folder)
  T.F.mono = font(sk.fonts.data, 'Consolas', ui.DWriteFont.Weight.Bold, FTN_FONTS.mono, folder)
end

M.scan()
M.apply(config.s.skin ~= '' and config.s.skin or nil)

--- Elige la skin ('' = FTN) y la recuerda.
function M.choose(id)
  config.s.skin = id or ''
  M.apply(id ~= '' and id or nil)
end

return M
