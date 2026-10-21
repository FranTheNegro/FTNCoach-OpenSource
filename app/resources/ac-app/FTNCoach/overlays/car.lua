--[[ Coche: combustible (con lo que falta o sobra para el final) y ajustes en pista. ]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 320, 210

local function setting(k, v, x, y, w, color)
  D.card(x, y, w, 46, 8)
  D.label(k, x + 10, y + 6, w - 20)
  D.text(v, 17, x + 10, y + 20, w - 20, 22, color or C.blanco, T.F.mono)
end

function M.draw()
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local car = live.car
  local imperial = config.imperial(link)
  local fu = T.U.fuelLabel(imperial)
  local f = live.fuel()
  local pad = 12

  -- Combustible
  D.label('COMBUSTIBLE', pad, 8, 140)
  D.text(f.perLap and (T.dec(T.U.fuel(f.perLap, imperial), 2) .. ' ' .. fu .. '/vuelta') or 'Calculando consumo…', 10, DW - 180, 8, 168, 14, C.niebla, T.F.monoReg, 'r')
  D.text(T.dec(T.U.fuel(f.liters, imperial)), 30, pad, 22, 120, 36, C.blanco, T.F.mono)
  D.text(fu, 12, pad + 96, 36, 40, 18, C.niebla, T.F.monoReg)
  if f.lapsLeft then D.text(T.dec(f.lapsLeft) .. ' vueltas', 16, DW - 172, 28, 160, 24, C.azul, T.F.mono, 'r') end
  D.bar(pad, 62, DW - 2 * pad, 6, f.max > 0 and f.liters / f.max or 0, T.accent(config.s.accent))
  if f.missing then
    local short = f.missing > 0
    D.text(short and string.format('Hasta el final te faltan %s %s', T.dec(T.U.fuel(f.missing, imperial)), fu)
      or string.format('Llegás al final con %s %s de sobra', T.dec(T.U.fuel(-f.missing, imperial)), fu),
      11, pad, 72, DW - 2 * pad, 16, short and C.alerta or C.record, T.F.semi)
  end

  -- Ajustes en pista
  local y = 96
  local gap = 8
  local w = (DW - 2 * pad - gap) / 2
  local bias = car.brakeBias
  if bias > 0 and bias <= 1 then bias = bias * 100 end
  setting('REPARTO FRENO', bias > 0 and (T.dec(bias) .. ' %') or T.DASH, pad, y, w)
  setting('TC · ABS', (car.tractionControlModes > 0 and tostring(car.tractionControlMode) or T.DASH) .. ' · ' .. (car.absModes > 0 and tostring(car.absMode) or T.DASH), pad + w + gap, y, w)
  y = y + 54
  local water = car.waterTemperature
  setting('AGUA', water > 0 and (math.floor(T.U.temp(water, imperial) + 0.5) .. T.U.tempLabel(imperial)) or T.DASH, pad, y, w, water > 105 and C.alerta or nil)
  local dmg = 0
  for i = 0, 3 do dmg = math.max(dmg, car.damage[i] or 0) end
  local engineHurt = car.engineLifeLeft > 0 and car.engineLifeLeft < 1000
  local dmgText = dmg > 0 and string.format('Choque %d km/h', math.floor(dmg + 0.5)) or engineHurt and string.format('Motor %d %%', math.floor(car.engineLifeLeft / 10)) or 'Sin daño'
  setting('DAÑO', dmgText, pad + w + gap, y, w, (dmg > 0 or engineHurt) and C.alerta or C.record)
end

return M
