/**
 * Lambert-93 (EPSG:2154): la proyección oficial de Francia. Assetto Corsa Rally
 * ubica sus tramos franceses con estas coordenadas corridas a un origen propio
 * (x = norte, z = este, y = altitud NGF), así que el mapa del IGN calza al metro.
 * Cónica conforme de Lambert con dos paralelos sobre el elipsoide GRS80.
 */
const A = 6378137
const F_INV = 298.257222101
const E = Math.sqrt((1 / F_INV) * (2 - 1 / F_INV))
const rad = (d: number) => (d * Math.PI) / 180
const PHI1 = rad(49)
const PHI2 = rad(44)
const PHI0 = rad(46.5)
const LAM0 = rad(3)
const E0 = 700000
const N0 = 6600000

const m = (p: number) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2)
const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2)
const N = (Math.log(m(PHI1)) - Math.log(m(PHI2))) / (Math.log(t(PHI1)) - Math.log(t(PHI2)))
const FF = m(PHI1) / (N * t(PHI1) ** N)
const R0 = A * FF * t(PHI0) ** N

/** Latitud y longitud (grados) → [este, norte] en Lambert-93 (m). */
export function toL93(lat: number, lon: number): [number, number] {
  const r = A * FF * t(rad(lat)) ** N
  const th = N * (rad(lon) - LAM0)
  return [E0 + r * Math.sin(th), N0 + R0 - r * Math.cos(th)]
}

/** [este, norte] en Lambert-93 → [latitud, longitud] (grados). */
export function fromL93(east: number, north: number): [number, number] {
  const dx = east - E0
  const dy = R0 - (north - N0)
  const r = Math.hypot(dx, dy)
  const th = Math.atan2(dx, dy)
  const tt = (r / (A * FF)) ** (1 / N)
  let p = Math.PI / 2 - 2 * Math.atan(tt)
  for (let i = 0; i < 10; i++) p = Math.PI / 2 - 2 * Math.atan(tt * ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2))
  return [(p * 180) / Math.PI, ((th / N + LAM0) * 180) / Math.PI]
}

/** Francia metropolitana (aproximado), donde vale Lambert-93 y hay cartografía del IGN. */
export function inFrance(lat: number, lon: number): boolean {
  return lat > 41 && lat < 51.5 && lon > -5.5 && lon < 10
}
