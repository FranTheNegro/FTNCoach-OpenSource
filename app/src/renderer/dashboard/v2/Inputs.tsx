/** Pantalla "Inputs": trazas de pedales y volante, círculo de fuerzas G. */
import { useEffect, useRef } from 'react'
import { ChevronsUp, Disc3, OctagonX } from 'lucide-react'
import type { LiveFrame } from '@shared/live'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import type { History } from '@ui/live-client'
import { C, Ico, Lbl } from './kit'

const TRACE_SAMPLES = 300
const GG_MAX = 2.5
const GG_TRAIL = 90

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Ajusta el canvas a su tamaño en pantalla (nítido en pantallas retina). */
function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1
  const { width, height } = canvas.getBoundingClientRect()
  const w = Math.round(width * dpr)
  const h = Math.round(height * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

function drawTrace(canvas: HTMLCanvasElement, h: History, colors: Record<string, string>) {
  const ctx = fit(canvas)
  const { width: W, height: H } = canvas.getBoundingClientRect()
  ctx.clearRect(0, 0, W, H)
  const top = 12
  const bottom = 12
  const plotH = H - top - bottom
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(top + plotH * (1 - q)) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  ctx.setLineDash([])
  const n = Math.min(h.count, TRACE_SAMPLES)
  const first = h.count - n
  const line = (arr: Float32Array, color: string, map: (v: number) => number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    for (let k = 0; k < n; k++) {
      const x = W - ((n - 1 - k) / (TRACE_SAMPLES - 1)) * W
      const y = top + plotH * (1 - map(arr[h.at(first + k)]))
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  line(h.steer, colors.steer, (v) => 0.5 + v / 2)
  line(h.brake, colors.brake, (v) => v)
  line(h.throttle, colors.throttle, (v) => v)
}

function drawGG(canvas: HTMLCanvasElement, h: History, colors: Record<string, string>) {
  const ctx = fit(canvas)
  const { width: W, height: H } = canvas.getBoundingClientRect()
  ctx.clearRect(0, 0, W, H)
  const cx = W / 2
  const cy = H / 2
  const r = Math.min(W, H) / 2 - 6
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  for (const g of [1, 2]) {
    ctx.beginPath()
    ctx.arc(cx, cy, (r * g) / GG_MAX, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(cx - r, cy)
  ctx.lineTo(cx + r, cy)
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx, cy + r)
  ctx.stroke()
  ctx.fillStyle = colors.text
  ctx.font = `11px ${css('--ftn-font-data')}`
  ctx.fillText('1G', cx + (r * 1) / GG_MAX + 3, cy - 4)
  ctx.fillText('2G', cx + (r * 2) / GG_MAX + 3, cy - 4)

  const n = Math.min(h.count, GG_TRAIL)
  const first = h.count - n
  const pos = (k: number) => {
    const i = h.at(first + k)
    // Frenando, el punto va arriba (como en el auto: la carga va hacia adelante)
    return [cx + (h.gLat[i] / GG_MAX) * r, cy + (h.gLon[i] / GG_MAX) * r] as const
  }
  for (let k = 1; k < n; k++) {
    const [x0, y0] = pos(k - 1)
    const [x1, y1] = pos(k)
    ctx.strokeStyle = colors.steer
    ctx.globalAlpha = k / n
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  if (n) {
    const [x, y] = pos(n - 1)
    // Marcador de la marca: cuadrado, nunca círculo
    ctx.fillStyle = colors.now
    ctx.fillRect(x - 6, y - 6, 12, 12)
  }
}

export function Inputs({ f, history, units }: { f: LiveFrame; history: History; units: Units }) {
  const trace = useRef<HTMLCanvasElement>(null)
  const gg = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const colors = {
      grid: css('--ftn-grafito'),
      text: css('--ftn-niebla'),
      throttle: css('--ftn-record'),
      brake: css('--ftn-error'),
      steer: css('--ftn-azul'),
      now: css('--ftn-blanco'),
    }
    let raf = 0
    const loop = () => {
      if (trace.current) drawTrace(trace.current, history, colors)
      if (gg.current) drawGG(gg.current, history, colors)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [history])

  const live = [
    { icon: ChevronsUp, color: C.record, v: `${Math.round(f.throttle * 100)} %`, label: 'Acelerador' },
    { icon: OctagonX, color: C.error, v: `${Math.round(f.brake * 100)} %`, label: 'Freno' },
    { icon: Disc3, color: C.azul, v: `${Math.round(f.steer * 100)} %`, label: 'Volante' },
  ]
  const stats = [
    { k: 'Lateral', v: `${f.gLat.toFixed(2)} G` },
    { k: 'Longitudinal', v: `${f.gLon.toFixed(2)} G` },
    { k: 'Velocidad', v: `${Math.round(fmt.speed(f.speedKmh, units))} ${fmt.unitLabel.speed(units)}` },
    { k: 'Marcha', v: fmt.gear(f.gear) },
  ]

  return (
    <main className="d2-body d2-inputs">
      <section className="d2-panel" style={{ minHeight: 0, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {live.map((l) => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={l.label}>
              <Ico icon={l.icon} size={24} color={l.color} />
              <span className="d2-mono" style={{ fontWeight: 700, fontSize: 20, color: C.blanco, minWidth: 64 }}>{l.v}</span>
            </div>
          ))}
        </div>
        <div className="d2-canvasbox">
          <canvas ref={trace} />
        </div>
      </section>
      <div className="d2-colv">
        <section className="d2-panel fill">
          <Lbl>Fuerzas G</Lbl>
          <div className="d2-canvasbox">
            <canvas ref={gg} />
          </div>
        </section>
        <section className="d2-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
          {stats.map((s) => (
            <div key={s.k} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <Lbl>{s.k}</Lbl>
              <span className="d2-mono" style={{ fontWeight: 700, fontSize: 24, whiteSpace: 'nowrap' }}>{s.v}</span>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
