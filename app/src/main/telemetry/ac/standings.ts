/**
 * Clasificación que manda la app Lua de AC (resources/ac-app/FTNCoach/lib/standings.lua)
 * por POST a 127.0.0.1. Formato compacto, un arreglo por auto:
 *
 *   { "focus": 3, "cars": [[idx, "num", "piloto", pos, vueltas, pct, gapS, mejorMs, ultimaMs, boxes, yo], …] }
 *
 * gapS lo calcula la app en el juego (segundos detrás del líder, -1 = no se sabe).
 */
import type { StandingInput } from '@shared/standings'

const MAX_CARS = 128

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const lapS = (ms: unknown): number | null => {
  const v = num(ms)
  return v !== null && v > 0 ? v / 1000 : null
}

export function parseAcStandings(raw: unknown): { input: StandingInput[]; focusIdx: number | null } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { focus?: unknown; cars?: unknown }
  if (!Array.isArray(o.cars)) return null
  const input: StandingInput[] = []
  for (const row of o.cars.slice(0, MAX_CARS)) {
    if (!Array.isArray(row)) continue
    const [idx, carNum, name, pos, laps, pct, gap, best, last, pit, me] = row as unknown[]
    const i = num(idx)
    if (i === null) continue
    const g = num(gap)
    const p = num(pct)
    input.push({
      idx: i,
      num: typeof carNum === 'string' && carNum ? carNum.slice(0, 6) : null,
      name: typeof name === 'string' && name ? name.slice(0, 48) : `Auto ${i + 1}`,
      cls: null,
      position: num(pos),
      laps: Math.max(0, num(laps) ?? 0),
      lapPct: p !== null && p >= 0 && p <= 1 ? p : null,
      raceGapS: g !== null && g >= 0 ? g : null,
      bestLapS: lapS(best),
      lastLapS: lapS(last),
      inPit: pit === 1 || pit === true,
      me: me === 1 || me === true,
    })
  }
  const f = num(o.focus)
  return { input, focusIdx: f !== null && f >= 0 ? f : null }
}
