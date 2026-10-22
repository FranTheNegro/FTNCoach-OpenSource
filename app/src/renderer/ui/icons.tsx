/**
 * Pack de íconos de FTN Coach: lo propio del automovilismo que lucide no trae.
 * Mismas reglas que lucide (grilla de 24, línea de 2 px, extremos redondeados),
 * así que se usan igual que cualquier ícono de lucide, también con `Ico`.
 */
import { createLucideIcon, type LucideIcon } from 'lucide-react'

/** Pedal de freno: colgado desde arriba. */
export const BrakePedal = createLucideIcon('ftn-brake-pedal', [
  ['path', { d: 'M12 2v5', key: 'arm' }],
  ['rect', { x: '5', y: '7', width: '14', height: '14', rx: '2', key: 'pad' }],
  ['path', { d: 'M9 12h6', key: 'groove1' }],
  ['path', { d: 'M9 16h6', key: 'groove2' }],
])

/** Acelerador: pedal de piso, articulado abajo. */
export const ThrottlePedal = createLucideIcon('ftn-throttle-pedal', [
  ['rect', { x: '7.5', y: '2', width: '9', height: '16', rx: '2', key: 'pad' }],
  ['path', { d: 'M12 6v8', key: 'groove' }],
  ['path', { d: 'M5 22h14', key: 'floor' }],
  ['path', { d: 'M12 18v4', key: 'hinge' }],
])

/** Turn-in: la recta que empieza a doblar. */
export const TurnIn = createLucideIcon('ftn-turn-in', [
  ['path', { d: 'M6 22v-8a8 8 0 0 1 8-8h4', key: 'line' }],
  ['path', { d: 'm15 3 3 3-3 3', key: 'head' }],
])

/** Apex: el punto interior de la curva. */
export const Apex = createLucideIcon('ftn-apex', [
  ['path', { d: 'M3 22v-4A15 15 0 0 1 18 3h3', key: 'edge' }],
  ['path', { d: 'm13 10 2.5 2.5L13 15l-2.5-2.5Z', key: 'point' }],
])

/** Trail-braking: freno que se sostiene mientras el auto dobla. */
export const TrailBrake = createLucideIcon('ftn-trail-brake', [
  ['path', { d: 'M4 4h6', key: 'brake-on' }],
  ['path', { d: 'M4 4v8a8 8 0 0 0 8 8h8', key: 'line' }],
  ['path', { d: 'm17 17 3 3-3 3', key: 'head' }],
])

/** Salida de pista: el auto cruza el borde. */
export const OffTrack = createLucideIcon('ftn-off-track', [
  ['path', { d: 'M4 2v20', key: 'edge-l' }],
  ['path', { d: 'M12 2v6', key: 'edge-r1' }],
  ['path', { d: 'M12 16v6', key: 'edge-r2' }],
  ['path', { d: 'M7 17 19 7', key: 'line' }],
  ['path', { d: 'M15 7h4v4', key: 'head' }],
])

/** Piano: el diente de sierra del kerb. */
export const Kerb = createLucideIcon('ftn-kerb', [
  ['path', { d: 'm2 16 3-5 3 5 3-5 3 5 3-5 3 5 3-5', key: 'teeth' }],
  ['path', { d: 'M2 20h20', key: 'edge' }],
])

/** Calle de boxes: sale de la recta y pasa frente a los garajes. */
export const PitLane = createLucideIcon('ftn-pit-lane', [
  ['path', { d: 'M2 4h20', key: 'straight' }],
  ['path', { d: 'M5 4c2 0 2 5 5 5h4c3 0 3-5 5-5', key: 'lane' }],
  ['path', { d: 'M4 21v-7h16v7', key: 'boxes' }],
  ['path', { d: 'M9.5 14v7', key: 'wall1' }],
  ['path', { d: 'M14.5 14v7', key: 'wall2' }],
])

/** Neumático visto de costado. */
export const Tyre = createLucideIcon('ftn-tyre', [
  ['circle', { cx: '12', cy: '12', r: '9', key: 'outer' }],
  ['circle', { cx: '12', cy: '12', r: '4', key: 'rim' }],
  ['path', { d: 'M12 3v2', key: 't1' }],
  ['path', { d: 'M12 19v2', key: 't2' }],
  ['path', { d: 'M3 12h2', key: 't3' }],
  ['path', { d: 'M19 12h2', key: 't4' }],
])

/** Volante. */
export const SteeringWheel = createLucideIcon('ftn-steering-wheel', [
  ['circle', { cx: '12', cy: '12', r: '9', key: 'rim' }],
  ['circle', { cx: '12', cy: '12', r: '2.5', key: 'hub' }],
  ['path', { d: 'M9.5 12H3', key: 'spoke-l' }],
  ['path', { d: 'M14.5 12H21', key: 'spoke-r' }],
  ['path', { d: 'M12 14.5V21', key: 'spoke-b' }],
])

/** Palanca en H: la marcha. */
export const Shifter = createLucideIcon('ftn-shifter', [
  ['path', { d: 'M5 4v16', key: 'g1' }],
  ['path', { d: 'M12 4v16', key: 'g2' }],
  ['path', { d: 'M19 4v8', key: 'g3' }],
  ['path', { d: 'M5 12h14', key: 'gate' }],
])

/** Delta: diferencia contra la referencia. */
export const Delta = createLucideIcon('ftn-delta', [['path', { d: 'M12 4 21 20H3Z', key: 'tri' }]])

/** Sector o parcial: el arco de cronometraje sobre la pista. */
export const Split = createLucideIcon('ftn-split', [
  ['path', { d: 'M2 20h20', key: 'road' }],
  ['path', { d: 'M6 20V6h12v14', key: 'gantry' }],
  ['path', { d: 'M9 10h6', key: 'beam' }],
])

/** Tramo de rally: el camino que serpentea hasta la bandera. */
export const Stage = createLucideIcon('ftn-stage', [
  ['path', { d: 'M3 21c4 0 3-7 8-7s4-6 8-6', key: 'road' }],
  ['path', { d: 'M19 8V2', key: 'pole' }],
  ['path', { d: 'm19 2-4 1.5L19 5', key: 'flag' }],
])

/** Luces de cambio: las RPM que suben hasta el corte. */
export const ShiftLights = createLucideIcon('ftn-shift-lights', [
  ['path', { d: 'M4 17v3', key: 'l1' }],
  ['path', { d: 'M8 14v6', key: 'l2' }],
  ['path', { d: 'M12 11v9', key: 'l3' }],
  ['path', { d: 'M16 8v12', key: 'l4' }],
  ['path', { d: 'M20 4v16', key: 'l5' }],
])

/** Muestra de leyenda: un tramo de la misma línea que representa. */
export function LineSwatch({ color, width = 2.5, dashed = false }: { color: string; width?: number; dashed?: boolean }) {
  return (
    <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M1 4h16" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dashed ? '3 3' : undefined} />
    </svg>
  )
}

/**
 * Flecha del auto en el mapa (apunta hacia arriba, −y, antes de rotar), centrada en 0,0 y de
 * lado 1: se escala y se rota con `transform`. Rellena para que se lea chica.
 */
export const CAR_ARROW_PATH = 'M0 -0.5 0.38 0.42 0 0.22 -0.38 0.42Z'

/** Rombo de lado 1 centrado en 0,0: el punto de los gráficos de valores. */
export const DIAMOND_PATH = 'M0 -0.5 0.5 0 0 0.5 -0.5 0Z'

/** Ícono de la fase de la curva según el título del consejo ("T7 · FRENADA", "T3 · SALIDA DE PISTA"…). */
export function phaseIcon(title: string): LucideIcon {
  const t = title.toUpperCase()
  if (/SALIDA DE PISTA|OFF.?TRACK/.test(t)) return OffTrack
  if (/FRENAD|BRAK/.test(t)) return BrakePedal
  if (/V[ÉE]RTICE|APEX/.test(t)) return Apex
  if (/SALIDA|EXIT|TRACCI/.test(t)) return ThrottlePedal
  if (/ENTRADA|ENTRY|TURN/.test(t)) return TurnIn
  return Apex
}

export function PhaseIcon({ title, size = 15, color }: { title: string; size?: number; color?: string }) {
  const Icon = phaseIcon(title)
  return <Icon size={size} color={color} className="shrink-0" aria-hidden="true" />
}

/** Muestra de leyenda para barras: una barra corta del mismo color (o solo el contorno). */
export function BarSwatch({ color, outline = false }: { color: string; outline?: boolean }) {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="0.5" y="0.5" width="7" height="11" rx="1.5" fill={outline ? 'none' : color} stroke={outline ? color : 'none'} strokeDasharray={outline ? '2 2' : undefined} />
    </svg>
  )
}
