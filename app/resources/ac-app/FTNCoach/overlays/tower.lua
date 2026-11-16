--[[
  Torre de posiciones: posición, número, piloto, gap o intervalo, mejor vuelta y
  boxes, con el estilo de la skin elegida. Cuando alguien gana o pierde un puesto
  su fila se desliza al lugar nuevo y se tiñe un momento (verde si subió, rojo si
  bajó). Muestra el líder y los autos alrededor del que sigue la cámara.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local live = require('lib.live')
local standings = require('lib.standings')

local M = {}
local C = T.C
local DW = 300
local ROW = 24
local HEAD = 34

--- Tiempo del deslizamiento y de la marca de cambio de puesto (s).
local SLIDE_S = 0.35
local MARK_S = 1.6

local shownY = {} -- [idx] = y dibujada (se acerca a la de su puesto)
local lastPos = {} -- [idx] = puesto anterior
local mark = {} -- [idx] = { t, up }

local function rowsToShow(cars, focus, n)
  if #cars <= n then return cars end
  local at = 1
  for k, r in ipairs(cars) do
    if r.idx == focus then at = k end
  end
  local from = math.max(2, math.min(at - math.floor((n - 1) / 2), #cars - (n - 2)))
  local out = { cars[1] }
  for k = from, from + n - 2 do out[#out + 1] = cars[k] end
  return out
end

local function gapText(r)
  if r.position == 1 then
    if standings.race then return 'LÍDER' end
    return T.lapTime(r.best)
  end
  if standings.race and r.lapsDown > 0 then return '+' .. r.lapsDown .. 'V' end
  local v = (config.s.towerGap == 2 or not standings.race) and r.gap or r.interval
  if not v then return T.DASH end
  return '+' .. T.dec(v, standings.race and 1 or 3)
end

function M.draw(dt)
  dt = dt or 0
  local sk = T.SK
  local accent = sk and sk.accent or T.accent(config.s.accent)
  local labelColor = sk and sk.label or C.niebla
  local cars = standings.cars
  local n = math.min(math.floor(config.s.towerRows), math.max(1, #cars))
  local DH = HEAD + n * ROW + 8
  D.begin(DW, DH)
  D.panel(0, 0, DW, DH)
  local pad = 10

  -- Encabezado: logo de la categoría (o la sigla) y la vuelta
  local logo = sk and sk.logo
  if logo then
    local size = ui.imageSize(logo)
    local h = 20
    local w = (size and size.y > 0) and math.min(90, h * size.x / size.y) or 60
    ui.drawImage(logo, D.P(pad, 7), D.P(pad + w, 7 + h))
  else
    D.text(sk and sk.short or 'POSICIONES', sk and 16 or 11, pad, 6, 160, 22, sk and accent or labelColor, T.F.display)
  end
  if config.s.towerLaps then
    local session = ac.getSession(live.sim.currentSessionIndex)
    local total = session and not session.isTimedRace and session.laps or 0
    local lap = standings.leaderLaps + 1
    local text = (total and total > 0) and string.format('VUELTA %d/%d', math.min(lap, total), total)
      or (live.sim.sessionTimeLeft and live.sim.sessionTimeLeft > 0) and T.clock(live.sim.sessionTimeLeft / 1000)
      or ''
    D.text(text, 12, DW - 160, 6, 150, 22, C.blanco, T.F.mono, 'r')
  end
  D.rect(pad, HEAD - 4, DW - 2 * pad, 2, accent)

  if #cars == 0 then
    D.text('Esperando a los autos…', 12, pad, HEAD, DW - 2 * pad, ROW * 2, C.niebla, T.F.ui, 'c', 'c')
    return
  end

  local rows = rowsToShow(cars, standings.focus, n)
  local k = 1 - math.exp(-dt * 4.6 / SLIDE_S)
  local now = os.preciseClock()
  local seen = {}
  for slot, r in ipairs(rows) do
    seen[r.idx] = true
    local target = HEAD + (slot - 1) * ROW
    -- Cambio de puesto: se anota para teñir la fila
    local prev = lastPos[r.idx]
    if prev and prev ~= r.position then mark[r.idx] = { t = now, up = r.position < prev } end
    lastPos[r.idx] = r.position
    local y = shownY[r.idx] or target
    y = y + (target - y) * k
    if math.abs(target - y) < 0.3 then y = target end
    shownY[r.idx] = y

    local focused = r.idx == standings.focus
    if focused then
      D.rect(4, y, DW - 8, ROW - 2, T.alpha(accent, 0.24), 4)
      D.rect(4, y, 3, ROW - 2, accent)
    end
    local m = mark[r.idx]
    if m then
      local age = now - m.t
      if age > MARK_S then mark[r.idx] = nil
      else D.rect(4, y, DW - 8, ROW - 2, T.alpha(m.up and C.record or C.error, 0.3 * (1 - age / MARK_S)), 4) end
    end

    -- Puesto en una caja del color de la categoría
    D.rect(pad, y + 2, 26, ROW - 6, r.position == 1 and accent or T.alpha(labelColor, 0.2), 3)
    D.text(tostring(r.position), 12, pad, y + 2, 26, ROW - 6, r.position == 1 and C.carbono or C.blanco, T.F.display, 'c', 'c')
    D.text(r.num ~= '' and r.num or '', 10, pad + 30, y, 30, ROW - 2, C.niebla, T.F.monoReg, 'c')
    D.text(standings.shortName(r.name), 12, pad + 62, y, 132, ROW - 2, focused and C.blanco or C.plata, T.F.bold)
    if r.pit then
      D.chip('BOX', DW - pad - 44, y + 4, 44, ROW - 10, C.alerta)
    else
      local fastest = config.s.towerBest and r.best and standings.best and math.abs(r.best - standings.best) < 0.0005
      if fastest then D.circle(DW - pad - 80, y + ROW / 2 - 1, 3, C.mejor) end
      D.text(gapText(r), 11, DW - pad - 74, y, 74, ROW - 2, fastest and not standings.race and C.mejor or C.plata, T.F.mono, 'r')
    end
  end
  -- Los que salieron de la vista vuelven a entrar desde su lugar nuevo
  for idx in pairs(shownY) do
    if not seen[idx] then shownY[idx] = nil end
  end
end

return M
