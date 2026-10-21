import type { DriverLite, IrContext } from './normalize'
import type { SessionInfo } from './session-info'
import type { SimId } from '@shared/live'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Datos de la session info que cada muestra necesita (vueltas totales, autos en pista). */
export function irContext(info: SessionInfo, sim: SimId, sessionNum: number | null): IrContext {
  const sessions: any[] = info.SessionInfo?.Sessions ?? []
  const s = sessions.find((x) => x?.SessionNum === sessionNum) ?? sessions[sessions.length - 1]
  const laps = Number(s?.SessionLaps)
  const drivers: any[] = info.DriverInfo?.Drivers ?? []
  const cars = drivers.filter((d) => String(d?.CarIsPaceCar) !== '1' && String(d?.IsSpectator) !== '1').length
  const roster = new Map<number, DriverLite>()
  for (const d of drivers) {
    if (typeof d?.CarIdx !== 'number' || String(d.CarIsPaceCar) === '1' || String(d.IsSpectator) === '1') continue
    const rating = Number(d.IRating)
    roster.set(d.CarIdx, {
      idx: d.CarIdx,
      num: String(d.CarNumber ?? ''),
      name: String(d.UserName ?? 'Piloto'),
      cls: d.CarClassShortName ? String(d.CarClassShortName) : null,
      irating: Number.isFinite(rating) && rating > 0 ? rating : null,
    })
  }
  const est = Number(info.DriverInfo?.DriverCarEstLapTime)
  return {
    sim,
    lapsTotal: Number.isFinite(laps) && laps > 0 ? laps : null,
    carsInSession: cars > 0 ? cars : null,
    drivers: roster,
    estLapS: Number.isFinite(est) && est > 0 ? est : null,
  }
}
