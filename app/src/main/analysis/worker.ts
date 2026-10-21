/**
 * Hilo de análisis: lee sesiones, registra mapas y calcula comparaciones sin
 * trabar la ventana ni el motor en vivo.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { isLocal, type LibraryState } from '@shared/analysis'
import { analyzeSession, coachData, compareLaps, type Prepared } from './analyze'
import { Library } from './library'
import type { AnalysisInit, AnalysisMessage, AnalysisRequest } from './protocol'
import { loadSession } from './session'
import { TrackMaps } from './track-map'
import { acSections, findAcRoot } from './track-map/ac'

const init = workerData as AnalysisInit
const library = new Library(init.cacheFile)
const maps = new TrackMaps(init.geoDir)
const prepared = new Map<string, Prepared>()
let scanning = false
let scanError: string | null = null

function post(m: AnalysisMessage): void {
  parentPort!.postMessage(m)
}

function publish(): void {
  const state: LibraryState = { scanning, sessions: library.sessions, error: scanError }
  post({ type: 'library', state })
}

async function prepare(id: string): Promise<Prepared> {
  const hit = prepared.get(id)
  if (hit) {
    // Al frente del LRU
    prepared.delete(id)
    prepared.set(id, hit)
    return hit
  }
  const summary = library.find(id)
  if (!summary) throw new Error('La sesión ya no está en la biblioteca')
  const s = loadSession(summary.path)
  if (!s.laps.length) throw new Error('La sesión no tiene vueltas')
  const sm = await maps.forSession(s)
  const root = s.summary.sim === 'ac' && s.summary.trackId ? findAcRoot() : null
  const p = analyzeSession(s, sm, root && s.summary.trackId ? acSections(root, s.summary.trackId) : [])
  prepared.set(id, p)
  while (prepared.size > 3) prepared.delete(prepared.keys().next().value!)
  return p
}

async function handle(req: AnalysisRequest): Promise<unknown> {
  switch (req.type) {
    case 'scan':
      if (scanning) return null
      scanning = true
      scanError = null
      publish()
      try {
        await library.scan(req.dirs, req.exclude, publish)
      } catch (err) {
        scanError = err instanceof Error ? err.message : String(err)
      } finally {
        scanning = false
        publish()
      }
      return null
    case 'detail':
      return (await prepare(req.sessionId)).detail
    case 'compare':
      return compareLaps(await prepare(req.sessionId), req.a, req.b)
    case 'coachData':
      return coachData(await prepare(req.sessionId), req.lap)
    case 'tips': {
      // La sesión más nueva de este trazado y auto con vueltas para comparar
      const src = library.sessions.find((x) => isLocal(x) && x.trackId === req.trackId && x.car === req.car && x.validLaps >= 3)
      if (!src) return []
      const p = await prepare(src.id)
      const d = p.detail
      if (d.bestIndex === null) return []
      // La vuelta válida típica (la mediana) contra la mejor: lo que se repite vuelta a vuelta
      const valid = d.laps.filter((l) => l.kind === 'valid').sort((a, b) => a.timeS - b.timeS)
      const typical = valid[valid.length >> 1]
      if (!typical || typical.index === d.bestIndex) return []
      return compareLaps(p, typical.index, d.bestIndex).insights.map((i) => {
        const c = d.corners.find((x) => x.id === i.cornerId)!
        return { startPct: c.startPct, apexPct: c.apexPct, title: i.title, text: i.text, lossS: i.lossS }
      })
    }
    case 'liveMap':
      return maps.forLive(req.trackId, req.slug, () => {
        const candidate = library.sessions.find((x) => isLocal(x) && x.trackId === req.trackId && x.hasPosition && x.validLaps > 0)
        return candidate ? loadSession(candidate.path) : null
      })
  }
}

// Un pedido a la vez: el análisis es sincrónico y pesado
let queue = Promise.resolve()
async function run(m: { id: number; req: AnalysisRequest }): Promise<void> {
  try {
    post({ type: 'result', id: m.id, ok: true, result: await handle(m.req) })
  } catch (err) {
    console.error('[analysis]', err)
    post({ type: 'result', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

parentPort!.on('message', (m: { id: number; req: AnalysisRequest }) => {
  // El escaneo cede entre archivos: corre aparte para no frenar los demás pedidos
  if (m.req.type === 'scan') void run(m)
  else queue = queue.then(() => run(m))
})

publish()
