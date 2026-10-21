--[[ Últimas vueltas con su tiempo, la diferencia con la mejor y si fueron válidas. ]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')
local KIND = require('overlays.coach').KIND

local M = {}
local C = T.C
local DW = 320
local ROW = 24

function M.draw()
  local n = math.floor(config.s.lapsCount)
  local DH = 34 + n * ROW + 6
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local pad = 12

  -- FTN Coach sabe más del tipo de vuelta (boxes, incidentes); sin él, la validez de AC
  local list = link.get('laps')
  local fromFtn = type(list) == 'table' and #list > 0
  if not fromFtn then list = live.laps end
  D.label('ÚLTIMAS VUELTAS', pad, 8, 180)
  D.text(fromFtn and 'FTN Coach' or 'AC', 10, DW - 120, 8, 108, 14, C.niebla, T.F.ui, 'r')

  if #list == 0 then
    D.text('Todavía no completaste vueltas.', 12, pad, 34, DW - 2 * pad, DH - 44, C.niebla, T.F.ui, 'c', 'c')
    return
  end
  local best
  for _, l in ipairs(list) do
    if l.kind == 'valid' and (not best or l.timeS < best) then best = l.timeS end
  end
  local y = 32
  for k = #list, math.max(1, #list - n + 1), -1 do
    local l = list[k]
    local isBest = best and l.kind == 'valid' and math.abs(l.timeS - best) < 0.0005
    local kind = KIND[l.kind] or { l.label or l.kind, C.niebla }
    if isBest then D.rect(4, y, DW - 8, ROW - 2, T.alpha(C.mejor, 0.14), 6) end
    D.text('V' .. l.lap, 11, pad, y, 40, ROW - 2, C.niebla, T.F.mono)
    D.text(T.lapTime(l.timeS), 14, pad + 42, y, 100, ROW - 2, isBest and C.mejor or C.blanco, T.F.mono)
    local diff = (best and l.kind == 'valid' and not isBest) and T.signed(l.timeS - best, 3) or ''
    D.text(diff, 11, pad + 142, y, 70, ROW - 2, C.alerta, T.F.monoReg)
    D.text(isBest and 'Mejor' or kind[1], 11, DW - 112, y, 100, ROW - 2, isBest and C.mejor or kind[2], T.F.semi, 'r')
    y = y + ROW
  end
end

return M
