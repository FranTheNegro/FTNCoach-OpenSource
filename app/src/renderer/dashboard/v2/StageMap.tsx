/**
 * Pantalla "Mapa" en rally (ACR): el tramo sobre la cartografía oficial (ortofoto,
 * relieve LiDAR o curvas de nivel), tu auto, los parciales, tus notas y el perfil de
 * alturas. El mapa sale de la cartografía, no de la pasada: la línea solo ubica el
 * camino.
 *
 * Se maneja como un navegador: "Seguir" acompaña al auto con el norte arriba (gira
 * la flecha, no el mapa), "Tramo" lo muestra entero, y arrastrando o haciendo zoom
 * (rueda o pellizco) se recorre libre. Tocar el camino agrega una nota en ese metro.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { LiveFrame, SessionMeta } from '@shared/live'
import { STAGE_TILE_PX, STAGE_TILE_SIZES, type StageLayer, type StageMapData, type StageNote, type StageNoteKind, type StagePoint } from '@shared/stage'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import { Lightbulb, type LucideIcon, Map as MapIcon, StickyNote, TriangleAlert, X } from 'lucide-react'
import { C, DASH, Ico, Lbl, clamp, signed, thousands } from './kit'

const LAYER_LABEL: Record<StageLayer, string> = { orto: 'Foto', relieve: 'Relieve', curvas: 'Curvas' }
/** Ancho de la vista que sigue al auto (m), al abrir. */
const FOLLOW_M = 700
/** Zoom posible: ancho de la vista (m). */
const MIN_W = 120
const MAX_W = 30000
/** Cuánto antes se avisa una nota durante la pasada (m). */
const NOTE_WARN_M = 250

const NOTE_KIND: Record<StageNoteKind, { label: string; icon: LucideIcon; color: string }> = {
  peligro: { label: 'Peligro', icon: TriangleAlert, color: 'var(--ftn-error)' },
  consejo: { label: 'Consejo', icon: Lightbulb, color: 'var(--ftn-mejor)' },
  nota: { label: 'Nota', icon: StickyNote, color: 'var(--ftn-plata)' },
}

function useStageMap(id: string | null, ready: boolean): StageMapData | null {
  const [map, setMap] = useState<StageMapData | null>(null)
  useEffect(() => {
    setMap(null)
    if (!id) return
    let alive = true
    fetch(`/api/stage-map?${new URLSearchParams({ id })}`)
      .then((r) => r.json())
      .then((m: StageMapData) => alive && setMap(m))
      .catch(() => alive && setMap(null))
    return () => {
      alive = false
    }
  }, [id, ready])
  return map
}

function useStageNotes(stageId: string | null): [StageNote[], (n: StageNote[]) => void] {
  const [notes, setNotes] = useState<StageNote[]>([])
  useEffect(() => {
    setNotes([])
    if (!stageId) return
    let alive = true
    fetch(`/api/stage-notes?${new URLSearchParams({ id: stageId })}`)
      .then((r) => r.json())
      .then((n: StageNote[]) => alive && Array.isArray(n) && setNotes(n))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [stageId])
  return [notes, setNotes]
}

async function notesRequest(stageId: string, init: RequestInit & { note?: string }): Promise<StageNote[]> {
  const q = new URLSearchParams({ id: stageId, ...(init.note ? { note: init.note } : {}) })
  const r = await fetch(`/api/stage-notes?${q}`, init)
  const body = await r.json()
  if (!r.ok) throw new Error(body?.error ?? 'No se pudo guardar')
  return body as StageNote[]
}

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial
    } catch {
      return initial
    }
  })
  return [
    v,
    (next: T) => {
      setV(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // sin almacenamiento: la preferencia dura lo que la pantalla
      }
    },
  ]
}

/** Punto de la línea a `d` metros de la largada (la línea viene cada 5 m). */
function pointAt(line: StagePoint[], d: number): { p: StagePoint; i: number } {
  let lo = 0
  let hi = line.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (line[mid].d < d) lo = mid + 1
    else hi = mid
  }
  return { p: line[lo], i: lo }
}

/** Pantalla: este a la derecha, norte arriba (z del juego = este, x = norte). */
const sx = (p: { z: number }) => p.z
const sy = (p: { x: number }) => -p.x

interface View {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Teselas que cubren la vista, del tamaño justo para el zoom: debajo siempre las más
 * grandes (cargan rápido y tapan el hueco), encima las de detalle si hacen falta.
 */
function Tiles({ geo, layer, vb, mpp }: { geo: NonNullable<StageMapData['geo']>; layer: StageLayer; vb: View; mpp: number }) {
  const sizes = STAGE_TILE_SIZES as readonly number[]
  const coarse = sizes[sizes.length - 1]
  // El más grande cuya resolución no sea peor que la de la pantalla
  const fit = [...sizes].reverse().find((s) => s / STAGE_TILE_PX <= mpp * 1.5) ?? sizes[0]
  const levels = fit === coarse ? [coarse] : [coarse, fit]
  // Pantalla: x = z del juego (este), y = −x (norte). Lambert-93 = juego + corrimiento
  const e0 = vb.x + geo.offsetE
  const e1 = vb.x + vb.w + geo.offsetE
  const n0 = -(vb.y + vb.h) + geo.offsetN
  const n1 = -vb.y + geo.offsetN
  const out: { key: string; url: string; x: number; y: number; size: number }[] = []
  for (const size of levels) {
    const cols = Math.floor(e1 / size) - Math.floor(e0 / size) + 1
    const rows = Math.floor(n1 / size) - Math.floor(n0 / size) + 1
    if (cols * rows > 48) continue
    for (let e = Math.floor(e0 / size) * size; e <= e1; e += size)
      for (let n = Math.floor(n0 / size) * size; n <= n1; n += size)
        out.push({
          key: `${size}:${e}:${n}`,
          url: `/api/stage-tile?${new URLSearchParams({ layer, e: String(e), n: String(n), size: String(size) })}`,
          x: e - geo.offsetE,
          y: -(n + size - geo.offsetN),
          size,
        })
  }
  return (
    <g>
      {out.map((t) => (
        <image key={t.key} href={t.url} x={t.x} y={t.y} width={t.size} height={t.size} preserveAspectRatio="none" />
      ))}
    </g>
  )
}

const Route = memo(function Route({ line, scale }: { line: StagePoint[]; scale: number }) {
  const d = line.map((p, i) => `${i ? 'L' : 'M'}${sx(p).toFixed(1)},${sy(p).toFixed(1)}`).join('')
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={9 * scale} />
      <path d={d} stroke="var(--ftn-blanco)" strokeWidth={4.5 * scale} />
    </g>
  )
})

function Marker({ p, scale, color, label }: { p: StagePoint; scale: number; color: string; label?: string }) {
  return (
    <g transform={`translate(${sx(p)},${sy(p)})`}>
      <circle r={9 * scale} fill={color} stroke="var(--ftn-carbono)" strokeWidth={2.5 * scale} />
      {label && (
        <text y={-14 * scale} textAnchor="middle" fontSize={15 * scale} fontWeight={700} fill="var(--ftn-blanco)" stroke="var(--ftn-carbono)" strokeWidth={4 * scale} paintOrder="stroke" fontFamily="var(--ftn-font-data)">
          {label}
        </text>
      )}
    </g>
  )
}

function Profile({ map, distM, splitsM, notes }: { map: StageMapData; distM: number | null; splitsM: number[]; notes: StageNote[] }) {
  const line = map.line
  const stats = map.stats
  if (!stats || line.length < 2) return null
  const W = 1000
  const H = 140
  const len = line[line.length - 1].d || 1
  const lo = stats.altMinM - 10
  const hi = stats.altMaxM + 10
  const X = (d: number) => (d / len) * W
  const Y = (a: number) => H - ((a - lo) / Math.max(1, hi - lo)) * (H - 14) - 4
  const step = Math.max(1, Math.floor(line.length / 400))
  const pts = line.filter((_, i) => i % step === 0 || i === line.length - 1)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.y).toFixed(1)}`).join('')
  const car = distM !== null ? pointAt(line, distM).p : null
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <linearGradient id="stage-prof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--ftn-azul)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--ftn-azul)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <path d={`${path}L${W},${H}L0,${H}Z`} fill="url(#stage-prof)" />
      {car && <path d={`${pts.filter((p) => p.d <= car.d).map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.y).toFixed(1)}`).join('')}`} fill="none" stroke="var(--ftn-azul)" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
      <path d={path} fill="none" stroke="var(--ftn-plata)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {splitsM.map((d) => (
        <line key={d} x1={X(d)} x2={X(d)} y1={0} y2={H} stroke="var(--ftn-niebla)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      ))}
      {stats.hairpins.map((h) => (
        <line key={h.distM} x1={X(h.distM)} x2={X(h.distM)} y1={H - 10} y2={H} stroke="var(--ftn-alerta)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
      {notes.map((n) => (
        <line key={n.id} x1={X(n.distM)} x2={X(n.distM)} y1={0} y2={12} stroke={NOTE_KIND[n.kind].color} strokeWidth={3} vectorEffect="non-scaling-stroke" />
      ))}
      {car && <line x1={X(car.d)} x2={X(car.d)} y1={0} y2={H} stroke="var(--ftn-azul)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'rgba(10,12,16,0.78)', borderRadius: 10, padding: 4 }}>
      {options.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          onPointerUp={(e) => e.stopPropagation()}
          className="d2-mono"
          style={{
            border: 0,
            borderRadius: 7,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.06em',
            cursor: 'pointer',
            background: k === value ? 'var(--ftn-azul)' : 'transparent',
            color: k === value ? 'var(--ftn-carbono)' : 'var(--ftn-plata)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Row({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <span style={{ color: C.niebla, fontSize: 13 }}>{k}</span>
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 17, color: color ?? C.blanco, whiteSpace: 'nowrap' }}>
        {v}
      </span>
    </div>
  )
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`)

/** Aviso de la próxima nota del tramo durante la pasada. */
function NoteBanner({ note, inM }: { note: StageNote; inM: number }) {
  const k = NOTE_KIND[note.kind]
  return (
    <div style={{ position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', maxWidth: '86%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: 'rgba(10,12,16,0.9)', border: `2px solid ${k.color}`, pointerEvents: 'none' }}>
      <Ico icon={k.icon} size={22} color={k.color} />
      <span className="d2-mono" style={{ fontWeight: 700, fontSize: 18, color: k.color, whiteSpace: 'nowrap' }}>
        {Math.max(0, Math.round(inM / 10) * 10)} m
      </span>
      <span style={{ fontSize: 17, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.text}</span>
    </div>
  )
}

/** Panel sobre el mapa para crear o ver una nota. */
function Sheet({ title, color, onClose, children }: { title: string; color?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{ position: 'absolute', left: 12, bottom: 28, width: 'min(380px, calc(100% - 24px))', display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 12, background: 'rgba(10,12,16,0.94)', border: '1px solid rgba(255,255,255,0.12)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 15, color: color ?? C.blanco }}>{title}</strong>
        <button onClick={onClose} aria-label="Cerrar" style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <Ico icon={X} size={18} color={C.plata} />
        </button>
      </div>
      {children}
    </div>
  )
}

function SheetButton({ onClick, disabled, primary, children }: { onClick: () => void; disabled?: boolean; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ border: 0, borderRadius: 8, padding: '11px 12px', fontWeight: 700, fontSize: 14, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, background: primary ? 'var(--ftn-azul)' : 'rgba(255,255,255,0.08)', color: primary ? 'var(--ftn-carbono)' : C.blanco }}
    >
      {children}
    </button>
  )
}

export function StageMap({ f, meta, units }: { f: LiveFrame; meta: SessionMeta | null; units: Units }) {
  const st = f.stage ?? null
  const id = meta?.trackId?.startsWith('acr/') ? meta.trackId.slice(4) : null
  const map = useStageMap(id, !!st?.stageId)
  const [notes, setNotes] = useStageNotes(map?.line.length ? id : null)
  const [layer, setLayer] = usePref<StageLayer>('ftn.stage.layer', 'orto')
  const [view, setView] = usePref<'seguir' | 'tramo'>('ftn.stage.view', 'seguir')
  // Navegación libre: la cámara que dejó el piloto (null = sigue la vista elegida)
  const [free, setFree] = useState<{ cx: number; cy: number; w: number } | null>(null)
  const [followW, setFollowW] = useState(FOLLOW_M)
  const [draft, setDraft] = useState<{ distM: number; kind: StageNoteKind; text: string; error?: string } | null>(null)
  const [openNote, setOpenNote] = useState<StageNote | null>(null)
  const [boxRef, box] = useSize<HTMLDivElement>()
  const gesture = useRef<{ pts: Map<number, { x: number; y: number }>; moved: number; start: { x: number; y: number } } | null>(null)

  const line = map?.line ?? []
  const bounds = useMemo(() => {
    if (!line.length) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of line) {
      minX = Math.min(minX, sx(p))
      maxX = Math.max(maxX, sx(p))
      minY = Math.min(minY, sy(p))
      maxY = Math.max(maxY, sy(p))
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06 + 60
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [line])

  const carPos = f.pos ? { x: f.pos[0], z: f.pos[1] } : null
  const onStage = st && st.state !== 'idle' && line.length > 0
  const here = onStage ? pointAt(line, st.distM) : null
  // Flecha: hacia dónde apunta el auto; si el juego no lo da, el sentido del camino
  const ahead = here ? line[Math.min(line.length - 1, here.i + 3)] : null
  const behind = here ? line[Math.max(0, here.i - 3)] : null
  const roadAngle = ahead && behind ? (Math.atan2(sy(ahead) - sy(behind), sx(ahead) - sx(behind)) * 180) / Math.PI : 0
  const arrowAngle = f.headingDeg != null ? f.headingDeg - 90 : roadAngle

  // Cámara: centro y ancho en metros; el alto sale de la forma de la pantalla
  const aspect = box.w > 0 && box.h > 0 ? box.h / box.w : 0.74
  let cam: { cx: number; cy: number; w: number } | null = null
  if (free) cam = free
  else if (view === 'seguir' && carPos) cam = { cx: sx(carPos), cy: sy(carPos), w: followW }
  else if (bounds) {
    const w = Math.max(bounds.w, bounds.h / aspect)
    cam = { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, w }
  }
  const vb: View | null = cam ? { x: cam.cx - cam.w / 2, y: cam.cy - (cam.w * aspect) / 2, w: cam.w, h: cam.w * aspect } : null
  /** Metros por píxel: los tamaños de los dibujos van en píxeles de pantalla. */
  const scale = vb && box.w ? vb.w / box.w : 1

  const splitsM = st?.splits.map((s) => s.distM) ?? map?.splitsM ?? []
  const lengthM = st?.lengthM ?? map?.lengthM ?? null
  const surface = here && map ? map.surfaces.find((s) => st!.distM >= s.fromM && st!.distM <= s.toM) : null
  const stats = map?.stats ?? null
  const delta = f.deltaS
  const grade = here && here.i + 10 < line.length ? ((line[here.i + 10].y - here.p.y) / Math.max(1, line[here.i + 10].d - here.p.d)) * 100 : null
  // La próxima nota en el camino, durante la pasada
  const upcoming = st && (st.state === 'running' || st.state === 'ready') ? notes.find((n) => n.distM >= st.distM && n.distM - st.distM <= NOTE_WARN_M) : undefined

  // ── Gestos ──
  const toMap = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect()
    return { x: vb!.x + ((clientX - r.left) / r.width) * vb!.w, y: vb!.y + ((clientY - r.top) / r.height) * vb!.h }
  }
  const clampW = (w: number) => clamp(w, MIN_W, Math.max(MAX_W / 4, Math.min(MAX_W, (bounds?.w ?? 0) * 3)))
  /** Zoom alrededor de un punto de la pantalla; siguiendo al auto, alrededor del auto. */
  const zoom = (factor: number, clientX: number, clientY: number) => {
    if (!cam || !vb) return
    if (!free && view === 'seguir' && carPos) return setFollowW((w) => clampW(w * factor))
    const p = toMap(clientX, clientY)
    const from = cam
    // Funcional: entre dos cuadros pueden llegar varios eventos
    setFree((c) => {
      const b = c ?? from
      const w = clampW(b.w * factor)
      const k = w / b.w
      return { cx: p.x + (b.cx - p.x) * k, cy: p.y + (b.cy - p.y) * k, w }
    })
  }
  const onWheel = (e: React.WheelEvent) => zoom(Math.pow(1.0015, e.deltaY), e.clientX, e.clientY)
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!vb) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const g = gesture.current ?? { pts: new Map(), moved: 0, start: { x: e.clientX, y: e.clientY } }
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    gesture.current = g
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    const prev = g?.pts.get(e.pointerId)
    if (!g || !prev || !cam || !vb) return
    const pts = [...g.pts.entries()]
    if (pts.length >= 2) {
      // Pellizco: zoom según cuánto cambia la distancia entre los dos dedos
      const other = pts.find(([k]) => k !== e.pointerId)![1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      g.moved += 100
      g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (before > 10 && after > 10) zoom(before / after, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2)
      return
    }
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y))
    if (g.moved < 8) return
    // Arrastrar: la vista queda libre donde la deje el piloto
    const from = cam
    setFree((c) => {
      const b = c ?? from
      return { cx: b.cx - dx * scale, cy: b.cy - dy * scale, w: b.w }
    })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    const g = gesture.current
    if (!g) return
    g.pts.delete(e.pointerId)
    if (g.pts.size) return
    gesture.current = null
    if (g.moved >= 8 || !vb) return
    // Toque: una nota cerca abre la nota; el camino cerca empieza una nota nueva
    const p = toMap(e.clientX, e.clientY)
    const near = (q: StagePoint, px: number) => Math.hypot(sx(q) - p.x, sy(q) - p.y) <= px * scale
    const hit = notes.find((n) => near(pointAt(line, n.distM).p, 22))
    if (hit) {
      setDraft(null)
      setOpenNote(hit)
      return
    }
    let best: StagePoint | null = null
    let bestD = Infinity
    for (const q of line) {
      const d = Math.hypot(sx(q) - p.x, sy(q) - p.y)
      if (d < bestD) {
        bestD = d
        best = q
      }
    }
    setOpenNote(null)
    if (best && bestD <= 36 * scale && id) setDraft({ distM: best.d, kind: 'peligro', text: '' })
    else setDraft(null)
  }

  const saveDraft = async () => {
    if (!draft || !id || !draft.text.trim()) return
    try {
      setNotes(await notesRequest(id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ distM: draft.distM, kind: draft.kind, text: draft.text }) }))
      setDraft(null)
    } catch (err) {
      setDraft({ ...draft, error: (err as Error).message })
    }
  }
  const deleteNote = async (n: StageNote) => {
    if (!id) return
    try {
      setNotes(await notesRequest(id, { method: 'DELETE', note: n.id }))
      setOpenNote(null)
    } catch {
      // Sin conexión con la PC: la nota queda
    }
  }

  return (
    <main className="d2-body" style={{ gridTemplateColumns: 'minmax(0, 1fr) 330px', gridTemplateRows: 'minmax(0, 1fr) 150px' }}>
      <section className="d2-panel" style={{ minHeight: 0, padding: 0, overflow: 'hidden', background: C.carbono, position: 'relative' }}>
        <div
          ref={boxRef}
          style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: vb ? 'grab' : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => {
            e.stopPropagation()
            gesture.current = null
          }}
          onWheel={onWheel}
        >
          {map && vb && line.length ? (
            <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block', background: '#14171c' }}>
              {map.geo && <Tiles geo={map.geo} layer={layer} vb={vb} mpp={scale} />}
              <Route line={line} scale={scale} />
              {stats?.hairpins.map((h) => {
                const p = pointAt(line, h.distM).p
                return <circle key={h.distM} cx={sx(p)} cy={sy(p)} r={5 * scale} fill="var(--ftn-alerta)" stroke="var(--ftn-carbono)" strokeWidth={1.5 * scale} />
              })}
              {splitsM.map((d, k) => (
                <Marker key={d} p={pointAt(line, d).p} scale={scale} color="var(--ftn-plata)" label={`P${k + 1}`} />
              ))}
              {st?.impacts.map((im) => {
                const p = pointAt(line, im.distM).p
                return <circle key={im.distM} cx={sx(p)} cy={sy(p)} r={7 * scale} fill="none" stroke="var(--ftn-error)" strokeWidth={3 * scale} />
              })}
              <Marker p={line[0]} scale={scale} color="var(--ftn-mejor)" label="Largada" />
              <Marker p={line[line.length - 1]} scale={scale} color="var(--ftn-blanco)" label="Meta" />
              {notes.map((n) => {
                const p = pointAt(line, n.distM).p
                const k = NOTE_KIND[n.kind]
                const r = 13 * scale
                return (
                  <g key={n.id} transform={`translate(${sx(p)},${sy(p)})`}>
                    <circle r={r} fill="var(--ftn-carbono)" stroke={k.color} strokeWidth={3 * scale} />
                    <k.icon x={-r * 0.62} y={-r * 0.62} width={r * 1.24} height={r * 1.24} color={k.color} strokeWidth={2.4} />
                  </g>
                )
              })}
              {draft && <Marker p={pointAt(line, draft.distM).p} scale={scale} color="var(--ftn-azul)" />}
              {carPos && (
                <g transform={`translate(${sx(carPos)},${sy(carPos)}) rotate(${arrowAngle})`}>
                  <circle r={13 * scale} fill="var(--ftn-azul)" stroke="var(--ftn-carbono)" strokeWidth={3 * scale} />
                  <path d={`M${15 * scale},0 L${-6 * scale},${-8 * scale} L${-6 * scale},${8 * scale} Z`} fill="var(--ftn-carbono)" />
                </g>
              )}
            </svg>
          ) : (
            <div className="d2-empty">
              <Ico icon={MapIcon} size={34} color={C.niebla} />
              <strong>Mapa del tramo</strong>
              <span>{map ? map.note : id ? 'Cargando el mapa…' : 'Entrá a un tramo para ver el mapa.'}</span>
            </div>
          )}
        </div>

        {map && line.length > 0 && (
          <>
            <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {map.geo && <Toggle value={layer} onChange={setLayer} options={(Object.keys(LAYER_LABEL) as StageLayer[]).map((k) => [k, LAYER_LABEL[k]])} />}
              {/* En navegación libre no queda marcado ninguno: tocar uno vuelve a esa vista */}
              <Toggle
                value={free ? ('libre' as 'seguir') : view}
                onChange={(v) => {
                  setFree(null)
                  setView(v)
                }}
                options={[
                  ['seguir', 'Seguir'],
                  ['tramo', 'Tramo'],
                ]}
              />
            </div>
            {upcoming && <NoteBanner note={upcoming} inM={upcoming.distM - st!.distM} />}
            {draft && (
              <Sheet onClose={() => setDraft(null)} title={`Nota en ${km(draft.distM)}`}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(Object.keys(NOTE_KIND) as StageNoteKind[]).map((k) => {
                    const on = draft.kind === k
                    const K = NOTE_KIND[k]
                    return (
                      <button
                        key={k}
                        onClick={() => setDraft({ ...draft, kind: k })}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 6px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, border: `2px solid ${on ? K.color : 'transparent'}`, background: 'rgba(255,255,255,0.06)', color: on ? K.color : C.plata }}
                      >
                        <Ico icon={K.icon} size={16} color={on ? K.color : C.plata} />
                        {K.label}
                      </button>
                    )
                  })}
                </div>
                <textarea
                  autoFocus
                  value={draft.text}
                  maxLength={280}
                  rows={3}
                  placeholder="Por ejemplo: derecha que cierra, grava suelta en la salida."
                  onChange={(e) => setDraft({ ...draft, text: e.target.value, error: undefined })}
                  style={{ width: '100%', resize: 'none', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.35)', color: C.blanco, padding: 10, fontSize: 15, fontFamily: 'inherit' }}
                />
                {draft.error && <span style={{ color: C.error, fontSize: 13 }}>{draft.error}</span>}
                <SheetButton onClick={() => void saveDraft()} disabled={!draft.text.trim()} primary>
                  Guardar nota
                </SheetButton>
              </Sheet>
            )}
            {openNote && (
              <Sheet onClose={() => setOpenNote(null)} title={`${NOTE_KIND[openNote.kind].label} · ${km(openNote.distM)}`} color={NOTE_KIND[openNote.kind].color}>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{openNote.text}</p>
                <SheetButton onClick={() => void deleteNote(openNote)}>Borrar nota</SheetButton>
              </Sheet>
            )}
            {map.credits.length > 0 && (
              <div style={{ position: 'absolute', bottom: 6, right: 10, fontSize: 10, color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>{map.credits.join(' · ')}</div>
            )}
          </>
        )}
      </section>

      <div className="d2-colv" style={{ gridRow: 'span 2', minHeight: 0 }}>
        <section className="d2-panel">
          <Lbl>{map?.name ?? meta?.track ?? 'Tramo'}</Lbl>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span className="d2-mono" style={{ fontWeight: 700, fontSize: 34 }}>{fmt.lapTime(f.lapTimeS, 1)}</span>
            <span className="d2-mono" style={{ fontWeight: 700, fontSize: 24, color: delta === null ? C.niebla : delta <= 0 ? C.record : C.alerta }}>
              {delta === null ? DASH : signed(delta, 1)}
            </span>
          </div>
          {lengthM && st && (
            <>
              <div className="d2-progress">
                <i style={{ width: `${Math.round(clamp(st.distM / lengthM, 0, 1) * 100)}%` }} />
              </div>
              <Row k="Faltan" v={km(Math.max(0, lengthM - st.distM))} />
            </>
          )}
          {st && <Row k="Altitud" v={`${thousands(st.altM)} m${grade !== null ? ` · ${grade > 0 ? '+' : ''}${grade.toFixed(0)} %` : ''}`} />}
          {surface && <Row k={surface.road ?? 'Superficie'} v={surface.kind} />}
          {st && (st.resets > 0 || st.impacts.length > 0) && <Row k="Despistes · golpes" v={`${st.resets} · ${st.impacts.length}`} color={C.alerta} />}
        </section>

        <section className="d2-panel">
          <Lbl>Parciales</Lbl>
          {st && st.splits.length > 0 ? (
            st.splits.map((s, k) => (
              <Row
                key={s.distM}
                k={`P${k + 1} · ${km(s.distM)}`}
                v={s.timeS === null ? DASH : `${fmt.lapTime(s.timeS, 1)}  ${s.diffS === null ? '' : signed(s.diffS, 1)}`}
                color={s.timeS === null ? C.niebla : s.best ? C.record : C.blanco}
              />
            ))
          ) : (
            <span style={{ color: C.niebla, fontSize: 13, lineHeight: 1.4 }}>Faltan los parciales del juego: anotá los tiempos que te muestra al pasar por cada uno y se ubican solos en el tramo.</span>
          )}
          {st?.bestS != null && <Row k="Tu mejor pasada" v={fmt.lapTime(st.bestS, 1)} color={C.mejor} />}
        </section>

        {stats && (
          <section className="d2-panel fill">
            <Lbl>El tramo</Lbl>
            {lengthM && <Row k="Largo" v={km(lengthM)} />}
            <Row k="Altitud" v={`${thousands(stats.altStartM)} → ${thousands(stats.altFinishM)} m`} />
            <Row k="Desnivel" v={`+${thousands(stats.climbM)} / −${thousands(stats.descentM)} m`} />
            <Row k="Pendiente máx." v={`${stats.maxUpPct > 0 ? `+${stats.maxUpPct.toFixed(0)}` : DASH} / ${stats.maxDownPct < 0 ? `${stats.maxDownPct.toFixed(0)}` : DASH} %`} />
            <Row k="Horquillas" v={String(stats.hairpins.length)} />
            <Row k="Velocidad" v={`${Math.round(fmt.speed(f.speedKmh, units))} ${fmt.unitLabel.speed(units)}`} />
          </section>
        )}
      </div>

      <section className="d2-panel" style={{ padding: '10px 14px', minHeight: 0 }}>
        {map?.stats ? <Profile map={map} distM={onStage ? st!.distM : null} splitsM={splitsM} notes={notes} /> : <span style={{ color: C.niebla, fontSize: 13 }}>Perfil de alturas: aparece con el mapa del tramo.</span>}
      </section>
    </main>
  )
}
