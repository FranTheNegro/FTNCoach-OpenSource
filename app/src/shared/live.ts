/**
 * Protocolo de telemetría en vivo.
 *
 * El motor (proceso principal) lee el simulador, normaliza cada muestra a un
 * `LiveFrame` y lo publica por WebSocket. Lo consumen la app de escritorio y los
 * dashboards de la red local (tablet, celular). Todas las unidades son métricas;
 * la conversión a imperial es cosa de la vista.
 *
 * Subir PROTOCOL_VERSION ante cualquier cambio incompatible en los mensajes.
 */

export const PROTOCOL_VERSION = 3

export type SimId = 'iracing' | 'ac' | 'replay'

export const SIM_LABEL: Record<SimId, string> = {
  iracing: 'iRacing',
  ac: 'Assetto Corsa',
  replay: 'Demo',
}

export type Flag =
  | 'green'
  | 'yellow'
  | 'blue'
  | 'white'
  | 'checkered'
  | 'red'
  | 'black'
  | 'meatball'
  | 'penalty'

/** Cuatro ruedas en orden FL, FR, RL, RR. */
export type Quad = [number, number, number, number]

/** Temperatura de una goma por zona: [interior, centro, exterior]. */
export type Triple = [number, number, number]

/** Un auto cercano en pista (solo iRacing). */
export interface RivalCar {
  idx: number
  /** Número del auto, como lo muestra el sim. */
  num: string
  name: string
  cls: string | null
  irating: number | null
  position: number | null
  /**
   * Segundos de pista que lo separan de tu auto. Positivo = va adelante tuyo,
   * negativo = va atrás. Para tu propio auto es 0.
   */
  gapS: number
  lastLapS: number | null
  bestLapS: number | null
  inPit: boolean
  me: boolean
}

export interface Rivals {
  /** Autos cercanos ordenados de adelante hacia atrás (tu auto incluido). */
  cars: RivalCar[]
  /** El más cercano que va adelante / atrás tuyo. */
  ahead: RivalCar | null
  behind: RivalCar | null
}

export interface LiveFrame {
  seq: number
  sim: SimId
  /** El sim está en pausa o mostrando una repetición. */
  paused: boolean
  /** En el auto y en pista (no en el garage ni en menús). */
  onTrack: boolean
  inPit: boolean
  pitLimiter: boolean

  speedKmh: number
  rpm: number
  /** -1 reversa, 0 neutro. */
  gear: number
  /** Pedales 0..1 (1 = a fondo). */
  throttle: number
  brake: number
  clutch: number
  /** Volante -1..1, positivo a la derecha. */
  steer: number
  /** Aceleraciones en G. Lateral positivo a la derecha, longitudinal positivo acelerando. */
  gLat: number
  gLon: number

  /** Número de la vuelta en curso. */
  lap: number
  /**
   * Posición del auto en el mundo del sim (m; x y z de AC, mismo marco que su mapa).
   * null si el sim no la publica en vivo (iRacing: el mapa la ubica con lapPct).
   */
  pos: [number, number] | null
  /** Posición en la vuelta 0..1. */
  lapPct: number
  /** Tiempo de la vuelta en curso (s). */
  lapTimeS: number
  lastLapS: number | null
  bestLapS: number | null
  /** Delta contra la mejor vuelta (s). Negativo = más rápido. */
  deltaS: number | null

  position: number | null
  carsInSession: number | null
  lapsTotal: number | null
  lapsRemaining: number | null
  timeRemainingS: number | null

  fuelL: number | null
  /** Promedio de las últimas vueltas limpias. */
  fuelPerLapL: number | null
  fuelLapsLeft: number | null

  tyreTempC: Quad | null
  tyrePressKpa: Quad | null
  /** Desgaste restante 0..1 (1 = nuevo). */
  tyreWear: Quad | null
  /** Temperatura por zona de cada goma (interior, centro, exterior), si el sim la publica. */
  tyreZonesC?: [Triple, Triple, Triple, Triple] | null
  brakeTempC: Quad | null

  brakeBias: number | null
  tc: number | null
  abs: number | null

  flags: Flag[]
  incidents: number | null
  airTempC: number | null
  trackTempC: number | null
  waterTempC?: number | null
  oilTempC?: number | null
  /** Autos cercanos (solo iRacing; AC no publica a los rivales). */
  rivals?: Rivals | null
}

export interface SessionMeta {
  sim: SimId
  car: string
  track: string
  /** Trazado para buscar su mapa: "iracing/324", "ac/ks_brands_hatch/gp". */
  trackId: string | null
  /** Nombre interno del trazado (iRacing "tsukuba 2kfull"; AC la carpeta). */
  trackSlug: string | null
  trackLengthM: number | null
  /** Inicio de cada sector (0..1, el primero es 0). */
  sectorsPct: number[] | null
  driver: string | null
  sessionType: string
  /** RPM de las luces de cambio. firstRpm enciende la primera, shiftRpm es el cambio, blinkRpm parpadea. */
  firstRpm: number | null
  shiftRpm: number | null
  blinkRpm: number | null
  maxRpm: number | null
  fuelMaxL: number | null
}

export type LapKind = 'valid' | 'out_lap' | 'in_lap' | 'off_track' | 'incident' | 'partial'

export interface LapRecord {
  lap: number
  timeS: number
  kind: LapKind
  reason: string | null
  fuelUsedL: number | null
  /** Mejor vuelta válida de la sesión hasta ahora. */
  best: boolean
}

export type EngineState = 'waiting' | 'connected'

export interface EngineStatus {
  state: EngineState
  sim: SimId | null
  /** ms epoch del último cambio de estado. */
  since: number
  /** Frames por segundo que está leyendo el motor. */
  hz: number
}

export type ServerMessage =
  | { type: 'hello'; protocol: number; app: string; version: string }
  | { type: 'status'; status: EngineStatus }
  | { type: 'meta'; meta: SessionMeta | null }
  | { type: 'frame'; frame: LiveFrame }
  | { type: 'laps'; laps: LapRecord[] }
  /** Latido cada segundo: el dashboard sabe que la conexión sigue viva aunque no haya frames. */
  | { type: 'ping' }

export const LAP_KIND_LABEL: Record<LapKind, string> = {
  valid: 'Válida',
  out_lap: 'Salida de boxes',
  in_lap: 'Entrada a boxes',
  off_track: 'Salida de pista',
  incident: 'Incidente',
  partial: 'Parcial',
}
