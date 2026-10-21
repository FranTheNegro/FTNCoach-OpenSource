/**
 * Hilo lector: busca el simulador, lo lee a 60 Hz y le pasa cada muestra al
 * proceso principal.
 *
 * Va en un worker porque el loop principal de Electron (el de Chromium) agrupa
 * los timers y no baja de ~36 Hz aunque se pida resolución de 1 ms. El loop de
 * libuv del worker sí la respeta.
 */
import { parentPort } from 'node:worker_threads'
import type { SessionMeta } from '@shared/live'
import type { TelemetrySource } from './types'
import { IracingLive } from './iracing/live'
import { AcLive } from './ac/live'
import { IbtReplay } from './replay'
import { setHighResTimer } from './win32'
import type { ReaderCommand, ReaderEvent } from './reader-protocol'

const POLL_MS = 1000 / 60
const PROBE_MS = 1000

const port = parentPort!
const send = (e: ReaderEvent) => port.postMessage(e)

let source: TelemetrySource | null = null
let demoPath: string | null = null
let lastProbe = 0
let metaKey = ''

function openLive(): TelemetrySource | null {
  try {
    return IracingLive.open() ?? AcLive.open()
  } catch (err) {
    send({ type: 'error', message: `No se pudo abrir el simulador: ${String(err)}` })
    return null
  }
}

function openDemo(): TelemetrySource | null {
  if (!demoPath) return null
  try {
    return new IbtReplay(demoPath)
  } catch (err) {
    send({ type: 'error', message: `No se pudo reproducir ${demoPath}: ${String(err)}` })
    demoPath = null
    send({ type: 'demo', path: null })
    return null
  }
}

function connect(src: TelemetrySource): void {
  source = src
  metaKey = ''
  setHighResTimer(true)
  send({ type: 'connected', sim: src.sim })
}

function disconnect(reason = ''): void {
  if (!source) return
  if (reason) send({ type: 'error', message: `Se desconectó ${source.sim}: ${reason}` })
  source.close()
  source = null
  setHighResTimer(false)
  send({ type: 'disconnected' })
}

function metaIfChanged(meta: SessionMeta | null): SessionMeta | null | undefined {
  const key = meta ? JSON.stringify(meta) : ''
  if (key === metaKey) return undefined
  metaKey = key
  return meta
}

function tick(): void {
  const now = Date.now()
  // Con el demo andando se sigue buscando el sim: si se abre, tiene prioridad
  if ((!source || source.sim === 'replay') && now - lastProbe >= PROBE_MS) {
    lastProbe = now
    const live = openLive()
    if (live) {
      disconnect()
      connect(live)
    } else if (!source) {
      const demo = openDemo()
      if (demo) connect(demo)
    }
  }
  const src = source
  if (!src) return
  try {
    const sample = src.poll()
    if (sample) send({ type: 'sample', sample, meta: metaIfChanged(src.meta()) })
  } catch (err) {
    send({ type: 'error', message: `Error leyendo ${src.sim}: ${String(err)}` })
  }
  if (!src.alive()) disconnect('dejó de publicar datos')
}

port.on('message', (cmd: ReaderCommand) => {
  if (cmd.type === 'demo') {
    demoPath = cmd.path
    send({ type: 'demo', path: demoPath })
    if (source?.sim === 'replay' || (demoPath && !source)) disconnect()
    lastProbe = 0
  } else if (cmd.type === 'stop') {
    disconnect()
    clearInterval(timer)
    port.close()
  }
})

const timer = setInterval(tick, POLL_MS)
