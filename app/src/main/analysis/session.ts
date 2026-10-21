/**
 * Carga una sesión grabada (.ibt de iRacing o .ftnrec propio) con todos sus
 * canales y la corta en vueltas con el mismo LapTracker que en vivo: las vueltas
 * y su validez son idénticas a las que viste en el dashboard.
 */
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Conditions, SessionSectors, SessionSummary, SetupGroup } from '@shared/analysis'
import type { LapRecord } from '@shared/live'
import { IbtFile } from '../telemetry/iracing/ibt'
import { RowReader } from '../telemetry/iracing/irsdk'
import { irContext } from '../telemetry/iracing/context'
import { irSample } from '../telemetry/iracing/normalize'
import { carIdOf, conditionsOf, eventIdOf, metaFromSessionInfo, sessionTypeOf, setupOf } from '../telemetry/iracing/session-info'
import { LapTracker, type LapSpan } from '../telemetry/lap-tracker'
import type { RawSample } from '../telemetry/types'
import { REC_EXT, readRecording } from './recording'

export interface Channels {
  clock: Float64Array
  pct: Float32Array
  speed: Float32Array
  throttle: Float32Array
  brake: Float32Array
  steer: Float32Array
  gear: Float32Array
  rpm: Float32Array
  gLat: Float32Array
  gLon: Float32Array
  off: Uint8Array
  /** iRacing: latitud/longitud; AC: x/z del mundo. null si no hay. */
  posA: Float64Array | null
  posB: Float64Array | null
}

export interface LoadedSession {
  summary: SessionSummary
  trackSlug: string | null
  sectorsPct: number[] | null
  /** 'gps' = posA/posB son lat/lon; 'world' = x/z del sim. */
  posKind: 'gps' | 'world' | null
  ch: Channels
  laps: LapRecord[]
  spans: LapSpan[]
  setup: SetupGroup[] | null
  conditions: Conditions | null
  /** Giro máximo del volante en radianes (iRacing), para normalizar telemetría externa. */
  steerMaxRad: number | null
  /** Tipo de sesión de cada vuelta (un .ibt puede pasar de práctica a qualy sin bajarse del auto). */
  lapSessions?: (string | null)[]
}

export const SESSION_EXTS = ['.ibt', REC_EXT]

export function sessionId(path: string): string {
  return createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 12)
}

function alloc(n: number, pos: boolean): Channels {
  return {
    clock: new Float64Array(n),
    pct: new Float32Array(n),
    speed: new Float32Array(n),
    throttle: new Float32Array(n),
    brake: new Float32Array(n),
    steer: new Float32Array(n),
    gear: new Float32Array(n),
    rpm: new Float32Array(n),
    gLat: new Float32Array(n),
    gLon: new Float32Array(n),
    off: new Uint8Array(n),
    posA: pos ? new Float64Array(n) : null,
    posB: pos ? new Float64Array(n) : null,
  }
}

function put(ch: Channels, i: number, s: RawSample): void {
  ch.clock[i] = s.clockS
  ch.pct[i] = s.lapPct
  ch.speed[i] = s.speedKmh
  ch.throttle[i] = s.throttle
  ch.brake[i] = s.brake
  ch.steer[i] = s.steer
  ch.gear[i] = s.gear
  ch.rpm[i] = s.rpm
  ch.gLat[i] = s.gLat
  ch.gLon[i] = s.gLon
  ch.off[i] = s.offTrack ? 1 : 0
}

function summarize(
  path: string,
  base: Omit<SessionSummary, 'id' | 'path' | 'laps' | 'validLaps' | 'bestLapS' | 'durationS'>,
  ch: Channels,
  n: number,
  laps: LapRecord[],
): SessionSummary {
  const valid = laps.filter((l) => l.kind === 'valid')
  return {
    ...base,
    id: sessionId(path),
    path,
    laps: laps.length,
    validLaps: valid.length,
    bestLapS: valid.length ? Math.min(...valid.map((l) => l.timeS)) : null,
    durationS: n > 1 ? Math.max(0, ch.clock[n - 1] - ch.clock[0]) : 0,
  }
}

function loadIbt(path: string): LoadedSession {
  const f = new IbtFile(path)
  try {
    const r = new RowReader(f.vars)
    const ctx = irContext(f.info, 'iracing', null)
    const meta = metaFromSessionInfo(f.info, 'iracing', null)
    const hasGps = r.has('Lat') && r.has('Lon')
    const n = f.rowCount
    const ch = alloc(n, hasGps)
    const tracker = new LapTracker()
    const CH = 1200
    let gpsSeen = false
    let steerMaxRad: number | null = null
    const sessNum = new Int16Array(n).fill(-1)
    // El reloj de iRacing vuelve a 0 en cada sesión: se hace continuo para que las
    // vueltas de todas las sesiones del archivo queden en el mismo historial
    let clockOffset = 0
    let lastClock = -Infinity
    for (let first = 0; first < n; first += CH) {
      const buf = f.readRows(first, CH)
      const m = Math.min(CH, n - first)
      r.row = buf
      for (let k = 0; k < m; k++) {
        r.base = k * f.rowLen
        const s = irSample(r, ctx)
        const i = first + k
        if (s.clockS + clockOffset < lastClock - 1) clockOffset = lastClock - s.clockS + 1 / f.tickRate
        s.clockS += clockOffset
        lastClock = s.clockS
        sessNum[i] = r.num('SessionNum') ?? -1
        put(ch, i, s)
        if (steerMaxRad === null) {
          const v = r.num('SteeringWheelAngleMax')
          if (v && v > 0) steerMaxRad = v
        }
        if (ch.posA && ch.posB) {
          const lat = r.num('Lat') ?? 0
          const lon = r.num('Lon') ?? 0
          // iRacing manda 0 fuera del mundo (garage, menús)
          const ok = Math.abs(lat) > 0.5
          ch.posA[i] = ok ? lat : NaN
          ch.posB[i] = ok ? lon : NaN
          if (ok) gpsSeen = true
        }
        tracker.update(s)
      }
    }
    tracker.flush()
    const typeOf = (num: number) => (num >= 0 ? sessionTypeOf(f.info, num) : null)
    const lapSessions = tracker.spans.map((sp) => typeOf(sessNum[sp.start]))
    // Tipo de la sesión: el de las vueltas (o el del archivo si no hay); si pasó por varias, todas en orden
    const kinds = [...new Set((lapSessions.length ? lapSessions : [typeOf(sessNum[n >> 1])]).filter((x): x is string => !!x))]
    const fileTime = statSync(path).mtimeMs
    const startedAt = f.disk.startDate > 1e9 ? f.disk.startDate * 1000 : fileTime - (n / f.tickRate) * 1000
    return {
      summary: summarize(
        path,
        {
          source: 'ibt',
          sim: 'iracing',
          car: meta.car,
          carId: carIdOf(f.info),
          track: meta.track,
          trackId: meta.trackId,
          trackLengthM: meta.trackLengthM,
          sessionType: kinds.length ? kinds.join(' + ') : meta.sessionType,
          driver: meta.driver,
          startedAt,
          hasPosition: gpsSeen,
          eventId: eventIdOf(f.info),
        },
        ch,
        n,
        tracker.laps,
      ),
      trackSlug: meta.trackSlug ?? slugFromIbtName(path),
      sectorsPct: meta.sectorsPct,
      posKind: gpsSeen ? 'gps' : null,
      ch,
      laps: tracker.laps,
      spans: tracker.spans,
      setup: setupOf(f.info),
      conditions: conditionsOf(f.info),
      steerMaxRad,
      lapSessions: kinds.length > 1 ? lapSessions : undefined,
    }
  } finally {
    f.close()
  }
}

/** "toyotagr86_tsukuba 2kfull 2026-10-16 21-27-33.ibt" → "tsukuba 2kfull" */
export function slugFromIbtName(path: string): string | null {
  const m = /_(.+?) \d{4}-\d\d-\d\d \d\d-\d\d-\d\d/.exec(basename(path))
  return m ? m[1].trim().toLowerCase() : null
}

function loadRec(path: string): LoadedSession {
  const rec = readRecording(path)
  const h = rec.header
  const n = rec.rows
  const posX = rec.col('posX')
  const hasPos = posX.some((v) => Number.isFinite(v) && v !== 0)
  const ch = alloc(n, hasPos)
  const tracker = new LapTracker()
  const c = (name: Parameters<typeof rec.col>[0]) => rec.col(name)
  const [clock, lap, pct, lapTime, lastLap, speed, throttle, brake, clutch, steer, gear, rpm, gLat, gLon, fuel, off, inPit, posZ] = [
    c('clock'),
    c('lap'),
    c('pct'),
    c('lapTime'),
    c('lastLap'),
    c('speed'),
    c('throttle'),
    c('brake'),
    c('clutch'),
    c('steer'),
    c('gear'),
    c('rpm'),
    c('gLat'),
    c('gLon'),
    c('fuel'),
    c('off'),
    c('inPit'),
    c('posZ'),
  ]
  const fin = (v: number) => (Number.isFinite(v) ? v : null)
  for (let i = 0; i < n; i++) {
    const s = {
      sim: h.sim,
      paused: false,
      onTrack: true,
      inPit: inPit[i] > 0.5,
      pitLimiter: false,
      speedKmh: speed[i],
      rpm: rpm[i],
      gear: gear[i],
      throttle: throttle[i],
      brake: brake[i],
      clutch: clutch[i],
      steer: steer[i],
      gLat: gLat[i],
      gLon: gLon[i],
      lap: lap[i],
      pos: null,
      lapPct: pct[i],
      lapTimeS: lapTime[i],
      lastLapS: fin(lastLap[i]),
      bestLapS: null,
      simDeltaS: null,
      position: null,
      carsInSession: null,
      lapsTotal: null,
      lapsRemaining: null,
      timeRemainingS: null,
      fuelL: fin(fuel[i]),
      tyreTempC: null,
      tyrePressKpa: null,
      tyreWear: null,
      brakeTempC: null,
      brakeBias: null,
      tc: null,
      abs: null,
      flags: [],
      incidents: null,
      airTempC: null,
      trackTempC: null,
      clockS: clock[i],
      offTrack: off[i] > 0.5,
    } satisfies RawSample
    put(ch, i, s)
    if (ch.posA && ch.posB) {
      ch.posA[i] = posX[i]
      ch.posB[i] = posZ[i]
    }
    tracker.update(s)
  }
  tracker.flush()
  return {
    summary: summarize(
      path,
      {
        source: 'rec',
        sim: h.sim,
        car: h.car,
        track: h.track,
        trackId: h.trackId,
        trackLengthM: h.trackLengthM,
        sessionType: h.sessionType,
        driver: h.driver,
        startedAt: h.startedAt,
        hasPosition: hasPos,
      },
      ch,
      n,
      tracker.laps,
    ),
    trackSlug: h.trackSlug,
    sectorsPct: h.sectorsPct,
    posKind: hasPos ? 'world' : null,
    ch,
    laps: tracker.laps,
    spans: tracker.spans,
    setup: null,
    conditions: null,
    steerMaxRad: null,
  }
}

export function loadSession(path: string): LoadedSession {
  const ext = extname(path).toLowerCase()
  if (ext === '.ibt') return loadIbt(path)
  if (ext === REC_EXT) return loadRec(path)
  throw new Error(`Formato no soportado: ${ext}`)
}

/** Reloj en el primer cruce de `p` dentro de la vuelta, interpolado en el reloj (NaN si no lo cruza). */
function crossClock(s: LoadedSession, span: LapSpan, p: number): number {
  const { pct, clock } = s.ch
  for (let k = span.start + 1; k < span.end; k++) {
    const a = pct[k - 1]
    const b = pct[k]
    // b - a < 0.5 descarta el salto de 1 a 0 en la línea de meta
    if (a < p && b >= p && b - a < 0.5) return clock[k - 1] + ((p - a) / (b - a)) * (clock[k] - clock[k - 1])
  }
  return NaN
}

/** Mejores sectores de las vueltas válidas (los mismos cortes que el análisis). */
export function sectorBests(s: LoadedSession): SessionSectors | null {
  if (!s.laps.length) return null
  const pct = s.sectorsPct && s.sectorsPct.length > 1 ? s.sectorsPct : [0, 1 / 3, 2 / 3]
  const bestS: (number | null)[] = pct.map(() => null)
  s.laps.forEach((l, i) => {
    if (l.kind !== 'valid') return
    const span = s.spans[i]
    const t = [span.startClock, ...pct.slice(1).map((p) => crossClock(s, span, p)), span.startClock + l.timeS]
    for (let k = 0; k < pct.length; k++) {
      const dt = t[k + 1] - t[k]
      if (Number.isFinite(dt) && dt > 0 && (bestS[k] === null || dt < bestS[k]!)) bestS[k] = dt
    }
  })
  return { pct, bestS }
}
