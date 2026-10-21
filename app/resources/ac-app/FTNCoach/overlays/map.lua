--[[
  Mapa del circuito con todos los autos. El trazado es el map.png oficial que trae
  el circuito (con su map.ini para ubicar los autos), nunca se dibuja a partir de
  la vuelta. Marca la curva del próximo consejo de FTN Coach.
]]

local T = require('lib.theme')
local D = require('lib.draw')
local config = require('lib.config')
local link = require('lib.link')
local live = require('lib.live')
local coach = require('overlays.coach')

local M = {}
local C = T.C
local map = nil

local function load()
  local png = ac.getFolder(ac.FolderID.CurrentTrackLayout) .. '/map.png'
  local ini = ac.getTrackDataFilename('map.ini')
  if not io.fileExists(png) or not io.fileExists(ini) then return { missing = true } end
  local cfg = ac.INIConfig.load(ini):mapSection('PARAMETERS', { SCALE_FACTOR = 1, X_OFFSET = 0, Z_OFFSET = 0, WIDTH = 0, HEIGHT = 0 })
  return { png = png, cfg = cfg }
end

--- Posición del mundo → píxel del map.png.
local function toMap(pos)
  local c = map.cfg
  return (pos.x + c.X_OFFSET) / c.SCALE_FACTOR, (pos.z + c.Z_OFFSET) / c.SCALE_FACTOR
end

function M.draw()
  local size = ui.windowSize()
  local s = D.begin(300, 300)
  if not map then map = load() end
  if map.missing then
    D.empty(size.x / s, size.y / s, 'Este circuito no trae mapa', 'Falta map.png o data/map.ini en la carpeta del circuito.')
    return
  end
  D.panel(0, 0, size.x / s, size.y / s)

  local iw, ih = map.cfg.WIDTH, map.cfg.HEIGHT
  if iw <= 0 or ih <= 0 then
    if not ui.isImageReady(map.png) then return end
    local is = ui.imageSize(map.png)
    iw, ih = is.x, is.y
    if iw <= 0 then return end
  end
  local pad = 10 * s
  local k = math.min((size.x - 2 * pad) / iw, (size.y - 2 * pad) / ih)
  local ox = (size.x - iw * k) / 2
  local oy = (size.y - ih * k) / 2
  ui.drawImage(map.png, vec2(ox, oy), vec2(ox + iw * k, oy + ih * k), T.alpha(C.plata, 0.85))

  local function at(pos)
    local x, y = toMap(pos)
    return vec2(ox + x * k, oy + y * k)
  end

  -- Curva del próximo consejo
  if config.s.mapTips then
    local tip = coach.nextTip()
    if tip and tip.apexPct then
      local p = at(ac.trackProgressToWorldCoordinate(tip.apexPct))
      ui.drawCircle(p, 9 * s, C.alerta, 20, 2 * s)
    end
  end

  -- Autos: primero los demás, el propio arriba de todo
  local dot = 4.5 * s * config.s.mapDot
  local sim = live.sim
  local ahead = live.rel.ahead[1]
  local behind = live.rel.behind[1]
  for i = 0, sim.carsCount - 1 do
    local c = ac.getCar(i)
    if c and i ~= live.idx and c.isConnected and not c.isHidingLabels then
      local p = at(c.position)
      local color = (ahead and ahead.idx == i or behind and behind.idx == i) and C.blanco or C.niebla
      if c.isInPitlane then color = T.alpha(color, 0.5) end
      ui.drawCircleFilled(p, dot, color, 16)
      if config.s.mapNames then
        ui.pushDWriteFont(T.F.semi)
        ui.dwriteDrawText(ac.getDriverName(i) or '', 10 * s, p + vec2(dot + 2, -7 * s), C.plata)
        ui.popDWriteFont()
      end
    end
  end
  local me = at(live.car.position)
  ui.drawCircleFilled(me, dot * 1.5, T.accent(config.s.accent), 20)
  ui.drawCircle(me, dot * 1.5, C.blanco, 20, 1.5 * s)
end

return M
