/**
 * Seguimiento: cómo va el piloto contra su plan y qué tan preparado llega a cada
 * carrera. Todo sale de las sesiones grabadas; nada lo estima la IA.
 */
import { CalendarCheck, Flag, Gauge } from 'lucide-react'
import type { SessionSummary } from '@shared/analysis'
import { weekStart, type PlanState } from '@shared/plan'
import * as fmt from '@ui/format'
import { Card, Label } from '../components/ui'
import { hours } from '../pages/ProgressPage'
import { daysUntil, itemDone, readiness, sessionsOfWeek, shortDate, weekLabel } from './plan-data'

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-carbono-2 border border-grafito rounded-card px-5 py-4 min-w-0">
      <div className="data text-[12px] tracking-[0.1em] text-niebla uppercase">{label}</div>
      <div className="data text-[26px] font-bold mt-1.5 truncate">{value}</div>
      {sub && <div className="text-[13px] text-plata mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-2 rounded-full bg-carbono overflow-hidden">
      <div className="h-full bg-ultramar rounded-full" style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
    </div>
  )
}

export function TrackingTab({ st, sessions, onProgress }: { st: PlanState; sessions: SessionSummary[]; onProgress: () => void }) {
  const thisWeek = weekStart(new Date())
  const weekSessions = sessionsOfWeek(thisWeek, sessions)
  const drivenS = weekSessions.reduce((a, s) => a + s.durationS, 0)
  const goalS = st.goals.hoursPerWeek * 3600
  const plan = st.plan
  const planWeeks = (plan?.weeks ?? []).filter((w) => w.start <= thisWeek)
  const current = plan?.weeks.find((w) => w.start === thisWeek)
  const doneOf = (w: NonNullable<typeof plan>['weeks'][number]) => {
    const list = sessionsOfWeek(w.start, sessions)
    return w.items.filter((i) => itemDone(i, list)).length
  }
  const total = planWeeks.reduce((a, w) => a + w.items.length, 0)
  const done = planWeeks.reduce((a, w) => a + doneOf(w), 0)
  const upcoming = st.calendar.filter((e) => e.date && daysUntil(e.date) >= 0).slice(0, 5)
  const next = upcoming[0]
  const nextIn = next?.date ? daysUntil(next.date) : null

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-4">
        <Tile label="En pista esta semana" value={hours(drivenS)} sub={goalS ? `de ${hours(goalS)} que te propusiste` : `${weekSessions.length} ${weekSessions.length === 1 ? 'sesión' : 'sesiones'}`} />
        <Tile label="Plan de esta semana" value={current ? `${doneOf(current)} / ${current.items.length}` : fmt.DASH} sub={current ? 'salidas hechas' : 'sin plan para esta semana'} />
        <Tile label="Plan hasta hoy" value={total ? `${Math.round((100 * done) / total)} %` : fmt.DASH} sub={total ? `${done} de ${total} salidas` : 'todavía sin plan'} />
        <Tile
          label="Próxima carrera"
          value={nextIn === null ? fmt.DASH : nextIn === 0 ? 'Hoy' : `${nextIn} ${nextIn === 1 ? 'día' : 'días'}`}
          sub={next ? `${next.series}${next.track ? ` · ${next.track}` : ''}` : 'calendario vacío'}
        />
      </div>

      <section>
        <h2 className="text-[18px] font-bold mb-1">Cómo llegás a tus carreras</h2>
        <p className="text-[13px] text-niebla mb-3">Las sesiones grabadas con el auto y la pista de cada carrera.</p>
        {upcoming.length ? (
          <div className="bg-carbono-2 border border-grafito rounded-card divide-y divide-grafito">
            {upcoming.map((e) => {
              const r = readiness(e, sessions)
              return (
                <div key={e.id} className="px-4 py-3 grid grid-cols-[110px_minmax(0,1fr)_auto] gap-4 items-center">
                  <span className="data text-[13px]">{shortDate(e.date!)}</span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold truncate">
                      {e.series}
                      {e.round && <span className="text-plata font-normal"> · {e.round}</span>}
                    </div>
                    <div className="text-[13px] text-plata truncate">{[e.car, e.track].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="text-right">
                    {r.sessions ? (
                      <>
                        <div className="data text-[14px]">
                          {r.sessions} {r.sessions === 1 ? 'sesión' : 'sesiones'}
                          {r.bestS !== null && <span className="text-mejor"> · {fmt.lapTime(r.bestS)}</span>}
                        </div>
                        <div className="text-[12px] text-niebla">última el {new Date(r.last!).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</div>
                      </>
                    ) : (
                      <span className={`text-[13px] ${e.owned === false ? 'text-alerta' : 'text-niebla'}`}>{e.owned === false ? 'Te falta el contenido' : 'Todavía no la practicaste'}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <Card>
            <Label icon={Flag}>Sin carreras por delante</Label>
            <p className="text-plata mt-2">Cargá tu calendario en la pestaña Calendario y acá ves cómo llegás a cada una.</p>
          </Card>
        )}
      </section>

      {planWeeks.length > 0 && (
        <section>
          <h2 className="text-[18px] font-bold mb-3">Semana a semana</h2>
          <div className="bg-carbono-2 border border-grafito rounded-card divide-y divide-grafito">
            {[...planWeeks].reverse().map((w) => {
              const d = doneOf(w)
              const t = sessionsOfWeek(w.start, sessions).reduce((a, s) => a + s.durationS, 0)
              return (
                <div key={w.start} className="px-4 py-3 grid grid-cols-[180px_minmax(0,1fr)_200px] gap-4 items-center">
                  <span className="text-[14px] font-semibold inline-flex items-center gap-2">
                    <CalendarCheck size={16} className="text-niebla" />
                    {w.start === thisWeek ? 'Esta semana' : weekLabel(w.start)}
                  </span>
                  <span className="text-[13px] text-plata truncate">{w.focus}</span>
                  <div className="flex flex-col gap-1">
                    <Bar value={w.items.length ? d / w.items.length : 0} />
                    <span className="data text-[12px] text-niebla">
                      {d} de {w.items.length} salidas · {hours(t)} en pista
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <Card>
        <Label icon={Gauge}>Tus tiempos</Label>
        <p className="text-plata mt-2">
          La evolución de tu mejor vuelta en cada auto y pista está en{' '}
          <button className="text-azul font-semibold hover:underline" onClick={onProgress}>
            Progreso
          </button>
          .
        </p>
      </Card>
    </div>
  )
}
