--[[
  Dibujo en coordenadas de diseño. Cada overlay se diseña en un tamaño fijo
  (por ejemplo 360 × 120) y se escala al tamaño de su ventana: para agrandarlo
  alcanza con estirar la ventana desde la esquina.
]]

local T = require('lib.theme')
local config = require('lib.config')

local D = {}
local s = 1
local A = ui.Alignment

D.A = A

local function P(x, y)
  return vec2(x * s, y * s)
end
D.P = P

--- Empieza a dibujar un overlay de `dw × dh` unidades. Devuelve la escala.
function D.begin(dw, dh)
  local size = ui.windowSize()
  s = math.max(0.2, math.min(size.x / dw, size.y / dh))
  return s
end

function D.scale()
  return s
end

--- Fondo del overlay con la opacidad elegida en los ajustes.
function D.panel(x, y, w, h, r)
  local a = config.s.opacity
  if a <= 0.01 then return end
  ui.drawRectFilled(P(x, y), P(x + w, y + h), T.alpha(T.C.carbono, a), (r or 12) * s)
end

--- Tarjeta interna (un poco más clara que el fondo).
function D.card(x, y, w, h, r, color)
  ui.drawRectFilled(P(x, y), P(x + w, y + h), color or T.alpha(T.C.carbono2, math.max(0.6, config.s.opacity)), (r or 8) * s)
end

function D.rect(x, y, w, h, color, r)
  if w <= 0 or h <= 0 then return end
  ui.drawRectFilled(P(x, y), P(x + w, y + h), color, (r or 0) * s)
end

function D.stroke(x, y, w, h, color, r, th)
  ui.drawRect(P(x, y), P(x + w, y + h), color, (r or 0) * s, ui.CornerFlags.All, (th or 1) * s)
end

function D.line(x1, y1, x2, y2, color, th)
  ui.drawLine(P(x1, y1), P(x2, y2), color, (th or 1) * s)
end

function D.circle(x, y, r, color)
  ui.drawCircleFilled(P(x, y), r * s, color, 20)
end

--- Texto dentro de una caja; `h`/`v` son alineaciones ('l', 'c', 'r' / 't', 'c', 'b').
local H = { l = A.Start, c = A.Center, r = A.End }
local V = { t = A.Start, c = A.Center, b = A.End }
function D.text(str, size, x, y, w, h, color, font, ha, va, wrap)
  ui.pushDWriteFont(font or T.F.ui)
  ui.dwriteDrawTextClipped(str, size * s, P(x, y), P(x + w, y + h), H[ha or 'l'], V[va or 'c'], wrap or false, color or T.C.blanco)
  ui.popDWriteFont()
end

--- Etiqueta chica en mayúsculas (como las del dashboard).
function D.label(str, x, y, w, color, ha)
  D.text(str, 10, x, y, w, 14, color or T.C.niebla, T.F.semi, ha or 'l', 'c')
end

--- Barra de progreso horizontal 0..1.
function D.bar(x, y, w, h, k, color, track)
  D.rect(x, y, w, h, track or T.C.grafito, h / 2)
  k = T.clamp(k or 0, 0, 1)
  if k > 0 then D.rect(x, y, math.max(h, w * k), h, color, h / 2) end
end

--- Barra de delta centrada: verde a la izquierda si vas más rápido, ámbar a la derecha si más lento.
function D.deltaBar(x, y, w, h, d, range)
  D.rect(x, y, w, h, T.C.grafito, h / 2)
  local mid = x + w / 2
  if type(d) == 'number' then
    local k = T.clamp(d / range, -1, 1)
    local color = d <= 0 and T.C.record or T.C.alerta
    if k < 0 then D.rect(mid + k * w / 2, y, -k * w / 2, h, color, h / 2)
    else D.rect(mid, y, k * w / 2, h, color, h / 2) end
  end
  D.rect(mid - 1, y - 2, 2, h + 4, T.C.plata)
end

--- Chip con texto (estado o aviso).
function D.chip(str, x, y, w, h, color)
  ui.drawRectFilled(P(x, y), P(x + w, y + h), T.alpha(color, 0.16), 5 * s)
  D.text(str, 10, x, y, w, h, color, T.F.bold, 'c', 'c')
end

--- Mensaje centrado para overlays sin datos.
function D.empty(dw, dh, title, sub)
  D.panel(0, 0, dw, dh)
  D.text(title, 13, 12, 0, dw - 24, sub and dh * 0.55 or dh, T.C.plata, T.F.bold, 'c', sub and 'b' or 'c')
  if sub then D.text(sub, 11, 12, dh * 0.58, dw - 24, dh * 0.4, T.C.niebla, T.F.ui, 'c', 't', true) end
end

return D
