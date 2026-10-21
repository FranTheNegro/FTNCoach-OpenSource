--[[ Ventana principal: delta, última y mejor vuelta, el consejo de la próxima curva y avisos del momento. ]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 360, 236

local KIND = {
  valid = { 'Válida', C.record },
  out_lap = { 'Salida de boxes', C.niebla },
  in_lap = { 'Entrada a boxes', C.niebla },
  off_track = { 'Salida de pista', C.alerta },
  incident = { 'Incidente', C.error },
  partial = { 'Parcial', C.niebla },
}
M.KIND = KIND

--- Consejo de la curva que viene (dentro de los próximos ~4 % de vuelta).
local function nextTip()
  local tips = link.get('tips')
  if not config.s.tips or type(tips) ~= 'table' then return nil end
  local p = live.car.splinePosition
  for _, t in ipairs(tips) do
    local from = (t.startPct or 0) - 0.04
    local to = t.apexPct or t.startPct or 0
    if (p >= from and p <= to) or (from < 0 and p >= from + 1) then return t end
  end
  return nil
end
M.nextTip = nextTip

--- Aviso más importante del momento, igual que en el dashboard.
local function advice(imperial)
  local car = live.car
  local f = live.fuel()
  local fu = T.U.fuelLabel(imperial)
  if f.missing and f.missing > 0 then
    return 'COMBUSTIBLE', string.format('Con este consumo no llegás al final: te faltan %s %s. Ahorrá o planeá una parada.', T.dec(T.U.fuel(f.missing, imperial)), fu), C.alerta
  end
  for i = 0, 3 do
    local w = car.wheels[i]
    local opt = w.tyreOptimumTemperature > 0 and w.tyreOptimumTemperature or 85
    if w.tyreCoreTemperature > opt + 27 then
      return 'NEUMÁTICOS', string.format('%s pasada de temperatura (%d%s). Suavizá las entradas.', live.TYRE_NAMES[i + 1],
        math.floor(T.U.temp(w.tyreCoreTemperature, imperial) + 0.5), T.U.tempLabel(imperial)), C.error
    end
  end
  for i = 0, 3 do
    if car.wheels[i].brakeTemperature > 800 then
      return 'FRENOS', string.format('Frenos %s muy calientes. Dejalos respirar en la próxima recta.', live.TYRE_NAMES[i + 1]), C.alerta
    end
  end
  if f.lapsLeft and f.lapsLeft < 3 then
    return 'COMBUSTIBLE', string.format('Quedan %s vueltas de combustible.', T.dec(f.lapsLeft)), C.alerta
  end
  local d = live.delta()
  if d then
    if d <= 0 then return 'RITMO', string.format('Vas %s s más rápido que tu mejor vuelta. Mantené el ritmo.', T.dec(math.abs(d), 2)), C.record end
    return 'RITMO', string.format('Vas %s s detrás de tu mejor vuelta.', T.dec(d, 2)), C.plata
  end
  return 'RITMO', 'Completá una vuelta para empezar a comparar contra tu mejor tiempo.', C.niebla
end

function M.draw()
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local imperial = config.imperial(link)
  local pad = 14

  -- Encabezado: estado de la conexión con FTN Coach
  D.text('FTN COACH', 11, pad, 8, 120, 16, C.plata, T.F.display)
  local ok = link.ok()
  D.circle(DW - pad - 4, 16, 3.5, ok and C.record or C.niebla)
  D.text(ok and 'Conectado' or 'Solo datos de AC', 10, DW - 160, 8, 146 - 10, 16, C.niebla, T.F.ui, 'r')

  -- Delta
  local d, src = live.delta()
  local dColor = type(d) == 'number' and (d <= 0 and C.record or C.alerta) or C.niebla
  D.label(src == 'ac' and 'DELTA · AC' or 'DELTA', pad, 30, 100)
  D.text(T.signed(d, 2), 30, pad, 24, DW - 2 * pad, 38, dColor, T.F.mono, 'r')
  D.deltaBar(pad, 66, DW - 2 * pad, 8, d, config.s.deltaRange)

  -- Última y mejor vuelta
  local y = 82
  D.label('ÚLTIMA', pad, y, 100)
  D.label('MEJOR', DW / 2, y, 100)
  D.text(T.lapTime(live.lastLap()), 20, pad, y + 12, DW / 2 - pad, 26, C.blanco, T.F.mono)
  D.text(T.lapTime(live.bestLap()), 20, DW / 2, y + 12, DW / 2 - pad, 26, C.mejor, T.F.mono)
  local last = link.get('lastLap')
  local kind
  if type(last) == 'table' and last.kind then kind = KIND[last.kind] or { last.kind, C.niebla }
  elseif live.lastLap() then kind = live.car.isLastLapValid and KIND.valid or KIND.off_track end
  if kind then D.text(kind[1], 11, pad, y + 38, DW / 2 - pad, 14, kind[2], T.F.semi) end

  -- Foco de la sesión según el estilo de manejo (sale de tus sesiones analizadas)
  local focus = config.s.focus and link.get('focus')
  if type(focus) == 'table' and focus.title then
    D.text('FOCO · ' .. focus.title .. (focus.value and ('  ' .. focus.value) or ''), 10, DW / 2, y + 38, DW / 2 - pad, 14, C.azul, T.F.semi)
  end

  -- Consejo de la próxima curva o aviso del momento
  y = 140
  local tip = nextTip()
  local bx, bw, bh = pad - 4, DW - 2 * pad + 8, DH - y - 8
  if tip then
    D.card(bx, y, bw, bh, 8)
    D.rect(bx, y, 3, bh, C.alerta, 1)
    D.text(tip.title or '', 12, pad + 6, y + 4, bw - 20, 18, C.plata, T.F.bold)
    D.text(tip.text or '', 12, pad + 6, y + 22, bw - 20, bh - 26, C.blanco, T.F.ui, 'l', 't', true)
  elseif config.s.advice then
    local tag, text, color = advice(imperial)
    D.card(bx, y, bw, bh, 8)
    D.rect(bx, y, 3, bh, color, 1)
    D.text(tag, 10, pad + 6, y + 4, bw - 20, 18, color, T.F.bold)
    D.text(text, 12, pad + 6, y + 22, bw - 20, bh - 26, C.plata, T.F.ui, 'l', 't', true)
  end
end

return M
