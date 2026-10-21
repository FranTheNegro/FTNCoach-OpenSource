import type { Units } from '@shared/api'

export const DASH = '–'

/** 83.456 → "1:23.456" */
export function lapTime(s: number | null | undefined, digits = 3): string {
  if (s === null || s === undefined || !Number.isFinite(s) || s <= 0) return '-:--.---'
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const sec = rest.toFixed(digits).padStart(digits + 3, '0')
  return m > 0 ? `${m}:${sec}` : sec.replace(/^0(?=\d\.)/, '')
}

/** Delta con signo y el menos tipográfico: "+0.23", "−1.05". */
export function delta(s: number | null | undefined, digits = 2): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return DASH
  const v = Math.abs(s) < 0.5 * 10 ** -digits ? 0 : s
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`
}

/** 754.2 → "12:34" · 4000 → "1:06:40" */
export function clock(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return DASH
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export function gear(g: number): string {
  return g < 0 ? 'R' : g === 0 ? 'N' : String(g)
}

export const unitLabel = {
  speed: (u: Units) => (u === 'metric' ? 'km/h' : 'mph'),
  temp: (u: Units) => (u === 'metric' ? '°C' : '°F'),
  press: (u: Units) => (u === 'metric' ? 'kPa' : 'psi'),
  fuel: (u: Units) => (u === 'metric' ? 'L' : 'gal'),
}

export function speed(kmh: number, u: Units): number {
  return u === 'metric' ? kmh : kmh * 0.621371
}

export function temp(c: number, u: Units): number {
  return u === 'metric' ? c : c * 1.8 + 32
}

export function press(kpa: number, u: Units): number {
  return u === 'metric' ? kpa : kpa / 6.894757
}

export function fuel(l: number, u: Units): number {
  return u === 'metric' ? l : l * 0.264172
}

export function fixed(x: number | null | undefined, digits = 1): string {
  return x === null || x === undefined || !Number.isFinite(x) ? DASH : x.toFixed(digits)
}
