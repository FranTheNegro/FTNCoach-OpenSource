/** Cuánto combustible hace falta para terminar, con las vueltas y el consumo reales de la sesión. */
import type { LiveFrame, SessionMeta } from '@shared/live'

export interface FuelPlan {
  /** Vueltas que faltan (null si la sesión no tiene final). */
  lapsToGo: number | null
  /** Sesión por tiempo: las vueltas salen de dividir lo que queda por tu última vuelta. */
  estimated: boolean
  /** Lo que falta para llegar (negativo = sobra). null si todavía no hay consumo. */
  needL: number | null
  /** Lo que conviene cargar, sin pasarse de la capacidad del tanque. */
  loadL: number | null
  /** Ni con el tanque lleno se llega al final. */
  short: boolean
}

export function fuelPlan(f: LiveFrame, meta: SessionMeta | null): FuelPlan {
  const lapS = f.lastLapS ?? f.bestLapS
  const estimated = f.lapsRemaining === null && !!f.timeRemainingS && !!lapS
  const lapsToGo = f.lapsRemaining ?? (estimated ? Math.ceil(f.timeRemainingS! / lapS!) : null)
  if (lapsToGo === null || f.fuelPerLapL === null || f.fuelL === null) return { lapsToGo, estimated, needL: null, loadL: null, short: false }
  const needL = lapsToGo * f.fuelPerLapL - f.fuelL
  const roomL = meta?.fuelMaxL ? Math.max(0, meta.fuelMaxL - f.fuelL) : null
  const short = needL > 0 && roomL !== null && needL > roomL
  return { lapsToGo, estimated, needL, loadL: needL <= 0 ? 0 : short ? roomL : needL, short }
}
