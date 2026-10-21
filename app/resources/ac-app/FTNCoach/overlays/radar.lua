--[[
  Radar: los autos alrededor, vistos desde arriba con tu auto en el centro y mirando
  hacia adelante. Cada auto se dibuja con su tamaño real. Puede quedar oculto hasta
  que alguien se acerca.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 220, 220

--- Rectángulo girado: centro, dirección "adelante" en pantalla (normalizada), largo y ancho en píxeles.
local function carQuad(cx, cy, hx, hy, len, wid, color)
  local rx, ry = -hy, hx
  local fl, fw = len / 2, wid / 2
  ui.drawQuadFilled(
    vec2(cx + hx * fl - rx * fw, cy + hy * fl - ry * fw),
    vec2(cx + hx * fl + rx * fw, cy + hy * fl + ry * fw),
    vec2(cx - hx * fl + rx * fw, cy - hy * fl + ry * fw),
    vec2(cx - hx * fl - rx * fw, cy - hy * fl - ry * fw),
    color)
end

function M.draw()
  local s = D.begin(DW, DH)
  local me = live.car
  local sim = live.sim
  local range = config.s.radarRange

  -- `side` puede apuntar a la izquierda o a la derecha según la versión: se mide con la rueda delantera izquierda
  local toRight = (me.wheels[0].position - me.position):dot(me.side) > 0 and -1 or 1

  local cars = {}
  local closest = math.huge
  for i = 0, sim.carsCount - 1 do
    local c = ac.getCar(i)
    if c and i ~= live.idx and c.isConnected and not c.isHidingLabels then
      local rel = c.position - me.position
      local x = rel:dot(me.side) * toRight
      local z = rel:dot(me.look)
      if math.abs(x) < range and math.abs(z) < range then
        cars[#cars + 1] = { c = c, x = x, z = z }
        closest = math.min(closest, math.sqrt(x * x + z * z))
      end
    end
  end

  local hovered = ui.windowHovered()
  if config.s.radarAuto and #cars == 0 and not hovered then return end

  D.panel(0, 0, DW, DH, 110)
  local cx, cy = DW / 2 * s, DH / 2 * s
  local k = (DW / 2 - 12) * s / range
  -- Anillos de distancia
  ui.drawCircle(vec2(cx, cy), range * k, C.grafito, 40, 1 * s)
  ui.drawCircle(vec2(cx, cy), range * k / 2, C.grafito, 40, 1 * s)
  D.line(DW / 2, 12, DW / 2, DH - 12, T.alpha(C.grafito, 0.6), 1)

  -- Aviso de costado: alguien a la par
  local left, right = false, false
  for _, o in ipairs(cars) do
    local len = o.c.aabbSize.z > 0 and o.c.aabbSize.z or 4.5
    if math.abs(o.z) < len and math.abs(o.x) < 4 then
      if o.x < 0 then left = true else right = true end
    end
  end
  if left then D.rect(8, DH / 2 - 40, 5, 80, C.alerta, 2) end
  if right then D.rect(DW - 13, DH / 2 - 40, 5, 80, C.alerta, 2) end

  for _, o in ipairs(cars) do
    local c = o.c
    local hx = c.look:dot(me.side) * toRight
    local hz = c.look:dot(me.look)
    local norm = math.sqrt(hx * hx + hz * hz)
    if norm > 1e-3 then hx, hz = hx / norm, hz / norm else hx, hz = 0, 1 end
    local dist = math.sqrt(o.x * o.x + o.z * o.z)
    local color = dist < 5 and C.error or dist < 9 and C.alerta or C.plata
    local len = c.aabbSize.z > 0 and c.aabbSize.z or 4.5
    local wid = c.aabbSize.x > 0 and c.aabbSize.x or 1.9
    carQuad(cx + o.x * k, cy - o.z * k, hx, -hz, len * k, wid * k, color)
  end

  local len = me.aabbSize.z > 0 and me.aabbSize.z or 4.5
  local wid = me.aabbSize.x > 0 and me.aabbSize.x or 1.9
  carQuad(cx, cy, 0, -1, len * k, wid * k, T.accent(config.s.accent))
end

return M
