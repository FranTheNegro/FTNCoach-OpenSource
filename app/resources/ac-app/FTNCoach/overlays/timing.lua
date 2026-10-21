--[[ Tiempos: vuelta en curso, delta, sectores y referencias (última, mejor e ideal). ]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')

local M = {}
local C = T.C
local DW, DH = 360, 250
local GRADE = { best = C.mejor, close = C.blanco, slow = C.alerta }

local function ref(label, sub, subColor, value, valueColor, y)
  D.text(label, 12, 14, y, 160, 16, C.plata, T.F.ui)
  D.text(sub, 10, 14, y + 15, 200, 13, subColor, T.F.monoReg)
  D.text(value, 17, DW - 174, y, 160, 28, valueColor, T.F.mono, 'r')
end

function M.draw()
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local car = live.car
  local pad = 14

  -- Vuelta en curso
  local timeLeft, lapsLeft = live.remaining()
  D.label('VUELTA ' .. (car.lapCount + 1) .. ' · ACTUAL', pad, 8, 200)
  if timeLeft then D.text('Resta ' .. T.clock(timeLeft), 10, DW - 160, 8, 146, 14, C.niebla, T.F.monoReg, 'r')
  elseif lapsLeft then D.text('Resta ' .. lapsLeft .. ' v', 10, DW - 160, 8, 146, 14, C.niebla, T.F.monoReg, 'r') end
  D.text(T.lapTime(car.lapTimeMs / 1000), 30, pad, 20, 220, 36, C.blanco, T.F.mono)
  local valid = car.isLapValid
  D.chip(valid and 'VÁLIDA' or 'INVÁLIDA', DW - pad - 74, 28, 74, 20, valid and C.record or C.error)

  local d = live.delta()
  local dColor = d == nil and C.niebla or d < 0 and C.record or d == 0 and C.blanco or C.alerta
  D.text(T.signed(d, 3), 20, pad, 56, 120, 24, dColor, T.F.mono)
  D.text(d == nil and 'SIN DELTA' or (d < 0 and 'ADELANTE VS MEJOR' or 'ATRÁS VS MEJOR'), 9, pad + 112, 56, 180, 24, C.niebla, T.F.semi)

  local y = 84
  -- Sectores
  if config.s.timingSectors then
    local sectors = live.sectors()
    if #sectors > 0 then
      local gap = 8
      local w = (DW - 2 * pad - gap * (#sectors - 1)) / #sectors
      for i, s in ipairs(sectors) do
        local x = pad + (i - 1) * (w + gap)
        local color = s.state == 'live' and C.azul or s.state == 'done' and GRADE[s.grade or 'close'] or C.niebla
        local tag = ''
        if s.state == 'live' then tag = 'EN CURSO'
        elseif s.state == 'done' then tag = s.grade == 'best' and 'MEJOR' or (s.diffS and T.signed(s.diffS, 2) or '') end
        D.label(s.name, x, y, w / 2)
        D.text(tag, 9, x + w / 2 - 20, y, w / 2 + 20, 14, color, T.F.mono, 'r')
        D.text(s.timeS and string.format('%.3f', s.timeS) or '—', 15, x, y + 13, w, 20, color, T.F.mono)
        D.bar(x, y + 36, w, 3, s.progress, color)
      end
    else
      D.text('Este circuito no informa sectores.', 11, pad, y, DW - 2 * pad, 20, C.niebla)
    end
    y = y + 50
  end

  -- Referencias
  local best = live.bestLap()
  local last = live.lastLap()
  local lastIsBest = last and best and math.abs(last - best) < 0.0005
  local sub = last == nil and 'Todavía sin vueltas' or lastIsBest and 'Mejor de la sesión' or (T.signed(last - (best or last), 3) .. ' vs mejor')
  ref('Última vuelta', sub, lastIsBest and C.mejor or C.alerta, T.lapTime(last), C.blanco, y)
  y = y + 36
  local lapsList = link.get('laps')
  local bestNo
  if type(lapsList) == 'table' then
    for _, l in ipairs(lapsList) do if l.best then bestNo = l.lap end end
  end
  ref('Mejor vuelta', bestNo and ('Vuelta ' .. bestNo) or 'De la sesión', C.niebla, T.lapTime(best), C.mejor, y)
  if config.s.timingIdeal then
    y = y + 36
    local ideal = live.ideal()
    ref('Ideal de la sesión', (ideal and best) and (T.signed(ideal - best, 3) .. ' s de potencial') or 'Completá todos los sectores', C.niebla, T.lapTime(ideal), C.azul, y)
  end
end

return M
