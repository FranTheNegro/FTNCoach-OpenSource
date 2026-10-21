/**
 * Diagrama G-G: aceleración lateral contra longitudinal de la vuelta analizada y
 * la referencia. Cuanto más llena el círculo, más grip usa el piloto; los huecos
 * entre frenada y curva son el trail-braking que falta.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { LapTrace } from '@shared/analysis'
import { useWidth } from '../hooks'
import { Label } from '../components/ui'

const A = '#5b7bff'
const B = '#b77cff'

interface Stats {
  lat: number
  brake: number
  accel: number
  /** Uso medio del grip combinado mientras hay carga (|g| > 0,3). */
  combined: number
  /** % del tiempo de frenada con carga lateral (trail-braking). */
  trail: number | null
}

function statsOf(t: LapTrace, i0: number, i1: number): Stats {
  let lat = 0
  let brake = 0
  let accel = 0
  let sum = 0
  let cnt = 0
  let braking = 0
  let trailing = 0
  for (let i = i0; i <= i1; i++) {
    const x = t.gLat[i]
    const y = t.gLon[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    lat = Math.max(lat, Math.abs(x))
    brake = Math.max(brake, -y)
    accel = Math.max(accel, y)
    const g = Math.hypot(x, y)
    if (g > 0.3) {
      sum += g
      cnt++
    }
    if (t.brake[i] > 0.1) {
      braking++
      if (Math.abs(x) > 0.4) trailing++
    }
  }
  return { lat, brake, accel, combined: cnt ? sum / cnt : 0, trail: braking > 10 ? (100 * trailing) / braking : null }
}

export function GgDiagram({
  a,
  b,
  labelA,
  labelB,
  range,
  cursor,
}: {
  a: LapTrace
  b: LapTrace | null
  labelA: string
  labelB: string | null
  range: [number, number] | null
  cursor: number | null
}) {
  const [box, width] = useWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const n = a.gLat.length
  const i0 = range?.[0] ?? 0
  const i1 = range?.[1] ?? n - 1
  const size = Math.min(width, 560)

  const sa = useMemo(() => statsOf(a, i0, i1), [a, i0, i1])
  const sb = useMemo(() => (b ? statsOf(b, i0, i1) : null), [b, i0, i1])
  const maxG = Math.max(1.5, Math.ceil(Math.max(sa.lat, sa.brake, sa.accel, sb?.lat ?? 0, sb?.brake ?? 0) * 2 + 0.2) / 2)

  useEffect(() => {
    const c = canvas.current
    if (!c || size <= 0) return
    const dpr = window.devicePixelRatio || 1
    c.width = size * dpr
    c.height = size * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size, size)
    const mid = size / 2
    const r = mid - 28
    const P = (g: number) => (g / maxG) * r

    ctx.strokeStyle = '#2c313a'
    ctx.fillStyle = '#8e96a3'
    ctx.font = '11px "JetBrains Mono Variable", monospace'
    ctx.lineWidth = 1
    for (let g = 0.5; g <= maxG + 1e-6; g += 0.5) {
      ctx.beginPath()
      ctx.arc(mid, mid, P(g), 0, Math.PI * 2)
      ctx.stroke()
      if (Number.isInteger(g)) ctx.fillText(`${g} g`, mid + P(g) * 0.71 + 4, mid - P(g) * 0.71 - 4)
    }
    ctx.strokeStyle = '#3a404b'
    ctx.beginPath()
    ctx.moveTo(mid, 12)
    ctx.lineTo(mid, size - 12)
    ctx.moveTo(12, mid)
    ctx.lineTo(size - 12, mid)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillText('ACELERA', mid, 10)
    ctx.fillText('FRENA', mid, size - 2)
    ctx.textAlign = 'left'
    ctx.fillText('IZQ', 2, mid - 6)
    ctx.textAlign = 'right'
    ctx.fillText('DER', size - 2, mid - 6)

    const dots = (t: LapTrace, color: string, alpha: number) => {
      ctx.fillStyle = color
      ctx.globalAlpha = alpha
      const step = Math.max(1, Math.floor((i1 - i0) / 2500))
      for (let i = i0; i <= i1; i += step) {
        const x = t.gLat[i]
        const y = t.gLon[i]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        ctx.fillRect(mid + P(x) - 1.25, mid - P(y) - 1.25, 2.5, 2.5)
      }
      ctx.globalAlpha = 1
    }
    if (b) dots(b, B, 0.35)
    dots(a, A, 0.6)
    if (cursor !== null && Number.isFinite(a.gLat[cursor])) {
      ctx.fillStyle = '#f0f3fa'
      ctx.fillRect(mid + P(a.gLat[cursor]) - 4, mid - P(a.gLon[cursor]) - 4, 8, 8)
    }
  }, [a, b, i0, i1, size, maxG, cursor])

  const rows: [string, (s: Stats) => string][] = [
    ['G lateral máx', (s) => `${s.lat.toFixed(2)} g`],
    ['Frenada máx', (s) => `${s.brake.toFixed(2)} g`],
    ['Aceleración máx', (s) => `${s.accel.toFixed(2)} g`],
    ['Grip combinado medio', (s) => `${s.combined.toFixed(2)} g`],
    ['Frenada con carga lateral', (s) => (s.trail !== null ? `${Math.round(s.trail)} %` : '–')],
  ]

  return (
    <div className="flex gap-5 items-start">
      <section className="flex-1 min-w-0 bg-carbono-2 border border-grafito rounded-panel px-6 py-5">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-[16px] font-bold">Círculo de fricción{range ? ' · tramo elegido' : ''}</h2>
          <div className="flex gap-4 data text-[12px] text-plata">
            {labelB && (
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5" style={{ background: B }} />
                {labelB}
              </span>
            )}
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5" style={{ background: A }} />
              {labelA}
            </span>
          </div>
        </div>
        <div ref={box} className="w-full flex justify-center">
          <canvas ref={canvas} style={{ width: size, height: size }} />
        </div>
      </section>
      <aside className="w-[380px] shrink-0 bg-carbono-2 border border-grafito rounded-panel px-5 py-4">
        <Label>Uso del grip</Label>
        <table className="w-full mt-3 data text-[13px]">
          <thead>
            <tr className="text-niebla text-[11px] tracking-[0.08em] uppercase">
              <th className="text-left font-normal pb-2" />
              <th className="text-right font-normal pb-2" style={{ color: A }}>
                {labelA}
              </th>
              {sb && (
                <th className="text-right font-normal pb-2" style={{ color: B }}>
                  {labelB}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label} className="border-t border-grafito">
                <td className="py-2.5 font-ui text-plata">{label}</td>
                <td className="py-2.5 text-right">{f(sa)}</td>
                {sb && <td className="py-2.5 text-right text-plata">{f(sb)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px] text-niebla leading-snug mt-4">
          Un borde lleno y redondo es usar todo el grip. Si los puntos dibujan una cruz (frenás derecho y después doblás), falta trail-braking: soltá el
          freno de a poco mientras girás.
        </p>
      </aside>
    </div>
  )
}
