/**
 * Pantalla "Mapa" en rally (ACR): el tramo sobre la cartografía oficial (ortofoto,
 * relieve LiDAR o curvas de nivel), tu auto, los parciales y el perfil de alturas.
 * El mapa sale de la cartografía, no de la pasada: la línea solo ubica el camino.
 */
import { memo, useEffect, useMemo, useState } from 'react'
import type { LiveFrame, SessionMeta } from '@shared/live'
import type { StageLayer, StageMapData, StagePoint } from '@shared/stage'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import { Map as MapIcon } from 'lucide-react'
import { C, DASH, Ico, Lbl, clamp, signed, thousands } from './kit'

const LAYER_LABEL: Record<StageLayer, string> = { orto: 'Foto', relieve: 'Relieve', curvas: 'Curvas' }
/** Ancho de la vista que sigue al auto (m). */
const FOLLOW_M = 700

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

const Tiles = memo(function Tiles({ map, layer }: { map: StageMapData; layer: StageLayer }) {
  return (
    <g>
      {map.tiles
        .filter((t) => t.layer === layer)
        .map((t) => (
          <image key={t.url} href={t.url} x={t.z0} y={-t.x1} width={t.z1 - t.z0} height={t.x1 - t.x0} preserveAspectRatio="none" />
        ))}
    </g>
  )
})

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

function Profile({ map, distM, splitsM }: { map: StageMapData; distM: number | null; splitsM: number[] }) {
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

export function StageMap({ f, meta, units }: { f: LiveFrame; meta: SessionMeta | null; units: Units }) {
  const st = f.stage ?? null
  const id = meta?.trackId?.startsWith('acr/') ? meta.trackId.slice(4) : null
  const map = useStageMap(id, !!st?.stageId)
  const [layer, setLayer] = usePref<StageLayer>('ftn.stage.layer', 'orto')
  const [view, setView] = usePref<'seguir' | 'tramo'>('ftn.stage.view', 'seguir')

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
  // Rumbo según el camino (más estable que el movimiento del auto)
  const ahead = here ? line[Math.min(line.length - 1, here.i + 3)] : null
  const behind = here ? line[Math.max(0, here.i - 3)] : null
  const heading = ahead && behind ? (Math.atan2(sy(ahead) - sy(behind), sx(ahead) - sx(behind)) * 180) / Math.PI : 0

  // Vista: siguiendo al auto (700 m) o el tramo entero
  const ASPECT = 1.35
  let vb = bounds
  if (view === 'seguir' && carPos) {
    const w = FOLLOW_M
    const h = w / ASPECT
    vb = { x: sx(carPos) - w / 2, y: sy(carPos) - h / 2, w, h }
  }
  const scale = vb ? Math.max(vb.w / 1000, vb.h / 740) : 1
  const splitsM = st?.splits.map((s) => s.distM) ?? map?.splitsM ?? []
  const lengthM = st?.lengthM ?? map?.lengthM ?? null
  const surface = here && map ? map.surfaces.find((s) => st!.distM >= s.fromM && st!.distM <= s.toM) : null
  const stats = map?.stats ?? null
  const delta = f.deltaS
  const grade = here && here.i + 10 < line.length ? ((line[here.i + 10].y - here.p.y) / Math.max(1, line[here.i + 10].d - here.p.d)) * 100 : null

  return (
    <main className="d2-body" style={{ gridTemplateColumns: 'minmax(0, 1fr) 330px', gridTemplateRows: 'minmax(0, 1fr) 150px' }}>
      <section className="d2-panel" style={{ minHeight: 0, padding: 0, overflow: 'hidden', background: C.carbono, position: 'relative' }}>
        {map && vb && line.length ? (
          <>
            <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block', background: '#14171c' }}>
              <Tiles map={map} layer={layer} />
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
              {carPos && (
                <g transform={`translate(${sx(carPos)},${sy(carPos)}) rotate(${heading})`}>
                  <circle r={13 * scale} fill="var(--ftn-azul)" stroke="var(--ftn-carbono)" strokeWidth={3 * scale} />
                  <path d={`M${15 * scale},0 L${-6 * scale},${-8 * scale} L${-6 * scale},${8 * scale} Z`} fill="var(--ftn-carbono)" />
                </g>
              )}
            </svg>
            <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8 }}>
              <Toggle value={layer} onChange={setLayer} options={(Object.keys(LAYER_LABEL) as StageLayer[]).map((k) => [k, LAYER_LABEL[k]])} />
              <Toggle value={view} onChange={setView} options={[['seguir', 'Seguir'], ['tramo', 'Tramo']]} />
            </div>
            {map.credits.length > 0 && (
              <div style={{ position: 'absolute', bottom: 6, right: 10, fontSize: 10, color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 2px #000' }}>{map.credits.join(' · ')}</div>
            )}
          </>
        ) : (
          <div className="d2-empty">
            <Ico icon={MapIcon} size={34} color={C.niebla} />
            <strong>Mapa del tramo</strong>
            <span>{map ? map.note : id ? 'Cargando el mapa…' : 'Entrá a un tramo para ver el mapa.'}</span>
          </div>
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
        {map?.stats ? <Profile map={map} distM={onStage ? st!.distM : null} splitsM={splitsM} /> : <span style={{ color: C.niebla, fontSize: 13 }}>Perfil de alturas: aparece con el mapa del tramo.</span>}
      </section>
    </main>
  )
}
