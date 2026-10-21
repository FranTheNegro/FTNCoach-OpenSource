import { useEffect, useMemo, useState } from 'react'
import { isLocal, type CompareResult, type SessionDetail, type SessionSummary } from '@shared/analysis'
import { localHistory } from '@shared/history'
import { LAP_KIND_LABEL, type LapKind } from '@shared/live'
import * as fmt from '@ui/format'
import type { MapMarker } from '@ui/TrackMapSvg'
import { Button, Label } from '../components/ui'
import { useLibrary } from '../hooks'
import { TraceChart, type ChartMarks } from './TraceChart'
import { CoachPanel } from './CoachPanel'
import { GgDiagram } from './GgDiagram'
import { SetupView } from './SetupView'
import { VideoTab } from './VideoTab'
import { MapPanel } from './MapPanel'
import { CornersTable } from './CornersTable'
import { LapChart } from './LapChart'
import { sessionLabel } from '@shared/events'

type Tab = 'analysis' | 'corners' | 'laps' | 'gg' | 'video' | 'setup' | 'coach'

/** Contra qué se compara la vuelta analizada. */
type Ref = { kind: 'lap'; index: number }

const SIM = { iracing: 'iRacing', ac: 'Assetto Corsa' } as const
const C = {
  a: 'var(--ftn-azul)',
  b: 'var(--ftn-mejor)',
  throttle: 'var(--ftn-record)',
  brake: 'var(--ftn-error)',
  delta: 'var(--ftn-alerta)',
}

const KIND_COLOR: Record<LapKind, string> = {
  valid: 'text-record',
  out_lap: 'text-niebla',
  in_lap: 'text-niebla',
  off_track: 'text-alerta',
  incident: 'text-error',
  partial: 'text-niebla',
}

const cleanError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: React.ReactNode; color?: string }) {
  return (
    <div className="bg-carbono-2 border border-grafito rounded-card px-5 py-4 flex flex-col gap-1.5 min-w-0">
      <div className="data text-[12px] tracking-[0.1em] text-niebla uppercase">{label}</div>
      <div className="data text-[28px] font-bold leading-none" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[13px] text-plata truncate">{sub}</div>}
    </div>
  )
}

function defaultLap(d: SessionDetail): number {
  const valid = d.laps.filter((l) => l.kind === 'valid' && l.index !== d.bestIndex)
  return valid.length ? valid[valid.length - 1].index : (d.bestIndex ?? d.laps[d.laps.length - 1]?.index ?? 0)
}

const SELECT = 'h-9 px-2 rounded-control bg-carbono border border-acero text-blanco data text-[13px] focus:border-azul outline-none'

function lapOption(d: SessionDetail, i: number): string {
  const l = d.laps[i]
  return `V${l.lap} · ${fmt.lapTime(l.timeS)} ${l.kind !== 'valid' ? `· ${l.complete ? LAP_KIND_LABEL[l.kind] : 'cortada'}` : l.index === d.bestIndex ? '· mejor' : ''}${l.session ? ` · ${sessionLabel(l.session)}` : ''}`
}

interface RefSelectProps {
  d: SessionDetail
  value: Ref
  onChange: (r: Ref) => void
}

function RefSelect(props: RefSelectProps) {
  const { d, value, onChange } = props
  const v = String(value.index)
  return (
    <label className="flex items-center gap-2 text-[13px] text-plata">
      contra
      <select
        value={v}
        onChange={(e) => {
          const x = e.target.value
          onChange({ kind: 'lap', index: Number(x) })
        }}
        className={SELECT}
      >
        {d.laps.map((l) => (
          <option key={l.index} value={l.index}>
            {lapOption(d, l.index)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SessionDetailView({
  summary,
  onBack,
  onPrev,
  onNext,
  event = null,
  onOpen,
}: {
  summary: SessionSummary
  onBack: () => void
  /** Las sesiones del mismo evento (práctica, qualy, carrera), si hay más de una. */
  event?: { s: SessionSummary; name: string }[] | null
  onOpen?: (s: SessionSummary) => void
  /** Sesión más vieja / más nueva de la lista. */
  onPrev?: () => void
  onNext?: () => void
}) {
  const [d, setD] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('analysis')
  const [lapA, setLapA] = useState(0)
  const [ref, setRef] = useState<Ref>({ kind: 'lap', index: 0 })
  const [cmp, setCmp] = useState<CompareResult | null>(null)
  const [cmpError, setCmpError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const lib = useLibrary()
  /** Tu PB en este auto y pista antes de esta sesión, con las sesiones de esta PC. */
  const localPbS = useMemo(() => (lib ? localHistory(lib.sessions, summary).pbBeforeS : null), [lib, summary])

  useEffect(() => {
    let alive = true
    setD(null)
    setError(null)
    setCmp(null)
    setRange(null)
    setLoading(null)
    const off = window.ftn.onSessionProgress((p) => alive && p.id === summary.id && setLoading(p.text))
    window.ftn
      .sessionDetail(summary.id)
      .then((det) => {
        if (!alive) return
        setD(det)
        setLapA(defaultLap(det))
        setRef({ kind: 'lap', index: det.bestIndex ?? defaultLap(det) })
      })
      .catch((e) => alive && setError(cleanError(e)))
    return () => {
      alive = false
      off()
    }
  }, [summary.id, summary.sim])


  const refKey = `lap:${ref.index}`
  useEffect(() => {
    if (!d) return
    let alive = true
    setCmpError(null)
    const p = window.ftn.compareLaps(summary.id, lapA, ref.index)
    p.then((c) => alive && setCmp(c)).catch((e) => {
      if (!alive) return
      setCmpError(cleanError(e))
      setRef({ kind: 'lap', index: d.bestIndex ?? defaultLap(d) })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, summary.id, lapA, refKey])

  const date = new Date(summary.startedAt)
  const eyebrow = `${date.toLocaleDateString('es-AR')} ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} · ${sessionLabel(summary.sessionType)} · ${SIM[summary.sim]}`
  const cond = d?.conditions
  const condText = cond
    ? [
        cond.airC !== null ? `Aire ${Math.round(cond.airC)} °C` : null,
        cond.trackC !== null ? `Pista ${Math.round(cond.trackC)} °C` : null,
        cond.skies,
        cond.wetness,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  const header = (
    <div className="flex items-end justify-between gap-6 mb-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-3 text-[13px]">
          <button onClick={onBack} className="text-plata hover:text-blanco">
            ← Sesiones
          </button>
          <span className="flex gap-1">
            <button
              onClick={onPrev}
              disabled={!onPrev}
              title="Sesión anterior"
              className="w-7 h-7 rounded-chip text-plata hover:text-blanco hover:bg-grafito disabled:opacity-30 disabled:pointer-events-none"
            >
              ‹
            </button>
            <button
              onClick={onNext}
              disabled={!onNext}
              title="Sesión siguiente"
              className="w-7 h-7 rounded-chip text-plata hover:text-blanco hover:bg-grafito disabled:opacity-30 disabled:pointer-events-none"
            >
              ›
            </button>
          </span>
        </div>
        <div className="data text-[12px] tracking-[0.12em] uppercase text-niebla">
          {eyebrow}
        </div>
        <h1 className="text-[28px] font-bold tracking-[-0.01em] mt-1.5 truncate">
          {summary.track} · {summary.car}
        </h1>
        {condText && <div className="text-[13px] text-plata mt-1.5">{condText}</div>}
        {event && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {event.map(({ s, name }) => (
              <button
                key={s.id}
                onClick={() => s.id !== summary.id && onOpen?.(s)}
                className={`h-9 px-3 rounded-chip text-[13px] font-semibold flex items-center gap-2 ${
                  s.id === summary.id ? 'bg-ultramar text-blanco' : 'bg-carbono-2 border border-grafito text-plata hover:text-blanco'
                }`}
              >
                {name}
                <span className="data font-normal text-[12px]">{fmt.lapTime(s.bestLapS)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {isLocal(summary) && <Button onClick={() => void window.ftn.showFile(summary.path)}>Mostrar archivo</Button>}
    </div>
  )

  if (error)
    return (
      <div className="max-w-[1400px]">
        {header}
        <p className="text-error">No se pudo abrir la sesión: {error}</p>
      </div>
    )
  if (!d)
    return (
      <div className="max-w-[1400px]">
        {header}
        <p className="text-plata">{loading ?? `Analizando la sesión${summary.sim === 'iracing' ? ' y ubicando el mapa oficial' : ''}…`}</p>
      </div>
    )

  const best = d.bestIndex !== null ? d.laps[d.bestIndex] : null
  const A = d.laps[lapA]
  const gainS = best && d.theoreticalS !== null ? d.theoreticalS - best.timeS : null
  const pbPrevS = localPbS
  const pbGap = pbPrevS !== null && best ? best.timeS - pbPrevS : null
  const refLabel = `V${d.laps[ref.index]?.lap}`


  const tabs: [Tab, string][] = [
    ['analysis', 'Análisis'],
    ['corners', 'Curvas'],
    ['laps', 'Vueltas'],
    ['gg', 'G-G'],
    ['video', 'Video'],
    // El setup solo viene con la telemetría local
    ...(isLocal(summary) ? ([['setup', 'Setup']] as [Tab, string][]) : []),
    ['coach', 'Coach'],
  ]

  return (
    <div className="max-w-[1400px]">
      {header}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Kpi
          label="Mejor vuelta"
          value={fmt.lapTime(best?.timeS)}
          sub={
            best ? (
              <>
                Vuelta {best.lap}
                {pbGap !== null && (
                  <>
                    {' · '}
                    <span className={`data ${pbGap < 0 ? 'text-record' : 'text-alerta'}`}>
                      {pbGap < 0 ? `nuevo PB ${fmt.delta(pbGap, 3)}` : `${fmt.delta(pbGap, 3)} vs tu PB`}
                    </span>
                  </>
                )}
              </>
            ) : (
              'Sin vueltas válidas'
            )
          }
          color="var(--ftn-mejor)"
        />
        <Kpi
          label="Vuelta analizada"
          value={fmt.lapTime(A?.timeS)}
          sub={
            A && (
              <>
                Vuelta {A.lap}
                {A.gapS !== null && A.index !== d.bestIndex && (
                  <>
                    {' · '}
                    <span className="data text-alerta">{fmt.delta(A.gapS, 3)}</span>
                  </>
                )}
                {A.kind !== 'valid' && ` · ${LAP_KIND_LABEL[A.kind]}`}
              </>
            )
          }
        />
        <Kpi
          label="Consistencia"
          value={d.consistencyS !== null ? `±${d.consistencyS.toFixed(2)} s` : fmt.DASH}
          sub={`${d.laps.filter((l) => l.kind === 'valid').length} vueltas válidas`}
        />
        <Kpi
          label="Mejor teórica"
          value={fmt.lapTime(d.theoreticalS)}
          sub={gainS !== null ? `${fmt.delta(gainS, 3)} s con tus mejores sectores` : 'Hacen falta vueltas válidas'}
          color="var(--ftn-azul)"
        />
      </div>

      <div className="flex gap-1 mb-5 border-b border-grafito">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`h-11 px-4 -mb-px border-b-2 font-semibold text-[14px] transition-colors ${
              tab === id ? 'border-ultramar text-blanco' : 'border-transparent text-plata hover:text-blanco'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === 'analysis' || tab === 'corners' || tab === 'gg') && (
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <label className="flex items-center gap-2 text-[13px] text-plata">
            Vuelta
            <select value={lapA} onChange={(e) => setLapA(Number(e.target.value))} className={SELECT}>
              {d.laps.map((l) => (
                <option key={l.index} value={l.index}>
                  {lapOption(d, l.index)}
                </option>
              ))}
            </select>
          </label>
          <RefSelect
            d={d}
            value={ref}
            onChange={setRef}
          />
          {cmpError && <span className="text-error text-[13px]">{cmpError}</span>}
        </div>
      )}

      {tab === 'analysis' && (
        <Analysis
          d={d}
          cmp={cmp}
          lapA={lapA}
          refLabel={refLabel}
          refLap={ref.kind === 'lap' ? ref.index : null}
          cursor={cursor}
          setCursor={setCursor}
          range={range}
          setRange={setRange}
        />
      )}
      {tab === 'corners' && (
        <CornersTable
          d={d}
          lapA={lapA}
          refLap={ref.kind === 'lap' ? ref.index : null}
          labelA={`V${A?.lap}`}
          refLabel={refLabel}
          onZoom={(id) => {
            const c = d.corners.find((x) => x.id === id)
            const n = d.distM.length
            if (c) setRange([Math.max(0, Math.round(c.startPct * (n - 1)) - Math.round(n * 0.01)), Math.min(n - 1, Math.round(c.endPct * (n - 1)) + Math.round(n * 0.01))])
            setTab('analysis')
          }}
        />
      )}
      {tab === 'laps' && (
        <div className="flex flex-col gap-4">
          <LapChart
            d={d}
            selected={lapA}
            onSelect={(i) => {
              setLapA(i)
              setTab('analysis')
            }}
          />
          <LapsTable
            d={d}
            selected={lapA}
            onSelect={(i) => {
              setLapA(i)
              setTab('analysis')
            }}
          />
        </div>
      )}
      {tab === 'gg' &&
        (cmp ? (
          <GgDiagram a={cmp.a} b={cmp.b} labelA={`V${A?.lap}`} labelB={refLabel} range={range} cursor={cursor} />
        ) : (
          <p className="text-plata">Comparando…</p>
        ))}
      {tab === 'video' && <VideoTab sessionId={summary.id} d={d} />}
      {tab === 'setup' && <SetupView setup={d.setup} />}
      {tab === 'coach' && <CoachPanel sessionId={summary.id} lap={lapA} lapLabel={A ? `V${A.lap}` : ''} />}
    </div>
  )
}

function bounds(xs: (number[] | null | undefined)[], ys: (number[] | null | undefined)[], i0: number, i1: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  xs.forEach((x, k) => {
    const y = ys[k]
    if (!x || !y) return
    for (let i = i0; i <= i1; i++)
      if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
        minX = Math.min(minX, x[i])
        maxX = Math.max(maxX, x[i])
        minY = Math.min(minY, y[i])
        maxY = Math.max(maxY, y[i])
      }
  })
  if (!Number.isFinite(minX)) return null
  // Un mínimo de 120 m para que una curva no quede como un trazo suelto
  const pad = Math.max(30, (120 - Math.max(maxX - minX, maxY - minY)) / 2)
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

function Analysis({
  d,
  cmp,
  lapA,
  refLabel,
  refLap,
  cursor,
  setCursor,
  range,
  setRange,
}: {
  d: SessionDetail
  cmp: CompareResult | null
  lapA: number
  refLabel: string
  refLap: number | null
  cursor: number | null
  setCursor: (i: number | null) => void
  range: [number, number] | null
  setRange: (r: [number, number] | null) => void
}) {
  const [more, setMore] = useState(true)
  const A = d.laps[lapA]
  const B = refLap !== null ? d.laps[refLap] : null
  const hot = new Set(cmp?.insights.map((i) => i.cornerId))
  const marks: ChartMarks = useMemo(
    () => ({
      sectors: d.sectorsPct.slice(1),
      corners: d.corners.map((c) => ({ pct: c.apexPct, label: c.label, hot: hot.has(c.id) })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, cmp],
  )
  const n = d.distM.length
  const distLabel = cursor !== null ? `${Math.round(d.distM[cursor])} m` : null
  const zoomTo = (cornerId: number) => {
    const c = d.corners.find((x) => x.id === cornerId)
    if (!c) return
    const m = Math.round(n * 0.01)
    setRange([Math.max(0, Math.round(c.startPct * (n - 1)) - m), Math.min(n - 1, Math.round(c.endPct * (n - 1)) + m)])
  }
  const chart = { marks, cursor, onCursor: setCursor, range, onRange: setRange }

  const mapLines = cmp?.a.x && cmp.a.y
  const markers: MapMarker[] = []
  // Si el mapa oficial ya numera las curvas, el marcador va sin texto para no repetirlo
  const numbered = d.map.map?.labels.some((l) => l.turn !== null) ?? false
  if (cmp?.a.x && cmp.a.y) {
    for (const ins of cmp.insights) {
      const c = d.corners.find((x) => x.id === ins.cornerId)
      if (!c) continue
      const i = Math.round(c.apexPct * (n - 1))
      if (Number.isFinite(cmp.a.x[i])) markers.push({ x: cmp.a.x[i], y: cmp.a.y![i], color: 'var(--ftn-alerta)', label: numbered ? undefined : c.label })
    }
    if (cursor !== null && Number.isFinite(cmp.a.x[cursor]))
      markers.push({ x: cmp.a.x[cursor], y: cmp.a.y[cursor], color: 'var(--ftn-blanco)', size: 1.3 })
  }
  const focus = cmp && range ? bounds([cmp.a.x, cmp.b.x], [cmp.a.y, cmp.b.y], range[0], range[1]) : null
  const totalDelta = cmp ? cmp.delta.filter(Number.isFinite).at(-1) : null
  const rangeDelta = cmp && range ? (cmp.delta[range[1]] ?? NaN) - (cmp.delta[range[0]] ?? NaN) : null

  return (
    <div className="flex flex-col gap-5">
      {cmp && (mapLines || d.map.map) && (
        <section className="bg-carbono-2 border border-grafito rounded-panel px-6 py-5 flex flex-col gap-2">
          <MapPanel d={d} cmp={cmp} markers={markers} focus={focus} labelA={`V${A?.lap}`} labelB={refLabel} />
          <p className="text-[12px] text-niebla leading-snug">{d.map.note}</p>
        </section>
      )}
    <div className="flex gap-5 items-start">
      <section className="flex-1 min-w-0 bg-carbono-2 border border-grafito rounded-panel px-6 py-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setRange(null)}
              className={`h-8 px-3 rounded-chip data text-[12px] ${!range ? 'bg-ultramar text-blanco' : 'bg-carbono text-plata hover:text-blanco'}`}
            >
              Vuelta entera
            </button>
            {d.corners.map((c) => {
              const on = range && Math.round(c.apexPct * (n - 1)) >= range[0] && Math.round(c.apexPct * (n - 1)) <= range[1]
              return (
                <button
                  key={c.id}
                  onClick={() => zoomTo(c.id)}
                  title={c.name ?? undefined}
                  className={`h-8 px-2.5 rounded-chip data text-[12px] ${
                    on ? 'bg-grafito text-blanco' : hot.has(c.id) ? 'bg-carbono text-alerta hover:text-blanco' : 'bg-carbono text-plata hover:text-blanco'
                  }`}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
          <div className="flex gap-4 data text-[12px] text-plata">
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5" style={{ background: C.b }} />
              {refLabel}
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5" style={{ background: C.a }} />V{A?.lap}
            </span>
            {distLabel && <span className="text-niebla">{distLabel}</span>}
          </div>
        </div>

        {!cmp ? (
          <p className="text-plata">Comparando…</p>
        ) : (
          <>
            <TraceChart
              title="Velocidad"
              unit="km/h"
              series={[
                { values: cmp.b.speed, color: C.b, width: 2 },
                { values: cmp.a.speed, color: C.a, width: 2 },
              ]}
              height={220}
              showCorners
              {...chart}
            />
            <TraceChart
              title={range ? `Delta en el tramo · ${fmt.delta(rangeDelta, 3)}` : `Delta acumulado · ${fmt.delta(totalDelta ?? null, 3)}`}
              unit="s"
              series={[{ values: cmp.delta, color: C.delta, width: 2 }]}
              height={90}
              zeroLine
              format={(v) => fmt.delta(v, 2)}
              {...chart}
            />
            <TraceChart
              title="Acelerador y freno"
              unit="%"
              series={[
                { values: cmp.b.throttle.map((v) => v * 100), color: C.throttle, width: 1.25, opacity: 0.4 },
                { values: cmp.b.brake.map((v) => v * 100), color: C.brake, width: 1.25, opacity: 0.4 },
                { values: cmp.a.throttle.map((v) => v * 100), color: C.throttle },
                { values: cmp.a.brake.map((v) => v * 100), color: C.brake },
              ]}
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              height={110}
              {...chart}
            />
            <div className="grid grid-cols-2 gap-5">
              <TraceChart
                title="Volante"
                series={[
                  { values: cmp.b.steer.map((v) => v * 100), color: C.b, width: 1.5 },
                  { values: cmp.a.steer.map((v) => v * 100), color: C.a, width: 1.5 },
                ]}
                height={100}
                zeroLine
                {...chart}
              />
              <TraceChart
                title="Marcha"
                series={[
                  { values: cmp.b.gear, color: C.b, width: 1.5, step: true },
                  { values: cmp.a.gear, color: C.a, width: 1.5, step: true },
                ]}
                height={100}
                {...chart}
              />
            </div>
            {more && (
              <>
                <TraceChart
                  title="RPM"
                  series={[
                    { values: cmp.b.rpm, color: C.b, width: 1.5 },
                    { values: cmp.a.rpm, color: C.a, width: 1.5 },
                  ]}
                  height={100}
                  {...chart}
                />
                <div className="grid grid-cols-2 gap-5">
                  <TraceChart
                    title="G lateral"
                    unit="g"
                    series={[
                      { values: cmp.b.gLat, color: C.b, width: 1.5 },
                      { values: cmp.a.gLat, color: C.a, width: 1.5 },
                    ]}
                    height={100}
                    zeroLine
                    format={(v) => v.toFixed(1)}
                    {...chart}
                  />
                  <TraceChart
                    title="G longitudinal"
                    unit="g"
                    series={[
                      { values: cmp.b.gLon, color: C.b, width: 1.5 },
                      { values: cmp.a.gLon, color: C.a, width: 1.5 },
                    ]}
                    height={100}
                    zeroLine
                    format={(v) => v.toFixed(1)}
                    {...chart}
                  />
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-3">
              <button onClick={() => setMore(!more)} className="text-[13px] font-semibold text-azul hover:text-blanco whitespace-nowrap">
                {more ? 'Menos canales' : 'Más canales: RPM y fuerzas G'}
              </button>
              <span className="text-[12px] text-niebla">Arrastrá sobre un gráfico para acercar · doble clic para la vuelta entera</span>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${d.sectorsPct.length}, minmax(0, 1fr))` }}>
              {d.sectorsPct.map((_, k) => {
                const a = A?.sectorsS[k] ?? null
                const b = B ? (B.sectorsS[k] ?? null) : null
                const diff = a !== null && b !== null ? a - b : null
                return (
                  <div key={k} className="bg-carbono rounded-control px-3.5 py-3 flex flex-col gap-1 data min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-[12px] text-niebla">S{k + 1}</span>
                      <span className={`text-[12px] ${diff !== null && diff > 0.0005 ? 'text-alerta' : 'text-record'}`}>
                        {diff !== null ? fmt.delta(diff, 3) : ''}
                      </span>
                    </div>
                    <span className="text-[17px] font-medium">{a !== null ? a.toFixed(3) : fmt.DASH}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      <aside className="w-[380px] shrink-0 flex flex-col gap-3.5">
        <div className="bg-carbono-2 border border-grafito rounded-panel px-5 py-4 flex flex-col gap-2">
          <h2 className="text-[16px] font-bold">Dónde perdés tiempo</h2>
          {cmp && !(mapLines || d.map.map) && <div className="h-[80px] grid place-items-center text-niebla text-[13px] text-center">Sin mapa para esta sesión</div>}
          {cmp && <CursorReadout cmp={cmp} cursor={cursor} labelA={`V${A?.lap}`} labelB={refLabel} />}
        </div>
        {cmp?.insights.map((ins) => (
          <button
            key={ins.cornerId}
            onClick={() => zoomTo(ins.cornerId)}
            className="text-left bg-carbono-2 border border-grafito hover:border-acero rounded-card px-4 py-3.5 flex flex-col gap-1.5"
          >
            <div className="w-full flex justify-between items-center gap-3 data">
              <div className="flex items-center gap-2 text-[12px] tracking-[0.08em] text-plata uppercase min-w-0">
                <span className="w-2 h-2 bg-alerta shrink-0" />
                <span className="truncate">{ins.title}</span>
              </div>
              <div className="text-[14px] font-bold text-azul shrink-0">{fmt.delta(-ins.lossS, 2)} s</div>
            </div>
            <p className="text-[14px] leading-snug">{ins.text}</p>
          </button>
        ))}
        {cmp && !cmp.insights.length && (refLap === null || lapA !== refLap) && (
          <p className="text-plata text-[14px] px-1">En ninguna curva perdés más de 2 centésimas contra {refLabel}.</p>
        )}
        {refLap !== null && lapA === refLap && <p className="text-plata text-[14px] px-1">Elegí otra vuelta para comparar contra la mejor.</p>}
      </aside>
    </div>
    </div>
  )
}

/** Mandos de las dos vueltas en el punto del cursor. */
function CursorReadout({ cmp, cursor, labelA, labelB }: { cmp: CompareResult; cursor: number | null; labelA: string; labelB: string }) {
  if (cursor === null) return <p className="text-[12px] text-niebla">Pasá el mouse por los gráficos para ver los mandos en cada punto.</p>
  const row = (t: CompareResult['a'], label: string, color: string) => {
    const v = (x: number) => (Number.isFinite(x) ? x : 0)
    return (
      <div className="grid grid-cols-[52px_64px_28px_1fr] items-center gap-2 data text-[12px]">
        <span style={{ color }}>{label}</span>
        <span>{Number.isFinite(t.speed[cursor]) ? `${Math.round(t.speed[cursor])} km/h` : fmt.DASH}</span>
        <span className="text-plata">{Number.isFinite(t.gear[cursor]) ? fmt.gear(t.gear[cursor]) : ''}</span>
        <span className="flex gap-1 items-center">
          <span className="h-2 flex-1 bg-carbono rounded-sm overflow-hidden">
            <span className="block h-full bg-record" style={{ width: `${v(t.throttle[cursor]) * 100}%` }} />
          </span>
          <span className="h-2 flex-1 bg-carbono rounded-sm overflow-hidden">
            <span className="block h-full bg-error" style={{ width: `${v(t.brake[cursor]) * 100}%` }} />
          </span>
        </span>
      </div>
    )
  }
  const dt = cmp.delta[cursor]
  return (
    <div className="flex flex-col gap-1.5 bg-carbono rounded-control px-3 py-2.5">
      <div className="flex justify-between data text-[11px] tracking-[0.08em] uppercase text-niebla">
        <span>En el cursor · acel / freno</span>
        <span className="text-alerta normal-case tracking-normal">{fmt.delta(dt, 3)} s</span>
      </div>
      {row(cmp.b, labelB.length > 7 ? labelB.slice(0, 6) + '…' : labelB, C.b)}
      {row(cmp.a, labelA, C.a)}
    </div>
  )
}

function LapsTable({ d, selected, onSelect }: { d: SessionDetail; selected: number; onSelect: (i: number) => void }) {
  // El archivo pasó por varias sesiones (práctica y qualy sin bajarse del auto)
  const multi = d.laps.some((l) => l.session)
  const bestSector = d.sectorsPct.map((_, k) =>
    Math.min(...d.laps.filter((l) => l.kind === 'valid').map((l) => l.sectorsS[k] ?? Infinity)),
  )
  return (
    <div className="bg-carbono-2 border border-grafito rounded-card overflow-hidden">
      <table className="w-full data text-[13px]">
        <thead>
          <tr className="text-niebla text-[11px] tracking-[0.1em] uppercase text-left">
            <th className="px-4 h-10 font-normal">Vuelta</th>
            {multi && <th className="px-4 font-normal">Sesión</th>}
            <th className="px-4 font-normal">Tiempo</th>
            <th className="px-4 font-normal">Δ mejor</th>
            {d.sectorsPct.map((_, k) => (
              <th key={k} className="px-4 font-normal">
                S{k + 1}
              </th>
            ))}
            <th className="px-4 font-normal">Comb.</th>
            <th className="px-4 font-normal">Vel. máx</th>
            <th className="px-4 font-normal">Estado</th>
          </tr>
        </thead>
        <tbody>
          {d.laps.map((l) => (
            <tr
              key={l.index}
              onClick={() => onSelect(l.index)}
              className={`border-t border-grafito cursor-pointer hover:bg-grafito ${l.index === selected ? 'bg-grafito' : ''}`}
            >
              <td className="px-4 h-10">{l.lap}</td>
              {multi && <td className="px-4 font-ui text-plata">{l.session ? sessionLabel(l.session) : fmt.DASH}</td>}
              <td className={`px-4 ${l.index === d.bestIndex ? 'text-mejor font-bold' : !l.complete ? 'text-niebla' : ''}`} title={!l.complete ? 'Vuelta cortada: tiempo hasta donde llegó' : undefined}>
                {fmt.lapTime(l.timeS)}
                {!l.complete && <span className="text-[11px]"> parcial</span>}
              </td>
              <td className="px-4 text-plata">{l.gapS !== null && l.index !== d.bestIndex ? fmt.delta(l.gapS, 3) : ''}</td>
              {l.sectorsS.map((s, k) => (
                <td key={k} className={`px-4 ${l.kind === 'valid' && s !== null && Math.abs(s - bestSector[k]) < 1e-6 ? 'text-mejor' : ''}`}>
                  {s !== null ? s.toFixed(3) : fmt.DASH}
                </td>
              ))}
              <td className="px-4 text-plata">{l.fuelUsedL !== null ? `${l.fuelUsedL.toFixed(2)} L` : fmt.DASH}</td>
              <td className="px-4 text-plata">{Math.round(l.maxSpeedKmh)}</td>
              <td className={`px-4 font-ui text-[13px] ${KIND_COLOR[l.kind]}`} title={l.reason ?? undefined}>
                {LAP_KIND_LABEL[l.kind]}
                {l.reason && l.kind !== 'valid' ? <span className="text-niebla"> · {l.reason}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-3 border-t border-grafito">
        <Label>Tocá una vuelta para analizarla</Label>
      </div>
    </div>
  )
}
