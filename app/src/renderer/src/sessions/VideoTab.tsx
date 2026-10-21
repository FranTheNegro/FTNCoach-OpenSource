/**
 * Video + telemetría.
 *
 * Cada vuelta sabe cuándo empezó en el reloj de la sesión (startS). Con el anclaje
 * de cada cámara ("la V3 empieza en el segundo 724,5 del video") se pasa de tiempo
 * de video a tiempo de sesión y viceversa. Así la vuelta y el punto de la pista
 * siguen solos al video, elegir una vuelta o una curva salta al momento exacto, y
 * las dos cámaras quedan alineadas aunque cada una tenga su propio anclaje.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompareResult, SessionDetail } from '@shared/analysis'
import type { VideoCam, VideoConfig } from '@shared/api'
import { LAP_KIND_LABEL } from '@shared/live'
import * as fmt from '@ui/format'
import { TrackMapSvg } from '@ui/TrackMapSvg'
import { Button, Card, Label } from '../components/ui'
import { TraceChart, type ChartMarks } from './TraceChart'

type View = VideoCam | 'both'
const CAM_NAME: Record<VideoCam, string> = { onboard: 'Onboard', top: 'Cámara exterior' }
const FRAME = 1 / 30

const cleanError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 724.53 → "12:04.53" */
function videoTime(s: number): string {
  if (!Number.isFinite(s)) return fmt.DASH
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`
}

/** Punto de la grilla donde la vuelta llevaba `t` segundos (la grilla es monótona en tiempo). */
function indexAtTime(times: number[], t: number): number | null {
  let lo = 0
  let hi = times.length - 1
  while (lo < hi && !Number.isFinite(times[lo])) lo++
  while (hi > lo && !Number.isFinite(times[hi])) hi--
  if (lo >= hi || t < times[lo] || t > times[hi]) return null
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (!Number.isFinite(times[mid]) || times[mid] <= t) lo = mid
    else hi = mid
  }
  return lo
}

export function VideoTab({ sessionId, d }: { sessionId: string; d: SessionDetail }) {
  const [cfg, setCfg] = useState<VideoConfig | null>(null)
  const [view, setView] = useState<View>('onboard')
  const [err, setErr] = useState<string | null>(null)
  const [syncCam, setSyncCam] = useState<VideoCam | null>(null)
  const [t, setT] = useState(0)
  const [cmp, setCmp] = useState<CompareResult | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const refs = useRef<Partial<Record<VideoCam, HTMLVideoElement | null>>>({})

  useEffect(() => {
    void window.ftn.videoConfig(sessionId).then((c) => {
      setCfg(c)
      setView(c.onboard ? 'onboard' : c.top ? 'top' : 'onboard')
    })
  }, [sessionId])

  const run = async (p: Promise<VideoConfig | null>) => {
    setErr(null)
    try {
      const c = await p
      if (c) setCfg(c)
      return c
    } catch (e) {
      setErr(cleanError(e))
      return null
    }
  }

  const cams = (['onboard', 'top'] as VideoCam[]).filter((c) => cfg?.[c])
  // La cámara que manda: la que se ve (en "ambas", la onboard)
  const primary: VideoCam = view === 'both' ? (cfg?.onboard ? 'onboard' : 'top') : view
  const follower: VideoCam | null = view === 'both' ? (primary === 'onboard' ? 'top' : 'onboard') : null
  const anchorOf = (cam: VideoCam) => cfg?.[cam]?.anchor ?? null
  const lapStart = (i: number) => d.laps[i]?.startS ?? 0

  const toSession = useCallback(
    (cam: VideoCam, vt: number) => {
      const a = cfg?.[cam]?.anchor
      return a ? (d.laps[a.lap]?.startS ?? 0) + (vt - a.videoS) : null
    },
    [cfg, d],
  )
  const toVideo = useCallback(
    (cam: VideoCam, st: number) => {
      const a = cfg?.[cam]?.anchor
      return a ? a.videoS + (st - (d.laps[a.lap]?.startS ?? 0)) : null
    },
    [cfg, d],
  )

  // Reloj: lee el video mientras se reproduce (~15 veces por segundo) y arrastra la otra cámara
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const v = refs.current[primary]
      if (!v || now - last < 66) return
      last = now
      setT(v.currentTime)
      const f = follower ? refs.current[follower] : null
      if (f && !syncCam) {
        const st = toSession(primary, v.currentTime)
        const target = st !== null ? toVideo(follower!, st) : null
        if (target !== null && target >= 0 && Math.abs(f.currentTime - target) > 0.25) f.currentTime = target
        if (v.paused !== f.paused) void (v.paused ? f.pause() : f.play().catch(() => {}))
        f.playbackRate = v.playbackRate
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [primary, follower, syncCam, toSession, toVideo])

  const sessionT = toSession(primary, t)
  const lapIdx = useMemo(() => {
    if (sessionT === null) return null
    let found: number | null = null
    for (const l of d.laps) if (l.startS <= sessionT) found = l.index
    return found !== null && sessionT < d.laps[found].startS + d.laps[found].timeS + 1 ? found : null
  }, [sessionT, d])

  // Telemetría de la vuelta que se está viendo contra la mejor
  const best = d.bestIndex ?? 0
  useEffect(() => {
    if (lapIdx === null) return
    let alive = true
    void window.ftn.compareLaps(sessionId, lapIdx, best).then((c) => alive && setCmp(c))
    return () => {
      alive = false
    }
  }, [sessionId, lapIdx, best])
  const live = cmp && lapIdx !== null && cmp.a.index === lapIdx ? cmp : null
  const idx = live && sessionT !== null && lapIdx !== null ? indexAtTime(live.a.timeS, sessionT - lapStart(lapIdx)) : null

  const seekSession = (st: number) => {
    const vt = toVideo(primary, st)
    const v = refs.current[primary]
    if (v && vt !== null) v.currentTime = Math.max(0, vt)
  }
  const seekLap = (i: number, offset = 0) => seekSession(lapStart(i) + offset)

  if (!cfg) return null

  if (!cams.length)
    return (
      <Card className="max-w-[760px]">
        <Label>Video de la sesión</Label>
        <p className="text-plata mt-3 leading-relaxed">
          Cargá el video que grabaste de esta sesión (OBS, ShadowPlay, la grabación de Windows) y FTN Coach lo sincroniza con la telemetría: la vuelta,
          el mapa y los mandos siguen al video, y podés saltar a cualquier vuelta o curva. Podés sumar una segunda cámara (exterior, TV) y verlas juntas.
        </p>
        {err && <p className="text-error mt-3">{err}</p>}
        <div className="flex gap-3 mt-4">
          <Button variant="primary" onClick={() => void run(window.ftn.videoPick(sessionId, 'onboard'))}>
            Elegir video onboard
          </Button>
          <Button onClick={() => void run(window.ftn.videoPick(sessionId, 'top')).then((c) => c && setView('top'))}>Elegir cámara exterior</Button>
        </div>
      </Card>
    )

  const n = d.distM.length
  const marks: ChartMarks = { sectors: d.sectorsPct.slice(1), corners: d.corners.map((c) => ({ pct: c.apexPct, label: c.label })) }
  const lap = lapIdx !== null ? d.laps[lapIdx] : null
  const needsSync = cams.filter((c) => !anchorOf(c))
  const shown: VideoCam[] = view === 'both' ? cams : [view]
  const inLapT = sessionT !== null && lap ? sessionT - lap.startS : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-carbono-2 border border-grafito rounded-control p-1">
          {([...cams, ...(cams.length === 2 ? (['both'] as const) : [])] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`h-9 px-3 rounded-[8px] text-[14px] font-semibold ${view === v ? 'bg-grafito text-blanco' : 'text-niebla hover:text-blanco'}`}
            >
              {v === 'both' ? 'Ambas' : CAM_NAME[v]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {err && <span className="text-error text-[13px]">{err}</span>}
          {(['onboard', 'top'] as VideoCam[]).map((c) =>
            cfg[c] ? (
              <Button key={c} className="h-9 text-[13px]" onClick={() => setSyncCam(syncCam === c ? null : c)}>
                {anchorOf(c) ? `Ajustar sincronización · ${CAM_NAME[c]}` : `Sincronizar ${CAM_NAME[c]}`}
              </Button>
            ) : (
              <Button key={c} className="h-9 text-[13px]" variant="ghost" onClick={() => void run(window.ftn.videoPick(sessionId, c))}>
                + {CAM_NAME[c]}
              </Button>
            ),
          )}
        </div>
      </div>

      {needsSync.length > 0 && !syncCam && (
        <div className="bg-carbono-2 border border-alerta/50 rounded-card px-4 py-3 flex items-center justify-between gap-4">
          <span className="text-[14px]">
            <span className="inline-block w-2 h-2 bg-alerta mr-2" />
            Falta sincronizar {needsSync.map((c) => CAM_NAME[c].toLowerCase()).join(' y ')}: hasta entonces el video no sabe qué vuelta es.
          </span>
          <Button variant="primary" className="h-9 text-[13px]" onClick={() => setSyncCam(needsSync[0])}>
            Sincronizar
          </Button>
        </div>
      )}

      {syncCam && (
        <SyncPanel
          cam={syncCam}
          d={d}
          video={() => refs.current[syncCam] ?? null}
          anchor={anchorOf(syncCam)}
          onShow={() => setView(syncCam)}
          onSave={async (anchor) => {
            await run(window.ftn.videoSync(sessionId, syncCam, anchor))
            setSyncCam(null)
          }}
          onRemove={async () => {
            const c = await run(window.ftn.videoRemove(sessionId, syncCam))
            setSyncCam(null)
            if (c) setView(c.onboard ? 'onboard' : 'top')
          }}
          onReplace={() => void run(window.ftn.videoPick(sessionId, syncCam))}
          onClose={() => setSyncCam(null)}
        />
      )}

      <div className="flex gap-5 items-start">
        <div className={`flex-1 min-w-0 grid gap-3 ${shown.length === 2 ? 'grid-cols-2' : ''}`}>
          {shown.map((c) => {
            const src = cfg[c]!
            const isPrimary = c === primary
            return (
              <div key={c} className="relative bg-black rounded-panel overflow-hidden">
                {src.missing ? (
                  <div className="aspect-video grid place-items-center text-plata text-[14px] p-6 text-center">
                    No se encuentra el archivo {src.name}. ¿Lo moviste? Elegilo de nuevo con “Ajustar sincronización”.
                  </div>
                ) : (
                  <video
                    ref={(el) => {
                      refs.current[c] = el
                    }}
                    src={src.url}
                    controls={isPrimary || syncCam === c}
                    muted={!isPrimary}
                    preload="metadata"
                    className="w-full aspect-video block"
                  />
                )}
                {isPrimary && live && idx !== null && lap && <Hud cmp={live} i={idx} lapLabel={`V${lap.lap}`} lapT={inLapT} />}
                <span className="absolute top-3 right-3 data text-[11px] tracking-[0.1em] uppercase text-white/70 bg-black/50 px-2 py-1 rounded-chip">
                  {CAM_NAME[c]}
                </span>
              </div>
            )
          })}
        </div>

        <aside className="w-[340px] shrink-0 flex flex-col gap-3.5">
          <div className="bg-carbono-2 border border-grafito rounded-panel px-4 py-3">
            {live?.a.x && live.a.y ? (
              <TrackMapSvg
                className="w-full h-[220px]"
                map={d.map.map}
                lines={[{ x: live.a.x, y: live.a.y, color: 'var(--ftn-azul)', width: 2, off: live.a.off }]}
                markers={idx !== null && Number.isFinite(live.a.x[idx]) ? [{ x: live.a.x[idx], y: live.a.y[idx], color: 'var(--ftn-blanco)', size: 1.6 }] : []}
              />
            ) : (
              <div className="h-[120px] grid place-items-center text-niebla text-[13px] text-center">
                {anchorOf(primary) ? 'Fuera de una vuelta' : 'Sincronizá el video para seguir el auto en el mapa'}
              </div>
            )}
          </div>
          <div className="bg-carbono-2 border border-grafito rounded-panel overflow-hidden max-h-[360px] overflow-y-auto">
            {d.laps.map((l) => (
              <button
                key={l.index}
                disabled={!anchorOf(primary)}
                onClick={() => seekLap(l.index)}
                className={`w-full grid grid-cols-[48px_1fr_auto] items-center gap-2 px-4 h-10 border-b border-grafito last:border-0 data text-[13px] text-left disabled:opacity-50 ${
                  l.index === lapIdx ? 'bg-grafito' : 'hover:bg-carbono'
                }`}
              >
                <span className="text-plata">V{l.lap}</span>
                <span className={l.index === d.bestIndex ? 'text-mejor font-bold' : ''}>{fmt.lapTime(l.timeS)}</span>
                <span className={`font-ui text-[12px] ${l.kind === 'valid' ? 'text-niebla' : 'text-alerta'}`}>
                  {l.index === d.bestIndex ? 'mejor' : l.kind !== 'valid' ? LAP_KIND_LABEL[l.kind] : fmt.delta(l.gapS, 2)}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {live && lap && (
        <section className="bg-carbono-2 border border-grafito rounded-panel px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[13px] text-plata mr-2">Saltar a</span>
              {d.corners.map((c) => (
                <button
                  key={c.id}
                  title={c.name ?? undefined}
                  onClick={() => {
                    const k = Math.round(c.startPct * (n - 1))
                    const ts = live.a.timeS[k]
                    if (Number.isFinite(ts)) seekLap(lap.index, ts)
                  }}
                  className="h-8 px-2.5 rounded-chip data text-[12px] bg-carbono text-plata hover:text-blanco"
                >
                  {c.label}
                </button>
              ))}
            </div>
            <span className="text-[12px] text-niebla">V{lap.lap} contra la mejor (V{d.laps[best]?.lap}) · clic en el gráfico para ir a ese punto</span>
          </div>
          <div
            className="cursor-pointer flex flex-col gap-4"
            onClick={() => {
              const ts = hover !== null ? live.a.timeS[hover] : NaN
              if (Number.isFinite(ts)) seekLap(lap.index, ts)
            }}
          >
            <TraceChart
              title="Velocidad"
              unit="km/h"
              series={[
                { values: live.b.speed, color: 'var(--ftn-mejor)', width: 1.5, opacity: 0.7 },
                { values: live.a.speed, color: 'var(--ftn-azul)', width: 2 },
              ]}
              height={150}
              marks={marks}
              showCorners
              cursor={hover ?? idx}
              onCursor={setHover}
            />
            <TraceChart
              title="Acelerador y freno"
              unit="%"
              series={[
                { values: live.a.throttle.map((v) => v * 100), color: 'var(--ftn-record)' },
                { values: live.a.brake.map((v) => v * 100), color: 'var(--ftn-error)' },
              ]}
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              height={90}
              marks={marks}
              cursor={hover ?? idx}
              onCursor={setHover}
            />
          </div>
        </section>
      )}
    </div>
  )
}

/** Datos de la telemetría encima del video, en el momento que se está viendo. */
function Hud({ cmp, i, lapLabel, lapT }: { cmp: CompareResult; i: number; lapLabel: string; lapT: number | null }) {
  const a = cmp.a
  const dt = cmp.delta[i]
  const v = (x: number) => (Number.isFinite(x) ? x : 0)
  return (
    <div className="absolute left-3 top-3 bg-black/65 rounded-card px-3.5 py-2.5 flex items-center gap-4 data pointer-events-none">
      <div className="flex flex-col">
        <span className="text-[11px] text-white/70 tracking-[0.1em]">{lapLabel}</span>
        <span className="text-[16px] text-white">{fmt.lapTime(lapT)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[11px] text-white/70 tracking-[0.1em]">DELTA</span>
        <span className={`text-[16px] ${dt > 0 ? 'text-alerta' : 'text-record'}`}>{fmt.delta(dt, 2)}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-[22px] text-white leading-none">{Math.round(v(a.speed[i]))}</span>
        <span className="text-[11px] text-white/70">km/h</span>
      </div>
      <span className="text-[26px] text-white leading-none w-6 text-center">{fmt.gear(v(a.gear[i]))}</span>
      <div className="flex gap-1 h-10 items-end">
        <span className="w-2.5 h-full bg-white/15 flex items-end">
          <span className="w-full bg-error" style={{ height: `${v(a.brake[i]) * 100}%` }} />
        </span>
        <span className="w-2.5 h-full bg-white/15 flex items-end">
          <span className="w-full bg-record" style={{ height: `${v(a.throttle[i]) * 100}%` }} />
        </span>
      </div>
    </div>
  )
}

/** Paso a paso: pausar en la largada de una vuelta y decir cuál es. */
function SyncPanel({
  cam,
  d,
  video,
  anchor,
  onShow,
  onSave,
  onRemove,
  onReplace,
  onClose,
}: {
  cam: VideoCam
  d: SessionDetail
  video: () => HTMLVideoElement | null
  anchor: { lap: number; videoS: number } | null
  onShow: () => void
  onSave: (a: { lap: number; videoS: number }) => Promise<void>
  onRemove: () => Promise<void>
  onReplace: () => void
  onClose: () => void
}) {
  const firstFull = d.laps.find((l) => l.kind === 'valid')?.index ?? d.laps[1]?.index ?? 0
  const [lap, setLap] = useState(anchor?.lap ?? firstFull)
  const [now, setNow] = useState(0)
  useEffect(() => {
    onShow()
    const t = setInterval(() => setNow(video()?.currentTime ?? 0), 100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam])
  const nudge = (s: number) => {
    const v = video()
    if (!v) return
    v.pause()
    v.currentTime = Math.max(0, v.currentTime + s)
  }
  return (
    <section className="bg-carbono-2 border border-ultramar rounded-panel px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label color="var(--ftn-azul)">Sincronizar {CAM_NAME[cam].toLowerCase()}</Label>
        <button onClick={onClose} className="text-[13px] text-niebla hover:text-blanco">
          Cerrar
        </button>
      </div>
      <ol className="text-[14px] text-plata leading-relaxed list-decimal pl-5">
        <li>Buscá en el video el momento exacto en que cruzás la línea de llegada al empezar una vuelta, y pausá.</li>
        <li>Ajustá cuadro por cuadro si hace falta, elegí qué vuelta empieza ahí y guardá.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['−1 s', -1],
            ['−1 cuadro', -FRAME],
            ['+1 cuadro', FRAME],
            ['+1 s', 1],
          ] as const
        ).map(([label, s]) => (
          <Button key={label} className="h-9 text-[13px]" onClick={() => nudge(s)}>
            {label}
          </Button>
        ))}
        <span className="data text-[15px] mx-2">{videoTime(now)}</span>
        <select value={lap} onChange={(e) => setLap(Number(e.target.value))} className="h-9 px-2 rounded-control bg-carbono border border-acero text-blanco data text-[13px]">
          {d.laps.map((l) => (
            <option key={l.index} value={l.index}>
              V{l.lap} · {fmt.lapTime(l.timeS)}
              {l.kind !== 'valid' ? ` · ${LAP_KIND_LABEL[l.kind]}` : ''}
            </option>
          ))}
        </select>
        <Button variant="primary" className="h-9 text-[13px]" onClick={() => void onSave({ lap, videoS: now })}>
          La V{d.laps[lap]?.lap} empieza acá
        </Button>
      </div>
      <div className="flex gap-4 text-[13px]">
        <button onClick={onReplace} className="text-azul hover:text-blanco">
          Cambiar archivo
        </button>
        <button onClick={() => void onRemove()} className="text-niebla hover:text-error">
          Quitar este video
        </button>
      </div>
    </section>
  )
}
