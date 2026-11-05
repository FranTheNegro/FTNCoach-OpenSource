/**
 * Puntos clave de cada curva sobre el mapa: dónde frenás, doblás, pasás por el
 * vértice y volvés a fondo, con la diferencia contra la referencia.
 */
import type { CompareResult, SessionDetail } from '@shared/analysis'
import type { MapMarker } from '@ui/TrackMapSvg'
import { Apex, BrakePedal, OffTrack, ThrottlePedal, TurnIn } from '@ui/icons'

/** "12 m antes" / "8 m después" (sin texto si la diferencia es chica). */
function metres(a: number | null | undefined, b: number | null | undefined): string | undefined {
  if (a === null || a === undefined || b === null || b === undefined) return undefined
  const d = Math.round(a - b)
  if (Math.abs(d) < 3) return undefined
  return d < 0 ? `${-d} m antes` : `${d} m después`
}

/**
 * `cornerIds`: las curvas a marcar (las del tramo elegido o las de los consejos).
 * Las distancias de las pasadas están en metros desde el inicio de la vuelta.
 */
export function keyPoints(d: SessionDetail, cmp: CompareResult, cornerIds: number[]): MapMarker[] {
  const { x, y } = cmp.a
  if (!x || !y) return []
  const step = d.distM[1] ?? 2
  const at = (m: number) => {
    const i = Math.max(0, Math.min(x.length - 1, Math.round(m / step)))
    return Number.isFinite(x[i]) && Number.isFinite(y[i]) ? { x: x[i], y: y[i] } : null
  }
  const out: MapMarker[] = []
  const push = (m: number | null | undefined, marker: Omit<MapMarker, 'x' | 'y'>) => {
    if (m === null || m === undefined) return
    const p = at(m)
    if (p) out.push({ ...p, ...marker })
  }
  for (const id of cornerIds) {
    const k = d.corners.findIndex((c) => c.id === id)
    const a = cmp.passesA[k]
    const b = cmp.passesB[k]
    if (k < 0 || !a) continue
    const corner = d.corners[k].label
    // Cada punto dice qué es y, si difiere, cuánto contra la referencia
    const point = (m: number | null | undefined, legend: string, what: string, color: string, icon: MapMarker['icon'], label: string | undefined) =>
      push(m, { color, icon, size: 0.8, label, legend, title: `${corner} · ${what}${label ? `: ${label} que la referencia` : ''}` })
    point(a.brakeM, 'Frenada', 'dónde empezás a frenar', 'var(--ftn-error)', BrakePedal, metres(a.brakeM, b?.brakeM))
    point(a.turnInM, 'Turn-in', 'dónde empezás a doblar', 'var(--ftn-azul)', TurnIn, metres(a.turnInM, b?.turnInM))
    const kmh = b ? Math.round(a.minKmh - b.minKmh) : 0
    const apex = Math.abs(kmh) >= 2 ? `${kmh > 0 ? '+' : '−'}${Math.abs(kmh)} km/h` : undefined
    push(a.minM, { color: 'var(--ftn-plata)', icon: Apex, size: 0.8, label: apex, legend: 'Apex', title: `${corner} · apex, tu velocidad mínima${apex ? `: ${apex} contra la referencia` : ''}` })
    point(a.fullThrottleM, 'A fondo', 'dónde volvés a fondo', 'var(--ftn-record)', ThrottlePedal, metres(a.fullThrottleM, b?.fullThrottleM))
    if (a.offTrack) {
      const c = d.corners[k]
      const from = Math.round(c.startPct * (x.length - 1))
      const to = Math.round(c.endPct * (x.length - 1))
      const i = cmp.a.off.findIndex((v, j) => j >= from && j <= to && v > 0)
      if (i >= 0) push(i * step, { color: 'var(--ftn-alerta)', icon: OffTrack, size: 0.8, label: 'fuera de pista', legend: 'Fuera de pista', title: `${corner} · saliste de pista` })
    }
  }
  return out
}
