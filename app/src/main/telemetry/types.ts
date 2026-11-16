import type { LiveFrame, Quad, SessionMeta, SimId, Standings } from '@shared/live'

/**
 * Muestra que entrega cada fuente, antes de lo que agrega el motor
 * (delta propio, consumo por vuelta, historial de vueltas).
 */
export interface RawSample extends Omit<LiveFrame, 'seq' | 'deltaS' | 'fuelPerLapL' | 'fuelLapsLeft'> {
  /** Reloj de la sesión según el sim (s). */
  clockS: number
  /** Delta que calcula el propio sim; null → lo calcula el motor. */
  simDeltaS: number | null
  /** Las cuatro ruedas fuera de pista (o corte, según el sim). */
  offTrack: boolean
  // Solo para la grabación y el análisis: no viajan a los dashboards
  /** Velocidad de cada rueda (km/h), si el sim la publica. */
  wheelKmh?: Quad | null
  /** Recorrido de la suspensión de cada rueda (m). */
  suspM?: Quad | null
  /** Altura del piso adelante y atrás (m). */
  rideHeightM?: [number, number] | null
  /** El ABS está actuando. */
  absActive?: boolean | null
  /** Clasificación de todos los autos (solo algunas muestras: el motor la publica aparte). */
  standings?: Standings | null
}

export interface TelemetrySource {
  readonly sim: SimId
  /** La muestra más reciente, o null si no hay datos nuevos desde la última lectura. */
  poll(): RawSample | null
  meta(): SessionMeta | null
  /** false cuando el sim se cerró o dejó de publicar. */
  alive(): boolean
  close(): void
}
