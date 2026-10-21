--[[
  Tacómetro: shift lights, marcha, velocidad y RPM, con TC, ABS, DRS y limitador.
  Las luces usan la RPM de cambio del propio auto (drivetrain.ini) cuando la trae.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 420, 150
local clock = 0

local function lightColor(i)
  if i < 10 then return C.azul end
  if i < 16 then return C.blanco end
  if i < 21 then return C.alerta end
  return C.error
end

local function aid(label, value, x, y, w, active, available)
  local color = not available and C.acero or active and C.alerta or C.plata
  D.card(x, y, w, 20, 5, active and T.alpha(C.alerta, 0.18) or nil)
  D.text(label, 9, x + 6, y, w / 2, 20, available and C.niebla or C.acero, T.F.semi)
  D.text(value, 11, x + w / 2 - 6, y, w / 2, 20, color, T.F.mono, 'r')
end

function M.draw(dt)
  clock = clock + dt
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local car = live.car
  local imperial = config.imperial(link)
  local sh = live.shiftState()
  local pad = 12
  local top = 10

  -- Luces de cambio: todas parpadean en el punto de cambio, más rápido si te pasaste
  if config.s.tachoLights then
    local n = live.SEGMENTS
    local gap = 3
    local w = (DW - 2 * pad - gap * (n - 1)) / n
    local blinkOn = not sh.flash or math.floor(clock * (sh.fast and 16 or 8)) % 2 == 0
    for i = 0, n - 1 do
      local h = 10 + i * 0.5
      local x = pad + i * (w + gap)
      local lit = i < sh.lit and blinkOn
      local color = sh.flash and blinkOn and (sh.fast and C.error or C.azul) or lightColor(i)
      D.rect(x, top + 22 - h, w, h, lit and color or C.grafito, 2)
    end
    top = top + 30
  else
    top = top + 6
  end

  -- RPM · marcha · velocidad
  local midH = DH - top - (config.s.tachoAids and 32 or 8)
  if config.s.tachoRpm then
    D.label('RPM', pad, top, 80)
    D.text(T.thousands(car.rpm), 26, pad, top + 12, 140, 30, C.blanco, T.F.mono)
    D.text(car.rpmLimiter > 0 and ('LÍMITE ' .. T.thousands(car.rpmLimiter)) or '', 9, pad, top + 42, 140, 12, C.niebla, T.F.monoReg)
  end
  local gearColor = (car.manualPitsSpeedLimiterEnabled or car.speedLimiterInAction) and C.alerta or (sh.flash and C.azul or C.blanco)
  D.text(T.gear(car.gear), 64, DW / 2 - 60, top - 6, 120, midH + 6, gearColor, T.F.display, 'c')
  D.label(T.U.speedLabel(imperial), DW - pad - 100, top, 100, nil, 'r')
  D.text(tostring(math.floor(T.U.speed(car.speedKmh, imperial) + 0.5)), 40, DW - pad - 150, top + 10, 150, 44, C.blanco, T.F.mono, 'r')

  -- Ayudas
  if config.s.tachoAids then
    local y = DH - 28
    local w = (DW - 2 * pad - 18) / 4
    aid('TC', car.tractionControlModes > 0 and tostring(car.tractionControlMode) or T.DASH, pad, y, w, car.tractionControlInAction, car.tractionControlModes > 0)
    aid('ABS', car.absModes > 0 and tostring(car.absMode) or T.DASH, pad + (w + 6), y, w, car.absInAction, car.absModes > 0)
    aid('DRS', car.drsActive and 'ON' or (car.drsAvailable and 'LISTO' or T.DASH), pad + 2 * (w + 6), y, w, car.drsActive or car.drsAvailable, car.drsPresent)
    local lim = car.manualPitsSpeedLimiterEnabled or car.speedLimiterInAction
    aid('BOX', lim and 'LIM' or T.DASH, pad + 3 * (w + 6), y, w, lim, true)
  end
end

return M
