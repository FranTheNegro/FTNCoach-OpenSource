--[[
  Relative: los autos más cercanos en pista, adelante y atrás, con la distancia en
  segundos. El de adelante y el de atrás se tiñen según la tendencia (verde si te
  conviene, rojo si no), como en el dashboard.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local live = require('lib.live')

local M = {}
local C = T.C
local DW = 380
local ROW = 26
local TREND = { good = C.record, bad = C.error, flat = C.plata, none = C.niebla }

local function row(r, y, me, trend)
  local pad = 10
  local accent = T.accent(config.s.accent)
  if me then
    D.rect(4, y, DW - 8, ROW - 2, T.alpha(accent, 0.28), 6)
  elseif trend and trend.kind ~= 'none' and trend.kind ~= 'flat' then
    -- Degradé de la tendencia, de izquierda a derecha
    local col = TREND[trend.kind]
    local a = 0.1 + 0.18 * trend.strength
    local s = D.scale()
    ui.drawRectFilledMultiColor(vec2(4 * s, y * s), vec2((DW - 4) * s, (y + ROW - 2) * s), T.alpha(col, a), T.alpha(col, 0), T.alpha(col, 0), T.alpha(col, a))
  end
  -- Otros en la misma vuelta en blanco; los que te sacan vuelta en rojo y a los que les sacás, en azul
  local nameColor = C.blanco
  if not me and live.isRace() then
    if r.lapDiff > 0 then nameColor = C.error elseif r.lapDiff < 0 then nameColor = C.azul end
  end
  D.text(r.pos and r.pos > 0 and ('P' .. r.pos) or '', 11, pad, y, 34, ROW - 2, me and C.blanco or C.plata, T.F.mono)
  D.text(r.name or '', 12, pad + 38, y, DW - 150, ROW - 2, nameColor, me and T.F.bold or T.F.semi)
  if r.pit then D.chip('BOX', DW - 132, y + 4, 34, ROW - 10, C.alerta) end
  local gap = me and 'Vos' or ((r.d >= 0 and '−' or '+') .. string.format('%.1f', r.gapS))
  D.text(gap, 13, DW - 92, y, 82, ROW - 2, me and C.plata or (trend and TREND[trend.kind] or C.blanco), T.F.mono, 'r')
end

function M.draw()
  local n = math.floor(config.s.relRows)
  local DH = 34 + (2 * n + 1) * ROW + 6
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local car = live.car
  local sim = live.sim

  D.label('RELATIVO', 12, 10, 120)
  if car.racePosition > 0 then
    D.text(string.format('P%d de %d', car.racePosition, sim.carsCount), 11, DW - 140, 8, 128, 16, C.plata, T.F.mono, 'r')
  end

  local ahead, behind = live.rel.ahead, live.rel.behind
  if #ahead == 0 and #behind == 0 then
    D.text('Pista libre: no hay otros autos en la sesión.', 12, 12, 34, DW - 24, DH - 44, C.niebla, T.F.ui, 'c', 'c', true)
    return
  end
  local y = 34
  -- Adelante: el más lejano arriba
  for i = n, 1, -1 do
    local r = ahead[i]
    if r then row(r, y, false, i == 1 and live.trend('ahead') or nil) end
    y = y + ROW
  end
  row({ pos = car.racePosition, name = ac.getDriverName(live.idx), d = 0, gapS = 0, lapDiff = 0, pit = car.isInPitlane }, y, true)
  y = y + ROW
  for i = 1, n do
    local r = behind[i]
    if r then row(r, y, false, i == 1 and live.trend('behind') or nil) end
    y = y + ROW
  end
end

return M
