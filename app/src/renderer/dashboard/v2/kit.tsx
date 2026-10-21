/** Piezas chicas del diseño v2: escenario escalable, chips, íconos y formato. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export const DESIGN_W = 1280
export const DESIGN_H = 800

/**
 * Escenario de 1280 × 800 que se escala al tamaño real de la pantalla. Si la
 * proporción es otra, el escenario crece en el eje que sobra y el diseño llena todo.
 */
export function Stage({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const [box, setBox] = useState(() => measure())
  useEffect(() => {
    const on = () => setBox(measure())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return (
    <div className="d2-viewport">
      <div
        className="d2-stage"
        style={{ width: box.w, height: box.h, transform: `translate(-50%, -50%) scale(${box.scale})`, ...style }}
      >
        {children}
      </div>
    </div>
  )
}

function measure() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const scale = Math.min(vw / DESIGN_W, vh / DESIGN_H)
  return { scale, w: vw / scale, h: vh / scale }
}

export type ChipTone = 'default' | 'highlight' | 'best' | 'record' | 'alert' | 'error' | 'info'

export function Chip({ tone = 'default', children, title }: { tone?: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span className={`d2-chip ${tone === 'default' ? '' : tone}`} title={title}>
      {children}
    </span>
  )
}

export function Lbl({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="d2-lbl" style={style}>
      {children}
    </span>
  )
}

/** Ícono de línea (2 px, estilo lucide) con el color del dato. */
export function Ico({ icon: Icon, size = 22, color, style }: { icon: LucideIcon; size?: number; color?: string; style?: CSSProperties }) {
  return <Icon size={size} strokeWidth={2} color={color} style={{ flex: 'none', ...style }} aria-hidden="true" />
}



export const C = {
  azul: 'var(--ftn-azul)',
  blanco: 'var(--ftn-blanco)',
  plata: 'var(--ftn-plata)',
  niebla: 'var(--ftn-niebla)',
  mejor: 'var(--ftn-mejor)',
  record: 'var(--ftn-record)',
  alerta: 'var(--ftn-alerta)',
  error: 'var(--ftn-error)',
  grafito: 'var(--ftn-grafito)',
  carbono: 'var(--ftn-carbono)',
} as const

export const DASH = '–'

/** +0.18 / −0.18 con el menos tipográfico. */
export function signed(x: number | null | undefined, digits = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH
  const v = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`
}

/** Miles con espacio fino: 8100 → "8 100". */
export function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="d2-empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  )
}
