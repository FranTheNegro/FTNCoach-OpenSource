--[[
  Neumáticos: temperatura (y por zona), presión, desgaste y frenos de cada rueda.
  El color sale de la temperatura óptima del compuesto que trae el auto.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 320, 250

local function tile(i, x, y, w, h, imperial)
  local car = live.car
  local wh = car.wheels[i]
  local opt = wh.tyreOptimumTemperature
  local core = wh.tyreCoreTemperature
  local color, tag = live.tyreBand(core, opt)
  D.card(x, y, w, h, 8)
  D.label(live.TYRE_NAMES[i + 1], x + 10, y + 6, w / 2)
  D.text(tag, 9, x + w / 2, y + 6, w / 2 - 10, 14, color, T.F.mono, 'r')
  D.text(string.format('%d', math.floor(T.U.temp(core, imperial) + 0.5)), 24, x + 10, y + 20, 80, 30, color, T.F.mono)
  D.text(T.U.tempLabel(imperial), 11, x + 62, y + 30, 30, 16, color, T.F.monoReg)

  local yy = y + 54
  -- Zonas: en las ruedas izquierdas el exterior queda a la izquierda, en las derechas a la derecha
  if config.s.tyresZones then
    local left = i % 2 == 0
    local zones = left and { wh.tyreOutsideTemperature, wh.tyreMiddleTemperature, wh.tyreInsideTemperature }
      or { wh.tyreInsideTemperature, wh.tyreMiddleTemperature, wh.tyreOutsideTemperature }
    local zw = (w - 20 - 8) / 3
    for k, t in ipairs(zones) do
      local zc = live.tyreBand(t, opt)
      D.rect(x + 10 + (k - 1) * (zw + 4), yy, zw, 6, zc, 2)
    end
    yy = yy + 12
  end
  if config.s.tyresPressure and wh.tyrePressure > 0 then
    local p = T.U.press(wh.tyrePressure, imperial)
    D.text(string.format(imperial and '%.1f %s' or '%.0f %s', p, T.U.pressLabel(imperial)), 11, x + 10, yy, w / 2, 16, C.plata, T.F.monoReg)
  end
  if config.s.tyresBrakes and wh.brakeTemperature > 0 then
    local b = wh.brakeTemperature
    local bc = b > 800 and C.error or b > 650 and C.alerta or C.niebla
    D.text(string.format('F %d°', math.floor(T.U.temp(b, imperial) + 0.5)), 11, x + w / 2, yy, w / 2 - 10, 16, bc, T.F.monoReg, 'r')
  end
  if config.s.tyresWear then
    -- tyreWear crece con el uso: la barra muestra lo que queda
    D.bar(x + 10, y + h - 10, w - 20, 3, 1 - T.clamp(wh.tyreWear, 0, 1), color)
  end
end

function M.draw()
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local imperial = config.imperial(link)
  D.label('NEUMÁTICOS', 12, 8, 160)
  local car = live.car
  local compound = ac.getTyresName(live.idx, car.compoundIndex)
  if compound and compound ~= '' then D.text(compound, 10, DW - 172, 8, 160, 14, C.niebla, T.F.ui, 'r') end
  local pad, gap = 10, 8
  local w = (DW - 2 * pad - gap) / 2
  local h = (DH - 30 - pad - gap) / 2
  for i = 0, 3 do
    tile(i, pad + (i % 2) * (w + gap), 28 + math.floor(i / 2) * (h + gap), w, h, imperial)
  end
end

return M
