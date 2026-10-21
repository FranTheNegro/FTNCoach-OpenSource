--[[
  Estado en vivo calculado dentro de AC, frame a frame, con los datos de CSP:
  sectores con su nota, vuelta ideal, traza de pedales, autos cercanos y su
  tendencia, combustible hasta el final e historial de vueltas. Es lo mismo que
  calcula el dashboard de la tablet; cuando FTN Coach está conectado se usan sus
  datos (delta, consumo, tipo de vuelta) porque son más precisos.
]]

local config = require('lib.config')
local link = require('lib.link')
local T = require('lib.theme')

local L = {}

L.sim = ac.getSim()
L.idx = 0
L.car = ac.getCar(0)

-- ── Traza de pedales (anillo de 10 s a 30 Hz) ──

local TRACE_HZ = 30
L.TRACE_MAX = 10 * TRACE_HZ
L.TRACE_HZ = TRACE_HZ
L.trace = { gas = {}, brake = {}, speed = {}, n = 0, head = 0 }
local traceAcc = 0

local function pushTrace(car)
  local t = L.trace
  t.head = t.head % L.TRACE_MAX + 1
  t.gas[t.head] = car.gas
  t.brake[t.head] = car.brake
  t.speed[t.head] = car.speedKmh
  if t.n < L.TRACE_MAX then t.n = t.n + 1 end
end

--- Muestra `k` contando desde la más vieja de las últimas `count` (k = 1..count).
function L.traceAt(arr, count, k)
  local t = L.trace
  local i = (t.head - count + k - 1) % L.TRACE_MAX + 1
  return arr[i] or 0
end

-- ── Luces de cambio ──

L.seenMaxRpm = 0
local shiftRpmOf = {}

--- RPM de cambio del auto (drivetrain.ini → AUTO_SHIFTER/UP), o nil si no la trae.
local function carShiftRpm(idx)
  local id = ac.getCarID(idx)
  if shiftRpmOf[id] == nil then
    local ok, v = pcall(function()
      return ac.INIConfig.carData(idx, 'drivetrain.ini'):get('AUTO_SHIFTER', 'UP', 0)
    end)
    shiftRpmOf[id] = ok and type(v) == 'number' and v > 0 and v or false
  end
  return shiftRpmOf[id] or nil
end

L.SEGMENTS = 24

--- Igual que en el dashboard: cuántas luces prender, si todas parpadean (cambio) o rápido (pasado).
function L.shiftState()
  local car = L.car
  local top = car.rpmLimiter > 0 and car.rpmLimiter or math.max(4000, L.seenMaxRpm)
  local shift = carShiftRpm(L.idx) or top * 0.95
  if shift > top then shift = top * 0.97 end
  local first = shift * 0.75
  local blink = math.min(shift * 1.02, top * 0.995)
  local frac = T.clamp((car.rpm - first) / math.max(1, shift - first), 0, 1)
  return { lit = math.ceil(frac * L.SEGMENTS - 1e-6), flash = car.rpm >= shift, fast = car.rpm >= blink, top = top }
end

-- ── Referencias de tiempo ──

--- Tiempo de vuelta de referencia (s) para pasar distancia en pista a segundos.
function L.refLap()
  local car = L.car
  if car.bestLapTimeMs > 0 then return car.bestLapTimeMs / 1000 end
  if car.estimatedLapTimeMs > 0 then return car.estimatedLapTimeMs / 1000 end
  if car.previousLapTimeMs > 0 then return car.previousLapTimeMs / 1000 end
  return math.max(60, L.sim.trackLengthM / 40)
end

--- Delta contra tu mejor vuelta: el de FTN Coach si está, si no el medidor de AC.
function L.delta()
  local d = link.get('deltaS')
  if type(d) == 'number' then return d, 'ftn' end
  if L.car.bestLapTimeMs > 0 and L.car.lapTimeMs > 0 then return L.car.performanceMeter, 'ac' end
  return nil, nil
end

function L.bestLap()
  local b = link.get('bestLapS')
  if type(b) == 'number' and b > 0 then return b end
  if L.car.bestLapTimeMs > 0 then return L.car.bestLapTimeMs / 1000 end
  return nil
end

function L.lastLap()
  return L.car.previousLapTimeMs > 0 and L.car.previousLapTimeMs / 1000 or nil
end

function L.isRace()
  return L.sim.raceSessionType == ac.SessionType.Race
end

--- Tiempo que queda de sesión (s) o vueltas que faltan, para mostrar "Resta …".
function L.remaining()
  local sim = L.sim
  local session = ac.getSession(sim.currentSessionIndex)
  if session and session.laps and session.laps > 0 and not session.isTimedRace then
    return nil, math.max(0, session.laps - L.car.lapCount)
  end
  if sim.sessionTimeLeft and sim.sessionTimeLeft > 0 then return sim.sessionTimeLeft / 1000, nil end
  return nil, nil
end

-- ── Sectores ──

local GOOD_SECTOR_MARGIN_MS = 120
local grades = {}
local liveBest = {}
local prevSector = -1
local prevLapCount = -1

local function nSectors()
  return #L.sim.lapSplits
end

local function updateSectors(car)
  local cur = car.currentSector
  if car.lapCount ~= prevLapCount or cur < prevSector then
    grades = {}
    liveBest = {}
  elseif cur > prevSector and prevSector >= 0 and prevSector < #car.currentSplits then
    -- Se terminó un sector: se compara con el mejor que había antes de terminarlo
    local t = car.currentSplits[prevSector]
    local b = liveBest[prevSector] or 0
    if b <= 0 or t <= b then grades[prevSector] = { grade = 'best', diff = b > 0 and (t - b) / 1000 or nil }
    elseif t - b <= GOOD_SECTOR_MARGIN_MS then grades[prevSector] = { grade = 'close', diff = (t - b) / 1000 }
    else grades[prevSector] = { grade = 'slow', diff = (t - b) / 1000 } end
  end
  if cur < #car.bestSplits then liveBest[cur] = car.bestSplits[cur] end
  prevSector = cur
  prevLapCount = car.lapCount
end

--- Estado de cada sector, igual que en el dashboard.
function L.sectors()
  local sim, car = L.sim, L.car
  local n = nSectors()
  local out = {}
  if n < 1 then return out end
  local cur = car.currentSector
  local doneSum = 0
  for i = 0, n - 1 do
    local start = sim.lapSplits[i]
    local stop = i + 1 < n and sim.lapSplits[i + 1] or 1
    local name = 'S' .. (i + 1)
    if i < cur and i < #car.currentSplits then
      local t = car.currentSplits[i] / 1000
      doneSum = doneSum + t
      local g = grades[i]
      out[#out + 1] = { name = name, timeS = t, state = 'done', grade = g and g.grade or 'close', diffS = g and g.diff, progress = 1 }
    elseif i == cur then
      out[#out + 1] = {
        name = name, timeS = math.max(0, car.lapTimeMs / 1000 - doneSum), state = 'live',
        progress = T.clamp((car.splinePosition - start) / math.max(1e-6, stop - start), 0, 1),
      }
    else
      out[#out + 1] = { name = name, timeS = nil, state = 'idle', progress = 0 }
    end
  end
  return out
end

--- Suma de los mejores sectores de la sesión, o nil si falta alguno.
function L.ideal()
  local car = L.car
  local n = nSectors()
  if n < 1 or #car.bestSplits < n then return nil end
  local sum = 0
  for i = 0, n - 1 do
    local b = car.bestSplits[i]
    if not b or b <= 0 then return nil end
    sum = sum + b
  end
  return sum / 1000
end

-- ── Combustible ──

function L.fuel()
  local car = L.car
  local perLap = link.get('fuelPerLapL')
  if type(perLap) ~= 'number' or perLap <= 0 then perLap = car.fuelPerLap > 0 and car.fuelPerLap or nil end
  local lapsLeft = perLap and car.fuel / perLap or nil
  local toGo = nil
  if L.isRace() then
    local timeLeft, lapsRem = L.remaining()
    if lapsRem then toGo = lapsRem - car.splinePosition
    elseif timeLeft then
      local session = ac.getSession(L.sim.currentSessionIndex)
      toGo = timeLeft / L.refLap() + 1 - car.splinePosition + (session and session.hasAdditionalLap and 1 or 0)
    end
  end
  local missing = (perLap and toGo) and (toGo * perLap - car.fuel) or nil
  return { liters = car.fuel, max = car.maxFuel, perLap = perLap, lapsLeft = lapsLeft, toGo = toGo, missing = missing }
end

-- ── Neumáticos ──

L.TYRE_NAMES = { 'DEL IZQ', 'DEL DER', 'TRAS IZQ', 'TRAS DER' }

--- Color y etiqueta de la goma. Usa la temperatura óptima del auto; sin ella, la banda del dashboard.
function L.tyreBand(c, opt)
  if not opt or opt <= 0 then opt = 85 end
  if c < opt - 30 then return T.C.azul, 'FRÍA' end
  if c < opt - 15 then return T.C.azulClaro, 'TIBIA' end
  if c <= opt + 15 then return T.C.blanco, 'OK' end
  if c <= opt + 27 then return T.C.alerta, 'CALIENTE' end
  return T.C.error, 'LÍMITE'
end

-- ── Autos cercanos ──

L.rel = { ahead = {}, behind = {} }
local relAcc = 0

--- Distancia en pista con el auto `c`, en fracción de vuelta (−0,5..0,5; positiva = adelante).
local function trackGap(c, me)
  local d = c.splinePosition - me.splinePosition
  if d > 0.5 then d = d - 1 elseif d < -0.5 then d = d + 1 end
  return d
end

local function updateRelative()
  local sim, me = L.sim, L.car
  local ref = L.refLap()
  local ahead, behind = {}, {}
  for i = 0, sim.carsCount - 1 do
    local c = ac.getCar(i)
    if c and i ~= L.idx and c.isConnected and not c.isHidingLabels and (config.s.relPit or not c.isInPitlane) then
      local d = trackGap(c, me)
      local laps = (c.lapCount + c.splinePosition) - (me.lapCount + me.splinePosition)
      local row = {
        idx = i, d = d, gapS = math.abs(d) * ref, pos = c.racePosition,
        lapDiff = math.floor(laps - d + 0.5), pit = c.isInPitlane,
        name = ac.getDriverName(i), best = c.bestLapTimeMs,
      }
      if d >= 0 then ahead[#ahead + 1] = row else behind[#behind + 1] = row end
    end
  end
  table.sort(ahead, function(a, b) return a.d < b.d end)
  table.sort(behind, function(a, b) return a.d > b.d end)
  L.rel.ahead, L.rel.behind = ahead, behind
end

-- Tendencia de la distancia con el de adelante y el de atrás (regresión de los últimos 10 s)
local FLAT_SLOPE = 0.006
local FULL_SLOPE = 0.03
local WINDOW_S = 10
local hist = { ahead = { idx = -1, list = {} }, behind = { idx = -1, list = {} } }
local clock = 0

local function sampleTrend(side)
  local row = L.rel[side][1]
  local h = hist[side]
  if not row then h.idx, h.list = -1, {} return end
  if row.idx ~= h.idx then h.idx, h.list = row.idx, {} end
  h.list[#h.list + 1] = { at = clock, gap = row.gapS }
  while #h.list > 0 and clock - h.list[1].at > WINDOW_S do table.remove(h.list, 1) end
end

--- { row, gapS, kind = 'good'|'bad'|'flat'|'none', strength } para 'ahead' o 'behind'.
function L.trend(side)
  local row = L.rel[side][1]
  if not row then return { kind = 'none', strength = 0 } end
  local list = hist[side].list
  local span = #list > 1 and list[#list].at - list[1].at or 0
  if #list < 8 or span < 3 then return { row = row, gapS = row.gapS, kind = 'flat', strength = 0 } end
  local t0 = list[1].at
  local sx, sy, sxx, sxy = 0, 0, 0, 0
  for _, p in ipairs(list) do
    local x = p.at - t0
    sx, sy, sxx, sxy = sx + x, sy + p.gap, sxx + x * x, sxy + x * p.gap
  end
  local m = #list
  local den = m * sxx - sx * sx
  local slope = den > 1e-9 and (m * sxy - sx * sy) / den or 0
  if math.abs(slope) < FLAT_SLOPE then return { row = row, gapS = row.gapS, kind = 'flat', strength = 0 } end
  local closing = slope < 0
  -- Al de adelante conviene achicarle la distancia; del de atrás, alejarse
  local good = side == 'ahead' and closing or (side == 'behind' and not closing)
  return { row = row, gapS = row.gapS, kind = good and 'good' or 'bad', strength = T.clamp((math.abs(slope) - FLAT_SLOPE) / (FULL_SLOPE - FLAT_SLOPE), 0, 1) }
end

-- ── Vueltas (propias, por si FTN Coach no está) ──

L.laps = {}
local lapsSeen = -1

local function updateLaps(car)
  if lapsSeen < 0 or car.lapCount < lapsSeen then
    L.laps = {}
  elseif car.lapCount > lapsSeen and car.previousLapTimeMs > 0 then
    L.laps[#L.laps + 1] = { lap = car.lapCount, timeS = car.previousLapTimeMs / 1000, kind = car.isLastLapValid and 'valid' or 'off_track' }
    while #L.laps > 20 do table.remove(L.laps, 1) end
  end
  lapsSeen = car.lapCount
end

-- ── Cuadro a cuadro ──

local lastCarId = nil

local function reset()
  L.seenMaxRpm = 0
  L.trace = { gas = {}, brake = {}, speed = {}, n = 0, head = 0 }
  grades, liveBest, prevSector, prevLapCount = {}, {}, -1, -1
  lapsSeen = -1
  L.laps = {}
  hist.ahead, hist.behind = { idx = -1, list = {} }, { idx = -1, list = {} }
end

function L.update(dt)
  local sim = ac.getSim()
  L.sim = sim
  -- En las repeticiones se sigue al auto que muestra la cámara; manejando, siempre el propio
  L.idx = (sim.isReplayActive and sim.focusedCar >= 0) and sim.focusedCar or 0
  L.car = ac.getCar(L.idx)
  local car = L.car
  if not car then return end

  local id = L.idx .. ':' .. ac.getCarID(L.idx)
  if id ~= lastCarId then
    reset()
    lastCarId = id
  end

  if sim.isPaused then return end
  clock = clock + dt
  if car.rpm > L.seenMaxRpm then L.seenMaxRpm = car.rpm end

  traceAcc = traceAcc + dt
  local step = 1 / TRACE_HZ
  local pushes = 0
  while traceAcc >= step and pushes < 4 do
    pushTrace(car)
    traceAcc = traceAcc - step
    pushes = pushes + 1
  end
  if traceAcc > step then traceAcc = 0 end

  updateSectors(car)
  updateLaps(car)

  relAcc = relAcc + dt
  if relAcc >= 0.1 then
    relAcc = 0
    updateRelative()
    sampleTrend('ahead')
    sampleTrend('behind')
  end
end

return L
