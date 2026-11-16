--[[
  Clasificación de todos los autos, calculada dentro de AC con los datos de CSP
  (la memoria compartida de AC solo trae tu auto).

  - Orden: la posición de AC (en carrera por recorrido; en práctica y
    clasificación por mejor vuelta).
  - Gap en carrera: cada auto deja la hora a la que pasa por cada uno de los
    CHECKS puntos de la vuelta; el gap con el líder es la diferencia de hora en
    el último punto que pasó. Es lo mismo que hacen las transmisiones.
  - En práctica y clasificación, la diferencia de mejor vuelta.

  La usan la torre de posiciones y el banner, y se manda a FTN Coach para la
  mini tabla del dashboard de la tablet (solo si FTN Coach está abierto).
]]

local config = require('lib.config')
local link = require('lib.link')

local M = { cars = {}, race = false, focus = 0, leaderLaps = 0, best = nil }

local CHECKS = 200
--- Pasadas guardadas por auto (unas 3 vueltas): alcanza para autos doblados una vez.
local KEEP = CHECKS * 3
local REFRESH_S = 0.2
local SEND_S = 0.5

local clock = 0
local acc, sendAcc = 0, 0
local passes = {} -- [carIdx] = { [clave absoluta] = hora }
local lastKey = {} -- [carIdx] = última clave registrada

local function progress(c)
  return c.lapCount + c.splinePosition
end

local function record(i, c)
  local key = math.floor(progress(c) * CHECKS)
  local last = lastKey[i]
  -- Volvió atrás o saltó lejos (reinicio de sesión, vuelta a boxes): se empieza de nuevo
  if last and (key < last - CHECKS / 2 or key > last + CHECKS) then passes[i], last = nil, nil end
  local t = passes[i]
  if not t then
    t = {}
    passes[i] = t
  end
  if last == nil then
    t[key] = clock
  else
    -- Llena los puntos que pasó entre dos lecturas y olvida los de hace más de KEEP
    for k = last + 1, key do
      t[k] = clock
      t[k - KEEP] = nil
    end
  end
  lastKey[i] = key
end

--- Segundos detrás del líder en el último punto que pasó el auto (o nil).
local function raceGap(i, leaderIdx)
  local key = lastKey[i]
  local mine = key and passes[i] and passes[i][key]
  local lead = key and passes[leaderIdx] and passes[leaderIdx][key]
  if not mine or not lead then return nil end
  return math.max(0, mine - lead)
end

local function driverNumber(i)
  local ok, n = pcall(ac.getDriverNumber, i)
  if ok and n ~= nil and tostring(n) ~= '' and tostring(n) ~= '0' then return tostring(n) end
  return ''
end

local function rebuild()
  local sim = ac.getSim()
  M.race = sim.raceSessionType == ac.SessionType.Race
  M.focus = sim.focusedCar or 0
  local list = {}
  for i = 0, sim.carsCount - 1 do
    local c = ac.getCar(i)
    if c and c.isConnected and not c.isHidingLabels then
      record(i, c)
      list[#list + 1] = {
        idx = i,
        num = driverNumber(i),
        name = ac.getDriverName(i) or ('Auto ' .. (i + 1)),
        pos = c.racePosition or 0,
        laps = c.lapCount,
        pct = c.splinePosition,
        prog = progress(c),
        best = c.bestLapTimeMs > 0 and c.bestLapTimeMs / 1000 or nil,
        last = c.previousLapTimeMs and c.previousLapTimeMs > 0 and c.previousLapTimeMs / 1000 or nil,
        pit = c.isInPitlane or c.isInPit,
        me = i == 0,
      }
    end
  end
  table.sort(list, function(a, b)
    local pa = a.pos > 0 and a.pos or 999
    local pb = b.pos > 0 and b.pos or 999
    if pa ~= pb then return pa < pb end
    if M.race then return a.prog > b.prog end
    return (a.best or 1e9) < (b.best or 1e9)
  end)

  local leader = list[1]
  local best = nil
  for _, r in ipairs(list) do
    if r.best and (not best or r.best < best) then best = r.best end
  end
  M.best = best
  M.leaderLaps = leader and leader.laps or 0
  for k, r in ipairs(list) do
    r.position = k
    if M.race then
      r.lapsDown = leader and math.max(0, math.floor(leader.prog - r.prog + 1e-6)) or 0
      r.gap = k == 1 and 0 or raceGap(r.idx, leader.idx)
    else
      r.lapsDown = 0
      r.gap = (r.best and best) and (r.best - best) or nil
    end
    local prev = list[k - 1]
    r.interval = (k > 1 and r.gap and prev.gap and prev.lapsDown == r.lapsDown) and math.max(0, r.gap - prev.gap) or nil
  end
  M.cars = list
end

-- ── Envío a FTN Coach (mini tabla del dashboard) ──

local sending = false

local function send()
  if sending or not link.ok() or #M.cars == 0 then return end
  local rows = {}
  for _, r in ipairs(M.cars) do
    rows[#rows + 1] = {
      r.idx, r.num, r.name, r.pos, r.laps, r.pct,
      (M.race and r.gap) or -1,
      r.best and math.floor(r.best * 1000) or 0,
      r.last and math.floor(r.last * 1000) or 0,
      r.pit and 1 or 0, r.me and 1 or 0,
    }
  end
  local body = JSON.stringify({ focus = M.focus, cars = rows })
  sending = true
  local ok = pcall(web.request, 'POST', 'http://127.0.0.1:' .. math.floor(config.s.port) .. '/api/ac/standings',
    { ['Content-Type'] = 'application/json' }, body, function() sending = false end)
  if not ok then sending = false end
end

function M.update(dt)
  clock = clock + dt
  acc = acc + dt
  sendAcc = sendAcc + dt
  if acc >= REFRESH_S then
    acc = 0
    rebuild()
  end
  if sendAcc >= SEND_S then
    sendAcc = 0
    send()
  end
end

--- El auto del índice `idx` en la clasificación (o nil).
function M.byIdx(idx)
  for _, r in ipairs(M.cars) do
    if r.idx == idx then return r end
  end
  return nil
end

--- "Juan Pérez" → "J. PÉREZ".
function M.shortName(name)
  local first, last = name:match('^(%S+).*%s(%S+)$')
  if not first then return name:upper() end
  -- Inicial entera aunque sea una letra con tilde (UTF-8 de dos bytes)
  local initial = first:byte(1) >= 0xC0 and first:sub(1, 2) or first:sub(1, 1)
  return (initial .. '. ' .. last):upper()
end

return M
