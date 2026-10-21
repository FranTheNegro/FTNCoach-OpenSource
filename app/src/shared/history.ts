/**
 * Tu historial con las sesiones de esta PC, por auto y pista: el PB que tenías
 * antes de una sesión y la ideal histórica (la suma de tus mejores sectores).
 */
import { isLocal, type SessionSectors, type SessionSummary } from './analysis'

/** Mismo auto en el mismo trazado y simulador. */
export function sameCombo(a: SessionSummary, b: SessionSummary): boolean {
  if (a.sim !== b.sim || (a.trackId ?? a.track) !== (b.trackId ?? b.track)) return false
  return a.carId && b.carId ? a.carId === b.carId : a.car === b.car
}

const pctKey = (s: SessionSectors) => s.pct.map((p) => p.toFixed(3)).join(',')

/**
 * Suma de los mejores sectores de todas las sesiones. Solo se juntan sesiones con
 * los mismos cortes de sector (si el trazado los cambió, vale el grupo más grande).
 */
export function historicalIdeal(sessions: SessionSummary[]): number | null {
  const groups = new Map<string, SessionSectors[]>()
  for (const s of sessions) if (s.sectors) groups.set(pctKey(s.sectors), [...(groups.get(pctKey(s.sectors)) ?? []), s.sectors])
  const group = [...groups.values()].sort((a, b) => b.length - a.length)[0]
  if (!group) return null
  const best = group[0].pct.map((_, k) => Math.min(...group.map((g) => g.bestS[k] ?? Infinity)))
  return best.every(Number.isFinite) ? best.reduce((a, b) => a + b, 0) : null
}

export interface LocalHistory {
  /** Sesiones anteriores en este auto y pista. */
  sessionsBefore: number
  /** Tu mejor vuelta antes de esta sesión. */
  pbBeforeS: number | null
  /** Suma de tus mejores sectores en todas las sesiones (esta incluida). */
  idealS: number | null
}

export function localHistory(all: SessionSummary[], s: SessionSummary): LocalHistory {
  const combo = all.filter((x) => isLocal(x) && sameCombo(x, s))
  const before = combo.filter((x) => x.startedAt < s.startedAt)
  const pbs = before.map((x) => x.bestLapS).filter((t): t is number => t !== null)
  return {
    sessionsBefore: before.length,
    pbBeforeS: pbs.length ? Math.min(...pbs) : null,
    idealS: historicalIdeal(combo),
  }
}
