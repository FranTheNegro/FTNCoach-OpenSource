--[[
  Conexión con FTN Coach en la PC. Le pregunta por http://127.0.0.1:<puerto>/api/ingame
  cuatro veces por segundo lo que AC no da: delta contra tu mejor vuelta, validez de
  cada vuelta, consumo, consejos por curva y tu foco de manejo. No manda nada.

  Si FTN Coach no está abierto, los overlays siguen andando con los datos de AC.
]]

local config = require('lib.config')

local M = { data = nil }
local busy = false
local lastOk = -100
local now = 0

local function poll()
  if busy then return end
  busy = true
  web.get('http://127.0.0.1:' .. math.floor(config.s.port) .. '/api/ingame', function(err, res)
    busy = false
    if err or not res or res.status ~= 200 then return end
    local ok, data = pcall(JSON.parse, res.body)
    if ok and type(data) == 'table' then
      M.data = data
      lastOk = now
    end
  end)
end

setInterval(poll, 0.25)

function M.update(dt)
  now = now + dt
end

--- Hubo respuesta en los últimos 3 segundos.
function M.ok()
  return M.data ~= nil and now - lastOk < 3
end

--- Dato de FTN Coach si está conectado (y el valor existe), si no `nil`.
function M.get(key)
  if not M.ok() then return nil end
  local v = M.data[key]
  if v == nil or v == JSON.null then return nil end
  return v
end

return M
