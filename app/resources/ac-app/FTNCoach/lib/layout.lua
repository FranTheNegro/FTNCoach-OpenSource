--[[
  Layouts: qué overlays se ven, dónde y de qué tamaño, según la categoría del auto.

  - Al subirte a un auto se detecta su categoría (Fórmula, GT, Turismo, Rally…) y se
    aplica su layout recomendado (lib/presets.lua). Si para ese auto elegiste otra
    categoría, se respeta lo que elegiste.
  - Fuera del modo acomodar los overlays quedan fijos (no se pueden arrastrar). En el
    modo acomodar se mueven, se agrandan o achican con sus botones y, al soltarlos, se
    alinean a los bordes y a los demás overlays. Al terminar se guarda todo en tu
    layout de esa categoría y se vuelven a fijar.
  - Qué overlays se ven se guarda aparte para carrera y para práctica/clasificación.

  Cada overlay tiene una escala (píxeles por unidad de diseño) y su ventana se ajusta
  sola al contenido, como en CMRT Complete HUD. Cuando cambia de tamaño crece hacia
  adentro de la pantalla: uno de la derecha crece a la izquierda, uno de abajo hacia arriba.

  Las ventanas se manejan con ac.accessAppWindow: una ventana oculta no se puede
  mover, así que primero se muestra y se mueve al cuadro siguiente.
]]

local P = require('lib.presets')
local config = require('lib.config')
local T = require('lib.theme')
local D = require('lib.draw')

local M = {
  editing = false,
  hidden = false,
  current = nil, -- categoría aplicada
  detected = nil, -- categoría detectada para el auto actual
  carName = '',
  group = 'practice',
}

local s = config.s

-- Layouts propios por categoría y categoría elegida por auto (JSON en el storage de la app)
local customStore = ac.storage('layoutsCustom2', '{}')
local carStore = ac.storage('layoutsByCar', '{}')

local function load(store)
  local ok, v = pcall(JSON.parse, store:get())
  return ok and type(v) == 'table' and v or {}
end

local customs = load(customStore)
local byCar = load(carStore)

local function saveCustoms() customStore:set(JSON.stringify(customs)) end
local function saveByCar() carStore:set(JSON.stringify(byCar)) end

-- ── Atajos (se asignan en el centro de control → Atajos, o en los controles de CSP) ──

M.BUTTONS = {
  { 'Mostrar u ocultar los overlays', ac.ControlButton('ftn.coach/Mostrar u ocultar los overlays') },
  { 'Modo acomodar', ac.ControlButton('ftn.coach/Modo acomodar') },
  { 'Siguiente layout', ac.ControlButton('ftn.coach/Siguiente layout') },
}

-- ── Ventanas ──

local wins = {}
local mainWin = nil

local function findWindows()
  wins = {}
  for _, w in ipairs(ac.getAppWindows()) do
    -- Las ventanas de ajustes de CSP pueden llevar el mismo título que su app
    if not tostring(w.name):lower():find('setting') then
      if w.title == P.MAIN_TITLE then mainWin = ac.accessAppWindow(w.name) end
      for id, title in pairs(P.TITLE) do
        if w.title == title and not wins[id] then
          local acc = ac.accessAppWindow(w.name)
          if acc then wins[id] = acc end
        end
      end
    end
  end
end

local function uiScale()
  local u = ac.getUI().uiScale
  return (u and u > 0) and u or 1
end

-- Las posiciones se leen en unidades de la UI y se escriben en píxeles (igual que hace CMRT)
local function readPos(acc)
  return acc:position() * uiScale()
end

-- ── Pantalla ──

--- Zona donde van los overlays: en triple monitor la pantalla del centro y en
--- ultrawide la parte central, para no tener que girar la cabeza.
function M.screen()
  local sim = ac.getSim()
  local W, H = sim.windowWidth, sim.windowHeight
  local aspect = W / math.max(1, H)
  local x, w = 0, W
  if aspect >= 4 then x, w = W / 3, W / 3
  elseif aspect > 2.1 then w = H * 2.1; x = (W - w) / 2 end
  return { W = W, H = H, x = x, w = w, u = H / 1080 }
end

local MARGIN = 24

-- ── Escala y tamaño de cada overlay ──

local kpx = {} -- píxeles por unidad de diseño
local sizePx = {} -- último tamaño de ventana pedido, en píxeles
local design = {} -- tamaño de diseño que dibujó cada overlay la última vez

local function designSize(id)
  local d = design[id]
  if d then return d[1], d[2] end
  return P.SIZE[id][1], P.SIZE[id][2]
end

--- Tamaño en píxeles de la ventana de `id` con escala `k`.
local function windowPx(id, k)
  local dw, dh = designSize(id)
  return dw * k, dh * k + D.TOP * uiScale()
end

--- Escala para dibujar `id` (unidades de UI por unidad de diseño).
function M.scale(id)
  local u = uiScale()
  return (kpx[id] or u) / u
end

--- Escala relativa a la pantalla (1 = tamaño de diseño en 1080p), para mostrar en %.
function M.relScale(id)
  return (kpx[id] or uiScale()) / M.screen().u
end

local pending = {}

--- Ajusta la ventana al contenido dibujado; si cambió de tamaño, crece hacia adentro de la pantalla.
function M.fit(id, sizeUi)
  local acc = wins[id]
  if not acc then return end
  design[id] = { D.w, D.h }
  local u = uiScale()
  local px = sizeUi * u
  local old = sizePx[id]
  if old and math.abs(old.x - px.x) < 0.5 and math.abs(old.y - px.y) < 0.5 then return end
  acc:resize(px)
  if old and not pending[id] then
    local pos = readPos(acc)
    local sc = M.screen()
    local cx, cy = pos.x + old.x / 2, pos.y + old.y / 2
    local col = cx < sc.x + sc.w / 3 and 0 or cx > sc.x + sc.w * 2 / 3 and 1 or 0.5
    local row = cy < sc.H / 3 and 0 or cy > sc.H * 2 / 3 and 1 or 0.5
    acc:move(vec2(pos.x - (px.x - old.x) * col, pos.y - (px.y - old.y) * row))
  end
  sizePx[id] = px
end

-- ── Planes ──

--- Lugar de un overlay del layout recomendado: x, y, escala (en píxeles).
local function presetPlace(id, p, sc)
  local k = (p.k or 1) * sc.u * s.layoutScale
  local w, h = windowPx(id, k)
  local m = MARGIN * sc.u
  local ox, oy = (p.x or 0) * sc.u, (p.y or 0) * sc.u
  local row, col = p.at:sub(1, 1), p.at:sub(2, 2)
  local x = col == 'l' and sc.x + m + ox or col == 'r' and sc.x + sc.w - m - w - ox or sc.x + (sc.w - w) / 2 + ox
  local y = row == 't' and m + oy or row == 'b' and sc.H - m - h - oy or (sc.H - h) / 2 + oy
  return x, y, k
end

--- Cómo queda cada overlay en el layout de `cat`: { id = { visible, x, y, k, w, h } } en píxeles.
function M.plan(cat, group)
  local preset = P.BY_ID[cat]
  if not preset then return {} end
  group = group or M.group
  local custom = customs[cat] or {}
  local vis = custom.vis and custom.vis[group]
  local sc = M.screen()
  local out = {}
  for _, id in ipairs(P.IDS) do
    local p = preset.layout[id]
    local visible
    if vis and vis[id] ~= nil then visible = vis[id]
    else visible = p ~= nil and (not p.only or p.only == group) end
    local c = custom.pos and custom.pos[id]
    local x, y, k
    if c then x, y, k = c[1] * sc.W, c[2] * sc.H, c[3] * sc.u
    elseif p then x, y, k = presetPlace(id, p, sc) end
    local item = { visible = visible and x ~= nil, x = x, y = y, k = k }
    if k then item.w, item.h = windowPx(id, k) end
    out[id] = item
  end
  return out
end

function M.isCustom(cat)
  return customs[cat or M.current] ~= nil
end

-- ── Fijar (fuera del modo acomodar no se pueden arrastrar) ──

local function pinAll()
  local lock = s.layoutAsked and not M.editing
  for _, acc in pairs(wins) do acc:setPinned(lock) end
end

-- ── Aplicar y guardar ──

local baseline = nil
local clock = 0
local watchFrom = 0

function M.apply(cat)
  if not P.BY_ID[cat] then return end
  findWindows()
  M.current = cat
  s.layoutLast = cat
  pending = {}
  for id, item in pairs(M.plan(cat)) do
    local acc = wins[id]
    if acc then
      if item.visible then
        kpx[id] = item.k
        sizePx[id] = nil -- el primer ajuste no corre la ventana del lugar planeado
        pending[id] = { item.x, item.y }
      end
      acc:setVisible(item.visible)
    end
  end
  M.hidden = false
  pinAll()
  baseline = nil
  watchFrom = clock + 1.5
end

local function readState()
  local state = {}
  for id, acc in pairs(wins) do
    if acc:valid() then
      local p = readPos(acc)
      local z = sizePx[id]
      state[id] = { v = acc:visible(), x = p.x, y = p.y, w = z and z.x or 0, h = z and z.y or 0, k = kpx[id] or uiScale() }
    end
  end
  return state
end

--- Guarda lo que se ve ahora como el layout propio de la categoría actual.
local function snapshot(state)
  local cat = M.current
  if not cat then return end
  local sc = M.screen()
  local custom = customs[cat]
  if not custom then
    -- La primera vez se parte del recomendado, así los overlays de la otra sesión conservan su lugar
    custom = { pos = {}, vis = {} }
    for id, item in pairs(M.plan(cat, M.group == 'race' and 'practice' or 'race')) do
      if item.x then custom.pos[id] = { item.x / sc.W, item.y / sc.H, item.k / sc.u } end
    end
  end
  local vis = {}
  for id, st in pairs(state) do
    vis[id] = st.v
    if st.v then custom.pos[id] = { st.x / sc.W, st.y / sc.H, st.k / sc.u } end
  end
  custom.vis[M.group] = vis
  customs[cat] = custom
  saveCustoms()
end

function M.reset(cat)
  cat = cat or M.current
  customs[cat] = nil
  saveCustoms()
  if cat == M.current then M.apply(cat) end
end

--- Mantener como están los overlays ahora (primera vez, para quien ya los tenía acomodados).
function M.keepCurrent(cat)
  findWindows()
  M.current = cat
  s.layoutLast = cat
  snapshot(readState())
  pinAll()
  baseline = nil
  watchFrom = clock + 1
end

-- ── Categoría del auto ──

local function sessionGroup()
  return ac.getSim().raceSessionType == ac.SessionType.Race and 'race' or 'practice'
end

local function carKey()
  return ac.getCarID(0) or ''
end

--- Categoría que corresponde al auto actual: la elegida para ese auto, la fija o la detectada.
function M.wanted()
  if not s.layoutAuto then return P.BY_ID[s.layoutFixed] and s.layoutFixed or M.detected end
  return byCar[carKey()] or M.detected
end

--- Elegir la categoría para el auto actual (la detectada borra la elección).
function M.choose(cat)
  if cat == M.detected then cat = nil end
  if s.layoutAuto then
    byCar[carKey()] = cat
    saveByCar()
  else
    s.layoutFixed = cat or M.detected
  end
  M.apply(M.wanted())
end

function M.cycle(dir)
  local i = (P.BY_ID[M.current or M.detected] or P.CATEGORIES[1]).index
  local nextCat = P.CATEGORIES[(i - 1 + (dir or 1)) % #P.CATEGORIES + 1]
  M.choose(nextCat.id)
  ac.setMessage('FTN Coach', 'Layout ' .. nextCat.name)
end

--- Todavía no se eligió qué hacer con los layouts (primera vez con esta versión).
function M.needsOnboarding()
  return not s.layoutAsked and M.detected ~= nil
end

function M.accept(cat)
  s.layoutAsked = true
  M.choose(cat)
end

function M.decline()
  s.layoutAsked = true
  M.keepCurrent(M.wanted())
end

-- ── Mostrar u ocultar ──

local hiddenSet = {}

function M.toggleHidden()
  findWindows()
  if M.hidden then
    for id in pairs(hiddenSet) do if wins[id] then wins[id]:setVisible(true) end end
    M.hidden = false
    pinAll()
    baseline = nil
    watchFrom = clock + 1
  else
    hiddenSet = {}
    for id, acc in pairs(wins) do
      if acc:visible() then hiddenSet[id] = true; acc:setVisible(false) end
    end
    M.hidden = true
  end
end

function M.isVisible(id)
  return wins[id] ~= nil and wins[id]:visible()
end

--- Muestra u oculta un overlay en el layout actual (queda guardado).
function M.setVisible(id, v)
  local acc = wins[id]
  if not acc then return end
  if v and not acc:visible() then
    local item = M.current and M.plan(M.current)[id] or {}
    local sc = M.screen()
    local k = item.k or sc.u * s.layoutScale
    kpx[id] = k
    sizePx[id] = nil
    if item.x then pending[id] = { item.x, item.y }
    else
      -- Sin lugar en el layout: aparece en el centro para acomodarlo
      local w, h = windowPx(id, k)
      pending[id] = { sc.x + (sc.w - w) / 2, (sc.H - h) / 2 }
    end
  end
  acc:setVisible(v)
  acc:setPinned(s.layoutAsked and not M.editing)
end

-- ── Tamaño ──

local function clampK(k)
  local u = M.screen().u
  return T.clamp(k, 0.5 * u, 2.2 * u)
end

--- Agranda o achica un overlay (crece hacia adentro de la pantalla).
function M.scaleBy(id, f)
  kpx[id] = clampK((kpx[id] or uiScale()) * f)
end

--- Agranda o achica todos los overlays a la vez.
function M.rescale(f)
  local scale = T.clamp(s.layoutScale * f, 0.6, 1.6)
  f = scale / s.layoutScale
  s.layoutScale = scale
  for id, acc in pairs(wins) do
    if acc:visible() then M.scaleBy(id, f) end
  end
end

-- ── Modo acomodar ──

local function hasAny(t)
  return next(t) ~= nil
end

function M.setEditing(v)
  if M.editing == v then return end
  M.editing = v
  if v and M.hidden then M.toggleHidden() end
  findWindows()
  if v then
    ac.setMessage('FTN Coach · Modo acomodar', 'Arrastrá los overlays y usá − / + para el tamaño. Tocá "Listo" para fijarlos.')
  else
    -- Al terminar se guarda lo que quedó y se fija todo en su lugar
    if M.current and s.layoutAsked and not hasAny(pending) then snapshot(readState()) end
    baseline = nil
    ac.setMessage('FTN Coach', 'Overlays fijados en tu layout')
  end
  pinAll()
end

-- Imán: al soltar un overlay se alinea a los márgenes, al centro y a los overlays cercanos
local SNAP = 14

local function nearest(v, candidates, limit)
  local best, bestD = v, limit
  for _, c in ipairs(candidates) do
    local d = math.abs(c - v)
    if d < bestD then best, bestD = c, d end
  end
  return best
end

local function snapPos(id, st, state)
  local sc = M.screen()
  local m, gap, lim = MARGIN * sc.u, 12 * sc.u, SNAP * sc.u
  local w, h = st.w, st.h
  local xs = { sc.x + m, sc.x + sc.w - m - w, sc.x + (sc.w - w) / 2 }
  local ys = { m, sc.H - m - h, (sc.H - h) / 2 }
  for other, o in pairs(state) do
    if other ~= id and o.v then
      xs[#xs + 1] = o.x
      xs[#xs + 1] = o.x + o.w - w
      xs[#xs + 1] = o.x + o.w + gap
      xs[#xs + 1] = o.x - gap - w
      ys[#ys + 1] = o.y
      ys[#ys + 1] = o.y + o.h - h
      ys[#ys + 1] = o.y + o.h + gap
      ys[#ys + 1] = o.y - gap - h
    end
  end
  return nearest(st.x, xs, lim), nearest(st.y, ys, lim)
end

-- ── Cuadro a cuadro ──

local lastKey = nil
local watchAcc = 0
local centerOpened = false

local function differs(a, b)
  if a.v ~= b.v or math.abs(a.k - b.k) > 1e-4 then return true end
  return a.v and (math.abs(a.x - b.x) > 2 or math.abs(a.y - b.y) > 2)
end

local function watch()
  local state = readState()
  if not baseline then baseline = state return end
  local changed = false
  for id, st in pairs(state) do
    local b = baseline[id]
    if b and differs(st, b) then
      changed = true
      if M.editing and st.v and b.v and (st.x ~= b.x or st.y ~= b.y) then
        local x, y = snapPos(id, st, state)
        if math.abs(x - st.x) > 0.5 or math.abs(y - st.y) > 0.5 then
          wins[id]:move(vec2(x, y))
          st.x, st.y = x, y
        end
      end
    end
  end
  if changed then snapshot(state) end
  baseline = state
end

function M.update(dt)
  clock = clock + dt
  if not ac.getCar(0) then return end

  -- Auto o tipo de sesión nuevos: se detecta la categoría y se aplica su layout
  local key = carKey() .. '|' .. sessionGroup()
  if key ~= lastKey then
    lastKey = key
    M.group = sessionGroup()
    M.detected, M.carName = P.detect(0)
    if s.layoutAsked then
      local cat = M.wanted()
      local announce = s.layoutLast ~= '' and s.layoutLast ~= cat
      M.apply(cat)
      -- En los primeros cuadros AC puede no haber creado las ventanas todavía: se reintenta
      if not hasAny(wins) then lastKey = nil end
      if announce then ac.setMessage('FTN Coach', 'Layout ' .. P.BY_ID[cat].name .. ' para ' .. M.carName) end
    else
      findWindows()
      if not hasAny(wins) then lastKey = nil end
    end
  end

  -- La primera vez se abre el centro de control para elegir el layout
  if not centerOpened and M.needsOnboarding() and mainWin then
    centerOpened = true
    mainWin:setVisible(true)
  end

  if M.BUTTONS[1][2]:pressed() then M.toggleHidden() end
  if M.BUTTONS[2][2]:pressed() then M.setEditing(not M.editing) end
  if M.BUTTONS[3][2]:pressed() then M.cycle(1) end

  for id, p in pairs(pending) do
    local acc = wins[id]
    if not acc or not acc:valid() then pending[id] = nil
    elseif acc:visible() then
      acc:move(vec2(p[1], p[2]))
      pending[id] = nil
    end
  end

  -- Cambios hechos a mano (en el modo acomodar o abriendo y cerrando overlays): se guardan al soltar el mouse
  watchAcc = watchAcc + dt
  if watchAcc >= 0.3 and M.current and s.layoutAsked and not M.hidden and not hasAny(pending)
    and clock > watchFrom and not ac.getUI().isMouseLeftKeyDown then
    watchAcc = 0
    watch()
  end
end

return M
