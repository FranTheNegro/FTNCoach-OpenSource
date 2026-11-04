/**
 * Cuentas del análisis entre vueltas y entre sesiones: stints, tiempos por curva,
 * el plan de práctica (qué curvas trabajar y si mejoraron) y las diferencias de setup.
 * Todo sale de datos medidos de las sesiones; nada se estima.
 */
import type { Corner, LapInfo, SessionDetail, SessionSummary, SetupGroup } from '@shared/analysis'
import { sameCorner } from '@shared/history'

// ── Stints ────────────────────────────────────────────────────────────────

export interface Stint {
  n: number
  laps: LapInfo[]
  /** Vueltas válidas y completas (las que cuentan para el ritmo). */
  clean: LapInfo[]
  bestS: number | null
  /** Ritmo: promedio de las vueltas válidas sin las que se escapan. */
  avgS: number | null
  /** Cuánto cambia el tiempo por vuelta a lo largo del stint (s/vuelta, positivo = cae el ritmo). */
  trendS: number | null
  fuelPerLapL: number | null
}

/** Un stint termina al entrar a boxes (o cuando una salida de boxes abre uno nuevo). */
export function stintsOf(laps: LapInfo[]): Stint[] {
  const groups: LapInfo[][] = []
  let cur: LapInfo[] = []
  for (const l of laps) {
    if (l.kind === 'out_lap' && cur.length) {
      groups.push(cur)
      cur = []
    }
    cur.push(l)
    if (l.kind === 'in_lap') {
      groups.push(cur)
      cur = []
    }
  }
  if (cur.length) groups.push(cur)
  return groups.map((g, i) => {
    const clean = g.filter((l) => l.kind === 'valid' && l.complete)
    const times = clean.map((l) => l.timeS)
    const fuel = clean.map((l) => l.fuelUsedL).filter((x): x is number => x !== null && x > 0)
    return {
      n: i + 1,
      laps: g,
      clean,
      bestS: times.length ? Math.min(...times) : null,
      avgS: pace(times),
      trendS: slope(clean.map((l) => l.lap), times),
      fuelPerLapL: fuel.length ? fuel.reduce((a, b) => a + b, 0) / fuel.length : null,
    }
  })
}

/** Promedio sin las vueltas que se escapan mucho (tráfico, error). */
function pace(y: number[]): number | null {
  if (!y.length) return null
  const sorted = y.slice().sort((a, b) => a - b)
  const med = sorted[sorted.length >> 1]
  const keep = y.filter((v) => Math.abs(v - med) < Math.max(1, med * 0.015))
  return keep.reduce((a, b) => a + b, 0) / keep.length
}

/** Pendiente de mínimos cuadrados, sin las vueltas que se escapan mucho (tráfico, error). */
function slope(x: number[], y: number[]): number | null {
  if (y.length < 4) return null
  const sorted = y.slice().sort((a, b) => a - b)
  const med = sorted[sorted.length >> 1]
  const keep = y.map((v, i) => [x[i], v] as const).filter(([, v]) => Math.abs(v - med) < Math.max(1, med * 0.015))
  if (keep.length < 4) return null
  const mx = keep.reduce((a, [v]) => a + v, 0) / keep.length
  const my = keep.reduce((a, [, v]) => a + v, 0) / keep.length
  let num = 0
  let den = 0
  for (const [a, b] of keep) {
    num += (a - mx) * (b - my)
    den += (a - mx) ** 2
  }
  return den > 0 ? num / den : null
}

// ── Tiempos por curva ──────────────────────────────────────────────────────

export interface CornerStat {
  corner: Corner
  bestS: number
  medianS: number
  laps: number
}

/** Mejor y mediana de cada curva en las vueltas válidas y completas. */
export function cornerStats(d: SessionDetail): CornerStat[] {
  const valid = d.laps.filter((l) => l.kind === 'valid' && l.complete).map((l) => l.index)
  return d.corners.flatMap((corner, k) => {
    const t = valid.map((i) => d.passes[i]?.[k]?.timeS).filter((x): x is number => x !== undefined && Number.isFinite(x))
    if (t.length < 2) return []
    const s = t.slice().sort((a, b) => a - b)
    return [{ corner, bestS: s[0], medianS: s[s.length >> 1], laps: t.length }]
  })
}

// ── Plan de práctica ───────────────────────────────────────────────────────

export interface PlanCorner {
  label: string
  name: string | null
  apexPct: number
  /** Mediana y mejor de la curva cuando se armó el plan. */
  medianS: number
  bestS: number
}

export interface PracticePlan {
  sessionId: string
  /** Cuándo se corrió la sesión del plan: se controla en las sesiones posteriores. */
  sessionStartedAt: number
  createdAt: number
  corners: PlanCorner[]
}

/** Mismo auto, pista y simulador (la clave del plan). */
export function comboKey(s: SessionSummary): string {
  return `${s.sim}|${s.trackId ?? s.track}|${s.carId ?? s.car}`
}

const PLAN_KEY = 'ftn.practicePlans'

function loadAll(): Record<string, PracticePlan> {
  try {
    return JSON.parse(localStorage.getItem(PLAN_KEY) ?? '{}') as Record<string, PracticePlan>
  } catch {
    return {}
  }
}

export function loadPlan(s: SessionSummary): PracticePlan | null {
  return loadAll()[comboKey(s)] ?? null
}

export function savePlan(s: SessionSummary, plan: PracticePlan | null): void {
  const all = loadAll()
  if (plan) all[comboKey(s)] = plan
  else delete all[comboKey(s)]
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(all))
  } catch {
    // Sin almacenamiento el plan dura hasta cerrar la app
  }
}

/**
 * Las 3 curvas con más para ganar: la distancia entre lo que hacés casi siempre
 * (la mediana) y lo que ya hiciste (tu mejor pasada).
 */
export function buildPlan(d: SessionDetail): PracticePlan | null {
  const top = cornerStats(d)
    .filter((c) => c.laps >= 3)
    .sort((a, b) => b.medianS - b.bestS - (a.medianS - a.bestS))
    .slice(0, 3)
  if (!top.length) return null
  return {
    sessionId: d.summary.id,
    sessionStartedAt: d.summary.startedAt,
    createdAt: Date.now(),
    corners: top.map((c) => ({ label: c.corner.label, name: c.corner.name, apexPct: c.corner.apexPct, medianS: c.medianS, bestS: c.bestS })),
  }
}

export interface PlanCheck {
  plan: PlanCorner
  /** La misma curva en esta sesión (null si no se encontró o no hubo vueltas válidas). */
  now: CornerStat | null
  /** Cuánto bajó la mediana (positivo = mejoraste). */
  gainS: number | null
}

export function checkPlan(plan: PracticePlan, d: SessionDetail): PlanCheck[] {
  const stats = cornerStats(d)
  return plan.corners.map((p) => {
    const now = stats.find((s) => sameCorner(p, s.corner)) ?? null
    return { plan: p, now, gainS: now ? p.medianS - now.medianS : null }
  })
}

// ── Setup ──────────────────────────────────────────────────────────────────

export interface SetupChange {
  where: string
  name: string
  before: string | null
  after: string | null
}

/** Valores que cambiaron entre dos setups (por sección, parte y nombre). */
export function setupDiff(before: SetupGroup[], after: SetupGroup[]): SetupChange[] {
  const flat = (g: SetupGroup[]) => {
    const m = new Map<string, { where: string; name: string; value: string }>()
    for (const grp of g) for (const p of grp.parts) for (const [k, v] of p.values) m.set(`${grp.name}|${p.name}|${k}`, { where: `${grp.name} · ${p.name}`, name: k, value: v })
    return m
  }
  const a = flat(before)
  const b = flat(after)
  const out: SetupChange[] = []
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key)
    const y = b.get(key)
    if (x?.value === y?.value) continue
    out.push({ where: (y ?? x)!.where, name: (y ?? x)!.name, before: x?.value ?? null, after: y?.value ?? null })
  }
  return out
}

export interface CornerChange {
  label: string
  name: string | null
  /** Cuánto bajó tu mejor pasada (positivo = mejoraste). */
  gainS: number
}

/** Cómo cambió cada curva entre dos sesiones (mejor pasada de cada una). */
export function cornerChanges(before: SessionDetail, after: SessionDetail): CornerChange[] {
  const a = cornerStats(before)
  return cornerStats(after).flatMap((s) => {
    const prev = a.find((x) => sameCorner(x.corner, s.corner))
    return prev ? [{ label: s.corner.label, name: s.corner.name, gainS: prev.bestS - s.bestS }] : []
  })
}
