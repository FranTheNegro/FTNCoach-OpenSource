import { describe, expect, it } from 'vitest'
import { GRAPHICS, PHYSICS, STATIC } from '../src/main/telemetry/ac/structs'
import { prettyId } from '../src/main/telemetry/ac/live'
import { LapTracker } from '../src/main/telemetry/lap-tracker'
import type { RawSample } from '../src/main/telemetry/types'

describe('estructuras de memoria compartida de AC', () => {
  it('offsets con pack(4) y wchar de 2 bytes', () => {
    expect(PHYSICS.speedKmh.offset).toBe(28)
    expect(PHYSICS.accG.offset).toBe(44)
    expect(PHYSICS.numberOfTyresOut.offset).toBe(244)
    expect(GRAPHICS.completedLaps.offset).toBe(132)
    expect(GRAPHICS.iCurrentTime.offset).toBe(140)
    expect(GRAPHICS.numberOfLaps.offset).toBe(172)
    expect(GRAPHICS.tyreCompound.offset).toBe(176)
    // tyreCompound termina en 242: el float siguiente se alinea a 244
    expect(GRAPHICS.replayTimeMultiplier.offset).toBe(244)
    expect(GRAPHICS.normalizedCarPosition.offset).toBe(248)
    expect(GRAPHICS.flag.offset).toBe(268)
    expect(STATIC.carModel.offset).toBe(68)
    expect(STATIC.track.offset).toBe(134)
    expect(STATIC.sectorCount.offset).toBe(400)
    expect(STATIC.maxRpm.offset).toBe(412)
  })

  it('nombres internos legibles', () => {
    expect(prettyId('ks_mazda_mx5_cup')).toBe('Mazda Mx5 Cup')
    expect(prettyId('spa')).toBe('Spa')
  })
})

function sample(over: Partial<RawSample>): RawSample {
  return {
    sim: 'ac', paused: false, onTrack: true, inPit: false, pitLimiter: false,
    speedKmh: 150, rpm: 6000, gear: 3, throttle: 1, brake: 0, clutch: 0, steer: 0, gLat: 0, gLon: 0,
    lap: 1, pos: null, lapPct: 0, lapTimeS: 0, lastLapS: null, bestLapS: null, simDeltaS: null,
    position: null, carsInSession: null, lapsTotal: null, lapsRemaining: null, timeRemainingS: null,
    fuelL: 40, tyreTempC: null, tyrePressKpa: null, tyreWear: null, brakeTempC: null,
    brakeBias: null, tc: null, abs: null, flags: [], incidents: null, airTempC: null, trackTempC: null,
    clockS: 0, offTrack: false,
    ...over,
  }
}

/** Una vuelta de `lapS` segundos a 60 Hz, con salida de pista opcional entre dos posiciones. */
function driveLap(t: LapTracker, lap: number, startClock: number, lapS: number, fuel0: number, off?: [number, number]) {
  const n = Math.round(lapS * 60)
  for (let i = 0; i < n; i++) {
    const pct = i / n
    t.update(sample({
      lap, lapPct: pct, lapTimeS: i / 60, clockS: startClock + i / 60,
      fuelL: fuel0 - 2 * pct, lastLapS: lap > 1 ? 60 + lap : null,
      offTrack: off ? pct >= off[0] && pct < off[1] : false,
    }))
  }
}

describe('LapTracker', () => {
  it('cierra vueltas, detecta salidas de pista, consumo y delta propio', () => {
    const t = new LapTracker()
    // Arranca en boxes en la vuelta 1
    t.update(sample({ lap: 1, lapPct: 0.4, inPit: true, clockS: 0 }))
    driveLap(t, 1, 0.1, 60, 40)
    driveLap(t, 2, 60.1, 61, 38)
    driveLap(t, 3, 121.1, 62, 36, [0.5, 0.52])
    // AC actualiza el último tiempo en el mismo instante del cruce
    t.update(sample({ lap: 4, lapPct: 0, clockS: 183.1, lastLapS: 62, fuelL: 34 }))

    const laps = t.laps
    expect(laps.map((l) => l.kind)).toEqual(['out_lap', 'valid', 'off_track'])
    expect(laps[1].timeS).toBeCloseTo(61, 1)
    expect(laps[1].best).toBe(true)
    expect(laps[2].reason).toContain('50%')
    expect(t.fuelPerLap()).toBeCloseTo(2, 1)
    // A mitad de vuelta, 1 s más lento que la referencia de 61 s
    const d = t.delta(sample({ lap: 4, lapPct: 0.5, lapTimeS: 31.5, clockS: 214 }))
    expect(d).toBeCloseTo(1, 1)
  })

  it('el reloj que vuelve atrás reinicia la sesión', () => {
    const t = new LapTracker()
    driveLap(t, 1, 0, 60, 40)
    driveLap(t, 2, 60, 61, 38)
    t.update(sample({ lap: 3, clockS: 121, lastLapS: 61 }))
    expect(t.laps.length).toBeGreaterThan(0)
    t.update(sample({ lap: 1, clockS: 5 }))
    expect(t.laps).toEqual([])
  })
})
