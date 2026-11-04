/**
 * Assetto Corsa Rally en vivo: las páginas `acpmf_*` con el formato de ACC (ver
 * structs.ts para lo que ACR publica y lo que deja en cero).
 *
 * ACR no publica el estado de la sesión ni los tiempos como número, así que acá
 * se deducen:
 * - pausa: la página graphics deja de avanzar (physics sigue corriendo);
 * - tiempo del tramo: el texto `currentTime` ("mm:ss.sss"); "" fuera del tramo y
 *   "00:00.000" antes de la largada;
 * - llegada: el tiempo se congela mientras graphics sigue avanzando.
 *
 * Cada tramo cuenta como una vuelta (`lap` = número de pasada en la sesión), con
 * su tiempo en `lastLapS` al llegar. Lo propio del rally va en `frame.stage`: el
 * tramo se aprende y se guarda (stage-store.ts), así que el largo, el avance, los
 * parciales y el delta contra tu mejor pasada (por distancia) valen entre sesiones.
 */
import type { Quad, SessionMeta } from '@shared/live'
import type { StageLive, StageState } from '@shared/stage'
import { SharedMemory, isProcessRunning } from '../win32'
import type { RawSample, TelemetrySource } from '../types'
import { f32, i32, wstr, type Field } from '../ac/structs'
import { GRAPHICS, PHYSICS, STATIC } from './structs'
import { StageRun, loadStage, newStage, saveStage, stageId, stageLength, type StageFile } from './stage-store'

const PSI_TO_KPA = 6.894757
const STALE_MS = 4000
/** Sin paquetes nuevos de graphics durante este tiempo = juego en pausa o en un menú. */
const PAUSE_MS = 300
/** Paquetes de graphics con el tiempo congelado para dar el tramo por terminado (~0,5 s). */
const FINISH_PACKETS = 30

const kelvin = (k: number): number => (k > 0 ? k - 273.15 : 0)

function quad(b: Buffer, f: Field, map: (v: number) => number = (v) => v): Quad {
  return [map(f32(b, f, 0)), map(f32(b, f, 1)), map(f32(b, f, 2)), map(f32(b, f, 3))]
}

/** "04:37.259" → 277.259; null si está vacío o no es un tiempo. */
export function parseStageTime(text: string): number | null {
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text)
  if (!m) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** "Peugeot 208 Rally4" ya viene legible; el tramo se usa tal cual ("Alsacia Luttenbach"). */
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export class AcrLive implements TelemetrySource {
  readonly sim = 'acr' as const
  private phys = Buffer.alloc(PHYSICS.size)
  private gfx = Buffer.alloc(GRAPHICS.size)
  private stat = Buffer.alloc(STATIC.size)
  private lastPacket = -1
  private lastPacketAt = Date.now()
  private lastGfxPacket = -1
  private lastGfxAt = 0
  private clockS = 0
  private clockAt = 0
  private _meta: SessionMeta | null = null
  private metaKey = ''

  // Tramo en curso
  private stage = 0
  private timerText = ''
  private timerGfxPackets = 0
  /** Distancia en el último cambio del cronómetro: al congelarse, es la de la meta. */
  private timerDist = 0
  private running = false
  private finished = false
  private lastStageS: number | null = null
  private file: StageFile | null = null
  private fileKey = ''
  private run: StageRun | null = null
  private car = ''

  private constructor(
    private physics: SharedMemory,
    private graphics: SharedMemory,
    private statics: SharedMemory,
    /** Carpeta de los tramos aprendidos (null = no se guardan). */
    private stagesDir: string | null,
  ) {}

  static open(stagesDir: string | null = null): AcrLive | null {
    if (!isProcessRunning('acr.exe')) return null
    const p = SharedMemory.open('Local\\acpmf_physics')
    const g = p && SharedMemory.open('Local\\acpmf_graphics')
    const s = g && SharedMemory.open('Local\\acpmf_static')
    if (!p || !g || !s) {
      p?.close()
      g?.close()
      s?.close()
      return null
    }
    const src = new AcrLive(p, g, s, stagesDir)
    // La página static llega en ceros hasta que se carga el tramo
    src.statics.read(0, STATIC.size, src.stat)
    if (!wstr(src.stat, STATIC.carModel)) {
      src.close()
      return null
    }
    return src
  }

  meta(): SessionMeta | null {
    return this._meta
  }

  alive(): boolean {
    return Date.now() - this.lastPacketAt < STALE_MS
  }

  private refreshMeta(): void {
    this.statics.read(0, STATIC.size, this.stat)
    const car = clean(wstr(this.stat, STATIC.carModel))
    const track = clean(wstr(this.stat, STATIC.track))
    const maxRpm = i32(this.phys, PHYSICS.currentMaxRpm)
    this.car = car
    this.loadFile(track, f32(this.stat, STATIC.trackSPlineLength))
    const length = this.file ? stageLength(this.file) : null
    const key = `${car}|${track}|${maxRpm}|${length ?? ''}|${this.file?.line.length ?? 0}`
    if (key === this.metaKey) return
    this.metaKey = key
    const driver = `${wstr(this.stat, STATIC.playerName)} ${wstr(this.stat, STATIC.playerSurname)}`.trim()
    this._meta = {
      sim: 'acr',
      car: car || 'Auto',
      track: track || 'Tramo',
      trackId: this.file ? `acr/${this.file.id}` : null,
      trackSlug: track || null,
      trackLengthM: length,
      sectorsPct: null,
      driver: driver || null,
      sessionType: 'Tramo',
      // ACR no publica las luces de cambio: se aproximan con el corte, como en AC
      firstRpm: maxRpm > 0 ? maxRpm * 0.8 : null,
      shiftRpm: maxRpm > 0 ? maxRpm * 0.96 : null,
      blinkRpm: maxRpm > 0 ? maxRpm * 0.985 : null,
      maxRpm: maxRpm > 0 ? maxRpm : null,
      fuelMaxL: null,
      // ACR solo tiene autos de rally
      category: 'rally',
    }
  }

  /** Carga (o cambia) el archivo del tramo según el nombre y el spline del escenario. */
  private loadFile(track: string, splineM: number): void {
    if (!track || !(splineM > 0)) return
    const id = stageId(track, splineM)
    if (id === this.fileKey) return
    this.fileKey = id
    // Otro tramo: lo de la sesión anterior no sirve
    this.run = null
    this.running = false
    this.finished = false
    this.lastStageS = null
    this.stage = 0
    // Sin archivo: la largada se toma de la primera pasada (NaN hasta entonces)
    this.file = (this.stagesDir && loadStage(this.stagesDir, id)) || newStage(id, track, splineM, NaN)
  }

  private bestS(): number | null {
    return this.file?.best[this.car]?.timeS ?? null
  }

  /** Sigue el cronómetro del tramo: largada, llegada y la pasada en curso. */
  private trackStage(text: string, gfxAdvanced: boolean, dist: number, pos: [number, number, number], gHoriz: number): number {
    const t = parseStageTime(text)
    if (!t) {
      // Fuera del tramo ("") o esperando la largada ("00:00.000"): la próxima pasada es otra
      if (this.running || this.finished) {
        this.running = false
        this.finished = false
        this.run = null
      }
      this.timerText = text
      return 0
    }
    const file = this.file
    if (!this.running && !this.finished && file) {
      this.running = true
      this.stage++
      // La primera vez se toma la largada de esta pasada; después vale la guardada
      if (!Number.isFinite(file.startDistM)) file.startDistM = dist
      this.run = new StageRun(file, this.car)
    }
    if (text !== this.timerText) {
      this.timerText = text
      this.timerGfxPackets = 0
      this.timerDist = dist
      if (this.finished) {
        // El cronómetro volvió a andar: era una pausa larga, no la llegada
        this.finished = false
        this.running = true
      }
    } else if (gfxAdvanced && this.running && ++this.timerGfxPackets >= FINISH_PACKETS) {
      this.running = false
      this.finished = true
      this.lastStageS = t
      if (this.run && file && this.run.finish(t, this.timerDist) && this.stagesDir) {
        try {
          saveStage(this.stagesDir, file)
        } catch (err) {
          console.error('[acr] no se pudo guardar el tramo:', err)
        }
        this.metaKey = ''
      }
    }
    if (this.running && this.run && file) this.run.sample(dist - file.startDistM, t, pos[0], pos[1], pos[2], gHoriz)
    return t
  }

  private stageLive(dist: number, alt: number): StageLive | null {
    const file = this.file
    if (!file) return null
    const state: StageState = this.finished ? 'finished' : this.running ? 'running' : this.timerText ? 'ready' : 'idle'
    const run = this.run
    return {
      state,
      stageId: file.line.length ? file.id : null,
      distM: Number.isFinite(file.startDistM) ? Math.max(0, dist - file.startDistM) : 0,
      lengthM: stageLength(file),
      altM: alt,
      resets: run?.resets ?? 0,
      impacts: run?.impacts ?? [],
      splits: run ? run.splits() : file.splitsM.map((distM) => ({ distM, timeS: null, diffS: null, best: false })),
      splitsSource: file.splitsSource,
      bestS: this.bestS(),
    }
  }

  poll(): RawSample | null {
    this.physics.read(0, PHYSICS.size, this.phys)
    const packet = i32(this.phys, PHYSICS.packetId)
    if (packet === this.lastPacket) return null
    this.lastPacket = packet
    const now = Date.now()
    this.lastPacketAt = now

    this.graphics.read(0, GRAPHICS.size, this.gfx)
    const g = this.gfx
    const gfxPacket = i32(g, GRAPHICS.packetId)
    const gfxAdvanced = gfxPacket !== this.lastGfxPacket
    if (gfxAdvanced) {
      this.lastGfxPacket = gfxPacket
      this.lastGfxAt = now
    }
    const paused = now - this.lastGfxAt > PAUSE_MS

    // Reloj propio de la sesión: solo avanza con el juego corriendo
    if (!paused && this.clockAt) this.clockS += (now - this.clockAt) / 1000
    this.clockAt = now

    this.refreshMeta()
    const b = this.phys
    const text = wstr(g, GRAPHICS.currentTime)
    const dist = f32(g, GRAPHICS.distanceTraveled)
    const pos: [number, number, number] = [f32(g, GRAPHICS.carCoordinates, 0), f32(g, GRAPHICS.carCoordinates, 1), f32(g, GRAPHICS.carCoordinates, 2)]
    const gHoriz = Math.hypot(f32(b, PHYSICS.accG, 0), f32(b, PHYSICS.accG, 2))
    const stageS = this.trackStage(text, gfxAdvanced, dist, pos, gHoriz)
    const stage = this.stageLive(dist, pos[1])
    // Avance: solo con el largo aprendido en una pasada completa. El spline del
    // escenario (trackSPlineLength) es más largo que el tramo y daría ~66 % en la meta
    const progress = stage?.lengthM ? stage.distM / stage.lengthM : 0
    const delta = this.running && this.run && stage ? this.run.delta(stage.distM, stageS) : null

    return {
      sim: 'acr',
      paused,
      onTrack: !paused && text !== '',
      inPit: false,
      pitLimiter: false,

      speedKmh: f32(b, PHYSICS.speedKmh),
      rpm: Math.max(0, i32(b, PHYSICS.rpms)),
      // Como en AC: 0 = reversa, 1 = neutro, 2 = primera
      gear: i32(b, PHYSICS.gear) - 1,
      throttle: f32(b, PHYSICS.gas),
      brake: f32(b, PHYSICS.brake),
      // Publica el acoplamiento (1 = suelto), igual que AC
      clutch: 1 - f32(b, PHYSICS.clutch),
      steer: Math.max(-1, Math.min(1, f32(b, PHYSICS.steerAngle))),
      // accG = [x lateral, y vertical, z longitudinal]; el lateral viene con el signo opuesto a AC1
      gLat: -f32(b, PHYSICS.accG, 0),
      gLon: f32(b, PHYSICS.accG, 2),

      // Lap = pasada por el tramo; se mantiene fija durante la pasada (el tracker de vueltas no la cierra)
      lap: Math.max(1, this.stage),
      // Coordenadas del mundo en metros, y hacia arriba: el plano es x, z como en AC
      pos: [pos[0], pos[2]],
      lapPct: Math.max(0, Math.min(1, progress)),
      lapTimeS: stageS,
      lastLapS: this.lastStageS,
      bestLapS: this.bestS(),
      simDeltaS: delta,

      position: null,
      carsInSession: null,
      lapsTotal: null,
      lapsRemaining: null,
      timeRemainingS: null,

      fuelL: f32(b, PHYSICS.fuel),
      tyreTempC: quad(b, PHYSICS.tyreCoreTemperature, kelvin),
      tyrePressKpa: quad(b, PHYSICS.wheelsPressure, (v) => v * PSI_TO_KPA),
      tyreWear: null,
      tyreZonesC: null,
      brakeTempC: quad(b, PHYSICS.brakeTemp, kelvin),

      brakeBias: f32(b, PHYSICS.brakeBias) > 0 ? f32(b, PHYSICS.brakeBias) * 100 : null,
      tc: null,
      abs: null,

      flags: [],
      incidents: null,
      airTempC: kelvin(f32(b, PHYSICS.airTemp)),
      trackTempC: kelvin(f32(b, PHYSICS.roadTemp)),
      waterTempC: kelvin(f32(b, PHYSICS.waterTemp)),
      stage,

      clockS: this.clockS,
      // numberOfTyresOut queda en cero en ACR; las reubicaciones se cuentan en stage.resets
      offTrack: false,
    }
  }

  close(): void {
    this.physics.close()
    this.graphics.close()
    this.statics.close()
  }
}
