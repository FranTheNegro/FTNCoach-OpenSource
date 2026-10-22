--[[
  FTN Coach para Assetto Corsa (Custom Shaders Patch).

  Overlays de telemetría en vivo con el diseño del dashboard de la tablet: coach,
  delta, tacómetro, inputs, tiempos, relative, neumáticos, auto, vueltas, mapa,
  radar y banderas. Cada uno es una ventana; el layout de la categoría del auto
  (Fórmula, GT, Turismo, Rally…) decide cuáles se ven y dónde (lib/layout.lua).

  Los datos en vivo salen de AC; FTN Coach en la PC suma lo que AC no da (delta
  contra tu mejor vuelta, tipo de vuelta, consumo, consejos por curva y tu foco de
  manejo). Sin FTN Coach abierto, todo sigue andando con los datos de AC.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')
local layout = require('lib.layout')
local setup = require('lib.setup')

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

local now = 0

function script.update(dt)
  now = now + dt
  link.update(dt)
  live.update(dt)
  layout.update(dt)
end

--- Un error en un overlay no tiene que tirar abajo a los demás (se anota una sola vez en el log).
local lastError = {}
local function protect(id, fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok and lastError[id] ~= tostring(err) then
    lastError[id] = tostring(err)
    ac.error('[FTN Coach] ' .. id .. ': ' .. lastError[id])
  end
end

-- Entrada de cada overlay: se descubre de izquierda a derecha con una línea de acento
-- (al volver de la pausa no se repite)
local INTRO = 0.45
local shownAt = {}
local hiddenByPause = {}

local function intro(id)
  local t = shownAt[id] and (now - shownAt[id]) / INTRO or 1
  if t >= 1 then return nil end
  t = math.max(0, t)
  return 1 - (1 - t) ^ 3
end

local function window(id)
  local o = overlays[id]
  return function(dt)
    if not live.car then return end
    D.setScale(layout.scale(id))
    local e = intro(id)
    local size = ui.windowSize()
    if e then ui.pushClipRect(vec2(0, 0), vec2(size.x * e, size.y)) end
    protect(id, o.draw, dt)
    if e then
      ui.popClipRect()
      ui.drawRectFilled(vec2(size.x * e - 2, D.TOP), vec2(size.x * e, size.y), T.alpha(T.accent(config.s.accent), 1 - e))
    end
    layout.fit(id, D.windowSize())
    if layout.editing then protect('frame', setup.frame, id) end
  end
end

local function shown(id)
  return function()
    if not hiddenByPause[id] then shownAt[id] = now end
    hiddenByPause[id] = false
  end
end

local function hidden(id)
  return function()
    hiddenByPause[id] = live.sim.isPaused
  end
end

local NAMES = {
  coach = 'Coach', delta = 'Delta', tacho = 'Tacho', inputs = 'Inputs', timing = 'Timing', relative = 'Relative',
  tyres = 'Tyres', car = 'Car', laps = 'Laps', map = 'Map', radar = 'Radar', flags = 'Flags',
}
for id, name in pairs(NAMES) do
  script['window' .. name] = window(id)
  script['show' .. name] = shown(id)
  script['hide' .. name] = hidden(id)
end

-- "FTN Coach" en la barra de apps: el centro de control
function script.windowMain()
  protect('center', setup.center)
end
