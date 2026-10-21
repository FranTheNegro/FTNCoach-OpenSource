--[[
  Banderas: un cartel con la bandera de la sesión (amarilla, azul, negra, última
  vuelta, a cuadros…) y el aviso del limitador de boxes. Sin bandera no se ve nada.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 420, 56
local clock = 0
local F = ac.FlagType

local FLAGS = {
  [F.Caution] = { 'Bandera amarilla', C.alerta, true },
  [F.Stop] = { 'Bandera negra', C.niebla, true },
  [F.ReturnToPits] = { 'Penalización: entrá a boxes', C.error, true },
  [F.FasterCar] = { 'Bandera azul: auto más rápido detrás', C.azul, true },
  [F.Finished] = { 'Bandera a cuadros', C.blanco, false },
  [F.OneLapLeft] = { 'Última vuelta', C.blanco, false },
}

function M.draw(dt)
  clock = clock + dt
  D.begin(DW, DH)
  local sim = live.sim
  local car = live.car
  local flag = FLAGS[sim.raceFlagType]
  local label, color, wave
  if flag then
    label, color, wave = flag[1], flag[2], flag[3]
    if sim.raceFlagType == F.FasterCar and sim.raceFlagCause >= 0 then
      label = 'Bandera azul: ' .. (ac.getDriverName(sim.raceFlagCause) or 'auto más rápido') .. ' detrás'
    end
  elseif config.s.flagsLimiter and car.isInPitlane and car.manualPitsSpeedLimiterEnabled then
    label, color, wave = 'Limitador de boxes', C.alerta, false
  elseif config.s.flagsLimiter and car.isInPitlane and car.speedKmh > sim.pitsSpeedLimit + 2 then
    label, color, wave = 'Bajá la velocidad: estás en boxes', C.error, true
  end

  if not label then
    -- Sin bandera queda invisible; al pasar el mouse se ve dónde está para moverla
    if ui.windowHovered() then D.empty(DW, DH, 'Banderas') end
    return
  end
  -- Las banderas que piden atención "flamean" (pulso de opacidad)
  local a = wave and (0.55 + 0.45 * (0.5 + 0.5 * math.sin(clock * 7))) or 1
  D.panel(0, 0, DW, DH, 10)
  D.rect(0, 0, DW, DH, T.alpha(color, 0.22 * a), 10)
  D.stroke(1, 1, DW - 2, DH - 2, T.alpha(color, a), 10, 2)
  D.rect(12, 12, 8, DH - 24, T.alpha(color, a), 3)
  D.text(label, 18, 30, 0, DW - 42, DH, C.blanco, T.F.bold, 'l', 'c')
end

return M
