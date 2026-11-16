/**
 * Datos que leen los tableros réplica. Todo sale del LiveFrame y de la
 * clasificación; si el sim no da un dato, queda null y el tablero muestra lo
 * mismo que el real cuando no tiene lectura.
 */
import type { LiveFrame, SessionMeta, StandingCar, Standings } from '@shared/live'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import { clamp } from '../kit'
import { shiftState } from '../Live'
import type { DashTracker } from '../tracker'

export interface DashProps {
  f: LiveFrame
  meta: SessionMeta | null
  standings: Standings | null
  units: Units
  tracker: DashTracker
}

export interface DashData {
  rpm: number
  /** Fin de escala del tacómetro, en miles (redondeado para arriba). */
  scaleK: number
  shiftRpm: number
  /** Fracción de las luces de cambio (0–1). */
  lights: number
  /** Llegó al punto de cambio / al límite. */
  shift: boolean
  limit: boolean
  /** Marcha como la muestran los tableros de competición: -1, 0, 1… */
  gearNum: string
  /** Marcha con letras: R, N, 1… */
  gear: string
  speed: number
  speedUnit: string
  lapS: number
  bestS: number | null
  lastS: number | null
  deltaS: number | null
  position: number | null
  cars: number | null
  lap: number
  lapsTotal: number | null
  /** Gap con el de adelante (s) o vueltas abajo. */
  gapS: number | null
  lapsDown: number
  leader: boolean
  fuel: number | null
  fuelUnit: string
  fuelLaps: number | null
  waterC: number | null
  oilC: number | null
  oilBar: number | null
  fuelBar: number | null
  volt: number | null
  throttle: number
  brake: number
  clutch: number
  limiter: boolean
  me: StandingCar | null
}

export function dashData({ f, meta, standings, units, tracker }: DashProps): DashData {
  const sh = shiftState(f.rpm, meta, tracker.seenMaxRpm)
  const shiftRpm = meta?.shiftRpm ?? sh.top * 0.95
  const first = meta?.firstRpm ?? shiftRpm * 0.75
  const me = standings?.cars.find((x) => x.me) ?? null
  const position = f.position ?? me?.position ?? null
  const gapS = me && me.position > 1 ? me.intervalS : (f.rivals?.ahead?.gapS ?? null)
  const temp = (c: number | null | undefined) => (c === null || c === undefined ? null : fmt.temp(c, units))
  return {
    rpm: f.rpm,
    scaleK: Math.max(6, Math.ceil(sh.top / 1000)),
    shiftRpm,
    lights: clamp((f.rpm - first) / Math.max(1, shiftRpm - first), 0, 1),
    shift: sh.flash,
    limit: sh.fast,
    gearNum: f.gear < 0 ? '-1' : String(f.gear),
    gear: fmt.gear(f.gear),
    speed: Math.round(fmt.speed(f.speedKmh, units)),
    speedUnit: fmt.unitLabel.speed(units),
    lapS: tracker.lapTime(f),
    bestS: f.bestLapS,
    lastS: f.lastLapS,
    deltaS: f.deltaS,
    position,
    cars: f.carsInSession,
    lap: f.lap,
    lapsTotal: f.lapsTotal,
    gapS,
    lapsDown: me?.lapsDown ?? 0,
    leader: position === 1,
    fuel: f.fuelL !== null ? fmt.fuel(f.fuelL, units) : null,
    fuelUnit: fmt.unitLabel.fuel(units),
    fuelLaps: f.fuelLapsLeft,
    waterC: temp(f.waterTempC),
    oilC: temp(f.oilTempC),
    oilBar: f.oilPressBar ?? null,
    fuelBar: f.fuelPressBar ?? null,
    volt: f.voltageV ?? null,
    throttle: f.throttle,
    brake: f.brake,
    clutch: f.clutch,
    limiter: f.pitLimiter,
    me,
  }
}

/** 93.352 → "01.33.352" (así lo muestra el tablero AD). */
export function dotTime(s: number | null, digits = 3): string | null {
  if (s === null || !Number.isFinite(s) || s <= 0) return null
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const sec = Math.floor(rest)
  const frac = Math.floor((rest - sec) * 10 ** digits)
  return `${String(m).padStart(2, '0')}.${String(sec).padStart(2, '0')}.${String(frac).padStart(digits, '0')}`
}

/** 93.35 → "01:33:35" (reloj de los tableros de rally). */
export function colonTime(s: number | null, digits = 2): string | null {
  if (s === null || !Number.isFinite(s) || s < 0) return null
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const sec = Math.floor(rest)
  const frac = Math.floor((rest - sec) * 10 ** digits)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frac).padStart(digits, '0')}`
}

export function num(x: number | null, digits = 0): string | null {
  return x === null || !Number.isFinite(x) ? null : x.toFixed(digits)
}

// ── Geometría ────────────────────────────────────────────────────────────

/** Punto en un círculo; ángulo en grados, en sentido horario desde las 3 (eje y para abajo). */
export function pt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

/** Arco abierto (para trazos). */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  if (Math.abs(to - from) < 0.05) return ''
  const [x0, y0] = pt(cx, cy, r, from)
  const [x1, y1] = pt(cx, cy, r, to)
  const large = Math.abs(to - from) > 180 ? 1 : 0
  const sweep = to > from ? 1 : 0
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

/** Sector de anillo cerrado entre dos radios. */
export function ringPath(cx: number, cy: number, r0: number, r1: number, from: number, to: number): string {
  if (to - from < 0.05) return ''
  const [a, b] = pt(cx, cy, r1, from)
  const [c, d] = pt(cx, cy, r1, to)
  const [e, g] = pt(cx, cy, r0, to)
  const [h, k] = pt(cx, cy, r0, from)
  const large = to - from > 180 ? 1 : 0
  return `M${a.toFixed(1)} ${b.toFixed(1)}A${r1} ${r1} 0 ${large} 1 ${c.toFixed(1)} ${d.toFixed(1)}L${e.toFixed(1)} ${g.toFixed(1)}A${r0} ${r0} 0 ${large} 0 ${h.toFixed(1)} ${k.toFixed(1)}Z`
}
