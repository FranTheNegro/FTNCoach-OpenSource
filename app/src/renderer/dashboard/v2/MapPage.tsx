/** Pantalla "Mapa": trazado con la posición del auto. */
import { useEffect, useState } from 'react'
import type { TrackMapResult } from '@shared/analysis'
import type { LiveFrame, SessionMeta } from '@shared/live'
import type { Units } from '@shared/api'
import * as fmt from '@ui/format'
import { TrackMapSvg } from '@ui/TrackMapSvg'
import { Map as MapIcon } from 'lucide-react'
import { C, DASH, Ico, Lbl, signed } from './kit'
import type { DashTracker } from './tracker'

/** Mapa del trazado del servidor de FTN Coach (se pide una vez por trazado). */
function useTrackMap(meta: SessionMeta | null): TrackMapResult | null {
  const [map, setMap] = useState<TrackMapResult | null>(null)
  const id = meta?.trackId ?? null
  const slug = meta?.trackSlug ?? null
  useEffect(() => {
    setMap(null)
    if (!id) return
    let alive = true
    const q = new URLSearchParams({ id, ...(slug ? { slug } : {}) })
    fetch(`/api/track-map?${q}`)
      .then((r) => r.json())
      .then((m: TrackMapResult) => alive && setMap(m))
      .catch(() => alive && setMap({ map: null, note: 'No se pudo cargar el mapa.' }))
    return () => {
      alive = false
    }
  }, [id, slug])
  return map
}

export function TrackMap({ f, meta, units, tracker }: { f: LiveFrame; meta: SessionMeta | null; units: Units; tracker: DashTracker }) {
  const res = useTrackMap(meta)
  const map = res?.map ?? null
  // AC publica la posición en el mundo; iRacing se ubica por el punto de la vuelta
  let car: { x: number; y: number } | null = null
  if (f.pos && map?.source === 'ac') car = { x: f.pos[0], y: f.pos[1] }
  else if (map?.pctLine) {
    const p = map.pctLine[Math.max(0, Math.min(map.pctLine.length - 1, Math.round(f.lapPct * (map.pctLine.length - 1))))]
    car = { x: p[0], y: p[1] }
  }
  const empty = res ? res.note : meta?.trackId ? 'Cargando el mapa…' : 'Este simulador no informó el trazado.'
  const delta = f.deltaS
  const stats = [
    { k: 'Delta', v: delta === null ? DASH : signed(delta, 2), color: delta === null ? C.blanco : delta <= 0 ? C.record : C.error },
    { k: 'Vuelta actual', v: fmt.lapTime(tracker.lapTime(f), 1), color: C.blanco },
    { k: 'Velocidad', v: `${Math.round(fmt.speed(f.speedKmh, units))} ${fmt.unitLabel.speed(units)}`, color: C.blanco },
    { k: 'Marcha', v: fmt.gear(f.gear), color: C.blanco },
  ]

  return (
    <main className="d2-body d2-map">
      <section className="d2-panel" style={{ minHeight: 0, padding: 14, overflow: 'hidden', background: C.carbono }}>
        {map ? (
          <TrackMapSvg map={map} className="map-svg" markers={car ? [{ ...car, color: 'var(--ftn-azul)', size: 1.6 }] : []} />
        ) : (
          <div className="d2-empty">
            <Ico icon={MapIcon} size={34} color={C.niebla} />
            <strong>Mapa del trazado</strong>
            <span>{empty}</span>
          </div>
        )}
      </section>
      <div className="d2-colv">
        {stats.map((s) => (
          <section key={s.k} className="d2-panel fill" style={{ justifyContent: 'center' }}>
            <Lbl>{s.k}</Lbl>
            <span className="d2-mono" style={{ fontWeight: 700, fontSize: 40, lineHeight: 1.1, color: s.color, whiteSpace: 'nowrap' }}>{s.v}</span>
          </section>
        ))}
      </div>
    </main>
  )
}
