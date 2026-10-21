/**
 * Sigue las vueltas en vivo a partir de las muestras de cualquier sim:
 * cierra cada vuelta con su tiempo oficial, la clasifica (válida, salida de
 * pista, boxes…), promedia el consumo y guarda la mejor como referencia para el
 * delta cuando el sim no lo calcula (AC).
 *
 * Reglas del lector de .ibt:
 * - el tiempo oficial llega con demora (iRacing: 0,3–2 s después de cruzar la meta);
 *   se toma el primer valor distinto al previo al cruce, si está a ±1 s de lo medido.
 * - una salida de pista cuenta si dura ≥ 0,25 s.
 */
import type { LapKind, LapRecord } from '@shared/live'
import type { RawSample } from './types'

const MIN_OFF_TRACK_S = 0.25
const OFFICIAL_WAIT_S = 3
const OFFICIAL_TOLERANCE_S = 1
const MIN_COVERAGE = 0.85
/** Menos que esto recorrido antes de cruzar la meta (largada en la grilla) no es una vuelta. */
const MIN_TRACKED = 0.05
/** Una vuelta cortada (reset, remolque, fin de sesión) se registra si recorrió al menos esto. */
const MIN_CUT = 0.1
const FUEL_LAPS = 5
const REF_BINS = 1000

interface OpenLap {
  lap: number
  /** Índice de la primera muestra de la vuelta (contando desde el inicio). */
  startIdx: number
  startClock: number
  startFuel: number | null
  /** Se empezó a seguir con la vuelta ya empezada (al conectar, tras un reset). */
  partial: boolean
  startedInPit: boolean
  wasInPit: boolean
  maxPct: number
  incidentsStart: number | null
  offStart: number | null
  offPct: number
  offEvents: number[]
  /** (posición, tiempo) para la referencia del delta, cada 1/REF_BINS de vuelta. */
  pcts: number[]
  times: number[]
}

interface PendingLap {
  open: OpenLap
  /** Índice de la muestra que cruzó la meta (primera de la vuelta siguiente). */
  endIdx: number
  measuredS: number
  endedInPit: boolean
  endFuel: number | null
  incidentsEnd: number | null
  lastBefore: number | null
  deadline: number
}

export function lapTimeAt(ref: Float32Array, pct: number): number {
  const x = Math.max(0, Math.min(1, pct)) * (ref.length - 1)
  const i = Math.floor(x)
  const j = Math.min(ref.length - 1, i + 1)
  return ref[i] + (ref[j] - ref[i]) * (x - i)
}

/** Remuestrea (posición, tiempo) a REF_BINS puntos equiespaciados en la vuelta. */
export function buildReference(pcts: number[], times: number[], lapTimeS: number): Float32Array | null {
  if (pcts.length < 50) return null
  const ref = new Float32Array(REF_BINS + 1)
  let k = 0
  for (let i = 0; i <= REF_BINS; i++) {
    const p = i / REF_BINS
    while (k < pcts.length - 2 && pcts[k + 1] < p) k++
    const p0 = pcts[k]
    const p1 = pcts[k + 1]
    const t0 = times[k]
    const t1 = times[k + 1]
    ref[i] = p1 > p0 ? t0 + ((t1 - t0) * (p - p0)) / (p1 - p0) : t0
  }
  ref[0] = 0
  ref[REF_BINS] = lapTimeS
  for (let i = 1; i <= REF_BINS; i++) if (ref[i] < ref[i - 1]) ref[i] = ref[i - 1]
  return ref
}

/**
 * Se empieza a seguir una vuelta ya empezada. No cuenta en boxes ni en la vuelta 0
 * (antes del primer cruce: grilla o boxes), que son vueltas de salida.
 */
function joinedMidLap(s: RawSample): boolean {
  return s.lap > 0 && s.lapPct > 0.05 && !s.inPit
}

function classify(p: PendingLap): { kind: LapKind; reason: string | null } {
  const o = p.open
  if (o.partial) return { kind: 'partial', reason: 'Vuelta tomada empezada' }
  if (o.startedInPit) return { kind: 'out_lap', reason: 'Salida de boxes' }
  if (o.lap === 0) return { kind: 'out_lap', reason: 'Vuelta de salida' }
  const inc = o.incidentsStart !== null && p.incidentsEnd !== null ? p.incidentsEnd - o.incidentsStart : 0
  if (inc >= 2) return { kind: 'incident', reason: `Incidente (+${inc}x)` }
  if (o.offEvents.length) {
    const where = o.offEvents.map((x) => `${Math.round(x * 100)}%`).join(', ')
    return { kind: 'off_track', reason: `Salida de pista al ${where} de la vuelta` }
  }
  if (inc === 1) return { kind: 'off_track', reason: 'Salida de pista (+1x)' }
  if (p.endedInPit || o.wasInPit) return { kind: 'in_lap', reason: 'Entrada a boxes' }
  if (o.maxPct < MIN_COVERAGE) return { kind: 'partial', reason: `Incompleta (${Math.round(o.maxPct * 100)}% de la pista)` }
  return { kind: 'valid', reason: null }
}

/** Muestras de cada vuelta registrada: [start, end) en el orden en que llegaron. */
export interface LapSpan {
  start: number
  end: number
  /** Reloj del sim al inicio de la vuelta y en el cruce de meta. */
  startClock: number
  endClock: number
  /** Vuelta cortada: termina en la última muestra en pista, no en la meta. */
  cut?: boolean
}

export class LapTracker {
  laps: LapRecord[] = []
  /** Paralelo a `laps`. */
  spans: LapSpan[] = []
  /** Muestras procesadas desde que se creó (no se reinicia con reset). */
  private n = 0
  private open: OpenLap | null = null
  private pending: PendingLap | null = null
  private prev: RawSample | null = null
  private fuelUsed: number[] = []
  private ref: Float32Array | null = null
  private refTimeS = Infinity

  reset(): void {
    this.laps = []
    this.spans = []
    this.open = null
    this.pending = null
    this.prev = null
    this.fuelUsed = []
    this.ref = null
    this.refTimeS = Infinity
  }

  private start(s: RawSample, partial: boolean): OpenLap {
    // Al cruzar la meta el contador de vuelta puede cambiar un tick antes que la posición
    const pct = !partial && s.lapPct > 0.5 ? 0 : s.lapPct
    return {
      lap: s.lap,
      startIdx: this.n - 1,
      startClock: s.clockS,
      startFuel: s.fuelL,
      partial,
      startedInPit: s.inPit,
      wasInPit: false,
      maxPct: pct,
      incidentsStart: s.incidents,
      offStart: null,
      offPct: 0,
      offEvents: [],
      pcts: [pct],
      times: [partial ? s.lapTimeS : 0],
    }
  }

  /** Procesa una muestra. Devuelve true si cambió el historial de vueltas. */
  update(s: RawSample): boolean {
    this.n++
    const prev = this.prev
    this.prev = s
    // El reloj volvió atrás: sesión nueva o repetición que reinició
    if (prev && s.clockS < prev.clockS - 1) {
      const had = this.laps.length > 0
      this.reset()
      this.prev = s
      this.open = this.start(s, joinedMidLap(s))
      return had
    }
    if (!this.open) {
      this.open = this.start(s, joinedMidLap(s))
      return false
    }

    let changed = this.resolvePending(s)
    const o = this.open

    if (s.lap !== o.lap) {
      if (s.lap === o.lap + 1 && prev && o.maxPct - o.pcts[0] < MIN_TRACKED) {
        // Del largador o la conexión a la meta casi no hubo vuelta: no se registra
        this.open = this.start(s, false)
      } else if (s.lap === o.lap + 1 && prev) {
        this.pending = {
          open: o,
          endIdx: this.n - 1,
          measuredS: s.clockS - o.startClock,
          endedInPit: s.inPit,
          endFuel: prev.fuelL,
          incidentsEnd: s.incidents,
          lastBefore: prev.lastLapS,
          deadline: s.clockS + OFFICIAL_WAIT_S,
        }
        this.open = this.start(s, false)
        changed = this.resolvePending(s) || changed
      } else {
        // Reset, remolque o salto de vueltas: lo que había no es una vuelta completa,
        // pero se guarda igual para poder analizarla.
        // En la largada iRacing vuelve el contador a 0: esa es la vuelta de salida.
        if (prev) changed = this.cut(o, prev, this.n - 2, s.incidents) || changed
        this.open = this.start(s, !s.inPit && s.lap !== 0)
      }
      return changed
    }

    if (s.inPit) o.wasInPit = true
    if (s.lapPct > o.maxPct && s.lapPct - o.maxPct < 0.2) o.maxPct = s.lapPct
    if (s.lapPct - o.pcts[o.pcts.length - 1] >= 1 / REF_BINS && s.lapPct - o.pcts[o.pcts.length - 1] < 0.05) {
      o.pcts.push(s.lapPct)
      o.times.push(s.lapTimeS)
    }
    if (s.offTrack && !s.paused) {
      if (o.offStart === null) {
        o.offStart = s.clockS
        o.offPct = s.lapPct
      }
    } else if (o.offStart !== null) {
      if (s.clockS - o.offStart >= MIN_OFF_TRACK_S) o.offEvents.push(o.offPct)
      o.offStart = null
    }
    return changed
  }

  /** Fin de los datos (archivo grabado): cierra la vuelta pendiente y guarda la que quedó a medias. */
  flush(): boolean {
    const last = this.prev
    if (!last) return false
    let changed = this.resolvePending(last, true)
    if (this.open) changed = this.cut(this.open, last, this.n - 1, last.incidents, 'Sin terminar') || changed
    this.open = null
    return changed
  }

  /** Registra una vuelta que no llegó a la meta (si recorrió lo suficiente). */
  private cut(o: OpenLap, last: RawSample, lastIdx: number, incidents: number | null, why = 'Interrumpida'): boolean {
    const covered = o.maxPct - o.pcts[0]
    if (covered < MIN_CUT || lastIdx <= o.startIdx || last.clockS <= o.startClock) return false
    if (o.offStart !== null && last.clockS - o.offStart >= MIN_OFF_TRACK_S) o.offEvents.push(o.offPct)
    const inc = o.incidentsStart !== null && incidents !== null ? incidents - o.incidentsStart : 0
    const extra = [inc > 0 ? `+${inc}x` : null, o.offEvents.length ? 'salida de pista' : null].filter(Boolean).join(', ')
    const timeS = last.clockS - o.startClock
    this.spans.push({ start: o.startIdx, end: lastIdx, startClock: o.startClock, endClock: last.clockS, cut: true })
    this.laps.push({
      lap: o.lap,
      timeS,
      kind: 'partial',
      reason: `${why} al ${Math.round(o.maxPct * 100)}% de la vuelta${extra ? ` (${extra})` : ''}`,
      fuelUsedL: null,
      best: false,
    })
    return true
  }

  private resolvePending(s: RawSample, force = false): boolean {
    const p = this.pending
    if (!p) return false
    const fresh = s.lastLapS !== null && (p.lastBefore === null || Math.abs(s.lastLapS - p.lastBefore) > 1e-4)
    if (!fresh && s.clockS < p.deadline && !force) return false
    this.pending = null

    const official = fresh && s.lastLapS !== null && Math.abs(s.lastLapS - p.measuredS) < OFFICIAL_TOLERANCE_S ? s.lastLapS : null
    const timeS = official ?? p.measuredS
    const o = p.open
    if (o.offStart !== null && s.clockS - o.offStart >= MIN_OFF_TRACK_S) o.offEvents.push(o.offPct)
    const { kind, reason } = classify(p)

    const used = o.startFuel !== null && p.endFuel !== null ? o.startFuel - p.endFuel : null
    const green = kind === 'valid' || kind === 'off_track'
    if (green && used !== null && used > 0) {
      this.fuelUsed.push(used)
      if (this.fuelUsed.length > FUEL_LAPS) this.fuelUsed.shift()
    }

    if (kind === 'valid' && timeS < this.refTimeS) {
      const ref = buildReference(o.pcts, o.times, timeS)
      if (ref) {
        this.ref = ref
        this.refTimeS = timeS
      }
    }

    this.spans.push({ start: o.startIdx, end: p.endIdx, startClock: o.startClock, endClock: o.startClock + p.measuredS })
    this.laps.push({ lap: o.lap, timeS, kind, reason, fuelUsedL: used !== null && used > 0 ? used : null, best: false })
    let best: LapRecord | null = null
    for (const l of this.laps) {
      l.best = false
      if (l.kind === 'valid' && (!best || l.timeS < best.timeS)) best = l
    }
    if (best) best.best = true
    return true
  }

  /** Delta contra la mejor vuelta válida seguida en vivo (s), o null. */
  delta(s: RawSample): number | null {
    if (!this.ref || !this.open || this.open.partial) return null
    // Justo al cruzar la meta la posición y el tiempo no siempre se reinician juntos
    if (s.lapTimeS < 3 && s.lapPct > 0.5) return null
    return s.lapTimeS - lapTimeAt(this.ref, s.lapPct)
  }

  bestLapS(): number | null {
    return Number.isFinite(this.refTimeS) ? this.refTimeS : null
  }

  fuelPerLap(): number | null {
    if (!this.fuelUsed.length) return null
    return this.fuelUsed.reduce((a, b) => a + b, 0) / this.fuelUsed.length
  }
}
