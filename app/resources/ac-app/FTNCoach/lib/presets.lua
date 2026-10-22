--[[
  Layouts recomendados por categoría: qué overlays se muestran, dónde y de qué tamaño.

  Están pensados para 1920 × 1080 y se adaptan a cualquier pantalla: las posiciones
  son anclas (arriba a la izquierda, abajo al centro…) con un margen en píxeles de
  1080p, y el tamaño escala con el alto. En triple monitor se usa la pantalla del
  centro y en ultrawide se queda en la zona central, donde mira el piloto.

  Criterio: lo que se mira en cada frenada (delta, banderas, shift lights) va
  cerca del centro, debajo del espejo; lo que se consulta en recta (relative,
  tiempos, gomas, mapa) va a los costados. El radar queda en el medio porque solo
  aparece cuando hay alguien al lado.

  Cada overlay puede limitarse a un tipo de sesión: `only = 'race'` o `only = 'practice'`
  (práctica, clasificación, hotlap…).
]]

local M = {}

-- Tamaño de diseño de cada ventana (el SIZE del manifest)
M.SIZE = {
  coach = { 360, 236 },
  delta = { 360, 64 },
  tacho = { 420, 150 },
  inputs = { 380, 130 },
  timing = { 360, 250 },
  relative = { 380, 222 },
  tyres = { 320, 250 },
  car = { 320, 210 },
  laps = { 320, 184 },
  map = { 300, 300 },
  radar = { 220, 220 },
  flags = { 420, 56 },
}

-- Nombre de cada ventana en la barra de apps (el NAME del manifest); la principal es el centro de control
M.MAIN_TITLE = 'FTN Coach'
M.TITLE = {
  coach = 'FTN Coach · Coach',
  delta = 'FTN Coach · Delta',
  tacho = 'FTN Coach · Tacómetro',
  inputs = 'FTN Coach · Inputs',
  timing = 'FTN Coach · Tiempos',
  relative = 'FTN Coach · Relative',
  tyres = 'FTN Coach · Neumáticos',
  car = 'FTN Coach · Auto',
  laps = 'FTN Coach · Vueltas',
  map = 'FTN Coach · Mapa',
  radar = 'FTN Coach · Radar',
  flags = 'FTN Coach · Banderas',
}

M.IDS = { 'coach', 'delta', 'tacho', 'inputs', 'timing', 'relative', 'tyres', 'car', 'laps', 'map', 'radar', 'flags' }

-- Qué muestra cada overlay (en el centro de control)
M.DESC = {
  coach = 'Delta, última y mejor vuelta, y el consejo de la próxima curva o el aviso más importante del momento.',
  delta = 'Barra de delta contra tu mejor vuelta.',
  tacho = 'Shift lights, marcha, velocidad, RPM y ayudas (TC, ABS, DRS, limitador).',
  inputs = 'Pedales, traza de los últimos segundos y volante.',
  timing = 'Vuelta en curso, sectores con su nota y referencias (última, mejor e ideal).',
  relative = 'Los autos más cercanos adelante y atrás, con la distancia y la tendencia.',
  tyres = 'Temperatura por zona, presión, desgaste y frenos de cada rueda.',
  car = 'Combustible hasta el final, reparto de freno, TC/ABS, agua y daño.',
  laps = 'Tus últimas vueltas con la diferencia y si fueron válidas.',
  map = 'Mapa oficial del circuito con todos los autos.',
  radar = 'Autos alrededor vistos desde arriba; aparece cuando alguien se acerca.',
  flags = 'Banderas y limitador de boxes; aparece solo cuando hace falta.',
}

M.LABEL = {
  coach = 'Coach', delta = 'Delta', tacho = 'Tacómetro', inputs = 'Inputs', timing = 'Tiempos', relative = 'Relative',
  tyres = 'Neumáticos', car = 'Auto', laps = 'Vueltas', map = 'Mapa', radar = 'Radar', flags = 'Banderas',
}

-- Debajo del espejo virtual de AC (arriba al centro)
local UNDER_MIRROR = 128

--[[
  `at`: ancla en la zona segura (t/m/b = arriba/medio/abajo, l/c/r = izquierda/centro/derecha).
  `x`, `y`: corrimiento en px de 1080p hacia adentro de la pantalla (en las columnas
  del centro, `x` positivo va a la derecha y en la fila del medio, `y` positivo va abajo).
  `k`: escala respecto del tamaño de diseño.
]]
M.CATEGORIES = {
  {
    id = 'formula',
    name = 'Fórmula',
    hint = 'Monoplazas: shift lights y delta al centro, sectores y gomas a la vista.',
    layout = {
      delta = { at = 'tc', y = UNDER_MIRROR },
      flags = { at = 'tc', y = UNDER_MIRROR + 72, k = 0.9 },
      tacho = { at = 'bc', k = 0.9 },
      inputs = { at = 'bc', y = 159, k = 0.85, only = 'practice' },
      timing = { at = 'tr' },
      coach = { at = 'tr', y = 262, k = 0.9 },
      laps = { at = 'tr', y = 487, k = 0.85, only = 'practice' },
      relative = { at = 'tl' },
      tyres = { at = 'bl', k = 0.8 },
      map = { at = 'bl', y = 212, k = 0.75 },
      radar = { at = 'mc', y = 80 },
    },
  },
  {
    id = 'gt',
    name = 'GT',
    hint = 'GT3, GT4, GTE y copas: relative, combustible y ayudas (TC, ABS, reparto).',
    layout = {
      relative = { at = 'tl' },
      delta = { at = 'tc', y = UNDER_MIRROR },
      flags = { at = 'tc', y = UNDER_MIRROR + 72, k = 0.9 },
      timing = { at = 'tr', k = 0.9 },
      coach = { at = 'tr', y = 237, k = 0.85 },
      laps = { at = 'tr', y = 449, k = 0.8, only = 'practice' },
      tacho = { at = 'br', k = 0.9 },
      car = { at = 'br', y = 147, k = 0.85 },
      tyres = { at = 'bl', k = 0.8 },
      map = { at = 'bl', y = 212, k = 0.7 },
      inputs = { at = 'bc', k = 0.85, only = 'practice' },
      radar = { at = 'mc', y = 80 },
    },
  },
  {
    id = 'proto',
    name = 'Prototipos',
    hint = 'LMP, Hypercar y resistencia: mapa y relative arriba para leer el tráfico multiclase.',
    layout = {
      relative = { at = 'tl' },
      map = { at = 'tl', y = 234, k = 0.75 },
      delta = { at = 'tc', y = UNDER_MIRROR },
      flags = { at = 'tc', y = UNDER_MIRROR + 72, k = 0.9 },
      timing = { at = 'tr', k = 0.9 },
      coach = { at = 'tr', y = 237, k = 0.85 },
      laps = { at = 'tr', y = 449, k = 0.8, only = 'practice' },
      tacho = { at = 'br', k = 0.9 },
      car = { at = 'br', y = 147, k = 0.85 },
      tyres = { at = 'bl', k = 0.8 },
      inputs = { at = 'bc', k = 0.85, only = 'practice' },
      radar = { at = 'mc', y = 80 },
    },
  },
  {
    id = 'turismo',
    name = 'Turismo',
    hint = 'TC, TCR, Top Race, V8, Stock Car: puerta a puerta, con radar y relative bien visibles.',
    layout = {
      relative = { at = 'tl' },
      radar = { at = 'mc', y = 60, k = 1.1 },
      delta = { at = 'tc', y = UNDER_MIRROR },
      flags = { at = 'tc', y = UNDER_MIRROR + 72, k = 0.9 },
      timing = { at = 'tr', k = 0.85 },
      coach = { at = 'tr', y = 225, k = 0.85 },
      laps = { at = 'tr', y = 437, k = 0.8, only = 'practice' },
      tacho = { at = 'bc', k = 0.9 },
      car = { at = 'br', k = 0.8 },
      tyres = { at = 'bl', k = 0.7 },
      inputs = { at = 'bl', y = 187, k = 0.8, only = 'practice' },
    },
  },
  {
    id = 'rally',
    name = 'Rally',
    hint = 'Tramos: sin relative ni mapa; tacómetro grande, inputs y estado del auto.',
    layout = {
      tacho = { at = 'bc' },
      inputs = { at = 'bl', k = 0.9 },
      delta = { at = 'tc', y = UNDER_MIRROR, k = 0.9 },
      timing = { at = 'tr', k = 0.85 },
      coach = { at = 'tr', y = 225, k = 0.85 },
      car = { at = 'br', k = 0.85 },
    },
  },
  {
    id = 'drift',
    name = 'Drift',
    hint = 'Tacómetro grande e inputs para el control del ángulo; radar para los tándem.',
    layout = {
      tacho = { at = 'bc', k = 1.1 },
      inputs = { at = 'bl', k = 0.9 },
      radar = { at = 'mc', y = 80 },
      flags = { at = 'tc', y = UNDER_MIRROR, k = 0.9 },
    },
  },
  {
    id = 'calle',
    name = 'Calle',
    hint = 'Autos de calle, touge y autopista: lo mínimo para no tapar el camino.',
    layout = {
      tacho = { at = 'br', k = 0.85 },
      map = { at = 'bl', k = 0.8 },
      delta = { at = 'tc', y = UNDER_MIRROR, k = 0.9 },
      flags = { at = 'tc', y = UNDER_MIRROR + 66, k = 0.9 },
      coach = { at = 'tr', k = 0.85 },
      radar = { at = 'mc', y = 80 },
    },
  },
}

M.BY_ID = {}
for i, c in ipairs(M.CATEGORIES) do
  c.index = i
  M.BY_ID[c.id] = c
end

-- ── Detección de la categoría del auto ──

-- Palabras sueltas (tags, clase, nombre o carpeta del auto) que definen cada categoría
local WORDS = {
  formula = { 'formula', 'f2', 'f3', 'f4', 'indycar', 'indy', 'singleseater', 'openwheel', 'monoplaza', 'fnacional', 'superformula' },
  proto = { 'lmp', 'lmp1', 'lmp2', 'lmp3', 'lmh', 'lmdh', 'hypercar', 'dpi', 'gtp', 'prototype', 'prototipo', 'groupc', 'sportprototype', 'oreca' },
  gt = { 'gt', 'gt1', 'gt2', 'gt3', 'gt4', 'gte', 'gtlm', 'gtd', 'gtc', 'gte-gt3', 'cup', 'supercup', 'challenge', 'trofeo', 'endurance' },
  turismo = { 'tcr', 'touring', 'turismo', 'dtm', 'btcc', 'wtcc', 'wtcr', 'tc', 'tc2000', 'tcpista', 'turismopista', 'trv6', 'trseries', 'toprace', 'tps', 'vasc', 'v8sc', 'stockcar', 'nascar', 'marcas', 'superturismo', 'gra' },
}
local RALLY_WORDS = { 'rally', 'rally1', 'rally2', 'rally3', 'rally4', 'rally5', 'rallycross', 'r5', 'r4', 'wrc', 'gravel', 'maxi', 'dakar', 'rallyraid', 'baja' }
local DRIFT_WORDS = { 'drift', 'd1', 'fd' }
-- Clases de ui_car.json de autos de calle (aunque CSP no los cuente como "road" o "street")
local STREET_CLASSES = { street = true, road = true, shutoko = true, shuto = true, sport = true, stock = true, tuned = true, touge = true, traffic = true }

local function tokens(str)
  local set = {}
  for t in str:lower():gmatch('[%w%-]+') do set[t] = true end
  return set
end

local function hasAny(set, words)
  for _, w in ipairs(words) do
    if set[w] then return true end
  end
  return false
end

--- Clase del auto en su ui_car.json ("race", "street", "rally2"…), o ''.
local function carClass(carId)
  local path = ac.getFolder(ac.FolderID.ContentCars) .. '/' .. carId .. '/ui/ui_car.json'
  local ok, text = pcall(io.load, path)
  if not ok or type(text) ~= 'string' then return '' end
  return text:match('"class"%s*:%s*"([^"]*)"') or ''
end

--- Categoría del auto `idx` (una de M.CATEGORIES) y su nombre.
--- Rally y drift se miran en los tags y la clase: en el nombre suelen ser versiones de calle ("Gol Rally").
function M.detect(idx)
  idx = idx or 0
  local car = ac.getCar(idx)
  local id = ac.getCarID(idx) or ''
  local name = ac.getCarName(idx) or id
  local cls = carClass(id)
  local tagSet = tokens(table.concat(ac.getCarTags(idx) or {}, ' ') .. ' ' .. cls)
  local set = tokens(table.concat(ac.getCarTags(idx) or {}, ' ') .. ' ' .. cls .. ' ' .. id:gsub('_', ' ') .. ' ' .. name)
  -- Un auto de calle con "GT3" o "Rally" en el nombre sigue siendo de calle
  local street = STREET_CLASSES[cls:lower()] or set.touge or set.shutoko or set.wangan or (set.street and not set.race)

  local function pick(cat) return cat, name end
  if hasAny(tagSet, DRIFT_WORDS) or set.drift then return pick('drift') end
  if hasAny(tagSet, RALLY_WORDS) or (not street and hasAny(set, RALLY_WORDS)) then return pick('rally') end
  if car and car.isOpenWheeler or hasAny(set, WORDS.formula) then return pick('formula') end
  if not street then
    if hasAny(set, WORDS.proto) then return pick('proto') end
    if hasAny(set, WORDS.turismo) then return pick('turismo') end
    if hasAny(set, WORDS.gt) then return pick('gt') end
    -- Autos de carrera sin una categoría reconocible: el layout de GT es el más completo
    if car and car.isRacingCar or set.race then return pick('gt') end
  end
  return pick('calle')
end

return M
