--[[ Colores de la marca, fuentes y formatos (los mismos que el dashboard de la tablet). ]]

local M = {}

local function hex(h, a)
  return rgbm(tonumber(h:sub(2, 3), 16) / 255, tonumber(h:sub(4, 5), 16) / 255, tonumber(h:sub(6, 7), 16) / 255, a or 1)
end
M.hex = hex

M.C = {
  carbono = hex('#12151A'),
  carbono2 = hex('#1E2229'),
  grafito = hex('#2C313A'),
  acero = hex('#3A404B'),
  niebla = hex('#8E96A3'),
  plata = hex('#C3C8D2'),
  blanco = hex('#F0F3FA'),
  azul = hex('#5B7BFF'),
  azulClaro = hex('#8FA4FF'),
  ultramar = hex('#1D2BE0'),
  mejor = hex('#B77CFF'),
  record = hex('#34D399'),
  alerta = hex('#FFB020'),
  error = hex('#FF5C5C'),
}

--- Acentos que se pueden elegir en los ajustes (barra de aceleración, auto propio, avance).
M.ACCENTS = {
  { 'Azul FTN', '#5B7BFF' },
  { 'Ultramar', '#1D2BE0' },
  { 'Violeta', '#B77CFF' },
  { 'Verde', '#34D399' },
  { 'Ámbar', '#FFB020' },
}

function M.accent(i)
  local a = M.ACCENTS[math.floor(i or 1)] or M.ACCENTS[1]
  return hex(a[2])
end

--- Mismo color con otra opacidad (sin tocar el original).
function M.alpha(c, a)
  return rgbm(c.r, c.g, c.b, c.mult * a)
end

-- Segoe UI para textos y Consolas para números: vienen con Windows, no hay que instalar nada.
M.F = {
  display = ui.DWriteFont('Segoe UI', '@System'):weight(ui.DWriteFont.Weight.Black),
  bold = ui.DWriteFont('Segoe UI', '@System'):weight(ui.DWriteFont.Weight.Bold),
  semi = ui.DWriteFont('Segoe UI', '@System'):weight(ui.DWriteFont.Weight.SemiBold),
  ui = ui.DWriteFont('Segoe UI', '@System'),
  mono = ui.DWriteFont('Consolas', '@System'):weight(ui.DWriteFont.Weight.Bold),
  monoReg = ui.DWriteFont('Consolas', '@System'),
}

-- ── Formatos ──

M.DASH = '–'
local MINUS = '−'

function M.lapTime(s)
  if type(s) ~= 'number' or s <= 0 then return '-:--.---' end
  local m = math.floor(s / 60)
  return string.format('%d:%06.3f', m, s - m * 60)
end

--- +0.18 / −0.18 con el menos tipográfico, como en el dashboard.
function M.signed(x, digits)
  digits = digits or 3
  if type(x) ~= 'number' or x ~= x then return M.DASH end
  if math.abs(x) < 0.5 * 10 ^ -digits then return '±' .. string.format('%.' .. digits .. 'f', 0) end
  return (x > 0 and '+' or MINUS) .. string.format('%.' .. digits .. 'f', math.abs(x))
end

--- Miles con espacio fino: 8100 → "8 100".
function M.thousands(n)
  local s = tostring(math.floor(n + 0.5))
  local out = s:reverse():gsub('(%d%d%d)', '%1 '):reverse()
  return (out:gsub('^ ', ''))
end

function M.clock(sec)
  if type(sec) ~= 'number' or sec < 0 then return M.DASH end
  sec = math.floor(sec)
  local h = math.floor(sec / 3600)
  local m = math.floor(sec / 60) % 60
  if h > 0 then return string.format('%d:%02d:%02d', h, m, sec % 60) end
  return string.format('%d:%02d', m, sec % 60)
end

function M.gear(g)
  if g == nil then return M.DASH end
  if g < 0 then return 'R' end
  if g == 0 then return 'N' end
  return tostring(g)
end

--- Coma decimal, como en el resto de la app.
function M.dec(x, digits)
  if type(x) ~= 'number' or x ~= x then return M.DASH end
  return (string.format('%.' .. (digits or 1) .. 'f', x):gsub('%.', ','))
end

function M.clamp(x, lo, hi)
  if x < lo then return lo end
  if x > hi then return hi end
  return x
end

-- ── Unidades ──

M.U = {}
function M.U.speed(kmh, imperial) return imperial and kmh * 0.621371 or kmh end
function M.U.speedLabel(imperial) return imperial and 'MPH' or 'KM/H' end
function M.U.temp(c, imperial) return imperial and c * 9 / 5 + 32 or c end
function M.U.tempLabel(imperial) return imperial and '°F' or '°C' end
function M.U.fuel(l, imperial) return imperial and l * 0.264172 or l end
function M.U.fuelLabel(imperial) return imperial and 'gal' or 'L' end
--- AC da la presión en psi.
function M.U.press(psi, imperial) return imperial and psi or psi * 6.89476 end
function M.U.pressLabel(imperial) return imperial and 'psi' or 'kPa' end

return M
