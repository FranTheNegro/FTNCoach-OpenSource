/** Gráficos chicos de evolución (mejor vuelta por día). Más rápido = más arriba. */
import * as fmt from '@ui/format'
import { useWidth } from '../hooks'

export function Sparkline({ values, height = 44, color = 'var(--ftn-azul)' }: { values: number[]; height?: number; color?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const X = (i: number) => 4 + (i / Math.max(1, values.length - 1)) * (w - 8)
  const Y = (v: number) => 4 + ((v - lo) / (hi - lo || 1)) * (height - 8)
  const pb = values.indexOf(lo)
  return (
    <div ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} className="block">
          <path d={values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={2} />
          {values.map((v, i) => (
            <rect key={i} x={X(i) - (i === pb ? 4 : 2.5)} y={Y(v) - (i === pb ? 4 : 2.5)} width={i === pb ? 8 : 5} height={i === pb ? 8 : 5} fill={i === pb ? 'var(--ftn-mejor)' : color} />
          ))}
        </svg>
      )}
    </div>
  )
}

/** Mejor vuelta por día con eje de tiempos, línea del PB y cursor. */
export function BestLapChart({ points, height = 260 }: { points: { label: string; bestS: number }[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const LEFT = 70
  const RIGHT = 16
  const TOP = 12
  const BOTTOM = 28
  const vals = points.map((p) => p.bestS)
  const pb = Math.min(...vals)
  let lo = pb
  let hi = Math.max(...vals)
  const pad = (hi - lo) * 0.12 || 0.5
  lo -= pad
  hi += pad
  const plotW = Math.max(10, w - LEFT - RIGHT)
  const plotH = height - TOP - BOTTOM
  const X = (i: number) => LEFT + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const Y = (v: number) => TOP + ((v - lo) / (hi - lo)) * plotH
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3)
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 70))))
  return (
    <div ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} className="block" style={{ fontFamily: 'var(--ftn-font-data)' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={LEFT + plotW} y1={Y(t)} y2={Y(t)} stroke="var(--ftn-grafito)" />
              <text x={LEFT - 8} y={Y(t) + 4} fontSize={11} fill="var(--ftn-niebla)" textAnchor="end">
                {fmt.lapTime(t)}
              </text>
            </g>
          ))}
          <line x1={LEFT} x2={LEFT + plotW} y1={Y(pb)} y2={Y(pb)} stroke="var(--ftn-mejor)" strokeDasharray="4 4" />
          <path d={points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.bestS).toFixed(1)}`).join('')} fill="none" stroke="var(--ftn-azul)" strokeWidth={2.5} />
          {points.map((p, i) => {
            const isPb = p.bestS === pb
            const s = isPb ? 9 : 6
            return (
              <g key={i}>
                <rect x={X(i) - s / 2} y={Y(p.bestS) - s / 2} width={s} height={s} fill={isPb ? 'var(--ftn-mejor)' : 'var(--ftn-azul)'}>
                  <title>{`${p.label} · ${fmt.lapTime(p.bestS)}`}</title>
                </rect>
                {i % every === 0 && (
                  <text x={X(i)} y={height - 8} fontSize={11} fill="var(--ftn-niebla)" textAnchor="middle">
                    {p.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
