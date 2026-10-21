--[[ Pedales, traza de los últimos segundos (acelerador, freno, velocidad) y volante. ]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 380, 130

local function pedal(x, y, w, h, value, color, label)
  D.rect(x, y, w, h, C.grafito, 4)
  local k = T.clamp(value, 0, 1)
  if k > 0 then D.rect(x, y + h * (1 - k), w, h * k, color, 4) end
  D.text(label, 8, x - 6, y + h + 2, w + 12, 11, C.niebla, T.F.semi, 'c')
  D.text(tostring(math.floor(k * 100 + 0.5)), 10, x - 6, y + h + 12, w + 12, 12, color, T.F.mono, 'c')
end

local function path(arr, count, x, y, w, h, scale, color, th)
  if count < 2 then return end
  local s = D.scale()
  local step = count > 160 and 2 or 1
  for k = 1, count, step do
    local v = T.clamp(scale(live.traceAt(arr, count, k)), 0, 1)
    ui.pathLineTo(vec2((x + (k - 1) / (count - 1) * w) * s, (y + h - v * (h - 2) - 1) * s))
  end
  ui.pathStroke(color, false, th * s)
end

function M.draw()
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local car = live.car
  local accent = T.accent(config.s.accent)
  local pad = 12
  local barH = DH - 2 * pad - 24
  local x = pad

  pedal(x, pad, 16, barH, car.gas, accent, 'ACEL')
  x = x + 28
  pedal(x, pad, 16, barH, car.brake, C.blanco, 'FRENO')
  x = x + 28
  if config.s.inputsClutch then
    pedal(x, pad, 16, barH, car.clutch, C.niebla, 'EMB')
    x = x + 28
  end
  x = x + 6

  local w = DW - x - pad
  local steerH = config.s.inputsSteer and 14 or 0
  local traceH = DH - 2 * pad - (steerH > 0 and steerH + 8 or 0)
  if config.s.inputsTrace then
    D.card(x, pad, w, traceH, 6)
    for _, f in ipairs({ 0.25, 0.5, 0.75 }) do
      D.line(x + w * f, pad + 2, x + w * f, pad + traceH - 2, C.grafito, 1)
    end
    local count = math.min(live.trace.n, math.floor(config.s.inputsSeconds * live.TRACE_HZ))
    path(live.trace.speed, count, x, pad, w, traceH, function(v) return v / 300 end, C.niebla, 1.2)
    path(live.trace.gas, count, x, pad, w, traceH, function(v) return v end, accent, 2)
    path(live.trace.brake, count, x, pad, w, traceH, function(v) return v end, C.blanco, 2)
  end

  -- Volante: barra centrada según el ángulo y el giro máximo del auto
  if steerH > 0 then
    local y = DH - pad - steerH
    local lock = car.steerLock > 0 and car.steerLock or 450
    local k = T.clamp(car.steer / lock, -1, 1)
    D.rect(x, y + steerH / 2 - 3, w, 6, C.grafito, 3)
    local mid = x + w / 2
    if k < 0 then D.rect(mid + k * w / 2, y + steerH / 2 - 3, -k * w / 2, 6, C.plata, 3)
    else D.rect(mid, y + steerH / 2 - 3, k * w / 2, 6, C.plata, 3) end
    D.rect(mid - 1, y, 2, steerH, C.niebla)
    D.text(string.format('%d°', math.floor(car.steer + 0.5)), 9, x, y - 1, 50, steerH, C.niebla, T.F.monoReg)
  end
end

return M
