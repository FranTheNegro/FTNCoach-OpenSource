--[[
  Ajustes de la app (se guardan solos en Documents\Assetto Corsa\cfg\extension\state\lua).
  Cada overlay tiene su sección, que se abre con el engranaje de su ventana; la
  ventana principal muestra además los generales.
]]

local M = {}

M.s = ac.storage({
  -- Generales
  port = 8090,
  units = 0, -- 0 = como en FTN Coach, 1 = métrico, 2 = imperial
  opacity = 0.88,
  accent = 1,
  -- Coach
  tips = true,
  focus = true,
  advice = true,
  -- Delta
  deltaRange = 1,
  -- Tacómetro
  tachoLights = true,
  tachoRpm = true,
  tachoAids = true,
  -- Inputs
  inputsSeconds = 6,
  inputsClutch = true,
  inputsSteer = true,
  inputsTrace = true,
  -- Tiempos
  timingSectors = true,
  timingIdeal = true,
  -- Relativo
  relRows = 3,
  relPit = true,
  -- Neumáticos
  tyresZones = true,
  tyresPressure = true,
  tyresWear = true,
  tyresBrakes = true,
  -- Vueltas
  lapsCount = 6,
  -- Mapa
  mapNames = false,
  mapTips = true,
  mapDot = 1,
  -- Radar
  radarRange = 12,
  radarAuto = true,
  -- Banderas
  flagsLimiter = true,
})

local s = M.s

--- true = mostrar en unidades imperiales (según FTN Coach o lo elegido acá).
function M.imperial(link)
  if s.units == 1 then return false end
  if s.units == 2 then return true end
  local d = link and link.data
  if d and d.units then return d.units == 'imperial' end
  return ac.getUI().useImperialUnits
end

-- ── Controles ──

local function check(label, key)
  if ui.checkbox(label, s[key]) then s[key] = not s[key] end
end

local function slider(label, key, min, max, fmt, int)
  local v, changed = ui.slider(label, s[key], min, max, fmt)
  if changed then s[key] = int and math.floor(v + 0.5) or v end
end

local function radios(key, options)
  for i, o in ipairs(options) do
    if i > 1 then ui.sameLine() end
    if ui.radioButton(o[1], s[key] == o[2]) then s[key] = o[2] end
  end
end

local SECTIONS = {}

function SECTIONS.general(link, T)
  ui.header('General')
  ui.text('Puerto de FTN Coach (en la PC: Ajustes → Red local):')
  local port, changed = ui.inputText('##port', tostring(math.floor(s.port)), ui.InputTextFlags.CharsDecimal)
  if changed and tonumber(port) then s.port = tonumber(port) end
  ui.text(link.ok() and 'Conectado a FTN Coach' or 'Sin conexión con FTN Coach (los overlays siguen andando con los datos de AC)')
  ui.offsetCursorY(6)
  ui.text('Unidades')
  radios('units', { { 'Como en FTN Coach', 0 }, { 'Métricas', 1 }, { 'Imperiales', 2 } })
  slider('Opacidad del fondo', 'opacity', 0, 1, '%.2f')
  ui.text('Color de acento')
  for i, a in ipairs(T.ACCENTS) do
    if i > 1 then ui.sameLine() end
    if ui.radioButton(a[1], math.floor(s.accent) == i) then s.accent = i end
  end
  ui.offsetCursorY(4)
  ui.textWrapped('Para agrandar o achicar un overlay, estirá su ventana desde la esquina. Se activan desde la barra de apps de la derecha.')
end

function SECTIONS.coach()
  ui.header('Coach')
  check('Consejo de la próxima curva (de tus sesiones analizadas)', 'tips')
  check('Foco de la sesión según tu estilo de manejo', 'focus')
  check('Avisos del momento (combustible, gomas, frenos)', 'advice')
end

function SECTIONS.delta()
  ui.header('Delta')
  slider('Rango de la barra (s)', 'deltaRange', 0.25, 3, '%.2f s')
end

function SECTIONS.tacho()
  ui.header('Tacómetro')
  check('Shift lights', 'tachoLights')
  check('RPM en números', 'tachoRpm')
  check('TC, ABS, DRS y limitador', 'tachoAids')
end

function SECTIONS.inputs()
  ui.header('Inputs')
  check('Traza de los últimos segundos', 'inputsTrace')
  slider('Segundos de traza', 'inputsSeconds', 2, 10, '%.0f s', true)
  check('Embrague', 'inputsClutch')
  check('Volante', 'inputsSteer')
end

function SECTIONS.timing()
  ui.header('Tiempos')
  check('Sectores', 'timingSectors')
  check('Vuelta ideal (suma de tus mejores sectores)', 'timingIdeal')
end

function SECTIONS.relative()
  ui.header('Relative')
  slider('Autos adelante y atrás', 'relRows', 1, 6, '%.0f', true)
  check('Mostrar autos en boxes', 'relPit')
end

function SECTIONS.tyres()
  ui.header('Neumáticos')
  check('Temperatura por zona (interior, centro, exterior)', 'tyresZones')
  check('Presión', 'tyresPressure')
  check('Desgaste', 'tyresWear')
  check('Temperatura de frenos', 'tyresBrakes')
end

function SECTIONS.laps()
  ui.header('Vueltas')
  slider('Vueltas en la lista', 'lapsCount', 3, 10, '%.0f', true)
end

function SECTIONS.map()
  ui.header('Mapa')
  check('Nombres de los pilotos', 'mapNames')
  check('Marcar la curva del próximo consejo', 'mapTips')
  slider('Tamaño de los autos', 'mapDot', 0.5, 2, '%.1f×')
end

function SECTIONS.radar()
  ui.header('Radar')
  slider('Alcance (m)', 'radarRange', 6, 30, '%.0f m', true)
  check('Mostrar solo cuando hay un auto cerca', 'radarAuto')
end

function SECTIONS.flags()
  ui.header('Banderas')
  check('Avisar cuando el limitador de boxes está puesto', 'flagsLimiter')
end

M.ORDER = { 'general', 'coach', 'delta', 'tacho', 'inputs', 'timing', 'relative', 'tyres', 'laps', 'map', 'radar', 'flags' }

--- Dibuja la sección de un overlay (o todas, si `id` es nil).
function M.ui(id, link, T)
  if id then
    SECTIONS[id](link, T)
    return
  end
  for _, k in ipairs(M.ORDER) do
    SECTIONS[k](link, T)
    ui.offsetCursorY(8)
  end
end

return M
