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
  LapInfo,
  LapTrace,
  SessionDetail,
  TrackGeometry,
} from '@shared/analysis'
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
  for (let prom = 4; prom < 80; prom += 4) {
    found = valleys(v, prom, Math.round(40 / step)).filter((i) => i > margin && i < n - 1 - margin)
    if (found.length <= 25) break
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
  let throttleIdx: number | null = null
  for (let k = minIdx; k <= b; k++)
    if (lap.throttle[k] >= FULL_THROTTLE) {
      throttleIdx = k
      break
    }
  let off = false
  for (let k = a; k <= b; k++) if (lap.off[k]) off = true
  return {
    timeS: lap.t[b] - lap.t[a],
    entryKmh: entry,
    minKmh: lap.speed[minIdx],
    exitKmh: lap.speed[exitIdx],
    brakeM: brakeIdx !== null ? brakeIdx * step : null,
    fullThrottleM: throttleIdx !== null ? throttleIdx * step : null,
    minM: minIdx * step,
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
      corners.push({ id: k + 1, label: `T${k + 1}`, name: null, startPct: a / N, apexPct: apex / N, endPct: b / N })
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
  return { a: lapTrace(p, ia), b: gridTrace(B, ib), refLabel, delta, insights }
}

// ── Datos para el coach ─────────────────────────────────────────────────────

/** Resumen compacto y con unidades para el LLM (solo números medidos). */
export function coachData(p: Prepared, focus: number | null): Record<string, unknown> {
  const d = p.detail
  const s = d.summary
  const valid = d.laps.filter((l) => l.kind === 'valid')
  const ref = d.bestIndex
  const lap = focus ?? ref
  const r1 = (v: number | null | undefined, k = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** k) / 10 ** k)
  const median = (xs: number[]) => {
    const a = xs.filter(Number.isFinite).sort((x, y) => x - y)
    return a.length ? a[a.length >> 1] : null
  }
  return {
    sim: s.sim === 'ac' ? 'Assetto Corsa' : 'iRacing',
    car: s.car,
    track: s.track,
    track_length_m: Math.round(d.trackLengthM),
    session_type: s.sessionType,
    driver: s.driver,
    laps: d.laps.map((l) => ({
      lap: l.lap,
      time_s: r1(l.timeS, 3),
      kind: l.kind,
      note: l.reason,
      sectors_s: l.sectorsS.map((x) => r1(x, 3)),
      fuel_l: r1(l.fuelUsedL, 2),
      max_kmh: r1(l.maxSpeedKmh, 0),
    })),
    best_lap: ref !== null ? d.laps[ref].lap : null,
    best_lap_s: ref !== null ? r1(d.laps[ref].timeS, 3) : null,
    theoretical_best_s: r1(d.theoreticalS, 3),
    consistency_sigma_s: r1(d.consistencyS, 3),
    valid_laps: valid.length,
    analyzed_lap: lap !== null ? d.laps[lap].lap : null,
    corners: d.corners.map((c, k) => {
      const clean = valid.map((l) => d.passes[l.index][k]).filter((x): x is CornerPass => !!x && !x.offTrack)
      const best = clean.length ? clean.reduce((a, b) => (b.timeS < a.timeS ? b : a)) : null
      const mine = lap !== null ? d.passes[lap][k] : null
      const pass = (x: CornerPass | null) =>
        x && {
          segment_time_s: r1(x.timeS, 3),
          entry_kmh: r1(x.entryKmh, 0),
          min_kmh: r1(x.minKmh, 0),
          exit_kmh: r1(x.exitKmh, 0),
          brake_point_m: r1(x.brakeM, 0),
          full_throttle_m: r1(x.fullThrottleM, 0),
          off_track: x.offTrack,
        }
      return {
        corner_id: c.id,
        label: c.label,
        name: c.name,
        apex_pct: r1(c.apexPct * 100, 1),
        best_execution: pass(best),
        analyzed_lap: pass(mine),
        median_clean: clean.length
          ? {
              segment_time_s: r1(median(clean.map((x) => x.timeS)), 3),
              min_kmh: r1(median(clean.map((x) => x.minKmh)), 0),
            }
          : null,
        loss_vs_best_s: mine && best ? r1(mine.timeS - best.timeS, 3) : null,
      }
    }),
  }
}
