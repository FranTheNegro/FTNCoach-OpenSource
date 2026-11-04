/**
 * Tramos de rally aprendidos pasada a pasada: largada, meta, la línea del camino
 * (con altitud), los parciales y tu mejor pasada por auto, para el delta por
 * distancia. Un archivo JSON por tramo en `<userData>/acr/stages/`.
 *
 * El tramo se identifica por su nombre y el largo del spline del escenario
 * (dos variantes del mismo lugar pueden llamarse igual).
 *
 * Autocontenido (solo node:): lo usa el hilo lector y también
 * scripts/acr-importar.mts para cargar una grabación del sondeo.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StageSplitLive } from '../../../shared/stage'

/** Paso de la línea del camino y de los tiempos por distancia (m). */
export const LINE_STEP_M = 5
export const TIME_STEP_M = 10

export interface StagePass {
  car: string
  timeS: number
  /** Tiempo desde la largada cada TIME_STEP_M metros. */
  times: number[]
  resets: number
  date: string
}

export interface StageFile {
  version: 1
  id: string
  name: string
  splineM: number
  /** distanceTraveled del juego en la largada y en la meta. */
  startDistM: number
  finishDistM: number | null
  /** [d desde la largada, x, y, z] cada LINE_STEP_M metros. */
  line: [number, number, number, number][]
  /** Reubicaciones en la pasada de la que salió la línea (menos = mejor línea; null = sin línea). */
  lineResets: number | null
  splitsM: number[]
  splitsSource: 'game' | null
  /** Mejor pasada completa por auto. */
  best: Record<string, StagePass>
  /** Última pasada completa (para ubicar los parciales del juego a partir de sus tiempos). */
  last: StagePass | null
  /** Registro a la cartografía y datos del camino (los completa el proceso principal). */
  geo?: { crs: 'EPSG:2154'; offsetE: number; offsetN: number; errorM: number } | null
  surfaces?: { fromM: number; toM: number; kind: string; road: string | null }[]
}

export function stageId(name: string, splineM: number): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'tramo'}-${Math.round(splineM)}`
}

export function loadStage(dir: string, id: string): StageFile | null {
  const file = join(dir, `${id}.json`)
  if (!existsSync(file)) return null
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as StageFile
    return s.version === 1 ? s : null
  } catch {
    return null
  }
}

export function saveStage(dir: string, s: StageFile): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${s.id}.json`)
  writeFileSync(file + '.tmp', JSON.stringify(s))
  renameSync(file + '.tmp', file)
}

export function newStage(id: string, name: string, splineM: number, startDistM: number): StageFile {
  return { version: 1, id, name, splineM, startDistM, finishDistM: null, line: [], lineResets: null, splitsM: [], splitsSource: null, best: {}, last: null }
}

export function stageLength(s: StageFile): number | null {
  return s.finishDistM !== null ? s.finishDistM - s.startDistM : null
}

/** Tiempo de una pasada a `d` metros de la largada (interpolado), o null si no llegó. */
export function timeAt(times: number[], d: number): number | null {
  const x = d / TIME_STEP_M
  const i = Math.floor(x)
  if (i < 0 || i >= times.length || times[i] === undefined || times[i] === null) return null
  const a = times[i]
  const b = times[i + 1]
  return b === undefined || b === null ? a : a + (b - a) * (x - i)
}

/** Distancia a la que una pasada marcó `t` segundos (para ubicar los parciales del juego). */
export function distAt(times: number[], t: number): number | null {
  for (let i = 1; i < times.length; i++) {
    if (times[i] >= t) {
      const a = times[i - 1]
      const f = times[i] > a ? (t - a) / (times[i] - a) : 0
      return (i - 1 + f) * TIME_STEP_M
    }
  }
  return null
}

/** Ubica los parciales del juego en el tramo a partir de sus tiempos en la última pasada. */
export function splitsFromGameTimes(s: StageFile, splitTimesS: number[]): number[] | null {
  if (!s.last) return null
  const out: number[] = []
  for (const t of splitTimesS) {
    const d = distAt(s.last.times, t)
    if (d === null) return null
    out.push(Math.round(d))
  }
  return out
}

/** Picos de G horizontal que cuentan como golpe. */
const IMPACT_G = 4
/** Un retroceso mayor a esto en la distancia del camino = el juego te reubicó. */
const RESET_BACK_M = 15

/** Una pasada en curso: arma la línea, los tiempos por distancia, los parciales y los incidentes. */
export class StageRun {
  readonly times: number[] = []
  readonly line: [number, number, number, number][] = []
  resets = 0
  /** Se tomó con el tramo empezado (la app se conectó a mitad): no sirve de referencia. */
  partial = false
  impacts: { distM: number; g: number }[] = []
  splitTimes: (number | null)[]
  private lastD = -1
  private lastT = 0
  private impactUntil = -1

  readonly stage: StageFile
  readonly car: string

  constructor(stage: StageFile, car: string) {
    this.stage = stage
    this.car = car
    this.splitTimes = stage.splitsM.map(() => null)
  }

  /** `d` desde la largada (m), `t` del cronómetro del tramo (s). */
  sample(d: number, t: number, x: number, y: number, z: number, gHoriz: number): void {
    if (this.lastD >= 0 && d < this.lastD - RESET_BACK_M) {
      this.resets++
      this.lastD = d
      this.lastT = t
      return
    }
    if (d < 0) return
    if (this.lastD < 0 && d > 30) this.partial = true
    if (gHoriz >= IMPACT_G && d > this.impactUntil) {
      this.impacts.push({ distM: Math.round(d), g: Math.round(gHoriz * 10) / 10 })
      this.impactUntil = d + 30
    }
    const li = Math.round(d / LINE_STEP_M)
    if (this.line[li] === undefined) this.line[li] = [li * LINE_STEP_M, x, y, z]
    if (d > this.lastD) {
      const from = this.lastD < 0 ? 0 : Math.floor(this.lastD / TIME_STEP_M) + 1
      const to = Math.floor(d / TIME_STEP_M)
      for (let i = from; i <= to; i++) {
        const di = i * TIME_STEP_M
        const f = this.lastD < 0 || d === this.lastD ? 1 : (di - this.lastD) / (d - this.lastD)
        this.times[i] = this.lastD < 0 ? t : this.lastT + (t - this.lastT) * Math.max(0, Math.min(1, f))
      }
      this.stage.splitsM.forEach((sd, k) => {
        if (this.splitTimes[k] === null && this.lastD >= 0 && this.lastD < sd && d >= sd) {
          this.splitTimes[k] = this.lastT + ((t - this.lastT) * (sd - this.lastD)) / Math.max(1e-6, d - this.lastD)
        }
      })
      this.lastD = d
      this.lastT = t
    }
  }

  /** Delta contra la mejor pasada del mismo auto, a la distancia actual. */
  delta(d: number, t: number): number | null {
    const best = this.stage.best[this.car]
    if (!best) return null
    const ref = timeAt(best.times, d)
    return ref === null ? null : t - ref
  }

  splits(): StageSplitLive[] {
    const best = this.stage.best[this.car]
    return this.stage.splitsM.map((distM, k) => {
      const timeS = this.splitTimes[k]
      const ref = best ? timeAt(best.times, distM) : null
      return { distM, timeS, diffS: timeS !== null && ref !== null ? timeS - ref : null, best: timeS !== null && (ref === null || timeS <= ref) }
    })
  }

  /** Cierra la pasada en la meta: aprende el largo, la línea y la mejor pasada. Devuelve true si cambió el archivo. */
  finish(timeS: number, finishDistAbs: number): boolean {
    const s = this.stage
    const length = finishDistAbs - s.startDistM
    if (this.partial || !(length > 100)) return false
    if (s.finishDistM === null) s.finishDistM = finishDistAbs
    const len = stageLength(s)!
    // La meta se cruzó: el último tramo de tiempos llega hasta el largo exacto
    const lastBin = Math.floor(len / TIME_STEP_M)
    for (let i = 0; i <= lastBin; i++) if (this.times[i] === undefined) return false
    const pass: StagePass = { car: this.car, timeS, times: this.times.slice(0, lastBin + 1).map((v) => Math.round(v * 1000) / 1000), resets: this.resets, date: new Date().toISOString() }
    s.last = pass
    const prev = s.best[this.car]
    if (!prev || timeS < prev.timeS) s.best[this.car] = pass
    // La línea del camino sale de la pasada más limpia (menos reubicaciones) que la cubra entera
    const full = this.line.slice(0, Math.floor(len / LINE_STEP_M) + 1)
    const covered = full.filter(Boolean).length / Math.max(1, full.length)
    if (covered > 0.98 && (s.lineResets === null || this.resets < s.lineResets)) {
      s.line = full.filter(Boolean).map((p) => p.map((v) => Math.round(v * 100) / 100) as [number, number, number, number])
      s.lineResets = this.resets
      s.geo = undefined
      s.surfaces = undefined
    }
    return true
  }
}
