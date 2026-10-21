/**
 * Rasgos de manejo medidos en una sesión: cómo frenás, cuánto trail-braking
 * hacés, qué tan progresivo es el acelerador y cuánto del grip usás en curva.
 * Solo cuentan las vueltas válidas y completas.
 */
import type { StyleSample } from '@shared/analysis'
import type { GridLap } from './analyze'

const BRAKE_ON = 0.15
const FULL_THROTTLE = 0.95
/** Desde acá cuenta como frenar girando (trail-braking). */
const TRAIL_G = 0.4

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

export function styleSample(
  laps: GridLap[],
  valid: number[],
  segs: { a: number; apex: number; b: number }[],
  bestS: number | null,
  consistencyS: number | null,
): StyleSample | null {
  const use = valid.filter((i) => laps[i].complete)
  if (!use.length || !segs.length) return null

  // Grip disponible: el 95 % más alto de g combinada que lograste en la sesión
  const combined: number[] = []
  for (const i of use) {
    const g = laps[i]
    for (let k = 0; k < g.gLat.length; k += 2) {
      const c = Math.hypot(g.gLat[k], g.gLon[k])
      if (Number.isFinite(c)) combined.push(c)
    }
  }
  combined.sort((a, b) => a - b)
  const p95 = combined[Math.floor(combined.length * 0.95)] ?? 0

  const peaks: number[] = []
  const trails: number[] = []
  const smooth: number[] = []
  const grip: number[] = []
  for (const i of use) {
    const g = laps[i]
    for (const { a, apex, b } of segs) {
      let peak = 0
      let braking = 0
      let trail = 0
      for (let k = a; k < apex; k++) {
        const dt = g.t[k + 1] - g.t[k]
        if (!(g.brake[k] >= BRAKE_ON) || !Number.isFinite(dt)) continue
        peak = Math.max(peak, g.brake[k])
        braking += dt
        if (Math.abs(g.gLat[k]) >= TRAIL_G) trail += dt
      }
      if (braking > 0.3) {
        peaks.push(peak)
        trails.push(trail / braking)
      }
      // Aplicación del acelerador desde el vértice hasta llegar a fondo: cuánto se levanta en el camino
      let up = 0
      let down = 0
      for (let k = apex; k < b && g.throttle[k] < FULL_THROTTLE; k++) {
        const d = g.throttle[k + 1] - g.throttle[k]
        if (!Number.isFinite(d)) continue
        if (d > 0) up += d
        else down -= d
      }
      if (up > 0.2) smooth.push(up / (up + down))
      if (p95 > 0.3)
        for (let k = a; k <= b; k++)
          if (g.brake[k] >= BRAKE_ON || Math.abs(g.gLat[k]) >= 0.5) {
            const c = Math.hypot(g.gLat[k], g.gLon[k])
            if (Number.isFinite(c)) grip.push(Math.min(1, c / p95))
          }
    }
  }
  const gripMean = mean(grip)
  return {
    laps: use.length,
    brakePeak: mean(peaks),
    trailRatio: mean(trails),
    throttleSmooth: mean(smooth),
    // Desvío de 2 % del tiempo de vuelta = 0; vueltas idénticas = 1
    consistency: bestS && consistencyS !== null ? Math.max(0, Math.min(1, 1 - consistencyS / (bestS * 0.02))) : null,
    gripPct: gripMean !== null ? gripMean * 100 : null,
  }
}
