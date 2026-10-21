import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeSession, coachData, compareLaps } from '../src/main/analysis/analyze'
import { Recorder, readRecording } from '../src/main/analysis/recording'
import { loadSession } from '../src/main/analysis/session'
import { TrackMaps } from '../src/main/analysis/track-map'
import type { RawSample } from '../src/main/telemetry/types'
import type { SessionMeta } from '../src/shared/live'
import { localIbtFiles } from './fixtures'

const ibt = localIbtFiles().filter((f) => f.includes('tsukuba')).at(-1)
const svgDir = join(import.meta.dirname, '..', '..', 'data', 'track_geo', 'iracing', '324')

describe.skipIf(!ibt)('análisis de una sesión real', () => {
  it('sectores, teórica, consistencia, curvas y comparación', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ftn-an-'))
    if (existsSync(join(svgDir, 'active.svg'))) {
      const dir = join(root, 'iracing', '324')
      mkdirSync(dir, { recursive: true })
      for (const f of ['active.svg', 'turns.svg', 'start-finish.svg', 'meta.json']) copyFileSync(join(svgDir, f), join(dir, f))
    }
    const s = loadSession(ibt!)
    const sm = await new TrackMaps(root).forSession(s)
    const p = analyzeSession(s, sm)
    const d = p.detail

    expect(d.bestIndex).not.toBeNull()
    const best = d.laps[d.bestIndex!]
    expect(best.timeS).toBeCloseTo(61.688, 3)
    // Los sectores de una vuelta completa suman su tiempo
    const sum = best.sectorsS.reduce((a, b) => a! + b!, 0)!
    expect(sum).toBeCloseTo(best.timeS, 2)
    expect(d.theoreticalS!).toBeLessThanOrEqual(best.timeS + 1e-6)
    expect(d.theoreticalS!).toBeGreaterThan(best.timeS - 1.5)
    expect(d.consistencyS!).toBeGreaterThan(0)
    expect(d.consistencyS!).toBeLessThan(1)

    // Tsukuba: las curvas donde un GR86 baja la velocidad
    console.log('curvas', d.corners.map((c) => `${c.label}${c.name ? ' ' + c.name : ''}@${(c.apexPct * 100).toFixed(0)}%`).join(', '))
    expect(d.corners.length).toBeGreaterThanOrEqual(5)
    expect(d.corners.length).toBeLessThanOrEqual(14)
    const pass = d.passes[d.bestIndex!][0]!
    expect(pass.minKmh).toBeLessThan(pass.entryKmh)

    // Comparar la vuelta más lenta válida contra la mejor
    const valid = d.laps.filter((l) => l.kind === 'valid')
    const slow = valid.reduce((a, b) => (b.timeS > a.timeS ? b : a))
    const cmp = compareLaps(p, slow.index, d.bestIndex!)
    const end = cmp.delta[cmp.delta.length - 1]
    expect(end).toBeCloseTo(slow.timeS - best.timeS, 2)
    console.log(cmp.insights.map((i) => `${i.title} +${i.lossS.toFixed(3)}: ${i.text}`).join('\n'))
    expect(cmp.insights.length).toBeGreaterThan(0)
    if (sm.mapper) expect(cmp.a.x!.filter(Number.isFinite).length).toBeGreaterThan(100)

    const data = coachData(p, slow.index) as { corners: unknown[]; best_lap_s: number }
    expect(data.best_lap_s).toBeCloseTo(61.688, 3)
    expect(data.corners.length).toBe(d.corners.length)

    // El setup y el clima vienen del .ibt
    expect(d.setup?.length).toBeGreaterThan(0)
    expect(d.setup!.some((g) => g.parts.some((x) => x.values.length > 0))).toBe(true)
    expect(d.conditions?.airC).not.toBeNull()

  }, 60_000)
})

describe('grabaciones propias', () => {
  it('graba, lee y corta en vueltas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ftn-rec-'))
    const rec = new Recorder(() => dir)
    const meta: SessionMeta = {
      sim: 'ac', car: 'Mazda MX5 Cup', track: 'Magione', trackId: 'ac/magione', trackSlug: 'magione', trackLengthM: 2500,
      sectorsPct: [0, 0.5], driver: null, sessionType: 'Práctica', firstRpm: null, shiftRpm: null, blinkRpm: null, maxRpm: null, fuelMaxL: null,
    }
    const base: Omit<RawSample, 'speedKmh' | 'lap' | 'lapPct' | 'lapTimeS' | 'clockS' | 'fuelL' | 'pos' | 'lastLapS'> = {
      sim: 'ac', paused: false, onTrack: true, inPit: false, pitLimiter: false, rpm: 6000, gear: 3, throttle: 1, brake: 0,
      clutch: 0, steer: 0, gLat: 0, gLon: 0, bestLapS: null, simDeltaS: null, position: null, carsInSession: null,
      lapsTotal: null, lapsRemaining: null, timeRemainingS: null, tyreTempC: null, tyrePressKpa: null, tyreWear: null,
      brakeTempC: null, brakeBias: null, tc: null, abs: null, flags: [], incidents: null, airTempC: null, trackTempC: null, offTrack: false,
    }
    // Dos vueltas y media de 50 s a 60 Hz, arrancando en la meta
    const lapS = 50
    for (let i = 0; i < 60 * lapS * 2.5; i++) {
      const t = i / 60
      const lap = 1 + Math.floor(t / lapS)
      const pct = (t % lapS) / lapS
      const s: RawSample = {
        ...base, speedKmh: 150, lap, lapPct: pct, lapTimeS: t % lapS, clockS: t, fuelL: 40 - t * 0.01,
        pos: [Math.cos(pct * 2 * Math.PI) * 400, Math.sin(pct * 2 * Math.PI) * 400],
        lastLapS: lap > 1 ? lapS : null,
      }
      rec.sample(s, meta)
    }
    const file = rec.current!
    await rec.stop()
    expect(readdirSync(dir).length).toBe(1)
    const r = readRecording(file)
    expect(r.header.track).toBe('Magione')
    expect(r.rows).toBe(60 * lapS * 2.5)
    const s = loadSession(file)
    // Dos vueltas completas y la media vuelta final, que queda como cortada
    expect(s.summary.laps).toBe(3)
    expect(s.laps[2].kind).toBe('partial')
    expect(s.summary.hasPosition).toBe(true)
    expect(s.laps[1].timeS).toBeCloseTo(lapS, 1)
  })

  it('sin vueltas completas no deja archivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ftn-rec-'))
    const rec = new Recorder(() => dir)
    const meta = { sim: 'ac', car: 'x', track: 'y', trackId: null, trackSlug: null, trackLengthM: null, sectorsPct: null, driver: null, sessionType: 'P', firstRpm: null, shiftRpm: null, blinkRpm: null, maxRpm: null, fuelMaxL: null } as SessionMeta
    rec.sample({ sim: 'ac', paused: false, onTrack: true, speedKmh: 50, lap: 1, lapPct: 0.1, clockS: 1, pos: null } as unknown as RawSample, meta)
    await rec.stop()
    expect(readdirSync(dir).length).toBe(0)
  })
})
