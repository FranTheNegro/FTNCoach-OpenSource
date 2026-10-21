/**
 * Fila irsdk → RawSample. Lo comparten la lectura en vivo y la repetición de .ibt,
 * así el dashboard muestra lo mismo en los dos casos.
 */
import type { Flag, Quad, RivalCar, Rivals, SimId, Triple } from '@shared/live'
import type { RawSample } from '../types'
import type { RowReader } from './irsdk'

const G = 9.80665
/** 450° si el auto no informa el giro máximo del volante. */
const DEFAULT_STEER_MAX_RAD = 7.854
/** iRacing usa valores enormes para "sin límite" de tiempo y vueltas. */
const UNLIMITED_LAPS = 32767
const UNLIMITED_TIME_S = 86400 * 6

const PIT_LIMITER = 0x10

// irsdk_Flags
const F = {
  checkered: 0x1,
  white: 0x2,
  green: 0x4,
  yellow: 0x8,
  red: 0x10,
  blue: 0x20,
  yellowWaving: 0x100,
  caution: 0x4000,
  cautionWaving: 0x8000,
  black: 0x10000,
  disqualify: 0x20000,
  repair: 0x100000,
}

export function flagsOf(bits: number | null): Flag[] {
  if (!bits) return []
  const out: Flag[] = []
  if (bits & F.checkered) out.push('checkered')
  if (bits & (F.red)) out.push('red')
  if (bits & (F.black | F.disqualify)) out.push('black')
  if (bits & F.repair) out.push('meatball')
  if (bits & (F.yellow | F.yellowWaving | F.caution | F.cautionWaving)) out.push('yellow')
  if (bits & F.blue) out.push('blue')
  if (bits & F.white) out.push('white')
  if (bits & F.green) out.push('green')
  return out
}

function quad(r: RowReader, pattern: (corner: string) => string[]): Quad | null {
  const out: number[] = []
  for (const c of ['LF', 'RF', 'LR', 'RR']) {
    const names = pattern(c)
    const vals = names.map((n) => r.num(n)).filter((x): x is number => x !== null)
    if (!vals.length) return null
    out.push(vals.reduce((a, b) => a + b, 0) / vals.length)
  }
  return out as Quad
}

const positive = (x: number | null): number | null => (x !== null && x > 0 ? x : null)
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/** Interior, centro y exterior de cada goma. Las de la izquierda tienen el interior a la derecha. */
function tyreZones(r: RowReader): [Triple, Triple, Triple, Triple] | null {
  const out: Triple[] = []
  for (const [c, leftSide] of [['LF', true], ['RF', false], ['LR', true], ['RR', false]] as const) {
    const read = (zone: 'L' | 'M' | 'R') => r.num(`${c}tempC${zone}`) ?? r.num(`${c}temp${zone}`)
    const l = read('L')
    const m = read('M')
    const rt = read('R')
    if (l === null || m === null || rt === null) return null
    out.push(leftSide ? [rt, m, l] : [l, m, rt])
  }
  return out as [Triple, Triple, Triple, Triple]
}

/** Más cerca que esto (s) cuenta como rival directo. */
const RIVAL_MAX_GAP_S = 60
const RIVALS_EACH_SIDE = 4

/**
 * Autos cercanos en pista, con la distancia en segundos según el tiempo estimado
 * de iRacing (CarIdxEstTime). null si el sim no publica los autos o no hay pilotos.
 */
export function rivalsOf(r: RowReader, ctx: IrContext, lapRefS: number): Rivals | null {
  const drivers = ctx.drivers
  const me = r.num('PlayerCarIdx')
  if (!drivers || me === null || !r.has('CarIdxEstTime')) return null
  const myEst = r.num('CarIdxEstTime', me)
  if (myEst === null) return null

  const all: RivalCar[] = []
  for (const d of drivers.values()) {
    const surface = r.num('CarIdxTrackSurface', d.idx)
    const pct = r.num('CarIdxLapDistPct', d.idx)
    if (surface === null || surface < 0 || pct === null || pct < 0) continue
    let gap = 0
    if (d.idx !== me) {
      const est = r.num('CarIdxEstTime', d.idx)
      if (est === null) continue
      gap = est - myEst
      if (gap > lapRefS / 2) gap -= lapRefS
      else if (gap < -lapRefS / 2) gap += lapRefS
      if (Math.abs(gap) > RIVAL_MAX_GAP_S) continue
    }
    const position = r.num('CarIdxPosition', d.idx)
    all.push({
      idx: d.idx,
      num: d.num,
      name: d.name,
      cls: d.cls,
      irating: d.irating,
      position: position !== null && position > 0 ? position : null,
      gapS: gap,
      lastLapS: positive(r.num('CarIdxLastLapTime', d.idx)),
      bestLapS: positive(r.num('CarIdxBestLapTime', d.idx)),
      inPit: (r.num('CarIdxOnPitRoad', d.idx) ?? 0) > 0,
      me: d.idx === me,
    })
  }
  if (!all.some((c) => c.me)) return null

  const ahead = all.filter((c) => !c.me && c.gapS > 0).sort((a, b) => a.gapS - b.gapS)
  const behind = all.filter((c) => !c.me && c.gapS <= 0).sort((a, b) => b.gapS - a.gapS)
  const self = all.find((c) => c.me)!
  return {
    cars: [...ahead.slice(0, RIVALS_EACH_SIDE).reverse(), self, ...behind.slice(0, RIVALS_EACH_SIDE)],
    ahead: ahead[0] ?? null,
    behind: behind[0] ?? null,
  }
}

/** Datos fijos de cada piloto (de la session info) para armar la lista de rivales. */
export interface DriverLite {
  idx: number
  num: string
  name: string
  cls: string | null
  irating: number | null
}

export interface IrContext {
  sim: SimId
  lapsTotal: number | null
  carsInSession: number | null
  /** Pilotos de la sesión por CarIdx, sin autos de seguridad ni espectadores. */
  drivers?: Map<number, DriverLite>
  /** Vuelta de referencia del auto (s); la usa iRacing para estimar los tiempos en pista. */
  estLapS?: number | null
}

export function irSample(r: RowReader, ctx: IrContext): RawSample {
  const steerMax = positive(r.num('SteeringWheelAngleMax')) ?? DEFAULT_STEER_MAX_RAD
  const clutchEngagement = r.num('Clutch')
  const lapsRemain = r.num('SessionLapsRemainEx') ?? r.num('SessionLapsRemain')
  const timeRemain = r.num('SessionTimeRemain')
  const delta = r.num('LapDeltaToBestLap_OK') ? r.num('LapDeltaToBestLap') : null
  const warnings = r.num('EngineWarnings') ?? 0

  const tyreTemp =
    quad(r, (c) => [`${c}tempCL`, `${c}tempCM`, `${c}tempCR`]) ?? quad(r, (c) => [`${c}tempL`, `${c}tempM`, `${c}tempR`])
  const bestLap = positive(r.num('LapBestLapTime'))
  const lastLap = positive(r.num('LapLastLapTime'))

  return {
    sim: ctx.sim,
    paused: (r.num('IsReplayPlaying') ?? 0) > 0,
    onTrack: (r.num('IsOnTrack') ?? 1) > 0,
    inPit: (r.num('OnPitRoad') ?? 0) > 0,
    pitLimiter: (warnings & PIT_LIMITER) !== 0,

    speedKmh: (r.num('Speed') ?? 0) * 3.6,
    rpm: r.num('RPM') ?? 0,
    gear: r.num('Gear') ?? 0,
    throttle: clamp(r.num('Throttle') ?? 0, 0, 1),
    brake: clamp(r.num('Brake') ?? 0, 0, 1),
    // "Clutch" es el acoplamiento (1 = suelto); se pasa a recorrido del pedal
    clutch: clutchEngagement !== null ? clamp(1 - clutchEngagement, 0, 1) : 0,
    // iRacing: positivo = giro a la izquierda
    steer: clamp(-(r.num('SteeringWheelAngle') ?? 0) / steerMax, -1, 1),
    // iRacing: LatAccel positivo hacia la izquierda
    gLat: -(r.num('LatAccel') ?? 0) / G,
    gLon: (r.num('LongAccel') ?? 0) / G,

    lap: r.num('Lap') ?? 0,
    pos: null,
    lapPct: clamp(r.num('LapDistPct') ?? 0, 0, 1),
    lapTimeS: Math.max(0, r.num('LapCurrentLapTime') ?? 0),
    lastLapS: lastLap,
    bestLapS: bestLap,
    simDeltaS: delta,

    position: positive(r.num('PlayerCarPosition')),
    carsInSession: ctx.carsInSession,
    lapsTotal: ctx.lapsTotal,
    lapsRemaining: lapsRemain !== null && lapsRemain >= 0 && lapsRemain < UNLIMITED_LAPS ? lapsRemain : null,
    timeRemainingS: timeRemain !== null && timeRemain >= 0 && timeRemain < UNLIMITED_TIME_S ? timeRemain : null,

    fuelL: r.num('FuelLevel'),
    tyreTempC: tyreTemp,
    tyrePressKpa: quad(r, (c) => [`${c}pressure`]) ?? quad(r, (c) => [`${c}press`]),
    tyreWear: quad(r, (c) => [`${c}wearL`, `${c}wearM`, `${c}wearR`]),
    tyreZonesC: tyreZones(r),
    brakeTempC: null,

    brakeBias: r.num('dcBrakeBias'),
    tc: r.num('dcTractionControl'),
    abs: r.num('dcABS'),

    flags: flagsOf(r.num('SessionFlags')),
    incidents: r.num('PlayerCarMyIncidentCount') ?? r.num('PlayerCarDriverIncidentCount'),
    airTempC: r.num('AirTemp'),
    trackTempC: r.first('TrackTempCrew', 'TrackTemp'),
    waterTempC: r.num('WaterTemp'),
    oilTempC: r.num('OilTemp'),
    rivals: rivalsOf(r, ctx, ctx.estLapS ?? bestLap ?? lastLap ?? 90),

    clockS: r.num('SessionTime') ?? 0,
    // PlayerTrackSurface: -1 fuera del mundo · 0 fuera de pista · 1 box · 2 entrando a boxes · 3 en pista
    offTrack: r.num('PlayerTrackSurface') === 0,
  }
}
