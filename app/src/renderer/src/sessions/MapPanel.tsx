/**
 * Mapa del análisis: el trazado fijo con la vuelta encima, pintada según lo que se
 * quiera mirar. Se mueve arrastrando y se acerca con la rueda, y lo que queda a la
 * vista manda en los gráficos de telemetría. Se puede ampliar a pantalla completa.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Scan } from 'lucide-react'
import { LineSwatch } from '@ui/icons'
import type { CompareResult, SessionDetail } from '@shared/analysis'
import { fittedBox, mapBounds, TrackMapSvg, type MapBox, type MapLine, type MapMarker } from '@ui/TrackMapSvg'

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
    [SPEED[2], 'media'],
    [SPEED[4], 'rápida'],
  ],
  inputs: [
    ['var(--ftn-error)', 'freno'],
    ['var(--ftn-plata)', 'sin pedales'],
    ['var(--ftn-azul)', 'acelerador parcial'],
    ['var(--ftn-record)', 'a fondo'],
  ],
}

/** Lo más cerca que se puede llegar (m de lado). */
const MIN_SPAN_M = 40
/** Los gráficos siguen al mapa con esta demora, para no redibujarlos en cada movimiento. */
const SYNC_DELAY_MS = 80

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

const widthOf = (b: MapBox) => b.maxX - b.minX
const heightOf = (b: MapBox) => b.maxY - b.minY

/** Acerca o aleja `b` alrededor de un punto, sin pasar del mínimo ni de todo el mapa (null = todo). */
function zoomed(b: MapBox, fit: MapBox, k: number, x: number, y: number): MapBox | null {
  const next = { minX: x + (b.minX - x) * k, maxX: x + (b.maxX - x) * k, minY: y + (b.minY - y) * k, maxY: y + (b.maxY - y) * k }
  if (widthOf(next) >= widthOf(fit) && heightOf(next) >= heightOf(fit)) return null
  return Math.max(widthOf(next), heightOf(next)) < MIN_SPAN_M ? b : next
}

/** Corre `b` sin dejar que el centro se salga del mapa. */
function moved(b: MapBox, fit: MapBox, dx: number, dy: number): MapBox {
  const cx = Math.max(fit.minX, Math.min(fit.maxX, (b.minX + b.maxX) / 2 + dx))
  const cy = Math.max(fit.minY, Math.min(fit.maxY, (b.minY + b.maxY) / 2 + dy))
  const w = widthOf(b) / 2
  const h = heightOf(b) / 2
  return { minX: cx - w, maxX: cx + w, minY: cy - h, maxY: cy + h }
}

/** El mapa con arrastre y rueda. Los puntos del mouse se pasan a metros con la matriz del propio SVG. */
function PanZoom({
  areaRef,
  fit,
  view,
  onChange,
  onHover,
  className,
  children,
}: {
  areaRef: React.RefObject<HTMLDivElement | null>
  fit: MapBox
  view: MapBox | null
  onChange: (v: MapBox | null) => void
  onHover: (p: { x: number; y: number } | null) => void
  className: string
  children: React.ReactNode
}) {
  const ref = areaRef
  const drag = useRef<{ x: number; y: number; box: MapBox; pxPerM: number } | null>(null)
  // Última vista y callback para el listener de la rueda, que no se vuelve a registrar
  const latest = useRef({ view, fit, onChange })
  latest.current = { view, fit, onChange }

  const svgOf = () => ref.current?.querySelector('svg') ?? null
  const toMap = (clientX: number, clientY: number) => {
    const m = svgOf()?.getScreenCTM()?.inverse()
    return m ? new DOMPoint(clientX, clientY).matrixTransform(m) : null
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // React registra la rueda como pasiva: acá hace falta frenar el scroll de la página
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const m = el.querySelector('svg')?.getScreenCTM()?.inverse()
      if (!m) return
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
      const { view, fit, onChange } = latest.current
      onChange(zoomed(view ?? fit, fit, Math.exp(e.deltaY * 0.0015), p.x, p.y))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])

  const zoomCenter = (k: number) => {
    const b = view ?? fit
    onChange(zoomed(b, fit, k, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2))
  }

  return (
    <div
      ref={ref}
      className={`relative touch-none select-none ${drag.current ? 'cursor-grabbing' : 'cursor-grab'} ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const pxPerM = svgOf()?.getScreenCTM()?.a
        if (!pxPerM) return
        drag.current = { x: e.clientX, y: e.clientY, box: view ?? fit, pxPerM }
        e.currentTarget.setPointerCapture(e.pointerId)
        onHover(null)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) onChange(moved(d.box, fit, (d.x - e.clientX) / d.pxPerM, (d.y - e.clientY) / d.pxPerM))
        else {
          const p = toMap(e.clientX, e.clientY)
          onHover(p ? { x: p.x, y: p.y } : null)
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={() => !drag.current && onHover(null)}
      onDoubleClick={() => onChange(null)}
    >
      {children}
      <div className="absolute right-2 top-2 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {(
          [
            ['Acercar', Plus, () => zoomCenter(0.7)],
            ['Alejar', Minus, () => zoomCenter(1 / 0.7)],
            ['Ver todo el circuito', Scan, () => onChange(null)],
          ] as const
        ).map(([label, Icon, run]) => (
          <button key={label} onClick={run} title={label} aria-label={label} className="w-8 h-8 grid place-items-center rounded-control bg-carbono border border-grafito text-plata hover:text-blanco cursor-pointer">
            <Icon size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Muestra de la calle de boxes: el mismo punteado parejo que el mapa. */
function PitSwatch() {
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M0 4h26" stroke="var(--ftn-plata)" strokeWidth={3} strokeDasharray="6 4" />
    </svg>
  )
}

/** Qué significa cada ícono que hay ahora sobre el mapa. */
function IconLegend({ markers }: { markers: MapMarker[] }) {
  const seen = new Set<string>()
  const items = markers.filter((m) => {
    if (!m.icon || !m.legend || seen.has(m.legend)) return false
    seen.add(m.legend)
    return true
  })
  return (
    <>
      {items.map((m) => {
        const Icon = m.icon!
        return (
          <span key={m.legend} className="flex items-center gap-1.5">
            <span className="w-5 h-5 grid place-items-center rounded-[5px] border bg-carbono" style={{ borderColor: m.color, color: m.color }}>
              <Icon size={13} aria-hidden="true" />
            </span>
            {m.legend}
          </span>
        )
      })}
    </>
  )
}

export function MapPanel({
  d,
  cmp,
  markers,
  points,
  focus,
  focusKey,
  labelA,
  labelB,
  onVisible,
  onHover,
}: {
  d: SessionDetail
  cmp: CompareResult
  markers: MapMarker[]
  /** Frenada, turn-in, apex y gas de las curvas elegidas (reemplazan a los marcadores de consejo). */
  points: MapMarker[]
  /** Zona elegida desde los gráficos o las curvas: el mapa va hacia ahí. */
  focus: MapBox | null
  /** Cambia con cada elección: volver a "toda la vuelta" también tiene que mover el mapa. */
  focusKey: number
  labelA: string
  labelB: string
  /** Lo que quedó a la vista después de mover el mapa (null = todo el circuito). */
  onVisible: (visible: MapBox | null) => void
  /** Punto del mapa bajo el mouse. */
  onHover: (p: { x: number; y: number } | null) => void
}) {
  const [mode, setMode] = useState<Mode>('lines')
  const [big, setBig] = useState(false)
  const [showPoints, setShowPoints] = useState(true)
  const [view, setView] = useState<MapBox | null>(focus && fittedBox(focus))
  const stepM = d.distM[1] ?? 2
  const colors = useMemo(() => colorsFor(mode, cmp, stepM), [mode, cmp, stepM])
  const area = useRef<HTMLDivElement>(null)
  const syncTimer = useRef<number | undefined>(undefined)

  useEffect(() => setView(focus && fittedBox(focus)), [focus, focusKey])
  useEffect(() => () => window.clearTimeout(syncTimer.current), [])

  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big])

  const lines = useMemo(() => {
    const out: MapLine[] = []
    if (cmp.b.x && cmp.b.y)
      out.push(mode === 'lines' ? { x: cmp.b.x, y: cmp.b.y, color: B, width: 1.5 } : { x: cmp.b.x, y: cmp.b.y, color: 'var(--ftn-acero)', width: 1 })
    if (cmp.a.x && cmp.a.y) out.push({ x: cmp.a.x, y: cmp.a.y, color: A, width: mode === 'lines' ? 2 : 3, off: mode === 'lines' ? cmp.a.off : undefined, colors })
    return out
  }, [cmp, mode, colors])
  const bounds = useMemo(() => mapBounds(d.map.map, lines), [d.map.map, lines])
  const fit = useMemo(() => (bounds ? fittedBox(bounds) : null), [bounds])

  /** El SVG muestra más que la caja cuando sus proporciones no coinciden: cuenta lo que se ve de verdad. */
  const visibleOf = (b: MapBox): MapBox => {
    const r = area.current?.getBoundingClientRect()
    if (!r?.width || !r.height) return b
    const pxPerM = Math.min(r.width / widthOf(b), r.height / heightOf(b))
    const w = r.width / pxPerM / 2
    const h = r.height / pxPerM / 2
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    return { minX: cx - w, maxX: cx + w, minY: cy - h, maxY: cy + h }
  }

  const changeView = (v: MapBox | null) => {
    setView(v)
    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => onVisible(v && visibleOf(v)), SYNC_DELAY_MS)
  }

  const shown = showPoints && points.length ? [...markers.filter((m) => !m.icon), ...points] : markers
  const iconsOnMap = shown.some((m) => m.icon)

  const controls = (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {MODES.map(([id, label]) => (
        <button key={id} onClick={() => setMode(id)} className={`h-8 px-3 rounded-chip data text-[12px] ${mode === id ? 'bg-ultramar text-blanco' : 'bg-carbono text-plata hover:text-blanco'}`}>
          {label}
        </button>
      ))}
      <span className="flex-1" />
      <button
        onClick={() => setShowPoints(!showPoints)}
        aria-pressed={showPoints}
        title="Muestra dónde frenás, doblás, pasás por el apex y volvés a fondo, con la diferencia contra la referencia"
        className={`h-8 px-3 rounded-chip data text-[12px] ${showPoints ? 'bg-ultramar text-blanco' : 'bg-carbono text-plata hover:text-blanco'}`}
      >
        Puntos clave
      </button>
      <button onClick={() => setBig(!big)} className="h-8 px-3 rounded-chip data text-[12px] bg-carbono text-plata hover:text-blanco">
        {big ? 'Cerrar' : 'Ampliar'}
      </button>
    </div>
  )

  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 data text-[12px] text-plata shrink-0">
      {mode === 'lines' ? (
        <>
          <span className="flex items-center gap-2">
            <LineSwatch color={A} />
            {labelA}
          </span>
          <span className="flex items-center gap-2">
            <LineSwatch color={B} width={1.5} />
            {labelB}
          </span>
          <span className="flex items-center gap-2">
            <LineSwatch color="var(--ftn-alerta)" width={3.5} />
            fuera de pista
          </span>
        </>
      ) : (
        <>
          {LEGEND[mode].map(([c, t]) => (
            <span key={t} className="flex items-center gap-2">
              <LineSwatch color={c} width={3} />
              {t}
            </span>
          ))}
          {mode === 'delta' && (
            <span className="text-niebla">
              {labelA} contra {labelB}
            </span>
          )}
        </>
      )}
      {d.map.map?.pitLane?.length ? (
        <span className="flex items-center gap-2">
          <PitSwatch />
          calle de boxes
        </span>
      ) : null}
      <IconLegend markers={shown} />
      {iconsOnMap && <span className="text-niebla">Los textos son la diferencia contra {labelB}</span>}
    </div>
  )

  const canvas = (cls: string) =>
    fit ? (
      <PanZoom areaRef={area} fit={fit} view={view} onChange={changeView} onHover={onHover} className={cls}>
        <TrackMapSvg className="absolute inset-0 w-full h-full" map={d.map.map} view={view} lines={lines} markers={shown} sectorsPct={d.sectorsPct} />
      </PanZoom>
    ) : null

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        {controls}
        <div className="flex-1 min-h-0 flex">{!big && canvas('flex-1 min-w-0')}</div>
        {legend}
        <p className="text-[12px] text-niebla leading-snug truncate shrink-0" title={d.map.note ?? undefined}>
          Rueda para acercar · arrastrá para moverte · doble clic para ver todo{d.map.note ? ` · ${d.map.note}` : ''}
        </p>
      </div>
      {big && (
        <div className="fixed inset-0 z-50 bg-carbono/95 p-8 flex flex-col gap-3" onClick={(e) => e.target === e.currentTarget && setBig(false)}>
          {controls}
          {canvas('flex-1 min-h-0')}
          {legend}
          <p className="text-[12px] text-niebla">Esc para cerrar</p>
        </div>
      )}
    </>
  )
}
