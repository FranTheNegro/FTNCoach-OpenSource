import { describe, expect, it } from 'vitest'
import { IbtFile } from '../src/main/telemetry/iracing/ibt'
import { RowReader } from '../src/main/telemetry/iracing/irsdk'
import { metaFromSessionInfo } from '../src/main/telemetry/iracing/session-info'
import { irSample } from '../src/main/telemetry/iracing/normalize'
import { irContext } from '../src/main/telemetry/iracing/context'
import { LapTracker } from '../src/main/telemetry/lap-tracker'
import { localIbtFiles } from './fixtures'

const files = localIbtFiles()

/** Pasa todas las filas del .ibt por el normalizador y el tracker, como en vivo. */
function simulate(path: string) {
  const f = new IbtFile(path)
  const r = new RowReader(f.vars)
  const ctx = irContext(f.info, 'replay', null)
  const tracker = new LapTracker()
  const CH = 600
  let deltaSamples = 0
  let corr = 0
  for (let first = 0; first < f.rowCount; first += CH) {
    const buf = f.readRows(first, CH)
    const n = Math.min(CH, f.rowCount - first)
    for (let i = 0; i < n; i++) {
      r.row = buf
      r.base = i * f.rowLen
      const s = irSample(r, ctx)
      tracker.update(s)
      if (tracker.delta(s) !== null) deltaSamples++
      corr += s.steer * s.gLat
    }
  }
  f.close()
  return { file: f, tracker, deltaSamples, corr }
}

describe.skipIf(!files.length)('.ibt reales', () => {
  it('lee header, variables y session info', () => {
    const f = new IbtFile(files[0])
    expect(f.tickRate).toBe(60)
    expect(f.rowCount).toBeGreaterThan(1000)
    for (const v of ['Speed', 'RPM', 'Gear', 'Throttle', 'Brake', 'LapDistPct', 'Lap', 'SessionTime']) {
      expect(f.vars.has(v), v).toBe(true)
    }
    const meta = metaFromSessionInfo(f.info, 'replay', null)
    expect(meta.car).toBe('Toyota GR86')
    expect(meta.track).toBe('Tsukuba Circuit 2k Full')
    expect(meta.trackLengthM).toBeCloseTo(2083.5, 0)
    expect(meta.shiftRpm).toBeGreaterThan(5000)
    f.close()
  })

  it('las vueltas coinciden con el lector Python', () => {
    const { tracker, deltaSamples, corr } = simulate(files[files.length - 1])
    const laps = tracker.laps
    // Referencia: src/ingestors/iracing_reader.py sobre el mismo archivo
    const expected = [62.7, 61.815, 61.688, 61.966, 61.841, 61.912, 61.861, 62.119, 61.966, 61.905, 62.63, 62.616, 62.11, 62.445, 62.689]
    const valid = laps.filter((l) => l.kind === 'valid').map((l) => Number(l.timeS.toFixed(3)))
    expect(valid).toEqual(expected)
    expect(laps[0].kind).toBe('out_lap')
    // El cruce desde la grilla (1 s) no es una vuelta
    expect(laps.every((l) => l.timeS > 30)).toBe(true)
    expect(laps.find((l) => l.best)?.timeS).toBeCloseTo(61.688, 3)
    expect(laps.filter((l) => l.fuelUsedL !== null).length).toBeGreaterThan(10)
    expect(tracker.fuelPerLap()).toBeGreaterThan(0.5)
    expect(deltaSamples).toBeGreaterThan(1000)
    // En una curva a la derecha el volante va a la derecha y la G lateral también
    expect(corr).toBeGreaterThan(0)
  })
})

describe.skipIf(!files.length)('modo demo', () => {
  it('reproduce el .ibt desde que el auto se mueve', async () => {
    const { IbtReplay } = await import('../src/main/telemetry/replay')
    const r = new IbtReplay(files[files.length - 1])
    const s = r.poll()
    expect(s).not.toBeNull()
    expect(s!.sim).toBe('replay')
    expect(r.meta().car).toBe('Toyota GR86')
    expect(r.alive()).toBe(true)
    r.close()
    expect(r.alive()).toBe(false)
  })
})
