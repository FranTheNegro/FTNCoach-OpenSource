/**
 * Análisis de una sesión: todas las vueltas sobre una misma grilla de distancia
 * (así se comparan punto a punto), sectores, mejor vuelta teórica,
 * consistencia, curvas detectadas en la vuelta de referencia y cómo pasó cada
 * vuelta por cada curva.
 */
import type {
  CompareResult,
  Corner,
  CornerPass,
  Insight,
  LapCar,
  LapInfo,
  LapTrace,
  SessionDetail,
  TrackGeometry,
} from '@shared/analysis'
import { SIM_LABEL, type Quad } from '@shared/live'
import { stintsOf } from '@shared/stints'
import type { LoadedSession } from './session'
import { styleSample } from './style'
import type { SessionMap } from './track-map'

/** Canales de una vuelta sobre la grilla (NaN donde la vuelta no pasó). */
export interface GridLap {
  t: Float64Array
  speed: Float32Array
  throttle: Float32Array
  brake: Float32Array
  steer: Float32Array
  gear: Float32Array
  rpm: Float32Array
  gLat: Float32Array
  gLon: Float32Array
  off: Uint8Array
  /** 1 = rueda bloqueada, 2 = patinando; null si la telemetría no trae las ruedas. */
  slip: Uint8Array | null
  x: Float32Array | null
  y: Float32Array | null
  complete: boolean
}

export interface Prepared {
  s: LoadedSession
  L: number
  N: number
  step: number
  laps: GridLap[]
  detail: SessionDetail
  /** Tramo de cada curva sobre la grilla (para medir vueltas externas). */
  segs: CornerSeg[]
  mapper: SessionMap['mapper']
}

interface CornerSeg {
  a: number
  apex: number
  b: number
  prevApex: number
}

const BRAKE_ON = 0.15
const FULL_THROTTLE = 0.95
/** Por debajo de esto, el pedal se considera suelto. */
const COAST_PEDAL = 0.05

// ── Remuestreo ──────────────────────────────────────────────────────────────

export function resampleLap(s: Pick<LoadedSession, 'spans' | 'ch' | 'laps'>, i: number, N: number, mapper: SessionMap['mapper']): GridLap {
  const { start, end, startClock, endClock, cut } = s.spans[i]
  const ch = s.ch
  const total = ch.clock.length
  const last = Math.min(end, total - 1)
  const count = last - start + 1
  const measured = endClock - startClock
  const k = measured > 0 ? s.laps[i].timeS / measured : 1

  // Posición en la vuelta, monótona: al cruzar la meta la posición y el contador
  // no siempre cambian juntos
  const p = new Float64Array(count)
  const t = new Float64Array(count)
  let run = 0
  for (let j = 0; j < count; j++) {
    const idx = start + j
    let v = ch.pct[idx]
    if (j < count * 0.2 && v > 0.9) v = 0
    if (!cut && j > count * 0.8 && v < 0.1) v = 1
    if (!cut && idx === end) v = 1
    // La primera muestra llega apenas pasada la meta: es el inicio de la vuelta
    if (j === 0 && v < 0.02) v = 0
    run = Math.max(run, v)
    p[j] = run
    t[j] = (ch.clock[idx] - startClock) * k
  }
  const px = mapper && ch.posA && ch.posB ? new Float64Array(count) : null
  const py = px ? new Float64Array(count) : null
  if (mapper && px && py && ch.posA && ch.posB) {
    for (let j = 0; j < count; j++) {
      const a = ch.posA[start + j]
      const b = ch.posB[start + j]
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const [x, y] = mapper(a, b)
        px[j] = x
        py[j] = y
      } else {
        px[j] = NaN
        py[j] = NaN
      }
    }
  }

  const out: GridLap = {
    t: new Float64Array(N + 1),
    speed: new Float32Array(N + 1),
    throttle: new Float32Array(N + 1),
    brake: new Float32Array(N + 1),
    steer: new Float32Array(N + 1),
    gear: new Float32Array(N + 1),
    rpm: new Float32Array(N + 1),
    gLat: new Float32Array(N + 1),
    gLon: new Float32Array(N + 1),
    off: new Uint8Array(N + 1),
    slip: ch.slip && ch.slip.some((v) => v > 0) ? new Uint8Array(N + 1) : null,
    x: px ? new Float32Array(N + 1) : null,
    y: py ? new Float32Array(N + 1) : null,
    complete: p[0] <= 0.02 && p[count - 1] >= 0.98,
  }
  let j = 0
  for (let g = 0; g <= N; g++) {
    const target = g / N
    if (count < 2 || target < p[0] - 1e-6 || target > p[count - 1] + 1e-6) {
      for (const c of [out.t, out.speed, out.throttle, out.brake, out.steer, out.gear, out.rpm, out.gLat, out.gLon]) c[g] = NaN
      if (out.x && out.y) {
        out.x[g] = NaN
        out.y[g] = NaN
      }
      continue
    }
    while (j < count - 2 && p[j + 1] < target) j++
    const a = start + j
    const span = p[j + 1] - p[j]
    const f = span > 0 ? Math.min(1, Math.max(0, (target - p[j]) / span)) : 1
    const lerp = (arr: ArrayLike<number>) => arr[a] + (arr[a + 1] - arr[a]) * f
    out.t[g] = t[j] + (t[j + 1] - t[j]) * f
    out.speed[g] = lerp(ch.speed)
    out.throttle[g] = lerp(ch.throttle)
    out.brake[g] = lerp(ch.brake)
    out.steer[g] = lerp(ch.steer)
    out.gear[g] = f < 0.5 ? ch.gear[a] : ch.gear[a + 1]
    out.rpm[g] = lerp(ch.rpm)
    out.gLat[g] = lerp(ch.gLat)
    out.gLon[g] = lerp(ch.gLon)
    out.off[g] = ch.off[a] || ch.off[a + 1] ? 1 : 0
    if (out.slip && ch.slip) out.slip[g] = ch.slip[a] || ch.slip[a + 1]
    if (out.x && out.y && px && py) {
      out.x[g] = px[j] + (px[j + 1] - px[j]) * f
      out.y[g] = py[j] + (py[j + 1] - py[j]) * f
    }
  }
  return out
}

/** Tiempo en una posición fraccionaria de la grilla. */
function timeAt(lap: GridLap, pos: number): number {
  const i = Math.floor(pos)
  if (i >= lap.t.length - 1) return lap.t[lap.t.length - 1]
  return lap.t[i] + (lap.t[i + 1] - lap.t[i]) * (pos - i)
}

// ── Curvas ──────────────────────────────────────────────────────────────────

function smooth(v: ArrayLike<number>, half: number): Float64Array {
  const n = v.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    let c = 0
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++)
      if (Number.isFinite(v[k])) {
        acc += v[k]
        c++
      }
    out[i] = c ? acc / c : NaN
  }
  return out
}

function valleys(v: Float64Array, minProminence: number, minGap: number): number[] {
  const n = v.length
  const found: { i: number; prom: number }[] = []
  for (let i = 1; i < n - 1; i++) {
    if (!(v[i] <= v[i - 1] && v[i] < v[i + 1])) continue
    let lMax = v[i]
    for (let k = i - 1; k >= 0 && v[k] >= v[i]; k--) lMax = Math.max(lMax, v[k])
    let rMax = v[i]
    for (let k = i + 1; k < n && v[k] >= v[i]; k++) rMax = Math.max(rMax, v[k])
    const prom = Math.min(lMax, rMax) - v[i]
    if (prom >= minProminence) found.push({ i, prom })
  }
  // Dos mínimos muy cerca son la misma curva: queda el más bajo
  const kept: { i: number; prom: number }[] = []
  for (const f of found) {
    const prev = kept[kept.length - 1]
    if (prev && f.i - prev.i < minGap) {
      if (v[f.i] < v[prev.i]) kept[kept.length - 1] = f
    } else kept.push(f)
  }
  return kept.map((f) => f.i)
}

function detectCorners(ref: GridLap, step: number): number[] {
  const v = smooth(ref.speed, Math.max(1, Math.round(8 / step)))
  const n = v.length
  const margin = Math.round(n * 0.01)
  let found: number[] = []
  // Un tramo o un circuito muy largo tiene más curvas que uno normal
  const maxCorners = Math.max(25, Math.round((n * step) / 300))
  for (let prom = 4; prom < 80; prom += 4) {
    found = valleys(v, prom, Math.round(40 / step)).filter((i) => i > margin && i < n - 1 - margin)
    if (found.length <= maxCorners) break
  }
  // Una curva de verdad: se frena antes o hay G lateral en el vértice
  const back = Math.round(300 / step)
  const near = Math.round(60 / step)
  return found.filter((i) => {
    for (let k = Math.max(0, i - back); k <= i; k++) if (ref.brake[k] > 0.1) return true
    for (let k = Math.max(0, i - near); k <= Math.min(n - 1, i + near); k++) if (Math.abs(ref.gLat[k]) > 0.6) return true
    return false
  })
}

function argmax(v: ArrayLike<number>, a: number, b: number): number {
  let best = a
  for (let k = a; k <= b; k++) if (v[k] > v[best] || !Number.isFinite(v[best])) best = k
  return best
}

function cornerPass(lap: GridLap, c: CornerSeg, step: number): CornerPass | null {
  const { a, apex, b } = c
  if (!Number.isFinite(lap.t[a]) || !Number.isFinite(lap.t[b])) return null
  const w = Math.round(100 / step)
  let minIdx = Math.max(a, apex - w)
  for (let k = Math.max(a, apex - w); k <= Math.min(b, apex + w); k++) if (lap.speed[k] < lap.speed[minIdx]) minIdx = k
  let entry = 0
  for (let k = a; k <= minIdx; k++) entry = Math.max(entry, lap.speed[k])
  const exitIdx = Math.min(b, minIdx + Math.round(100 / step))
  // Comienzo de la frenada que lleva a esta curva (puede ser antes que en la referencia)
  const from = Math.max(c.prevApex, a - Math.round(150 / step))
  let brakeIdx: number | null = null
  for (let k = minIdx; k > from; k--) {
    if (lap.brake[k] >= BRAKE_ON && lap.brake[k - 1] < BRAKE_ON) {
      brakeIdx = k
      break
    }
  }
  if (brakeIdx === null && lap.brake[from] >= BRAKE_ON) brakeIdx = from
  // Turn-in: el volante pasa un tercio del máximo entre el inicio de la curva y la mínima
  const from2 = brakeIdx ?? a
  let peak = 0
  for (let k = from2; k <= minIdx; k++) peak = Math.max(peak, Math.abs(lap.steer[k]))
  let turnIdx: number | null = null
  if (peak > 0.02)
    for (let k = from2; k <= minIdx; k++)
      if (Math.abs(lap.steer[k]) >= peak / 3) {
        turnIdx = k
        break
      }
  let throttleIdx: number | null = null
  for (let k = minIdx; k <= b; k++)
    if (lap.throttle[k] >= FULL_THROTTLE) {
      throttleIdx = k
      break
    }
  let off = false
  for (let k = a; k <= b; k++) if (lap.off[k]) off = true
  let brakePeak = 0
  if (brakeIdx !== null) for (let k = brakeIdx; k <= minIdx; k++) brakePeak = Math.max(brakePeak, lap.brake[k])
  let coastS = 0
  for (let k = brakeIdx ?? a; k < (throttleIdx ?? b); k++)
    if (lap.brake[k] < COAST_PEDAL && lap.throttle[k] < COAST_PEDAL && Number.isFinite(lap.t[k + 1])) coastS += lap.t[k + 1] - lap.t[k]
  const slipTime = (from: number, to: number, kind: number) => {
    if (!lap.slip) return null
    let s = 0
    for (let k = from; k < to; k++) if (lap.slip[k] === kind && Number.isFinite(lap.t[k + 1])) s += lap.t[k + 1] - lap.t[k]
    return s
  }
  return {
    timeS: lap.t[b] - lap.t[a],
    entryKmh: entry,
    minKmh: lap.speed[minIdx],
    exitKmh: lap.speed[exitIdx],
    brakeM: brakeIdx !== null ? brakeIdx * step : null,
    fullThrottleM: throttleIdx !== null ? throttleIdx * step : null,
    minM: minIdx * step,
    turnInM: turnIdx !== null ? turnIdx * step : null,
    gear: Number.isFinite(lap.gear[minIdx]) ? lap.gear[minIdx] : null,
    brakePeak: brakeIdx !== null ? brakePeak : null,
    coastS,
    trailBraking: turnIdx !== null ? lap.brake[turnIdx] >= BRAKE_ON : null,
    lockupS: slipTime(brakeIdx ?? a, minIdx, 1),
    spinS: slipTime(minIdx, b, 2),
    offTrack: off,
  }
}

/** Nombres oficiales: el número de curva y el nombre más cercanos al vértice. */
function nameCorners(corners: Corner[], ref: GridLap, apexIdx: number[], map: TrackGeometry | null, sections: { name: string; inPct: number; outPct: number }[]): void {
  const used = new Map<string, number>()
  corners.forEach((c, k) => {
    if (map?.source === 'iracing' && ref.x && ref.y) {
      const x = ref.x[apexIdx[k]]
      const y = ref.y[apexIdx[k]]
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const near = (pred: (l: TrackGeometry['labels'][number]) => boolean, max: number) =>
          map.labels
            .filter(pred)
            .map((l) => ({ l, d: Math.hypot(l.x - x, l.y - y) }))
            .filter((o) => o.d < max)
            .sort((p, q) => p.d - q.d)[0]?.l
        const num = near((l) => l.turn !== null, 140)
        const named = near((l) => l.turn === null, 160)
        if (num) c.label = `T${num.text}`
        if (named) c.name = named.text
      }
    } else if (sections.length) {
      const s = sections.find((x) => c.apexPct >= x.inPct - 0.005 && c.apexPct <= x.outPct + 0.005)
      if (s) c.name = s.name
    }
    // Dos vértices en la misma curva oficial (chicanas): T4, T4b
    const n = used.get(c.label) ?? 0
    used.set(c.label, n + 1)
    if (n) c.label = `${c.label}${String.fromCharCode(97 + n)}`
  })
}

// ── Sesión ──────────────────────────────────────────────────────────────────

export function analyzeSession(
  s: LoadedSession,
  sm: SessionMap,
  sections: { name: string; inPct: number; outPct: number }[] = [],
): Prepared {
  // Largo: el oficial, o la distancia recorrida en la vuelta más rápida
  let L = s.summary.trackLengthM ?? 0
  if (!L) {
    const fastest = s.laps.map((l, i) => ({ l, i })).sort((a, b) => a.l.timeS - b.l.timeS)[0]
    if (fastest) {
      const { start, end } = s.spans[fastest.i]
      for (let k = start; k < end - 1; k++) L += (s.ch.speed[k] / 3.6) * (s.ch.clock[k + 1] - s.ch.clock[k])
    }
    L = L || 1000
  }
  const N = Math.max(400, Math.min(8000, Math.round(L / 2)))
  const step = L / N
  const laps = s.laps.map((_, i) => resampleLap(s, i, N, sm.mapper))

  const sectorsPct = s.sectorsPct && s.sectorsPct.length > 1 ? s.sectorsPct : [0, 1 / 3, 2 / 3]
  const bounds = [...sectorsPct, 1]
  const valid = s.laps.map((l, i) => (l.kind === 'valid' && laps[i].complete ? i : -1)).filter((i) => i >= 0)
  const bestIndex = valid.length ? valid.reduce((a, b) => (s.laps[b].timeS < s.laps[a].timeS ? b : a)) : null
  const bestS = bestIndex !== null ? s.laps[bestIndex].timeS : null

  const lapInfos: LapInfo[] = s.laps.map((l, i) => {
    const g = laps[i]
    const sectorsS = sectorsPct.map((p0, k) => {
      const t0 = timeAt(g, p0 * N)
      const t1 = timeAt(g, bounds[k + 1] * N)
      return Number.isFinite(t0) && Number.isFinite(t1) ? t1 - t0 : null
    })
    let vmax = 0
    for (let k = s.spans[i].start; k < s.spans[i].end; k++) vmax = Math.max(vmax, s.ch.speed[k])
    return {
      index: i,
      lap: l.lap,
      timeS: l.timeS,
      startS: s.spans[i].startClock - s.ch.clock[0],
      kind: l.kind,
      reason: l.reason,
      fuelUsedL: l.fuelUsedL,
      sectorsS,
      // Una vuelta cortada no tiene tiempo comparable
      gapS: bestS !== null && g.complete ? l.timeS - bestS : null,
      complete: g.complete,
      session: s.lapSessions?.[i] ?? null,
      maxSpeedKmh: vmax,
      car: s.carLaps?.[i] ?? null,
    }
  })

  let theoreticalS: number | null = null
  if (valid.length) {
    const best = sectorsPct.map((_, k) => Math.min(...valid.map((i) => lapInfos[i].sectorsS[k] ?? Infinity)))
    if (best.every(Number.isFinite)) theoreticalS = best.reduce((a, b) => a + b, 0)
  }
  let consistencyS: number | null = null
  if (bestS !== null) {
    const times = valid.map((i) => s.laps[i].timeS).filter((t) => t <= bestS * 1.07)
    if (times.length >= 3) {
      const mean = times.reduce((a, b) => a + b, 0) / times.length
      consistencyS = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / (times.length - 1))
    }
  }

  // Curvas en la vuelta de referencia (la mejor válida, o la completa más rápida)
  const refIndex =
    bestIndex ??
    laps
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.complete)
      .sort((a, b) => s.laps[a.i].timeS - s.laps[b.i].timeS)[0]?.i ??
    null
  const corners: Corner[] = []
  const segs: CornerSeg[] = []
  if (refIndex !== null) {
    const ref = laps[refIndex]
    const apexes = detectCorners(ref, step)
    const starts = apexes.map((apex, k) => argmax(ref.speed, k ? apexes[k - 1] : 0, apex))
    apexes.forEach((apex, k) => {
      const a = starts[k]
      const b = k + 1 < apexes.length ? starts[k + 1] : N
      segs.push({ a, apex, b, prevApex: k ? apexes[k - 1] : 0 })
      // En rally no hay números de curva: se ubican por el kilómetro del tramo
      const label = s.summary.sim === 'acr' ? `km ${((apex * step) / 1000).toFixed(1).replace('.', ',')}` : `T${k + 1}`
      corners.push({ id: k + 1, label, name: null, startPct: a / N, apexPct: apex / N, endPct: b / N })
    })
    nameCorners(corners, ref, apexes, sm.result.map, sections)
  }
  const passes = laps.map((g) => segs.map((c) => cornerPass(g, c, step)))

  const detail: SessionDetail = {
    summary: s.summary,
    trackLengthM: L,
    distM: Array.from({ length: N + 1 }, (_, k) => Math.round(k * step * 10) / 10),
    sectorsPct,
    laps: lapInfos,
    bestIndex,
    theoreticalS,
    consistencyS,
    corners,
    passes,
    map: sm.result,
    setup: s.setup,
    conditions: s.conditions,
    style: styleSample(laps, valid, segs, bestS, consistencyS),
  }
  return { s, L, N, step, laps, detail, segs, mapper: sm.mapper }
}

// ── Comparación ─────────────────────────────────────────────────────────────

const round = (v: ArrayLike<number>, d: number): number[] => {
  const k = 10 ** d
  return Array.from(v, (x) => (Number.isFinite(x) ? Math.round(x * k) / k : NaN))
}

export function lapTrace(p: Prepared, i: number): LapTrace {
  return gridTrace(p.laps[i], i)
}

function gridTrace(g: GridLap, index: number): LapTrace {
  return {
    index,
    timeS: round(g.t, 3),
    speed: round(g.speed, 1),
    throttle: round(g.throttle, 3),
    brake: round(g.brake, 3),
    steer: round(g.steer, 3),
    gear: round(g.gear, 0),
    rpm: round(g.rpm, 0),
    gLat: round(g.gLat, 2),
    gLon: round(g.gLon, 2),
    off: Array.from(g.off),
    x: g.x ? round(g.x, 2) : null,
    y: g.y ? round(g.y, 2) : null,
  }
}

const fmt = (v: number, d = 0) => v.toFixed(d).replace('.', ',')

/** Qué cambia en una curva entre la vuelta A y la referencia B, en una frase accionable. */
export function cornerInsight(corner: Corner, a: CornerPass, b: CornerPass, ref: string): Insight {
  const title = corner.name ? `${corner.label} · ${corner.name.toUpperCase()}` : corner.label
  const lossS = a.timeS - b.timeS
  const facts: { phase: string; weight: number; text: string; fix: string }[] = []
  if (a.offTrack && !b.offTrack)
    facts.push({ phase: 'SALIDA DE PISTA', weight: 99, text: 'Te fuiste de pista en esta curva.', fix: 'Esa pérdida no es de técnica: no la persigas.' })
  if (a.brakeM !== null && b.brakeM !== null && b.brakeM - a.brakeM > 6)
    facts.push({
      phase: 'FRENADA',
      weight: (b.brakeM - a.brakeM) / 5,
      text: `Frenás ${fmt(b.brakeM - a.brakeM)} m antes que en ${ref}.`,
      fix: 'Retrasá la referencia de a 5 m por vuelta.',
    })
  if (a.brakeM !== null && b.brakeM !== null && a.brakeM - b.brakeM > 6 && a.minKmh < b.minKmh - 2)
    facts.push({
      phase: 'FRENADA',
      weight: (a.brakeM - b.brakeM) / 5,
      text: `Frenás ${fmt(a.brakeM - b.brakeM)} m más tarde y la mínima cae ${fmt(b.minKmh - a.minKmh)} km/h.`,
      fix: `Frená en la referencia de ${ref} y llevá más velocidad al vértice.`,
    })
  if (b.minKmh - a.minKmh > 2)
    facts.push({
      phase: 'VÉRTICE',
      weight: (b.minKmh - a.minKmh) / 2,
      text: `Mínima ${fmt(b.minKmh - a.minKmh)} km/h más baja (${fmt(a.minKmh)} contra ${fmt(b.minKmh)}).`,
      fix: 'Soltá el freno más progresivo hacia el vértice.',
    })
  if (a.fullThrottleM !== null && b.fullThrottleM !== null && a.fullThrottleM - b.fullThrottleM > 12)
    facts.push({
      phase: 'SALIDA',
      weight: (a.fullThrottleM - b.fullThrottleM) / 10,
      text: `Acelerás a fondo ${fmt(a.fullThrottleM - b.fullThrottleM)} m más tarde.`,
      fix: 'Enderezá el auto antes y pisá a fondo antes.',
    })
  else if (b.exitKmh - a.exitKmh > 3)
    facts.push({
      phase: 'SALIDA',
      weight: (b.exitKmh - a.exitKmh) / 3,
      text: `Salís ${fmt(b.exitKmh - a.exitKmh)} km/h más lento.`,
      fix: 'Priorizá la salida: vértice un poco más tarde.',
    })
  if (b.entryKmh - a.entryKmh > 3)
    facts.push({
      phase: 'ENTRADA',
      weight: (b.entryKmh - a.entryKmh) / 4,
      text: `Llegás a la frenada ${fmt(b.entryKmh - a.entryKmh)} km/h más lento: viene de la curva anterior.`,
      fix: 'Mirá la salida de la curva anterior.',
    })
  facts.sort((x, y) => y.weight - x.weight)
  const main = facts[0]
  const text = main
    ? [main.text, facts[1] && facts[1].phase !== main.phase ? facts[1].text : null, main.fix].filter(Boolean).join(' ')
    : 'Mismas referencias que la mejor vuelta: la diferencia es chica y repartida.'
  return { cornerId: corner.id, title: main ? `${title} · ${main.phase}` : title, lossS, text }
}

export function compareLaps(p: Prepared, ia: number, ib: number): CompareResult {
  const ref = `la V${p.s.laps[ib].lap}`
  return compareGrid(p, ia, p.laps[ib], ib, p.detail.passes[ib], ref)
}

/** Vuelta A de la sesión contra una vuelta externa ya llevada a la grilla (p. ej. una vuelta de otra sesión). */
export function compareExternal(p: Prepared, ia: number, B: GridLap, label: string): CompareResult {
  const passes = p.segs.map((c) => cornerPass(B, c, p.step))
  return compareGrid(p, ia, B, -1, passes, label)
}

function compareGrid(p: Prepared, ia: number, B: GridLap, ib: number, passesB: (CornerPass | null)[], refLabel: string): CompareResult {
  const A = p.laps[ia]
  const delta = Array.from(A.t, (t, k) => {
    const d = t - B.t[k]
    return Number.isFinite(d) ? Math.round(d * 1000) / 1000 : NaN
  })
  const { corners, passes } = p.detail
  const insights = corners
    .map((c, k) => {
      const a = passes[ia][k]
      const b = passesB[k]
      return a && b ? cornerInsight(c, a, b, refLabel) : null
    })
    .filter((x): x is Insight => x !== null && x.lossS > 0.02)
    .sort((x, y) => y.lossS - x.lossS)
    .slice(0, 3)
  return { a: lapTrace(p, ia), b: gridTrace(B, ib), refLabel, delta, insights, passesA: passes[ia], passesB }
}

// ── Datos para el coach ─────────────────────────────────────────────────────

/** Largo típico de un auto: para contar las distancias de una forma que se pueda imaginar. */
const CAR_LENGTH_M = 4.5
/** Diferencias más chicas que esto no se notan al manejar (la grilla ya mide de a ~2 m). */
const MIN_POINT_DIFF_M = 6
const MIN_SPEED_DIFF_KMH = 2
/** Lo mínimo para contar un bloqueo o una patinada (un piano da picos más cortos). */
const MIN_LOCKUP_S = 0.1
const MIN_SPIN_S = 0.2
/** Una vuelta más lenta que esto contra la mejor no cuenta para el ritmo (tráfico, error). */
const PACE_WINDOW = 1.07

const r = (v: number | null | undefined, k = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** k) / 10 ** k)

function median(xs: (number | null | undefined)[]): number | null {
  const a = xs.filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/** Una distancia dicha de tres formas: el coach elige según lo que prefiera el piloto. */
function distanceDiff(diffM: number, speedKmh: number | null) {
  const m = Math.abs(diffM)
  return {
    metres: r(m, 0),
    car_lengths: r(m / CAR_LENGTH_M, 1),
    seconds: speedKmh && speedKmh > 1 ? r(m / (speedKmh / 3.6), 2) : null,
  }
}

/** Qué hace en una vuelta normal contra su mejor pasada, y en cuántas vueltas se ve. */
function cornerPattern(clean: CornerPass[], best: CornerPass) {
  const n = clean.length
  const count = (f: (p: CornerPass) => boolean) => clean.filter(f).length
  const pattern: Record<string, unknown> = {}

  const brakeDiff = best.brakeM === null ? null : median(clean.map((p) => (p.brakeM === null ? null : p.brakeM - best.brakeM!)))
  if (brakeDiff !== null && Math.abs(brakeDiff) >= MIN_POINT_DIFF_M) {
    const earlier = brakeDiff < 0
    pattern.braking = {
      compared_to_best: earlier ? 'earlier' : 'later',
      ...distanceDiff(brakeDiff, best.entryKmh),
      laps: count((p) => p.brakeM !== null && (earlier ? best.brakeM! - p.brakeM : p.brakeM - best.brakeM!) >= MIN_POINT_DIFF_M),
      of_laps: n,
    }
  }
  const minDiff = median(clean.map((p) => p.minKmh - best.minKmh))
  if (minDiff !== null && Math.abs(minDiff) >= MIN_SPEED_DIFF_KMH) pattern.middle_speed_kmh_vs_best = r(minDiff, 0)
  const exitDiff = median(clean.map((p) => p.exitKmh - best.exitKmh))
  if (exitDiff !== null && Math.abs(exitDiff) >= MIN_SPEED_DIFF_KMH) pattern.exit_speed_kmh_vs_best = r(exitDiff, 0)
  const entryDiff = median(clean.map((p) => p.entryKmh - best.entryKmh))
  if (entryDiff !== null && Math.abs(entryDiff) >= MIN_SPEED_DIFF_KMH) pattern.arrival_speed_kmh_vs_best = r(entryDiff, 0)

  const gasDiff = best.fullThrottleM === null ? null : median(clean.map((p) => (p.fullThrottleM === null ? null : p.fullThrottleM - best.fullThrottleM!)))
  if (gasDiff !== null && Math.abs(gasDiff) >= MIN_POINT_DIFF_M) {
    const later = gasDiff > 0
    pattern.full_throttle = {
      compared_to_best: later ? 'later' : 'earlier',
      ...distanceDiff(gasDiff, best.exitKmh),
      laps: count((p) => p.fullThrottleM !== null && (later ? p.fullThrottleM - best.fullThrottleM! : best.fullThrottleM! - p.fullThrottleM) >= MIN_POINT_DIFF_M),
      of_laps: n,
    }
  }
  const gear = median(clean.map((p) => p.gear))
  if (gear !== null && best.gear !== null && best.gear !== undefined && gear !== best.gear) pattern.gear_in_corner = { usual: gear, in_best_pass: best.gear }
  const coast = median(clean.map((p) => p.coastS))
  if (coast !== null && best.coastS !== null && best.coastS !== undefined && Math.abs(coast - best.coastS) >= 0.1)
    pattern.seconds_without_pedals = { usual: r(coast, 1), in_best_pass: r(best.coastS, 1) }
  const peak = median(clean.map((p) => p.brakePeak))
  if (peak !== null && best.brakePeak !== null && best.brakePeak !== undefined && Math.abs(peak - best.brakePeak) >= 0.08)
    pattern.brake_pressure_pct = { usual: r(peak * 100, 0), in_best_pass: r(best.brakePeak * 100, 0) }
  const trails = clean.filter((p) => p.trailBraking !== null && p.trailBraking !== undefined)
  if (trails.length && best.trailBraking !== null && best.trailBraking !== undefined) {
    const on = count((p) => p.trailBraking === true)
    if (best.trailBraking !== on / trails.length >= 0.5) pattern.still_braking_when_turning_in = { usual_laps: on, of_laps: trails.length, in_best_pass: best.trailBraking }
  }
  return pattern
}

const roundQuad = (q: readonly number[] | null | undefined, k = 0) => (q ? q.map((v) => r(v, k)) : null)

/** Gomas y frenos de un stint: cómo arrancó y cómo terminó, en lo que publica el sim. */
function stintTyres(clean: LapInfo[]) {
  const cars = clean.map((l) => l.car).filter((c): c is LapCar => !!c)
  if (!cars.length) return null
  const first = cars[0]
  const last = cars[cars.length - 1]
  const peak = cars.map((c) => c.brakePeakC).filter((q): q is Quad => !!q)
  return {
    order: 'front-left, front-right, rear-left, rear-right',
    temp_c_start: roundQuad(first.tyreC),
    temp_c_end: roundQuad(last.tyreC),
    inner_middle_outer_c_end: last.tyreZonesC ? last.tyreZonesC.map((z) => roundQuad(z)) : null,
    pressure_kpa_end: roundQuad(last.tyreKpa),
    wear_left_pct_end: last.tyreWear ? last.tyreWear.map((v) => r(v * 100, 0)) : null,
    brake_peak_c: peak.length ? [0, 1, 2, 3].map((k) => r(Math.max(...peak.map((q) => q[k])), 0)) : null,
  }
}

/** Lo que se repite en toda la sesión, sin depender de una vuelta en particular. */
function sessionStory(p: Prepared, valid: LapInfo[]) {
  const d = p.detail
  const bestS = d.bestIndex !== null ? d.laps[d.bestIndex].timeS : null
  const paced = bestS === null ? [] : valid.filter((l) => l.complete && l.timeS <= bestS * PACE_WINDOW)
  const typical = median(paced.map((l) => l.timeS))
  const half = paced.length >> 1
  const firstHalf = median(paced.slice(0, half).map((l) => l.timeS))
  const secondHalf = median(paced.slice(half).map((l) => l.timeS))
  const sectors = d.sectorsPct.map((_, k) => {
    const times = paced.map((l) => l.sectorsS[k]).filter((x): x is number => x !== null)
    const best = times.length ? Math.min(...times) : null
    const usual = median(times)
    return { sector: k + 1, best_s: r(best, 3), usual_s: r(usual, 3), usual_vs_best_s: best !== null && usual !== null ? r(usual - best, 3) : null }
  })
  return {
    total_laps: d.laps.length,
    clean_laps: valid.length,
    invalid_or_incomplete_laps: d.laps.length - valid.length,
    laps_with_off_track: d.laps.filter((_, i) => d.passes[i].some((x) => x?.offTrack)).length,
    best_lap_s: r(bestS, 3),
    best_came_on_lap_number: d.bestIndex !== null ? d.laps[d.bestIndex].lap : null,
    typical_lap_s: r(typical, 3),
    typical_vs_best_s: bestS !== null && typical !== null ? r(typical - bestS, 3) : null,
    best_sectors_together_s: r(d.theoreticalS, 3),
    gain_if_best_sectors_joined_s: bestS !== null && d.theoreticalS !== null ? r(bestS - d.theoreticalS, 3) : null,
    lap_to_lap_spread_s: r(d.consistencyS, 3),
    pace_second_half_vs_first_half_s: firstHalf !== null && secondHalf !== null && half >= 2 ? r(secondHalf - firstHalf, 3) : null,
    sectors,
    stints: stintsOf(d.laps).map((st) => ({
      stint: st.n,
      laps: st.laps.length,
      clean_laps: st.clean.length,
      best_s: r(st.bestS, 3),
      pace_s: r(st.avgS, 3),
      pace_change_per_lap_s: r(st.trendS, 3),
      fuel_per_lap_l: r(st.fuelPerLapL, 2),
      tyres: stintTyres(st.clean),
    })),
  }
}

const cornerKind = (minKmh: number) => (minKmh < 90 ? 'slow' : minKmh < 150 ? 'medium' : 'fast')

/** Resumen de la sesión completa para el LLM: solo números medidos, listos para contarlos sin jerga. */
export function coachData(p: Prepared): Record<string, unknown> {
  const d = p.detail
  const s = d.summary
  const valid = d.laps.filter((l) => l.kind === 'valid' && l.complete)
  const ref = d.bestIndex
  const refLap = ref ?? d.laps.filter((l) => l.complete).sort((a, b) => a.timeS - b.timeS)[0]?.index ?? null
  const steerAt = (k: number) => (refLap === null ? NaN : p.laps[refLap].steer[Math.round(d.corners[k].apexPct * p.N)])
  const nameOf = (k: number) => {
    const c = d.corners[k]
    return c ? (c.name ? `${c.label} ${c.name}` : c.label) : null
  }
  return {
    sim: SIM_LABEL[s.sim],
    car: s.car,
    track: s.track,
    track_length_m: Math.round(d.trackLengthM),
    session_type: s.sessionType,
    driver: s.driver,
    session: sessionStory(p, valid),
    laps: d.laps.map((l) => ({
      lap: l.lap,
      time_s: r(l.timeS, 3),
      kind: l.kind,
      note: l.reason,
      sectors_s: l.sectorsS.map((x) => r(x, 3)),
      fuel_l: r(l.fuelUsedL, 2),
      max_kmh: r(l.maxSpeedKmh, 0),
    })),
    best_lap: ref !== null ? d.laps[ref].lap : null,
    best_lap_s: ref !== null ? r(d.laps[ref].timeS, 3) : null,
    theoretical_best_s: r(d.theoreticalS, 3),
    consistency_sigma_s: r(d.consistencyS, 3),
    valid_laps: valid.length,
    corners: d.corners.map((c, k) => {
      const passes = valid.map((l) => d.passes[l.index][k]).filter((x): x is CornerPass => !!x)
      const clean = passes.filter((x) => !x.offTrack)
      const best = clean.length ? clean.reduce((a, b) => (b.timeS < a.timeS ? b : a)) : null
      const times = clean.map((x) => x.timeS)
      const usual = median(times)
      const mean = times.length ? times.reduce((a, t) => a + t, 0) / times.length : 0
      const pass = (x: CornerPass | null) =>
        x && {
          segment_time_s: r(x.timeS, 3),
          entry_kmh: r(x.entryKmh, 0),
          min_kmh: r(x.minKmh, 0),
          exit_kmh: r(x.exitKmh, 0),
          brake_point_m: r(x.brakeM, 0),
          full_throttle_m: r(x.fullThrottleM, 0),
          gear: r(x.gear, 0),
          off_track: x.offTrack,
        }
      const steer = steerAt(k)
      const prev = k ? d.corners[k - 1] : null
      return {
        corner_id: c.id,
        label: c.label,
        name: c.name,
        apex_pct: r(c.apexPct * 100, 1),
        how_to_recognise_it: {
          direction: Number.isFinite(steer) && Math.abs(steer) > 0.01 ? (steer > 0 ? 'right' : 'left') : null,
          kind: best ? cornerKind(best.minKmh) : null,
          comes_after: nameOf(k - 1),
          leads_to: nameOf(k + 1),
          // Del vértice anterior hasta el inicio de esta curva, que es donde termina la recta
          metres_from_previous_corner: prev ? r((c.startPct - prev.apexPct) * d.trackLengthM, 0) : null,
          sector: d.sectorsPct.reduce((acc, start, i) => (c.apexPct >= start ? i + 1 : acc), 1),
        },
        clean_laps: clean.length,
        off_track_laps: passes.length - clean.length,
        best_execution: pass(best),
        median_clean: clean.length
          ? {
              segment_time_s: r(usual, 3),
              min_kmh: r(median(clean.map((x) => x.minKmh)), 0),
            }
          : null,
        repeatable_gain_s: best && usual !== null ? r(usual - best.timeS, 3) : null,
        lockup_laps: clean.some((x) => x.lockupS !== null && x.lockupS !== undefined) ? clean.filter((x) => (x.lockupS ?? 0) >= MIN_LOCKUP_S).length : null,
        wheelspin_laps: clean.some((x) => x.spinS !== null && x.spinS !== undefined) ? clean.filter((x) => (x.spinS ?? 0) >= MIN_SPIN_S).length : null,
        lap_to_lap_spread_s: times.length >= 3 ? r(Math.sqrt(times.reduce((a, t) => a + (t - mean) ** 2, 0) / (times.length - 1)), 3) : null,
        usual_vs_best_pass: best ? cornerPattern(clean, best) : null,
      }
    }),
  }
}
