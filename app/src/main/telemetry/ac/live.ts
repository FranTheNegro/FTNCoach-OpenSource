/**
 * Assetto Corsa en vivo: lee las páginas `acpmf_physics`, `acpmf_graphics` y
 * `acpmf_static` que publica el juego. No hace falta instalar ninguna app en AC.
 */
import type { Flag, Quad, SessionMeta, Triple } from '@shared/live'
import { SharedMemory } from '../win32'
import type { RawSample, TelemetrySource } from '../types'
import { AC_FLAG, AC_SESSION, AC_STATUS, GRAPHICS, PHYSICS, STATIC, f32, i32, wstr, type Field } from './structs'

const PSI_TO_KPA = 6.894757
const STALE_MS = 4000

/** "ks_mazda_mx5_cup" → "Mazda Mx5 Cup" */
export function prettyId(id: string): string {
  return id
    .replace(/^(ks|ac|rss|vrc|urd|tc)_/i, '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/** Interior, centro y exterior de cada goma (AC las publica por separado). */
function zones(b: Buffer): [Triple, Triple, Triple, Triple] {
  const at = (i: number): Triple => [f32(b, PHYSICS.tyreTempI, i), f32(b, PHYSICS.tyreTempM, i), f32(b, PHYSICS.tyreTempO, i)]
  return [at(0), at(1), at(2), at(3)]
}

function quad(b: Buffer, f: Field, k = 1): Quad {
  return [f32(b, f, 0) * k, f32(b, f, 1) * k, f32(b, f, 2) * k, f32(b, f, 3) * k]
}

function flagOf(code: number): Flag[] {
  switch (code) {
    case AC_FLAG.blue:
      return ['blue']
    case AC_FLAG.yellow:
      return ['yellow']
    case AC_FLAG.black:
      return ['black']
    case AC_FLAG.white:
      return ['white']
    case AC_FLAG.checkered:
      return ['checkered']
    case AC_FLAG.penalty:
      return ['penalty']
    default:
      return []
  }
}

const validMs = (ms: number): number | null => (ms > 0 && ms < 3_600_000 ? ms / 1000 : null)

export class AcLive implements TelemetrySource {
  readonly sim = 'ac' as const
  private phys = Buffer.alloc(PHYSICS.size)
  private gfx = Buffer.alloc(GRAPHICS.size)
  private stat = Buffer.alloc(STATIC.size)
  private lastPacket = -1
  private lastPacketAt = Date.now()
  private lastStatus: number = AC_STATUS.off
  private clockS = 0
  private clockAt = 0
  private _meta: SessionMeta | null = null
  private metaKey = ''

  private constructor(
    private physics: SharedMemory,
    private graphics: SharedMemory,
    private statics: SharedMemory,
  ) {}

  static open(): AcLive | null {
    const p = SharedMemory.open('Local\\acpmf_physics')
    const g = p && SharedMemory.open('Local\\acpmf_graphics')
    const s = g && SharedMemory.open('Local\\acpmf_static')
    if (!p || !g || !s) {
      p?.close()
      g?.close()
      return null
    }
    const src = new AcLive(p, g, s)
    src.graphics.read(0, GRAPHICS.size, src.gfx)
    if (i32(src.gfx, GRAPHICS.status) === AC_STATUS.off) {
      src.close()
      return null
    }
    return src
  }

  meta(): SessionMeta | null {
    return this._meta
  }

  alive(): boolean {
    if (this.lastStatus === AC_STATUS.off) return false
    // En pausa los paquetes de física se frenan: no es que el juego se haya cerrado
    if (this.lastStatus === AC_STATUS.pause) return true
    return Date.now() - this.lastPacketAt < STALE_MS
  }

  private refreshMeta(): void {
    this.statics.read(0, STATIC.size, this.stat)
    const session = i32(this.gfx, GRAPHICS.session)
    const car = wstr(this.stat, STATIC.carModel)
    const track = wstr(this.stat, STATIC.track)
    const config = wstr(this.stat, STATIC.trackConfiguration)
    const key = `${car}|${track}|${config}|${session}`
    if (key === this.metaKey) return
    this.metaKey = key
    const maxRpm = i32(this.stat, STATIC.maxRpm)
    const length = f32(this.stat, STATIC.trackSPlineLength)
    const sectors = i32(this.stat, STATIC.sectorCount)
    const driver = `${wstr(this.stat, STATIC.playerName)} ${wstr(this.stat, STATIC.playerSurname)}`.trim()
    // AC no publica las luces de cambio: se aproximan con el corte de la caja
    this._meta = {
      sim: 'ac',
      car: prettyId(car) || 'Auto',
      track: [prettyId(track), config ? prettyId(config) : ''].filter(Boolean).join(' ') || 'Pista',
      trackId: track ? `ac/${track}${config ? '/' + config : ''}` : null,
      trackSlug: track || null,
      trackLengthM: length > 0 ? length : null,
      sectorsPct: sectors > 1 ? Array.from({ length: sectors }, (_, i) => i / sectors) : null,
      driver: driver || null,
      sessionType: AC_SESSION[session] ?? 'Sesión',
      firstRpm: maxRpm > 0 ? maxRpm * 0.8 : null,
      shiftRpm: maxRpm > 0 ? maxRpm * 0.96 : null,
      blinkRpm: maxRpm > 0 ? maxRpm * 0.985 : null,
      maxRpm: maxRpm > 0 ? maxRpm : null,
      fuelMaxL: f32(this.stat, STATIC.maxFuel) || null,
    }
  }

  poll(): RawSample | null {
    this.graphics.read(0, GRAPHICS.size, this.gfx)
    const status = i32(this.gfx, GRAPHICS.status)
    this.lastStatus = status
    if (status === AC_STATUS.off) return null

    this.physics.read(0, PHYSICS.size, this.phys)
    const packet = i32(this.phys, PHYSICS.packetId)
    if (packet === this.lastPacket) return null
    this.lastPacket = packet
    const now = Date.now()
    this.lastPacketAt = now

    // Reloj propio de la sesión: solo avanza con el juego corriendo
    if (status === AC_STATUS.live && this.clockAt) this.clockS += (now - this.clockAt) / 1000
    this.clockAt = now

    this.refreshMeta()
    const b = this.phys
    const g = this.gfx
    const laps = i32(g, GRAPHICS.numberOfLaps)
    const timeLeft = f32(g, GRAPHICS.sessionTimeLeft)
    const position = i32(g, GRAPHICS.position)
    const cars = i32(this.stat, STATIC.numCars)
    const completed = i32(g, GRAPHICS.completedLaps)
    const inPit = i32(g, GRAPHICS.isInPit) > 0

    return {
      sim: 'ac',
      paused: status !== AC_STATUS.live,
      onTrack: status === AC_STATUS.live && !inPit,
      inPit: inPit || i32(g, GRAPHICS.isInPitLane) > 0,
      pitLimiter: i32(b, PHYSICS.pitLimiterOn) > 0,

      speedKmh: f32(b, PHYSICS.speedKmh),
      rpm: i32(b, PHYSICS.rpms),
      // AC: 0 = reversa, 1 = neutro, 2 = primera
      gear: i32(b, PHYSICS.gear) - 1,
      throttle: f32(b, PHYSICS.gas),
      brake: f32(b, PHYSICS.brake),
      // AC publica el acoplamiento (1 = suelto), igual que iRacing
      clutch: 1 - f32(b, PHYSICS.clutch),
      steer: Math.max(-1, Math.min(1, f32(b, PHYSICS.steerAngle))),
      // accG = [x lateral, y vertical, z longitudinal]
      gLat: f32(b, PHYSICS.accG, 0),
      gLon: f32(b, PHYSICS.accG, 2),

      lap: completed + 1,
      pos: [f32(g, GRAPHICS.carCoordinates, 0), f32(g, GRAPHICS.carCoordinates, 2)],
      lapPct: Math.max(0, Math.min(1, f32(g, GRAPHICS.normalizedCarPosition))),
      lapTimeS: Math.max(0, i32(g, GRAPHICS.iCurrentTime) / 1000),
      lastLapS: validMs(i32(g, GRAPHICS.iLastTime)),
      bestLapS: validMs(i32(g, GRAPHICS.iBestTime)),
      simDeltaS: null,

      position: position > 0 ? position : null,
      carsInSession: cars > 0 ? cars : null,
      lapsTotal: laps > 0 ? laps : null,
      lapsRemaining: laps > 0 ? Math.max(0, laps - completed) : null,
      timeRemainingS: timeLeft > 0 && timeLeft < 86_400_000 ? timeLeft / 1000 : null,

      fuelL: f32(b, PHYSICS.fuel),
      tyreTempC: quad(b, PHYSICS.tyreCoreTemperature),
      tyrePressKpa: quad(b, PHYSICS.wheelsPressure, PSI_TO_KPA),
      tyreWear: null,
      tyreZonesC: zones(b),
      brakeTempC: quad(b, PHYSICS.brakeTemp),

      brakeBias: f32(b, PHYSICS.brakeBias) > 0 ? f32(b, PHYSICS.brakeBias) * 100 : null,
      tc: null,
      abs: null,

      flags: flagOf(i32(g, GRAPHICS.flag)),
      incidents: null,
      airTempC: f32(b, PHYSICS.airTemp),
      trackTempC: f32(b, PHYSICS.roadTemp),

      clockS: this.clockS,
      // Más de dos ruedas afuera = corte (mismo criterio que la validación de AC)
      offTrack: i32(b, PHYSICS.numberOfTyresOut) > 2,
    }
  }

  close(): void {
    this.physics.close()
    this.graphics.close()
    this.statics.close()
  }
}
