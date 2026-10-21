--[[ Barra de delta contra tu mejor vuelta. ]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local live = require('lib.live')

local M = {}
local DW, DH = 360, 64

function M.draw()
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH, 10)
  local d, src = live.delta()
  local color = type(d) == 'number' and (d <= 0 and T.C.record or T.C.alerta) or T.C.niebla
  D.text(T.signed(d, 2), 26, 0, 2, DW, 36, color, T.F.mono, 'c')
  local range = config.s.deltaRange
  D.deltaBar(12, 42, DW - 24, 10, d, range)
  D.text(T.signed(-range, 1), 9, 12, 52, 60, 12, T.C.niebla, T.F.monoReg)
  D.text(T.signed(range, 1), 9, DW - 72, 52, 60, 12, T.C.niebla, T.F.monoReg, 'r')
  if src == 'ac' then D.text('AC', 9, DW / 2 - 30, 52, 60, 12, T.C.niebla, T.F.monoReg, 'c') end
end

return M
