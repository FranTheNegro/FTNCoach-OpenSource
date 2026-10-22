--[[
  Centro de control (la ventana "FTN Coach" de la barra de apps) y los controles del
  modo acomodar que aparecen sobre cada overlay.

  El centro de control tiene un menú a la izquierda: Layout (categoría, vista previa,
  modo acomodar), cada overlay (mostrarlo, su tamaño y sus opciones), General y Atajos.
  La primera vez abre en la bienvenida para elegir el layout.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local layout = require('lib.layout')
local P = require('lib.presets')

local M = {}
local C = T.C
local s = config.s

local function pushButton(color, text)
  ui.pushStyleColor(ui.StyleColor.Button, color)
  ui.pushStyleColor(ui.StyleColor.ButtonHovered, T.alpha(color, 0.85))
  ui.pushStyleColor(ui.StyleColor.ButtonActive, T.alpha(color, 0.7))
  ui.pushStyleColor(ui.StyleColor.Text, text or C.blanco)
end

local function popButton()
  ui.popStyleColor(4)
end

local function button(label, size, color, text)
  pushButton(color or C.grafito, text or (color and C.blanco or C.plata))
  local pressed = ui.button(label, size)
  popButton()
  return pressed
end

local function muted(text)
  ui.pushStyleColor(ui.StyleColor.Text, C.niebla)
  ui.textWrapped(text)
  ui.popStyleColor()
end

local function title(text)
  ui.pushFont(ui.Font.Title)
  ui.text(text)
  ui.popFont()
end

local function section(text)
  ui.offsetCursorY(10)
  ui.pushStyleColor(ui.StyleColor.Text, C.niebla)
  ui.pushFont(ui.Font.Small)
  ui.text(text:upper())
  ui.popFont()
  ui.popStyleColor()
  ui.offsetCursorY(2)
end

local function percent(k)
  return string.format('%d %%', math.floor(k * 100 + 0.5))
end

-- ── Controles del modo acomodar (sobre cada overlay) ──

function M.frame(id)
  local size = ui.windowSize()
  local top = D.TOP
  local accent = T.accent(s.accent)
  ui.drawRectFilled(vec2(0, top), size, T.alpha(accent, 0.1), 6)
  ui.drawRect(vec2(1, top + 1), size - vec2(1, 1), accent, 6, ui.CornerFlags.All, 2)

  local label = P.LABEL[id] .. '  ' .. percent(layout.relScale(id))
  ui.pushDWriteFont(T.F.bold)
  local tw = ui.measureDWriteText(label, 12).x
  ui.drawRectFilled(vec2(6, top + 6), vec2(18 + tw, top + 28), accent, 4)
  ui.dwriteDrawText(label, 12, vec2(12, top + 9), C.blanco)
  ui.popDWriteFont()

  local x = 24 + tw
  ui.setCursor(vec2(x, top + 6))
  if button('−##' .. id, vec2(22, 22)) then layout.scaleBy(id, 1 / 1.1) end
  ui.setCursor(vec2(x + 26, top + 6))
  if button('+##' .. id, vec2(22, 22)) then layout.scaleBy(id, 1.1) end
  ui.setCursor(vec2(x + 52, top + 6))
  if button('Listo##' .. id, vec2(52, 22), C.record, C.carbono) then layout.setEditing(false) end
end

-- ── Vista previa de la pantalla ──

local function preview(plan)
  local sc = layout.screen()
  local w = ui.availableSpaceX()
  local h = math.min(w * sc.H / sc.W, 230)
  w = h * sc.W / sc.H
  local o = ui.getCursor()
  local k = w / sc.W
  ui.drawRectFilled(o, o + vec2(w, h), C.carbono, 4)
  if sc.w < sc.W then ui.drawRectFilled(o + vec2(sc.x * k, 0), o + vec2((sc.x + sc.w) * k, h), C.carbono2, 0) end
  -- Espejo virtual de AC, como referencia
  local mx = sc.x + sc.w / 2
  ui.drawRectFilled(o + vec2((mx - 220 * sc.u) * k, 10 * sc.u * k), o + vec2((mx + 220 * sc.u) * k, 70 * sc.u * k), C.grafito, 2)
  ui.pushDWriteFont(T.F.semi)
  for _, id in ipairs(P.IDS) do
    local item = plan[id]
    if item and item.visible then
      local a = o + vec2(item.x * k, (item.y + D.TOP) * k)
      local b = o + vec2((item.x + item.w) * k, (item.y + item.h) * k)
      ui.drawRectFilled(a, b, T.alpha(C.azul, 0.28), 2)
      ui.drawRect(a, b, C.azul, 2)
      ui.dwriteDrawTextClipped(P.LABEL[id], 10, a, b, ui.Alignment.Center, ui.Alignment.Center, false, C.blanco)
    end
  end
  ui.popDWriteFont()
  ui.dummy(vec2(w, h))
end

local function categoryButtons(current, onPick)
  local bw = (ui.availableSpaceX() - 6 * 6) / 7
  for i, c in ipairs(P.CATEGORIES) do
    if i > 1 then ui.sameLine(0, 6) end
    local on = c.id == current
    if button(c.name .. '##cat', vec2(bw, 30), on and C.azul or nil) then onPick(c.id) end
    if ui.itemHovered() then ui.setTooltip(c.hint .. (c.id == layout.detected and '\n(la detectada para este auto)' or '')) end
  end
end

-- ── Páginas ──

local choice = nil

local function welcome()
  choice = choice or layout.detected
  local cat = P.BY_ID[choice]
  title('Acomodemos tus overlays')
  muted(string.format('Tu %s es de %s. Elegí la categoría y te armamos un layout pensado para ella. Después lo podés acomodar a gusto: se guarda solo y queda fijo.',
    layout.carName, P.BY_ID[layout.detected].name))
  ui.offsetCursorY(8)
  categoryButtons(choice, function(id) choice = id end)
  muted(cat.hint)
  ui.offsetCursorY(6)
  preview(layout.plan(choice))
  ui.offsetCursorY(8)
  if button('Aplicar layout ' .. cat.name, vec2(260, 34), C.azul) then
    layout.accept(choice)
    choice = nil
  end
  ui.sameLine()
  if button('Dejar mis overlays como están', vec2(240, 34)) then
    layout.decline()
    choice = nil
  end
end

local function layoutPage()
  if layout.needsOnboarding() then return welcome() end
  local current = layout.current or layout.wanted()
  if not current then
    ui.text('Subite a un auto para elegir su layout.')
    return
  end
  local cat = P.BY_ID[current]
  title('Layout ' .. cat.name)
  local detected = P.BY_ID[layout.detected]
  muted(string.format('%s · detectado como %s · %s', layout.carName, detected and detected.name or '?',
    layout.group == 'race' and 'carrera' or 'práctica / clasificación'))

  section(s.layoutAuto and 'Categoría para este auto' or 'Categoría para todos los autos')
  categoryButtons(current, layout.choose)
  muted(cat.hint)
  ui.offsetCursorY(6)
  preview(layout.plan(current))

  ui.offsetCursorY(8)
  if layout.editing then
    if button('Listo: fijar los overlays', vec2(220, 32), C.record, C.carbono) then layout.setEditing(false) end
  else
    if button('Modo acomodar', vec2(220, 32), C.azul) then layout.setEditing(true) end
  end
  ui.sameLine()
  if button(layout.hidden and 'Mostrar overlays' or 'Ocultar overlays', vec2(160, 32)) then layout.toggleHidden() end
  ui.sameLine()
  if layout.isCustom(current) then
    if button('Volver al recomendado', vec2(180, 32)) then layout.reset(current) end
  end
  muted(layout.editing and 'Arrastrá los overlays y usá − / + para el tamaño; al soltarlos se alinean solos. "Listo" guarda y los fija.'
    or layout.isCustom(current) and ('Usando tu layout de ' .. cat.name .. '. Fuera del modo acomodar los overlays quedan fijos.')
    or 'Usando el layout recomendado. Fuera del modo acomodar los overlays quedan fijos.')

  section('Tamaño de todos los overlays')
  if button('−##all', vec2(30, 0)) then layout.rescale(1 / 1.1) end
  ui.sameLine()
  ui.text(percent(s.layoutScale))
  ui.sameLine()
  if button('+##all', vec2(30, 0)) then layout.rescale(1.1) end

  section('Cambio automático')
  if ui.checkbox('Cambiar de layout según el auto', s.layoutAuto) then
    s.layoutAuto = not s.layoutAuto
    if not s.layoutAuto then s.layoutFixed = current end
    layout.apply(layout.wanted())
  end
  muted(s.layoutAuto and 'Cada auto usa el layout de su categoría (o el que le elijas arriba). Qué overlays se ven se guarda aparte para carrera y para práctica.'
    or 'Todos los autos usan el mismo layout.')
end

local function overlayPage(id)
  title(P.LABEL[id])
  muted(P.DESC[id])
  ui.offsetCursorY(6)
  local cat = layout.current and P.BY_ID[layout.current]
  local on = layout.isVisible(id)
  if ui.checkbox(cat and ('Mostrar en el layout ' .. cat.name) or 'Mostrar', on) then layout.setVisible(id, not on) end
  if on then
    ui.text('Tamaño ' .. percent(layout.relScale(id)))
    ui.sameLine()
    if button('−##one', vec2(30, 0)) then layout.scaleBy(id, 1 / 1.1) end
    ui.sameLine()
    if button('+##one', vec2(30, 0)) then layout.scaleBy(id, 1.1) end
  end
  if config.has(id) then
    section('Opciones')
    config.ui(id, link, T)
  end
end

local function keysPage()
  title('Atajos')
  muted('Asignalos a una tecla o a un botón del volante.')
  ui.offsetCursorY(8)
  for _, b in ipairs(layout.BUTTONS) do
    ui.text(b[1])
    ui.sameLine(240)
    b[2]:control(vec2(200, 0), nil, 'Asignar')
  end
end

-- ── Centro de control ──

local page = 'layout'

local function navItem(id, label, dim)
  if dim then ui.pushStyleColor(ui.StyleColor.Text, C.niebla) end
  if ui.selectable(label .. '##nav' .. id, page == id) then page = id end
  if dim then ui.popStyleColor() end
end

function M.center()
  if layout.needsOnboarding() then page = 'layout' end
  ui.childWindow('##nav', vec2(170, 0), false, function()
    navItem('layout', 'Layout')
    section('Overlays')
    for _, id in ipairs(P.IDS) do
      navItem(id, P.LABEL[id], not layout.isVisible(id))
    end
    section('App')
    navItem('general', 'General')
    navItem('keys', 'Atajos')
  end)
  ui.sameLine(0, 12)
  ui.childWindow('##page', vec2(0, 0), false, function()
    if page == 'layout' then layoutPage()
    elseif page == 'keys' then keysPage()
    elseif page == 'general' then
      title('General')
      config.ui('general', link, T)
    else overlayPage(page) end
  end)
end

return M
