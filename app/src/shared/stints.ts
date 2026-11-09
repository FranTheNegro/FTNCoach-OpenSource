/**
 * Stints de una sesión: los usan la pantalla de análisis y el coach.
 * Todo sale de vueltas medidas; nada se estima.
 */
import type { LapInfo } from './analysis'

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
