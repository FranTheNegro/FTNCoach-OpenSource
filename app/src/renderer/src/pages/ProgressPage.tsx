/**
 * Progreso: la evolución de tu mejor vuelta en cada auto y pista, con las
 * sesiones de esta PC.
 */
import { useMemo, useState } from 'react'
import type { SessionSummary } from '@shared/analysis'
import { historicalIdeal } from '@shared/history'
import * as fmt from '@ui/format'
import { BestLapChart } from '../components/charts'
import { Card, Label, PageHeader } from '../components/ui'
import { useLibrary, useWidth } from '../hooks'
import { GoLink } from '../nav'

interface Combo {
  key: string
  track: string
  car: string
  sim: 'iracing' | 'ac'
  points: { day: string; bestS: number }[]
  sessions: number
  timeS: number | null
  /** Ideal histórica (suma de tus mejores sectores), si se conoce. */
  idealS: number | null
}

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function hours(s: number | null | undefined): string {
  if (!s) return fmt.DASH
  return s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`
}

const shortDay = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

function sessionsLabel(c: Combo): string {
  return `${c.sessions} ${c.sessions === 1 ? 'sesión' : 'sesiones'}`
}

interface Progress {
  combos: Combo[]
  sessions: SessionSummary[]
}

export function useProgress(): Progress {
  const lib = useLibrary()
  const sessions = useMemo(() => lib?.sessions ?? [], [lib])
  const combos = useMemo(() => {
    const out: Combo[] = []
    const local = new Map<string, SessionSummary[]>()
    for (const s of sessions) {
      if (!s.bestLapS) continue
      const key = `local:${s.sim}:${s.trackId ?? s.track}:${s.car}`
      local.set(key, [...(local.get(key) ?? []), s])
    }
    for (const [key, list] of local) {
      const byDay = new Map<string, number>()
      for (const s of list) {
        const day = localDay(s.startedAt)
        byDay.set(day, Math.min(byDay.get(day) ?? Infinity, s.bestLapS!))
      }
      out.push({
        key,
        track: list[0].track,
        car: list[0].car,
        sim: list[0].sim,
        points: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, bestS]) => ({ day, bestS })),
        sessions: list.length,
        timeS: list.reduce((a, s) => a + s.durationS, 0),
        idealS: historicalIdeal(list),
      })
    }
    return out.sort((a, b) => (b.points.at(-1)?.day ?? '').localeCompare(a.points.at(-1)?.day ?? ''))
  }, [sessions])
  return { combos, sessions }
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-carbono rounded-control px-3.5 py-3 flex flex-col gap-1">
      <span className="data text-[11px] tracking-[0.1em] uppercase text-niebla">{label}</span>
      <span className="data text-[18px] font-medium" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-carbono-2 border border-grafito rounded-card px-5 py-4 flex flex-col gap-1.5 min-w-0">
      <div className="data text-[12px] tracking-[0.1em] text-niebla uppercase">{label}</div>
      <div className="data text-[28px] font-bold leading-none">{value}</div>
      {sub && <div className="text-[13px] text-plata truncate">{sub}</div>}
    </div>
  )
}

/** Horas en pista por mes (últimos 12). */
function MonthBars({ months }: { months: { month: string; timeS: number }[] }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const last = months.slice(-12)
  const max = Math.max(...last.map((m) => m.timeS), 1)
  const H = 120
  const bw = last.length ? Math.min(40, (w - 8) / last.length - 8) : 0
  return (
    <div ref={ref}>
      {w > 0 && (
        <svg width={w} height={H + 22} className="block" style={{ fontFamily: 'var(--ftn-font-data)' }}>
          {last.map((m, i) => {
            const x = 4 + i * ((w - 8) / last.length) + 4
            const h = Math.max(2, (m.timeS / max) * H)
            const label = new Date(m.month + '-15T12:00:00').toLocaleDateString('es-AR', { month: 'short' })
            return (
              <g key={m.month}>
                <rect x={x} y={H - h} width={bw} height={h} fill="var(--ftn-azul)">
                  <title>{`${m.month} · ${hours(m.timeS)}`}</title>
                </rect>
                <text x={x + bw / 2} y={H + 16} fontSize={11} fill="var(--ftn-niebla)" textAnchor="middle">
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

export function ProgressPage() {
  const { combos, sessions } = useProgress()
  const [selected, setSelected] = useState<string | null>(null)
  const active = combos.find((c) => c.key === selected) ?? combos[0] ?? null

  const localLaps = sessions.reduce((a, s) => a + s.laps, 0)
  const localValid = sessions.reduce((a, s) => a + s.validLaps, 0)
  let source = 'Sesiones de esta PC'
  let timeS = sessions.reduce((a, s) => a + s.durationS, 0)
  let lapCount = localLaps
  let lapsSub = localLaps ? `${Math.round((100 * localValid) / localLaps)} % válidas` : undefined
  const months = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sessions) {
      const k = localDay(s.startedAt).slice(0, 7)
      m.set(k, (m.get(k) ?? 0) + s.durationS)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, timeS]) => ({ month, timeS }))
  }, [sessions])

  const pts = active?.points ?? []
  const pb = pts.length ? Math.min(...pts.map((p) => p.bestS)) : null
  const first = pts[0]?.bestS
  const last = pts.at(-1)?.bestS

  return (
    <div className="max-w-[1300px]">
      <PageHeader title="Progreso">
        <Label>{source}</Label>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Kpi label="Tiempo en pista" value={hours(timeS)} sub={source} />
        <Kpi label="Vueltas" value={String(lapCount)} sub={lapsSub} />
        <Kpi label="Pistas" value={String(new Set(combos.map((c) => norm(c.track))).size)} />
        <Kpi label="Autos" value={String(new Set(combos.map((c) => norm(c.car))).size)} />
      </div>

      {!combos.length ? (
        <Card>
          <p className="text-plata">
            Todavía no hay vueltas cronometradas: corré una sesión y acá vas a ver tu evolución.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          <div className="flex flex-col gap-5 min-w-0">
            <section className="bg-carbono-2 border border-grafito rounded-panel px-6 py-5 flex flex-col gap-4 min-w-0">
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-[18px] font-bold truncate">{active?.track}</h2>
                  <div className="text-[14px] text-niebla truncate">
                    {active?.car}
                    {active && (
                      <>
                        {' · '}
                        <GoLink to="sessions" query={active.track}>
                          Ver sesiones
                        </GoLink>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-4 data text-[12px] text-plata shrink-0">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-azul" />
                    MEJOR VUELTA POR DÍA
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-mejor" />
                    PB
                  </span>
                </div>
              </div>
              {pts.length > 1 ? (
                <BestLapChart points={pts.map((p) => ({ label: shortDay(p.day), bestS: p.bestS }))} />
              ) : (
                <p className="text-niebla text-center py-10">Hace falta al menos otro día de práctica en esta combinación para ver la evolución.</p>
              )}
              <div className="grid grid-cols-4 gap-3">
                <MiniStat label="PB" value={fmt.lapTime(pb)} color="var(--ftn-mejor)" />
                <MiniStat label="Ideal histórica" value={fmt.lapTime(active?.idealS)} color="var(--ftn-azul)" />
                <MiniStat
                  label="Primer día → último"
                  value={first && last && pts.length > 1 ? `${fmt.delta(last - first, 3)} s` : fmt.DASH}
                  color={pts.length < 2 ? undefined : last! < first! ? 'var(--ftn-record)' : 'var(--ftn-alerta)'}
                />
                <MiniStat label="Tiempo en pista" value={hours(active?.timeS)} />
              </div>
            </section>
            {months.length > 1 && (
              <section className="bg-carbono-2 border border-grafito rounded-panel px-6 py-5">
                <h2 className="text-[16px] font-bold mb-3">Horas en pista por mes</h2>
                <MonthBars months={months} />
              </section>
            )}
          </div>

          <aside className="bg-carbono-2 border border-grafito rounded-panel overflow-hidden max-h-[720px] overflow-y-auto divide-y divide-grafito">
            {combos.map((c) => (
              <button
                key={c.key}
                onClick={() => setSelected(c.key)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${c.key === active?.key ? 'bg-grafito' : 'hover:bg-carbono'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold truncate">{c.track}</div>
                  <div className="text-[13px] text-plata truncate">{c.car}</div>
                </div>
                <div className="flex flex-col items-end shrink-0 gap-0.5">
                  <span className="data text-[13px]">{fmt.lapTime(Math.min(...c.points.map((p) => p.bestS)))}</span>
                  <span className="data text-[11px] text-niebla uppercase tracking-[0.08em]">
                    {sessionsLabel(c)}
                  </span>
                </div>
              </button>
            ))}
          </aside>
        </div>
      )}
    </div>
  )
}
