/**
 * Mapa del trazado: el asfalto real (dato fijo, nunca generado con las vueltas)
 * y encima las trazadas del piloto. Coordenadas en metros, y hacia abajo.
 */
import type { LucideIcon } from 'lucide-react'
import type { TrackGeometry } from '@shared/analysis'
import { CAR_ARROW_PATH, DIAMOND_PATH } from './icons'

export interface MapLine {
  x: number[]
  y: number[]
  color: string
  width?: number
  /** 1 donde la vuelta estuvo fuera de pista (se pinta en alerta). */
  off?: number[]
  /** Color de cada punto (pinta la trazada por tramos: delta, velocidad, mandos). */
  colors?: string[]
}

export interface MapMarker {
  x: number
  y: number
  color: string
  label?: string
  size?: number
  /** Sentido de marcha (rad, atan2 de dy y dx en el mapa): se dibuja como la flecha del auto. */
  heading?: number | null
  /** Qué marca el punto (frenada, apex…): se dibuja el ícono en una placa. Sin ícono ni sentido, un rombo. */
  icon?: LucideIcon
}

/** Sentido de marcha entre dos puntos del mapa, o null si están casi encima. */
export function headingOf(x0: number, y0: number, x1: number, y1: number, minM = 0.5): number | null {
  const dx = x1 - x0
  const dy = y1 - y0
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < minM) return null
  return Math.atan2(dy, dx)
}

/** Sentido de marcha en el punto `i` de una vuelta (mirando unos puntos adelante). */
export function headingAt(x: number[], y: number[], i: number): number | null {
  const j = Math.min(x.length - 1, i + 3)
  const k = j > i ? i : Math.max(0, i - 3)
  return headingOf(x[k], y[k], x[j], y[j])
}

/** Punto y sentido de la línea de la vuelta en `pct` (0..1). */
function along(line: [number, number][], pct: number): { x: number; y: number; h: number } {
  const n = line.length
  const i = Math.max(0, Math.min(n - 1, Math.round(pct * (n - 1))))
  const a = line[Math.max(0, i - 2)]
  const b = line[Math.min(n - 1, i + 2)]
  return { x: line[i][0], y: line[i][1], h: Math.atan2(b[1] - a[1], b[0] - a[0]) }
}

/** Marcas fijas sobre la pista: el sentido de giro y dónde empieza cada sector. */
function TrackMarks({ line, sectorsPct, font }: { line: [number, number][]; sectorsPct: number[] | null; font: number }) {
  const dir = along(line, 0.025)
  const deg = (h: number) => (h * 180) / Math.PI
  return (
    <g>
      <path
        d="M-0.5 -0.45 0.35 0 -0.5 0.45"
        transform={`translate(${dir.x} ${dir.y}) rotate(${deg(dir.h)}) scale(${font * 1.1})`}
        fill="none"
        stroke="var(--ftn-blanco)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        aria-label="Sentido de giro"
      />
      {(sectorsPct ?? [])
        .filter((p) => p > 0 && p < 1)
        .map((p, k) => {
          const m = along(line, p)
          const nx = -Math.sin(m.h)
          const ny = Math.cos(m.h)
          const half = font * 0.9
          return (
            <g key={p}>
              <path
                d={`M${m.x - nx * half} ${m.y - ny * half}L${m.x + nx * half} ${m.y + ny * half}`}
                stroke="var(--ftn-plata)"
                strokeWidth={2.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={m.x + nx * half * 2}
                y={m.y + ny * half * 2}
                fontSize={font * 0.8}
                fill="var(--ftn-plata)"
                fontFamily="var(--ftn-font-data)"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                S{k + 2}
              </text>
            </g>
          )
        })}
    </g>
  )
}

function Marker({ m, font }: { m: MapMarker; font: number }) {
  const s = (m.size ?? 1) * font * 0.7
  if (m.heading !== undefined && m.heading !== null) {
    const k = s * 2.2
    return (
      <path
        d={CAR_ARROW_PATH}
        transform={`translate(${m.x} ${m.y}) rotate(${(m.heading * 180) / Math.PI + 90}) scale(${k})`}
        fill={m.color}
        stroke="var(--ftn-carbono)"
        strokeWidth={0.08}
        strokeLinejoin="round"
      />
    )
  }
  if (m.icon) {
    const Icon = m.icon
    const b = s * 2.4
    return (
      <g>
        <rect x={m.x - b / 2} y={m.y - b / 2} width={b} height={b} rx={b * 0.22} fill="var(--ftn-carbono)" stroke={m.color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <Icon x={m.x - b * 0.35} y={m.y - b * 0.35} width={b * 0.7} height={b * 0.7} color={m.color} strokeWidth={2.4} aria-hidden="true" />
      </g>
    )
  }
  return <path d={DIAMOND_PATH} transform={`translate(${m.x} ${m.y}) scale(${s * 1.3})`} fill={m.color} />
}

function pathOf(x: number[], y: number[], from = 0, to = x.length, step = 1): string {
  let d = ''
  let pen = false
  for (let i = from; i < to; i += step) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${x[i].toFixed(1)} ${y[i].toFixed(1)}`
    pen = true
  }
  return d
}

/** Tramos consecutivos del mismo color, unidos punta con punta. */
function colorRuns(l: MapLine, step: number): { d: string; color: string }[] {
  const out: { d: string; color: string }[] = []
  const colors = l.colors!
  let from = 0
  for (let i = step; i <= l.x.length; i += step) {
    if (i < l.x.length && colors[i] === colors[from]) continue
    const to = Math.min(l.x.length - 1, i)
    out.push({ d: pathOf(l.x, l.y, from, to + 1, step), color: colors[from] })
    from = to
  }
  return out
}

function polygons(contours: [number, number][][]): string {
  return contours.map((c) => `M${c.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`).join('')
}

function boundsOf(map: TrackGeometry | null, lines: MapLine[]) {
  if (map && Number.isFinite(map.bounds.minX)) return map.bounds
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const l of lines)
    for (let i = 0; i < l.x.length; i++) {
      const x = l.x[i]
      const y = l.y[i]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

export function TrackMapSvg({
  map,
  lines = [],
  markers = [],
  className = '',
  showLabels = true,
  focus = null,
  sectorsPct = null,
}: {
  map: TrackGeometry | null
  lines?: MapLine[]
  markers?: MapMarker[]
  className?: string
  showLabels?: boolean
  /** Acerca el mapa a esta zona (p. ej. la curva elegida). */
  focus?: { minX: number; minY: number; maxX: number; maxY: number } | null
  /** Inicio de cada sector (0..1): se marcan sobre la pista. */
  sectorsPct?: number[] | null
}) {
  const full = boundsOf(map, lines)
  if (!full) return null
  const b = focus ?? full
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1)
  const pad = span * 0.06
  const vb = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`
  // Relativo a lo visible: al acercar, textos y marcadores conservan su tamaño en pantalla
  const font = span / 38
  const step = Math.max(1, Math.floor((lines[0]?.x.length ?? 0) / 2500))

  return (
    <svg viewBox={vb} className={className} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa del trazado">
      {map && map.asphalt.length > 0 && (
        <path d={polygons(map.asphalt)} fill="var(--ftn-grafito)" fillRule="nonzero" stroke="var(--ftn-acero)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      )}
      {map && !map.asphalt.length && map.pctLine && (
        <path d={pathOf(map.pctLine.map((p) => p[0]), map.pctLine.map((p) => p[1]))} fill="none" stroke="var(--ftn-acero)" strokeWidth={6} vectorEffect="non-scaling-stroke" />
      )}
      {map?.pitLane?.map((c, i) => (
        <path
          key={`pit${i}`}
          d={pathOf(c.map((p) => p[0]), c.map((p) => p[1]))}
          fill="none"
          stroke="var(--ftn-niebla)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {map?.pctLine && <TrackMarks line={map.pctLine} sectorsPct={sectorsPct} font={font} />}
      {map?.startFinish.map((c, i) =>
        c.length > 2 ? (
          <path key={i} d={polygons([c])} fill="var(--ftn-blanco)" />
        ) : (
          <path key={i} d={pathOf(c.map((p) => p[0]), c.map((p) => p[1]))} stroke="var(--ftn-blanco)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        ),
      )}
      {lines.map((l, k) => (
        <g key={k}>
          {l.colors ? (
            colorRuns(l, step).map((r, i) => (
              <path key={i} d={r.d} fill="none" stroke={r.color} strokeWidth={l.width ?? 2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))
          ) : (
            <path d={pathOf(l.x, l.y, 0, l.x.length, step)} fill="none" stroke={l.color} strokeWidth={l.width ?? 2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
          {l.off &&
            offRuns(l.off).map(([a, z], i) => (
              <path key={i} d={pathOf(l.x, l.y, a, z + 1)} fill="none" stroke="var(--ftn-alerta)" strokeWidth={(l.width ?? 2) + 1.5} vectorEffect="non-scaling-stroke" />
            ))}
        </g>
      ))}
      {showLabels &&
        map?.labels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y}
            fontSize={l.turn !== null ? font : font * 0.8}
            fill={l.turn !== null ? 'var(--ftn-plata)' : 'var(--ftn-niebla)'}
            fontFamily="var(--ftn-font-data)"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {l.text}
          </text>
        ))}
      {markers.map((m, i) => {
        const s = (m.size ?? 1) * font * 0.7
        return (
          <g key={i}>
            <Marker m={m} font={font} />
            {m.label && (
              <text x={m.x + s * (m.icon ? 1.6 : 1)} y={m.y} fontSize={font} fill="var(--ftn-blanco)" fontFamily="var(--ftn-font-data)" dominantBaseline="middle">
                {m.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function offRuns(off: number[]): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  for (let i = 0; i <= off.length; i++) {
    if (i < off.length && off[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      runs.push([Math.max(0, start - 1), i - 1])
      start = -1
    }
  }
  return runs
}
