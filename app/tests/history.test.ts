import { describe, expect, it } from 'vitest'
import { sectorBests, type LoadedSession } from '../src/main/analysis/session'
import type { SessionSummary } from '../src/shared/analysis'
import { historicalIdeal, localHistory } from '../src/shared/history'

/** Vueltas a velocidad constante dentro de cada vuelta: el sector k dura timeS × (largo del sector). */
function fakeSession(lapTimes: number[], kinds: ('valid' | 'invalid')[] = []): LoadedSession {
  const per = 100
  const n = lapTimes.length * per
  const pct = new Float32Array(n)
  const clock = new Float64Array(n)
  let t = 0
  const spans = lapTimes.map((lt, i) => {
    for (let k = 0; k < per; k++) {
      pct[i * per + k] = k / per
      clock[i * per + k] = t + (lt * k) / per
    }
    const span = { start: i * per, end: (i + 1) * per, startClock: t, endClock: t + lt }
    t += lt
    return span
  })
  return {
    sectorsPct: [0, 0.25, 0.5],
    ch: { pct, clock },
    spans,
    laps: lapTimes.map((timeS, i) => ({ lap: i + 1, timeS, kind: kinds[i] ?? 'valid' })),
  } as unknown as LoadedSession
}

const summary = (over: Partial<SessionSummary>): SessionSummary =>
  ({ id: 'x', source: 'ibt', sim: 'iracing', car: 'MX-5', track: 'Lime Rock', trackId: 'lr', startedAt: 0, bestLapS: null, ...over }) as SessionSummary

describe('historial local', () => {
  it('mejores sectores de las vueltas válidas', () => {
    const s = sectorBests(fakeSession([60, 56, 50], ['valid', 'valid', 'invalid']))!
    expect(s.pct).toEqual([0, 0.25, 0.5])
    // La inválida (50 s) no cuenta: sale todo de la de 56 s
    expect(s.bestS[0]).toBeCloseTo(14, 1)
    expect(s.bestS[1]).toBeCloseTo(14, 1)
    expect(s.bestS[2]).toBeCloseTo(28, 1)
  })

  it('ideal histórica, PB previo y combinaciones distintas', () => {
    const a = summary({ id: 'a', startedAt: 1, bestLapS: 60, sectors: { pct: [0, 0.5], bestS: [29, 31] } })
    const b = summary({ id: 'b', startedAt: 2, bestLapS: 59.5, sectors: { pct: [0, 0.5], bestS: [29.5, 30] } })
    const other = summary({ id: 'c', startedAt: 0, bestLapS: 40, car: 'GR86', sectors: { pct: [0, 0.5], bestS: [20, 20] } })
    expect(historicalIdeal([a, b])).toBeCloseTo(59)
    const h = localHistory([a, b, other], b)
    expect(h).toEqual({ sessionsBefore: 1, pbBeforeS: 60, idealS: 59 })
  })
})
