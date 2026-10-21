--[[
  FTN Coach para Assetto Corsa (Custom Shaders Patch).

  Overlays de telemetría en vivo con el diseño del dashboard de la tablet: coach,
  delta, tacómetro, inputs, tiempos, relative, neumáticos, auto, vueltas, mapa,
  radar y banderas. Cada uno es una ventana que se activa desde la barra de apps.

  Los datos en vivo salen de AC; FTN Coach en la PC suma lo que AC no da (delta
  contra tu mejor vuelta, tipo de vuelta, consumo, consejos por curva y tu foco de
  manejo). Sin FTN Coach abierto, todo sigue andando con los datos de AC.
]]

local T = require('lib.theme')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')

local overlays = {
  coach = require('overlays.coach'),
  delta = require('overlays.delta'),
  tacho = require('overlays.tacho'),
  inputs = require('overlays.inputs'),
  timing = require('overlays.timing'),
  relative = require('overlays.relative'),
  tyres = require('overlays.tyres'),
  car = require('overlays.car'),
  laps = require('overlays.laps'),
  map = require('overlays.map'),
  radar = require('overlays.radar'),
  flags = require('overlays.flags'),
}

function script.update(dt)
  link.update(dt)
  live.update(dt)
end

--- Un error en un overlay no tiene que tirar abajo a los demás (se anota una sola vez en el log).
local lastError = {}
local function window(id)
  local o = overlays[id]
  return function(dt)
    if not live.car then return end
    local ok, err = pcall(o.draw, dt)
    if not ok and lastError[id] ~= tostring(err) then
      lastError[id] = tostring(err)
      ac.error('[FTN Coach] ' .. id .. ': ' .. lastError[id])
    end
  end
end

local function settings(id)
  return function()
    config.ui(id, link, T)
  end
end

script.windowMain = window('coach')
script.windowDelta = window('delta')
script.windowTacho = window('tacho')
script.windowInputs = window('inputs')
script.windowTiming = window('timing')
script.windowRelative = window('relative')
script.windowTyres = window('tyres')
script.windowCar = window('car')
script.windowLaps = window('laps')
script.windowMap = window('map')
script.windowRadar = window('radar')
script.windowFlags = window('flags')

-- La ventana principal tiene todos los ajustes; cada overlay, los suyos
function script.windowSettings()
  config.ui(nil, link, T)
end
script.windowDeltaSettings = settings('delta')
script.windowTachoSettings = settings('tacho')
script.windowInputsSettings = settings('inputs')
script.windowTimingSettings = settings('timing')
script.windowRelativeSettings = settings('relative')
script.windowTyresSettings = settings('tyres')
script.windowLapsSettings = settings('laps')
script.windowMapSettings = settings('map')
script.windowRadarSettings = settings('radar')
script.windowFlagsSettings = settings('flags')
script.windowCarSettings = settings('general')
