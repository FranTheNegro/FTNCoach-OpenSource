--[[
  Banner del piloto que sigue la cámara (en carrera tu auto; en una repetición o
  como espectador, el que estés mirando): puesto, número, nombre, vuelta y sus
  tiempos, con el estilo de la skin elegida.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local live = require('lib.live')
local standings = require('lib.standings')

local M = {}
local C = T.C
local DW, DH = 420, 74

function M.draw()
  D.begin(DW, DH)
  local sk = T.SK
  local accent = sk and sk.accent or T.accent(config.s.accent)
  local r = standings.byIdx(standings.focus)
  if not r then
    D.empty(DW, DH, 'Esperando al piloto…')
    return
  end
  D.panel(0, 0, DW, DH)

  -- Puesto en bloque de color, como en las transmisiones
  D.rect(0, 0, 74, DH, accent, 12)
  D.rect(60, 0, 14, DH, accent)
  D.text(tostring(r.position), 34, 0, 0, 74, DH, C.carbono, T.F.display, 'c', 'c')

  local x = 88
  if r.num ~= '' then
    D.text('#' .. r.num, 14, x, 10, 60, 22, sk and sk.label or C.niebla, T.F.mono)
    x = x + 52
  end
  D.text(r.name:upper(), 20, x, 6, DW - x - 100, 30, C.blanco, T.F.display)

  local session = ac.getSession(live.sim.currentSessionIndex)
  local total = session and not session.isTimedRace and session.laps or 0
  local lap = r.laps + 1
  local lapText = (total and total > 0) and string.format('VUELTA %d/%d', math.min(lap, total), total) or ('VUELTA ' .. lap)
  D.text(lapText, 12, DW - 112, 10, 100, 22, C.plata, T.F.mono, 'r')

  if config.s.bannerBest then
    D.label('MEJOR', 88, 42, 50)
    D.text(T.lapTime(r.best), 13, 140, 40, 90, 20, standings.best and r.best and math.abs(r.best - standings.best) < 0.0005 and C.mejor or C.blanco, T.F.mono)
    D.label('ÚLTIMA', 240, 42, 56)
    D.text(T.lapTime(r.last), 13, 300, 40, 90, 20, C.blanco, T.F.mono)
  end
  if r.pit then D.chip('BOXES', DW - 70, 44, 58, 18, C.alerta) end
end

return M
