/**
 * Mapa del trazado: el asfalto real (dato fijo, nunca generado con las vueltas)
 * y encima las trazadas del piloto. Coordenadas en metros, y hacia abajo.
 */
import type { TrackGeometry } from '@shared/analysis'

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
}: {
  map: TrackGeometry | null
  lines?: MapLine[]
  markers?: MapMarker[]
  className?: string
  showLabels?: boolean
  /** Acerca el mapa a esta zona (p. ej. la curva elegida). */
  focus?: { minX: number; minY: number; maxX: number; maxY: number } | null
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
            <rect x={m.x - s / 2} y={m.y - s / 2} width={s} height={s} fill={m.color} />
            {m.label && (
              <text x={m.x + s} y={m.y} fontSize={font} fill="var(--ftn-blanco)" fontFamily="var(--ftn-font-data)" dominantBaseline="middle">
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
