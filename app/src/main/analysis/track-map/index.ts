/**
 * Mapa fijo de cada trazado (nunca generado con las vueltas del piloto) y cómo
 * ubicar la trazada real encima.
 */
import { join } from 'node:path'
import type { Point, TrackMapResult } from '@shared/analysis'
import type { LoadedSession } from '../session'
import { acGeometry, findAcRoot } from './ac'
import {
  MIN_INSIDE_FRACTION,
  contoursOf,
  ensureIracingSvgs,
  gpsToScreen,
  iracingGeometry,
  projectGps,
  readAlign,
  registerToGps,
  writeAlign,
  type IracingAlign,
} from './iracing'

export type Mapper = (a: number, b: number) => Point

export interface SessionMap {
  result: TrackMapResult
  /** Lleva posA/posB de la sesión al marco del mapa (null sin posición). */
  mapper: Mapper | null
}

const NO_POSITION = 'Esta sesión no tiene posición en pista: no se puede dibujar la trazada.'

/** Hasta 8 vueltas válidas más rápidas con GPS. */
function registrationLaps(s: LoadedSession): number[] {
  return s.laps
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.kind === 'valid')
    .sort((a, b) => a.l.timeS - b.l.timeS)
    .slice(0, 8)
    .map(({ i }) => i)
    .filter((i) => {
      const { start, end } = s.spans[i]
      let ok = 0
      for (let k = start; k < end; k++) if (Number.isFinite(s.ch.posA![k])) ok++
      return ok > (end - start) * 0.9
    })
}

/**
 * Registra el dibujo oficial contra el GPS de la sesión y lo guarda. Si ya había
 * un registro (`prev`), el nuevo solo lo reemplaza si calza mejor.
 */
function registerFrom(dir: string, s: LoadedSession, prev: IracingAlign | null = null): IracingAlign | null {
  const laps = registrationLaps(s)
  const length = s.summary.trackLengthM
  if (!laps.length || !length || !s.ch.posA || !s.ch.posB) return null
  const contours = contoursOf(dir)
  if (!contours.length) return null
  const lat: number[] = []
  const lon: number[] = []
  const pct: number[] = []
  for (const i of laps) {
    const { start, end } = s.spans[i]
    for (let k = start; k < end; k++) {
      if (!Number.isFinite(s.ch.posA[k])) continue
      lat.push(s.ch.posA[k])
      lon.push(s.ch.posB[k])
      pct.push(s.ch.pct[k])
    }
  }
  const lat0 = lat.reduce((a, b) => a + b, 0) / lat.length
  const lon0 = lon.reduce((a, b) => a + b, 0) / lon.length
  const gps = lat.map((la, k) => projectGps(la, lon[k], lat0, lon0))
  const fit = registerToGps(contours, gps, length)

  // Posición típica por punto de la vuelta (para el mapa en vivo, que no tiene GPS)
  const sx = new Float64Array(1001)
  const sy = new Float64Array(1001)
  const cnt = new Uint32Array(1001)
  gps.forEach(([x, y], k) => {
    const b = Math.max(0, Math.min(1000, Math.round(pct[k] * 1000)))
    sx[b] += x
    sy[b] += -y
    cnt[b]++
  })
  const pctLine: Point[] = []
  for (let b = 0; b <= 1000; b++) {
    if (cnt[b]) {
      pctLine.push([sx[b] / cnt[b], sy[b] / cnt[b]])
      continue
    }
    // Tramo sin muestras: se interpola entre los vecinos
    let lo = b - 1
    let hi = b + 1
    while (lo >= 0 && !cnt[lo]) lo--
    while (hi <= 1000 && !cnt[hi]) hi++
    const a = lo >= 0 ? [sx[lo] / cnt[lo], sy[lo] / cnt[lo]] : null
    const c = hi <= 1000 ? [sx[hi] / cnt[hi], sy[hi] / cnt[hi]] : null
    if (a && c) {
      const t = (b - lo) / (hi - lo)
      pctLine.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t])
    } else pctLine.push((a ?? c ?? [0, 0]) as Point)
  }

  if (prev && fit.insideFraction <= prev.insideFraction) return prev
  return writeAlign(dir, {
    lat0,
    lon0,
    scale: fit.s,
    theta: fit.theta,
    tx: fit.tx,
    ty: fit.ty,
    insideFraction: fit.insideFraction,
    trackLengthM: length,
    pctLine,
    registeredWith: { track: s.summary.track, file: s.summary.path, laps: laps.map((i) => s.laps[i].lap) },
  })
}

/** Marco local propio de la sesión (sin mapa oficial): la trazada sola, en metros. */
function localGps(s: LoadedSession): Mapper | null {
  const { posA, posB } = s.ch
  if (!posA || !posB) return null
  let la = 0
  let lo = 0
  let n = 0
  for (let k = 0; k < posA.length; k++)
    if (Number.isFinite(posA[k])) {
      la += posA[k]
      lo += posB[k]
      n++
    }
  if (!n) return null
  const origin = { lat0: la / n, lon0: lo / n }
  return (lat, lon) => gpsToScreen(origin, lat, lon)
}

export class TrackMaps {
  private memo = new Map<string, TrackMapResult>()
  /** Sesiones con las que ya se intentó registrar (registrar tarda: no se repite al reabrir). */
  private tried = new Set<string>()
  private acRoot: string | null | undefined

  constructor(private dir: string) {}

  private ac(): string | null {
    if (this.acRoot === undefined) this.acRoot = findAcRoot()
    return this.acRoot
  }

  private iracingDir(trackId: string): string {
    return join(this.dir, 'iracing', trackId.split('/')[1] ?? 'x')
  }

  /** Mapa del trazado + cómo ubicar la trazada de esta sesión. */
  async forSession(s: LoadedSession): Promise<SessionMap> {
    const trackId = s.summary.trackId
    if (s.summary.sim === 'ac') {
      const result = trackId ? this.acMap(trackId) : { map: null, note: 'Sin datos del trazado.' }
      const mapper: Mapper | null = s.posKind === 'world' ? (x, z) => [x, z] : null
      return { result: mapper ? result : { ...result, note: NO_POSITION }, mapper }
    }

    if (!trackId) return { result: { map: null, note: 'Sin datos del trazado.' }, mapper: localGps(s) }
    const dir = this.iracingDir(trackId)
    let svgDir: string | null
    try {
      svgDir = await ensureIracingSvgs(dir, trackId.split('/')[1], s.trackSlug)
    } catch {
      return {
        result: { map: null, note: 'Sin conexión para bajar el mapa oficial: se muestra solo tu trazada.' },
        mapper: localGps(s),
      }
    }
    if (!svgDir) {
      return {
        result: { map: null, note: 'iRacing no publica el mapa de este trazado: se muestra solo tu trazada.' },
        mapper: localGps(s),
      }
    }
    let align = readAlign(dir)
    const attempt = `${trackId}|${s.summary.path}`
    if (s.posKind === 'gps' && !this.tried.has(attempt) && (!align || registrationLaps(s).length > align.registeredWith.laps.length)) {
      this.tried.add(attempt)
      // Sin registro, o esta sesión tiene más vueltas con GPS que la que se usó: se registra de nuevo
      const next = registerFrom(dir, s, align)
      if (next !== align) this.memo.delete(trackId)
      align = next
    }
    if (!align) {
      return {
        result: { map: null, note: 'Hace falta una vuelta válida con GPS para ubicar el mapa oficial.' },
        mapper: localGps(s),
      }
    }
    if (align.insideFraction < MIN_INSIDE_FRACTION) {
      return {
        result: { map: null, note: 'El mapa oficial no coincide con el GPS de este trazado: se muestra solo tu trazada.' },
        mapper: localGps(s),
      }
    }
    const a = align
    return {
      result: this.iracingMap(trackId, dir, a),
      mapper: s.posKind === 'gps' ? (lat, lon) => gpsToScreen(a, lat, lon) : null,
    }
  }

  private acMap(trackId: string): TrackMapResult {
    const hit = this.memo.get(trackId)
    if (hit) return hit
    const root = this.ac()
    if (!root) return { map: null, note: 'No se encontró Assetto Corsa instalado.' }
    let map = null
    try {
      map = acGeometry(root, trackId)
    } catch (err) {
      console.error('[mapa] fast_lane.ai ilegible:', err)
    }
    const result = map ? { map, note: map.widthNote } : { map: null, note: 'Este trazado de AC no trae línea de IA para dibujarlo.' }
    this.memo.set(trackId, result)
    return result
  }

  private iracingMap(trackId: string, dir: string, align: IracingAlign): TrackMapResult {
    const hit = this.memo.get(trackId)
    if (hit) return hit
    const map = iracingGeometry(dir, align)
    const result = { map, note: `Mapa oficial de iRacing · ${map.widthNote.toLowerCase()}` }
    this.memo.set(trackId, result)
    return result
  }

  /**
   * Mapa para el dashboard en vivo. En iRacing hace falta el registro; si todavía
   * no existe se usa `registrar` (una sesión de la biblioteca con GPS).
   */
  async forLive(trackId: string, slug: string | null, registrar: () => LoadedSession | null): Promise<TrackMapResult> {
    if (trackId.startsWith('ac/')) return this.acMap(trackId)
    if (!trackId.startsWith('iracing/')) return { map: null, note: 'Sin mapa.' }
    const dir = this.iracingDir(trackId)
    let svgDir: string | null = null
    try {
      svgDir = await ensureIracingSvgs(dir, trackId.split('/')[1], slug)
    } catch {
      return { map: null, note: 'Sin conexión para bajar el mapa oficial.' }
    }
    if (!svgDir) return { map: null, note: 'iRacing no publica el mapa de este trazado.' }
    let align = readAlign(dir)
    if (!align) {
      const s = registrar()
      if (s) align = registerFrom(dir, s)
    }
    if (!align)
      return {
        map: null,
        note: 'Para ubicar el mapa hace falta una sesión guardada de este trazado: activá la telemetría de iRacing (Alt+L) y dá una vuelta.',
      }
    if (align.insideFraction < MIN_INSIDE_FRACTION) return { map: null, note: 'El mapa oficial no coincide con el GPS.' }
    return this.iracingMap(trackId, dir, align)
  }
}
