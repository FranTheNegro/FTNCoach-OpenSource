/**
 * Lo que el dashboard calcula del lado del cliente a partir de los frames:
 * tiempos de sector de la vuelta en curso, mejores sectores (para el ideal),
 * trazas de velocidad por vuelta (para comparar con la mejor) y la tendencia
 * de la distancia con el auto de adelante y el de atrás.
 *
 * Es de solo lectura sobre el stream: si el dashboard se abre a mitad de sesión,
 * lo que pasó antes no está y esas celdas quedan vacías.
 */
import type { LiveFrame, RivalCar, SessionMeta } from '@shared/live'

export const BINS = 200

export interface LapTrace {
  lap: number
  timeS: number
  /** Velocidad (km/h) y tiempo transcurrido (s) en cada 1/200 de la vuelta. NaN = sin dato. */
  speed: Float32Array
  t: Float32Array
}

export interface SectorState {
  name: string
  /** Tiempo (s) del sector, o null si todavía no empezó. */
  timeS: number | null
  state: 'done' | 'live' | 'idle'
  /** vs. el mejor sector de la sesión: 'best' = nuevo mejor, 'close' = hasta 0,12 s, 'slow' = más lento. */
  grade: 'best' | 'close' | 'slow' | null
  /** Diferencia con el mejor sector previo (s). */
  diffS: number | null
  /** Avance 0..1 dentro del sector. */
  progress: number
}

export type TrendKind = 'good' | 'flat' | 'bad' | 'none'

export interface RivalTrend {
  car: RivalCar | null
  /** Distancia en segundos, siempre positiva. */
  gapS: number | null
  /** Cambio de la distancia (s por segundo): negativo = se está achicando. */
  slope: number
  kind: TrendKind
  /** 0..1: cuánto cambia (para la intensidad del degradé). */
  strength: number
}

/** Por debajo de esto (s/s) la distancia se considera constante. */
const FLAT_SLOPE = 0.006
/** Con este cambio (s/s) el degradé llega a su intensidad máxima. */
const FULL_SLOPE = 0.03
const WINDOW_S = 10
const SAMPLE_EVERY_MS = 100
const GOOD_SECTOR_MARGIN_S = 0.12

function emptyTrace(): { speed: Float32Array; t: Float32Array } {
  return { speed: new Float32Array(BINS).fill(NaN), t: new Float32Array(BINS).fill(NaN) }
}

interface GapSample {
  at: number
  gap: number
}

export class DashTracker {
  private seq = -1
  private key = ''
  private lapNo = -1
  private sec = -1
  private secStartT = 0
  private lastT = 0
  private lastPct = 0
  private lastSpeed = 0
  /**
   * iRacing sigue contando el reloj de la vuelta anterior unos 2 s después de la
   * línea y recién ahí lo reinicia. Mientras tanto se le resta la hora (en ese
   * reloj) en que se cruzó la línea; 0 cuando el reloj ya vale tal cual.
   */
  private clockBase = 0
  private prevLastLapS: number | null = null
  /** El sector en curso empezó al cruzar su línea (no a mitad de camino al conectarse). */
  private secValid = false
  /** La vuelta en curso se vio completa desde la largada. */
  private lapFromStart = false
  private cur = emptyTrace()

  sectorsPct: number[] | null = null
  /** Máximo de RPM visto: sirve para las luces de cambio si el auto no informa su corte. */
  seenMaxRpm = 0
  /** Tiempos de los sectores de la vuelta en curso. */
  current: (number | null)[] = []
  private currentGrade: (SectorState['grade'])[] = []
  private currentDiff: (number | null)[] = []
  bestSec: (number | null)[] = []
  /** Sectores de cada vuelta completada mientras el dashboard estaba abierto. */
  lapSectors = new Map<number, (number | null)[]>()
  lastTrace: LapTrace | null = null
  bestTrace: LapTrace | null = null

  private aheadHist: GapSample[] = []
  private behindHist: GapSample[] = []
  private aheadIdx = -1
  private behindIdx = -1
  private lastSampleAt = 0
  private ahead: RivalCar | null = null
  private behind: RivalCar | null = null

  private reset(): void {
    this.lapNo = -1
    this.clockBase = 0
    this.prevLastLapS = null
    this.sec = -1
    this.secValid = false
    this.lapFromStart = false
    this.seenMaxRpm = 0
    this.current = []
    this.currentGrade = []
    this.currentDiff = []
    this.bestSec = []
    this.lapSectors.clear()
    this.lastTrace = null
    this.bestTrace = null
    this.cur = emptyTrace()
    this.aheadHist = []
    this.behindHist = []
    this.aheadIdx = -1
    this.behindIdx = -1
  }

  /** Procesa un frame. Es idempotente por `seq`: React puede dibujar dos veces el mismo. */
  feed(f: LiveFrame, meta: SessionMeta | null): void {
    if (f.seq === this.seq) return
    const key = meta ? `${meta.sim}|${meta.car}|${meta.track}|${meta.sessionType}` : ''
    if (key !== this.key || f.seq < this.seq) {
      this.key = key
      this.reset()
    }
    this.seq = f.seq
    if (f.rpm > this.seenMaxRpm) this.seenMaxRpm = f.rpm
    this.sectorsPct = meta?.sectorsPct && meta.sectorsPct.length >= 2 ? meta.sectorsPct : null
    this.feedLap(f)
    this.feedRivals(f)
  }

  private sectorIndex(pct: number): number {
    const s = this.sectorsPct
    if (!s) return -1
    let idx = 0
    for (let i = 0; i < s.length; i++) if (pct >= s[i]) idx = i
    return idx
  }

  /** Tiempo de la vuelta en curso, contado desde la línea aunque el sim todavía no reinició su reloj. */
  lapTime(f: LiveFrame): number {
    return this.clockBase > 0 ? Math.max(0, f.lapTimeS - this.clockBase) : f.lapTimeS
  }

  private closeSector(i: number, t: number): void {
    if (!this.secValid || !(t > 3 && t < 900)) {
      this.current[i] = null
      return
    }
    const prevBest = this.bestSec[i] ?? null
    this.current[i] = t
    this.currentDiff[i] = prevBest === null ? null : t - prevBest
    if (prevBest === null || t < prevBest - 1e-6) {
      this.currentGrade[i] = 'best'
      this.bestSec[i] = t
    } else {
      this.currentGrade[i] = t - prevBest <= GOOD_SECTOR_MARGIN_S ? 'close' : 'slow'
    }
  }

  private feedLap(f: LiveFrame): void {
    const n = this.sectorsPct?.length ?? 0
    const sameLapNow = f.lap === this.lapNo
    // El sim reinició el reloj: desde acá vale tal cual
    if (this.clockBase > 0 && f.lapTimeS < this.clockBase - 1) this.clockBase = 0

    if (f.lap !== this.lapNo) {
      const seenWhole = this.lapNo > 0 && f.lap === this.lapNo + 1 && this.lastT > 5
      // Si el reloj de la vuelta anterior sigue corriendo, la hora de la línea se
      // interpola entre este frame y el anterior según dónde cayó cada uno
      const oldClock = this.lapTime(f)
      const stale = this.lapNo >= 0 && oldClock >= this.lastT && oldClock > 3
      const before = 1 - this.lastPct
      const lineT = stale ? this.lastT + (oldClock - this.lastT) * (before + f.lapPct > 1e-6 ? before / (before + f.lapPct) : 1) : this.lastT
      // Terminó una vuelta (si es la primera que se ve, solo se toma la referencia)
      if (seenWhole) {
        // El tiempo oficial solo sirve si se acaba de actualizar: el que quedó es el de la vuelta anterior
        const fresh = f.lastLapS !== null && f.lastLapS !== this.prevLastLapS
        const official = fresh && Math.abs(f.lastLapS! - lineT) < 1 ? f.lastLapS! : lineT
        if (n > 0 && this.sec >= 0) {
          this.closeSector(this.sec, official - this.secStartT)
          this.lapSectors.set(this.lapNo, [...this.current])
        }
        // La traza solo sirve para comparar si se vio la vuelta entera
        if (this.lapFromStart) {
          const trace: LapTrace = { lap: this.lapNo, timeS: official, speed: this.cur.speed, t: this.cur.t }
          this.lastTrace = trace
          if (!this.bestTrace || official < this.bestTrace.timeS - 1e-6) this.bestTrace = trace
        }
      }
      this.clockBase = stale ? this.clockBase + lineT : 0
      this.lapNo = f.lap
      this.lapFromStart = seenWhole
      this.secValid = seenWhole
      this.cur = emptyTrace()
      this.current = []
      this.currentGrade = []
      this.currentDiff = []
      this.sec = n > 0 ? this.sectorIndex(f.lapPct) : -1
      this.secStartT = this.lapTime(f)
    } else if (n > 0) {
      const t = this.lapTime(f)
      const idx = this.sectorIndex(f.lapPct)
      if (idx > this.sec && this.sec >= 0) {
        this.closeSector(this.sec, t - this.secStartT)
        this.sec = idx
        this.secStartT = t
        // Desde acá los sectores se miden desde su línea
        this.secValid = true
      } else if (idx < this.sec || f.lapPct < this.lastPct - 0.3) {
        // Saltó hacia atrás sin cambiar de vuelta (volvió a boxes, reinicio): se descarta
        this.sec = idx
        this.secStartT = t
        this.secValid = false
        this.lapFromStart = false
        this.current = []
        this.currentGrade = []
        this.currentDiff = []
      } else if (this.sec < 0) {
        this.sec = idx
        this.secStartT = t
      }
    }

    const t = this.lapTime(f)
    this.writeTrace(f, t, sameLapNow)
    this.lastT = t
    this.lastPct = f.lapPct
    this.lastSpeed = f.speedKmh
    this.prevLastLapS = f.lastLapS
  }

  /**
   * Guarda velocidad y tiempo en cada 1/200 de la vuelta. El valor se interpola
   * justo en el borde del tramo, así la comparación entre vueltas no depende de
   * en qué instante cayó cada frame.
   */
  private writeTrace(f: LiveFrame, t: number, contiguous: boolean): void {
    const p1 = f.lapPct
    const p0 = this.lastPct
    const ok = contiguous && p1 >= p0 && p1 - p0 < 0.2 && t >= this.lastT
    if (!ok) {
      const bin = Math.min(BINS - 1, Math.max(0, Math.floor(p1 * BINS)))
      // Primer frame de la vuelta: el tiempo en la línea es 0
      this.cur.speed[bin] = f.speedKmh
      this.cur.t[bin] = p1 < 0.01 ? 0 : t
      return
    }
    const from = Math.floor(p0 * BINS) + 1
    const to = Math.min(BINS - 1, Math.floor(p1 * BINS))
    const span = p1 - p0
    for (let b = from; b <= to; b++) {
      const frac = span > 1e-9 ? (b / BINS - p0) / span : 1
      this.cur.t[b] = this.lastT + (t - this.lastT) * frac
      this.cur.speed[b] = this.lastSpeed + (f.speedKmh - this.lastSpeed) * frac
    }
  }

  /** Estado de cada sector para mostrar en pantalla. */
  sectors(f: LiveFrame): SectorState[] {
    const pcts = this.sectorsPct
    if (!pcts) return []
    return pcts.map((start, i) => {
      const end = i + 1 < pcts.length ? pcts[i + 1] : 1
      const done = this.current[i] ?? null
      if (done !== null) {
        return { name: `S${i + 1}`, timeS: done, state: 'done', grade: this.currentGrade[i] ?? null, diffS: this.currentDiff[i] ?? null, progress: 1 }
      }
      if (i === this.sec) {
        return {
          name: `S${i + 1}`,
          timeS: Math.max(0, this.lapTime(f) - this.secStartT),
          state: 'live',
          grade: null,
          diffS: null,
          progress: clamp01((f.lapPct - start) / Math.max(1e-6, end - start)),
        }
      }
      return { name: `S${i + 1}`, timeS: null, state: 'idle', grade: null, diffS: null, progress: 0 }
    })
  }

  /** Suma de los mejores sectores, o null si falta alguno. */
  ideal(): number | null {
    const n = this.sectorsPct?.length ?? 0
    if (n === 0) return null
    let sum = 0
    for (let i = 0; i < n; i++) {
      const b = this.bestSec[i]
      if (b === null || b === undefined) return null
      sum += b
    }
    return sum
  }

  private feedRivals(f: LiveFrame): void {
    this.ahead = f.rivals?.ahead ?? null
    this.behind = f.rivals?.behind ?? null
    const now = Date.now()
    if (now - this.lastSampleAt < SAMPLE_EVERY_MS) return
    this.lastSampleAt = now
    this.aheadHist = this.push(this.aheadHist, this.ahead, this.aheadIdx, now)
    this.aheadIdx = this.ahead?.idx ?? -1
    this.behindHist = this.push(this.behindHist, this.behind, this.behindIdx, now)
    this.behindIdx = this.behind?.idx ?? -1
  }

  private push(hist: GapSample[], car: RivalCar | null, prevIdx: number, now: number): GapSample[] {
    if (!car) return []
    const next = car.idx === prevIdx ? hist : []
    next.push({ at: now, gap: Math.abs(car.gapS) })
    while (next.length && now - next[0].at > WINDOW_S * 1000) next.shift()
    return next
  }

  /** Tendencia de la distancia con el de adelante (`side` = 'ahead') o el de atrás. */
  trend(side: 'ahead' | 'behind'): RivalTrend {
    const car = side === 'ahead' ? this.ahead : this.behind
    const hist = side === 'ahead' ? this.aheadHist : this.behindHist
    if (!car) return { car: null, gapS: null, slope: 0, kind: 'none', strength: 0 }
    const gapS = Math.abs(car.gapS)
    const span = hist.length > 1 ? (hist[hist.length - 1].at - hist[0].at) / 1000 : 0
    if (hist.length < 8 || span < 3) return { car, gapS, slope: 0, kind: 'flat', strength: 0 }
    // Regresión lineal simple de la distancia contra el tiempo
    const t0 = hist[0].at
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (const s of hist) {
      const x = (s.at - t0) / 1000
      sx += x
      sy += s.gap
      sxx += x * x
      sxy += x * s.gap
    }
    const m = hist.length
    const den = m * sxx - sx * sx
    const slope = den > 1e-9 ? (m * sxy - sx * sy) / den : 0
    if (Math.abs(slope) < FLAT_SLOPE) return { car, gapS, slope, kind: 'flat', strength: 0 }
    const closing = slope < 0
    // Al de adelante conviene achicarle la distancia; del de atrás, alejarse
    const good = side === 'ahead' ? closing : !closing
    return { car, gapS, slope, kind: good ? 'good' : 'bad', strength: clamp01((Math.abs(slope) - FLAT_SLOPE) / (FULL_SLOPE - FLAT_SLOPE)) }
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}
