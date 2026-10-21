/**
 * Mapa grande del análisis: el trazado fijo con la vuelta encima, pintada según
 * lo que se quiera mirar (las dos trazadas, dónde ganás o perdés, velocidad o
 * mandos). Se puede ampliar a pantalla completa.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CompareResult, SessionDetail } from '@shared/analysis'
import { TrackMapSvg, type MapLine, type MapMarker } from '@ui/TrackMapSvg'

type Mode = 'lines' | 'delta' | 'speed' | 'inputs'

const MODES: [Mode, string][] = [
  ['lines', 'Trazadas'],
  ['delta', 'Dónde ganás'],
  ['speed', 'Velocidad'],
  ['inputs', 'Mandos'],
]

const A = 'var(--ftn-azul)'
const B = 'var(--ftn-mejor)'
const SPEED = ['var(--ftn-ultramar)', 'var(--ftn-azul)', 'var(--ftn-record)', 'var(--ftn-alerta)', 'var(--ftn-error)']

const LEGEND: Record<Exclude<Mode, 'lines'>, [string, string][]> = {
  delta: [
    ['var(--ftn-record)', 'ganás'],
    ['var(--ftn-plata)', 'igual'],
    ['var(--ftn-alerta)', 'perdés'],
    ['var(--ftn-error)', 'perdés mucho'],
  ],
  speed: [
    [SPEED[0], 'lenta'],
    [SPEED[2], ''],
    [SPEED[4], 'rápida'],
  ],
  inputs: [
    ['var(--ftn-error)', 'freno'],
    ['var(--ftn-plata)', 'sin pedales'],
    ['var(--ftn-azul)', 'acelerador parcial'],
    ['var(--ftn-record)', 'a fondo'],
  ],
}

/** Color de cada punto de la vuelta A según el modo. */
function colorsFor(mode: Mode, cmp: CompareResult, stepM: number): string[] | undefined {
  const a = cmp.a
  if (mode === 'delta') {
    // Cuánto cambia el delta en ±15 m: positivo = A pierde
    const w = Math.max(1, Math.round(15 / stepM))
    const n = cmp.delta.length
    return cmp.delta.map((_, i) => {
      const d0 = cmp.delta[Math.max(0, i - w)]
      const d1 = cmp.delta[Math.min(n - 1, i + w)]
      const slope = d1 - d0
      if (!Number.isFinite(slope)) return 'var(--ftn-plata)'
      if (slope < -0.004) return 'var(--ftn-record)'
      if (slope > 0.02) return 'var(--ftn-error)'
      if (slope > 0.004) return 'var(--ftn-alerta)'
      return 'var(--ftn-plata)'
    })
  }
  if (mode === 'speed') {
    const fin = a.speed.filter(Number.isFinite)
    const lo = Math.min(...fin)
    const hi = Math.max(...fin)
    return a.speed.map((v) => SPEED[Math.max(0, Math.min(4, Math.floor(((v - lo) / Math.max(1, hi - lo)) * 5)))])
  }
  if (mode === 'inputs')
    return a.throttle.map((t, i) => {
      if (a.brake[i] > 0.15) return 'var(--ftn-error)'
      if (t >= 0.95) return 'var(--ftn-record)'
      if (t > 0.05) return 'var(--ftn-azul)'
      return 'var(--ftn-plata)'
    })
  return undefined
}

export function MapPanel({
  d,
  cmp,
  markers,
  focus,
  labelA,
  labelB,
}: {
  d: SessionDetail
  cmp: CompareResult
  markers: MapMarker[]
  focus: { minX: number; minY: number; maxX: number; maxY: number } | null
  labelA: string
  labelB: string
}) {
  const [mode, setMode] = useState<Mode>('lines')
  const [big, setBig] = useState(false)
  const stepM = d.distM[1] ?? 2
  const colors = useMemo(() => colorsFor(mode, cmp, stepM), [mode, cmp, stepM])

  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big])

  const lines: MapLine[] = []
  if (cmp.b.x && cmp.b.y)
    lines.push(mode === 'lines' ? { x: cmp.b.x, y: cmp.b.y, color: B, width: 1.5 } : { x: cmp.b.x, y: cmp.b.y, color: 'var(--ftn-acero)', width: 1 })
  if (cmp.a.x && cmp.a.y) lines.push({ x: cmp.a.x, y: cmp.a.y, color: A, width: mode === 'lines' ? 2 : 3, off: mode === 'lines' ? cmp.a.off : undefined, colors })

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`h-8 px-3 rounded-chip data text-[12px] ${mode === id ? 'bg-ultramar text-blanco' : 'bg-carbono text-plata hover:text-blanco'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 data text-[12px] text-plata">
        {mode === 'lines' ? (
          <>
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5" style={{ background: B }} />
              {labelB}
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5" style={{ background: A }} />
              {labelA}
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5" style={{ background: 'var(--ftn-alerta)' }} />
              fuera de pista
            </span>
          </>
        ) : (
          <>
            {LEGEND[mode].map(([c, t], i) => (
              <span key={i} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5" style={{ background: c }} />
                {t}
              </span>
            ))}
            {mode === 'delta' && <span className="text-niebla">{labelA} contra {labelB}</span>}
          </>
        )}
        <button onClick={() => setBig(!big)} className="h-8 px-3 rounded-chip bg-carbono text-plata hover:text-blanco">
          {big ? 'Cerrar' : 'Ampliar'}
        </button>
      </div>
    </div>
  )

  const svg = (cls: string) => <TrackMapSvg className={cls} map={d.map.map} focus={focus} lines={lines} markers={markers} />

  return (
    <>
      <div className="flex flex-col gap-3">
        {controls}
        {svg('w-full h-[540px]')}
      </div>
      {big && (
        <div className="fixed inset-0 z-50 bg-carbono/95 p-8 flex flex-col gap-4" onClick={(e) => e.target === e.currentTarget && setBig(false)}>
          {controls}
          {svg('w-full flex-1 min-h-0')}
          <p className="text-[12px] text-niebla">{d.map.note} · Esc para cerrar</p>
        </div>
      )}
    </>
  )
}
