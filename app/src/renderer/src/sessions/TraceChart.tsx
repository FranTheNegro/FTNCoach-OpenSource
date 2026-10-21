/**
 * Canal contra distancia (SVG). Todas las vueltas comparten la grilla de
 * distancia, así que el cursor es un índice y se sincroniza entre gráficos y mapa.
 */
import { useRef, useState } from 'react'
import { useWidth } from '../hooks'

export interface Series {
  values: number[]
  color: string
  width?: number
  /** Escalones (marcha) en vez de línea. */
  step?: boolean
  opacity?: number
}

const LEFT = 44
const RIGHT = 8

export interface ChartMarks {
  /** Inicio de cada sector (0..1), sin el 0. */
  sectors: number[]
  corners: { pct: number; label: string; hot?: boolean }[]
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

export function TraceChart({
  title,
  unit,
  series,
  height = 160,
  domain,
  ticks,
  zeroLine,
  marks,
  cursor,
  onCursor,
  format = (v: number) => String(Math.round(v)),
  showCorners = false,
  range,
  onRange,
}: {
  title: string
  unit?: string
  series: Series[]
  height?: number
  domain?: [number, number]
  ticks?: number[]
  zeroLine?: boolean
  marks: ChartMarks
  cursor: number | null
  onCursor: (i: number | null) => void
  format?: (v: number) => string
  showCorners?: boolean
  /** Tramo visible (índices de la grilla). Sin él, la vuelta entera. */
  range?: [number, number] | null
  /** Arrastrar sobre el gráfico elige un tramo; doble clic vuelve a la vuelta entera (null). */
  onRange?: (r: [number, number] | null) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const drag = useRef<number | null>(null)
  const [sel, setSel] = useState<[number, number] | null>(null)
  const n = series[0]?.values.length ?? 0
  const i0 = range ? Math.max(0, range[0]) : 0
  const i1 = range ? Math.min(n - 1, range[1]) : n - 1
  let lo = Infinity
  let hi = -Infinity
  if (domain) [lo, hi] = domain
  else
    for (const s of series)
      for (let i = i0; i <= i1; i++) {
        const v = s.values[i]
        if (Number.isFinite(v)) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  if (!domain) {
    const padV = (hi - lo) * 0.08 || 1
    lo -= padV
    hi += padV
  }
  const top = showCorners ? 18 : 8
  const bottom = 6
  const plotW = Math.max(10, width - LEFT - RIGHT)
  const plotH = height - top - bottom
  const X = (i: number) => LEFT + ((i - i0) / Math.max(1, i1 - i0)) * plotW
  const Y = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * plotH
  const stride = Math.max(1, Math.floor((i1 - i0) / Math.max(200, plotW * 1.5)))
  const inView = (i: number) => i >= i0 && i <= i1

  const pathOf = (s: Series) => {
    let d = ''
    let pen = false
    let prevY = 0
    for (let i = i0; i <= i1; i += stride) {
      const v = s.values[i]
      if (!Number.isFinite(v)) {
        pen = false
        continue
      }
      const x = X(i).toFixed(1)
      const y = Y(v).toFixed(1)
      if (pen && s.step) d += `L${x} ${prevY}`
      d += `${pen ? 'L' : 'M'}${x} ${y}`
      prevY = Number(y)
      pen = true
    }
    return d
  }

  const tickValues = ticks ?? niceTicks(lo, hi)
  const indexAt = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left - LEFT
    if (x < 0 || x > plotW) return null
    return Math.round(i0 + (x / plotW) * (i1 - i0))
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = indexAt(e)
    onCursor(i)
    if (drag.current !== null && i !== null) setSel([Math.min(drag.current, i), Math.max(drag.current, i)])
  }
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onRange || e.button !== 0) return
    drag.current = indexAt(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onUp = () => {
    // Un tramo de al menos ~2 % de lo visible: si no, fue un clic
    if (onRange && sel && sel[1] - sel[0] > (i1 - i0) * 0.02) onRange(sel)
    drag.current = null
    setSel(null)
  }
  const curVals = cursor !== null ? series.map((s) => s.values[cursor]) : null

  return (
    <div ref={ref} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="data text-[11px] tracking-[0.12em] uppercase text-niebla">
          {title}
          {unit ? <span className="normal-case tracking-normal"> · {unit}</span> : null}
        </div>
        {curVals && (
          <div className="data text-[12px] flex gap-3">
            {curVals.map((v, k) => (
              <span key={k} style={{ color: series[k].color }}>
                {Number.isFinite(v) ? format(v) : '–'}
              </span>
            ))}
          </div>
        )}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className={`block touch-none select-none ${onRange ? 'cursor-crosshair' : ''}`}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={() => drag.current === null && onCursor(null)}
          onDoubleClick={() => onRange?.(null)}
          style={{ fontFamily: 'var(--ftn-font-data)' }}
        >
          {tickValues.map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={LEFT + plotW} y1={Y(t)} y2={Y(t)} stroke="var(--ftn-grafito)" />
              <text x={LEFT - 6} y={Y(t) + 4} fontSize={10} fill="var(--ftn-niebla)" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {zeroLine && lo < 0 && hi > 0 && <line x1={LEFT} x2={LEFT + plotW} y1={Y(0)} y2={Y(0)} stroke="var(--ftn-acero)" />}
          {marks.sectors
            .filter((p) => inView(p * (n - 1)))
            .map((p) => (
              <line key={p} x1={X(p * (n - 1))} x2={X(p * (n - 1))} y1={top} y2={top + plotH} stroke="var(--ftn-acero)" strokeDasharray="4 4" />
            ))}
          {showCorners &&
            marks.corners
              .filter((c) => inView(c.pct * (n - 1)))
              .map((c) => (
              <g key={c.label + c.pct}>
                <rect x={X(c.pct * (n - 1)) - 3} y={2} width={6} height={6} fill={c.hot ? 'var(--ftn-alerta)' : 'var(--ftn-acero)'} />
                <text x={X(c.pct * (n - 1)) + 6} y={9} fontSize={10} fill={c.hot ? 'var(--ftn-blanco)' : 'var(--ftn-niebla)'}>
                  {c.label}
                </text>
              </g>
            ))}
          {series.map((s, k) => (
            <path key={k} d={pathOf(s)} fill="none" stroke={s.color} strokeOpacity={s.opacity ?? 1} strokeWidth={s.width ?? 1.75} strokeLinejoin="round" />
          ))}
          {sel && <rect x={X(sel[0])} y={top} width={Math.max(1, X(sel[1]) - X(sel[0]))} height={plotH} fill="var(--ftn-azul)" fillOpacity={0.15} />}
          {cursor !== null && inView(cursor) && <line x1={X(cursor)} x2={X(cursor)} y1={top} y2={top + plotH} stroke="var(--ftn-plata)" strokeWidth={1} />}
        </svg>
      )}
    </div>
  )
}
