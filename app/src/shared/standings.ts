/**
 * Arma la clasificación a partir de lo que da cada sim por auto. El orden, el
 * intervalo y las vueltas de diferencia se calculan igual para iRacing y AC.
 */
import type { SimId, StandingCar, Standings } from './live'

export interface StandingInput {
  idx: number
  num: string | null
  name: string
  cls: string | null
  /** Posición oficial del sim (0 o null = todavía sin posición). */
  position: number | null
  laps: number
  lapPct: number | null
  /** En carrera: segundos detrás del líder según el sim (null si no lo da). */
  raceGapS: number | null
  bestLapS: number | null
  lastLapS: number | null
  inPit: boolean
  me: boolean
}

const progress = (c: StandingInput) => c.laps + (c.lapPct ?? 0)

function order(a: StandingInput, b: StandingInput, race: boolean): number {
  const pa = a.position && a.position > 0 ? a.position : Infinity
  const pb = b.position && b.position > 0 ? b.position : Infinity
  if (pa !== pb) return pa - pb
  // Sin posición oficial: en carrera el que más recorrió, si no la mejor vuelta
  if (race) return progress(b) - progress(a)
  return (a.bestLapS ?? Infinity) - (b.bestLapS ?? Infinity) || a.idx - b.idx
}

export function buildStandings(sim: SimId, race: boolean, input: StandingInput[], focusIdx: number | null): Standings {
  const sorted = [...input].sort((a, b) => order(a, b, race))
  const leader = sorted[0]
  const fastest = Math.min(...sorted.map((c) => c.bestLapS ?? Infinity))
  const cars: StandingCar[] = []
  sorted.forEach((c, i) => {
    const lapsDown = race && leader ? Math.max(0, Math.floor(progress(leader) - progress(c) + 1e-6)) : 0
    let gapS: number | null
    if (race) gapS = i === 0 ? 0 : c.raceGapS !== null && c.raceGapS >= 0 ? c.raceGapS : null
    else gapS = c.bestLapS !== null && Number.isFinite(fastest) ? c.bestLapS - fastest : null
    const prev = cars[i - 1]
    const intervalS = i === 0 ? null : gapS !== null && prev?.gapS !== null && prev?.gapS !== undefined && prev.lapsDown === lapsDown ? Math.max(0, gapS - prev.gapS) : null
    cars.push({
      idx: c.idx,
      num: c.num,
      name: c.name,
      cls: c.cls,
      position: i + 1,
      laps: c.laps,
      lapPct: c.lapPct,
      gapS,
      intervalS,
      lapsDown,
      bestLapS: c.bestLapS,
      lastLapS: c.lastLapS,
      inPit: c.inPit,
      me: c.me,
    })
  })
  return { sim, race, cars, focusIdx }
}

/** Tipo de sesión de carrera (iRacing en inglés, AC traducido). */
export function isRaceSession(type: string | null | undefined): boolean {
  return /race|heat|carrera/i.test(type ?? '')
}
