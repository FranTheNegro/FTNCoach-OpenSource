/** Mapa chico del circuito para los tableros réplica (sin marco ni etiquetas). */
import type { LiveFrame, SessionMeta, Standings } from '@shared/live'
import { TrackMapSvg, type MapMarker } from '@ui/TrackMapSvg'
import { useTrackMap } from '../MapPage'

export function RpMap({ f, meta, standings, color }: { f: LiveFrame; meta: SessionMeta | null; standings: Standings | null; color: string }) {
  const res = useTrackMap(meta)
  const map = res?.map ?? null
  if (!map) return null
  const line = map.pctLine ?? null
  const at = (pct: number) => (line ? line[Math.max(0, Math.min(line.length - 1, Math.round(pct * (line.length - 1))))] : null)
  const markers: MapMarker[] = []
  for (const car of standings?.cars ?? []) {
    if (car.me || car.inPit || car.lapPct === null) continue
    const p = at(car.lapPct)
    if (p) markers.push({ x: p[0], y: p[1], color: '#cfd3da', size: 0.8 })
  }
  let mine: { x: number; y: number } | null = null
  if (f.pos && map.source === 'ac') mine = { x: f.pos[0], y: f.pos[1] }
  else {
    const p = at(f.lapPct)
    if (p) mine = { x: p[0], y: p[1] }
  }
  if (mine) markers.push({ ...mine, color, size: 1.4 })
  return <TrackMapSvg map={map} markers={markers} showLabels={false} className="rp-map-svg" />
}
