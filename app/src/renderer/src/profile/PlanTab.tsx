/**
 * Plan de entrenamiento: el piloto dice qué quiere lograr y cuánto tiempo tiene,
 * y el coach arma las semanas con su progreso real y su calendario. Se ajusta
 * pidiéndole cambios.
 */
import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Circle, Flag, Milestone, Sparkles, Target } from 'lucide-react'
import type { SessionSummary } from '@shared/analysis'
import { PLAN_SIM_LABEL, weekStart, type PlanGoals, type PlanItem, type PlanState, type RaceEvent } from '@shared/plan'
import { Button, Card, Label } from '../components/ui'
import { INPUT, sessionFor, sessionsOfWeek, shortDate, weekLabel } from './plan-data'

function GoalsForm({ value, onSave }: { value: PlanGoals; onSave: (g: PlanGoals) => Promise<void> }) {
  const [g, setG] = useState(value)
  const [saving, setSaving] = useState(false)
  useEffect(() => setG(value), [value])
  const dirty = JSON.stringify(g) !== JSON.stringify(value)
  return (
    <Card className="flex flex-col gap-4">
      <Label icon={Target}>Tu objetivo</Label>
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold">Qué querés lograr</span>
        <textarea
          value={g.main}
          onChange={(e) => setG({ ...g, main: e.target.value })}
          rows={2}
          placeholder="Por ejemplo: pasar a licencia B y correr GT3 Sprint, y el año que viene IMSA con los GTP."
          className={`${INPUT} py-2.5 leading-relaxed resize-y`}
        />
        <span className="text-[12px] text-niebla">Es el mismo objetivo de tu perfil: lo usa también el coach de cada sesión.</span>
      </label>
      <div className="grid grid-cols-[180px_160px_1fr] gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">Para cuándo</span>
          <input type="date" value={g.deadline} onChange={(e) => setG({ ...g, deadline: e.target.value })} className={`${INPUT} h-11 data`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">Horas por semana</span>
          <input
            type="number"
            min={0}
            max={60}
            value={g.hoursPerWeek || ''}
            onChange={(e) => setG({ ...g, hoursPerWeek: Number(e.target.value) || 0 })}
            className={`${INPUT} h-11 data`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">Cuándo podés correr</span>
          <input value={g.availability} onChange={(e) => setG({ ...g, availability: e.target.value })} placeholder="Martes y jueves a la noche, sábado a la tarde" className={`${INPUT} h-11`} />
        </label>
      </div>
      {dirty && (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setG(value)}>
            Descartar
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onSave(g)
              } finally {
                setSaving(false)
              }
            }}
          >
            Guardar
          </Button>
        </div>
      )}
    </Card>
  )
}

function Item({ item, week, event, onToggle }: { item: PlanItem; week: SessionSummary[]; event: RaceEvent | null; onToggle: () => void }) {
  const session = sessionFor(item, week)
  const done = item.done || !!session
  return (
    <div className="py-3 grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <button
        onClick={onToggle}
        disabled={!!session && !item.done}
        title={session ? 'Hecha: la sesión grabada coincide' : done ? 'Marcar como pendiente' : 'Marcar como hecha'}
        className="pt-0.5 text-niebla hover:text-blanco disabled:pointer-events-none"
      >
        {done ? <CheckCircle2 size={20} className="text-record" /> : <Circle size={20} />}
      </button>
      <div className="min-w-0">
        <div className={`text-[15px] font-semibold ${done ? 'text-plata' : ''}`}>{item.title}</div>
        <div className="text-[13px] text-plata">
          {[item.car, item.track, PLAN_SIM_LABEL[item.sim], item.minutes ? `${item.minutes} min` : null].filter(Boolean).join(' · ')}
        </div>
        {event && (
          <div className="data text-[12px] text-azul mt-1 inline-flex items-center gap-1.5">
            <Flag size={12} /> Prepara {event.series}
            {event.round ? ` · ${event.round}` : ''}
            {event.date ? ` (${shortDate(event.date)})` : ''}
          </div>
        )}
        {item.drill && <p className="mt-1.5 text-[14px] leading-relaxed">{item.drill}</p>}
        {item.kpi && (
          <p className="mt-1 text-[13px] text-niebla leading-snug">
            <span className="text-plata">Cómo sabés que salió:</span> {item.kpi}
          </p>
        )}
        {session && <p className="mt-1 data text-[12px] text-record">Hecha el {new Date(session.startedAt).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
      </div>
    </div>
  )
}

export function PlanTab({
  st,
  run,
  error,
  sessions,
  onGoalsSaved,
}: {
  st: PlanState
  run: (p: Promise<PlanState>) => Promise<void>
  error: string | null
  sessions: SessionSummary[]
  onGoalsSaved: () => void
}) {
  const [change, setChange] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = st.busy === 'plan'
  const plan = st.plan
  const thisWeek = weekStart(new Date())
  const events = new Map(st.calendar.map((e) => [e.id, e]))
  const upcoming = st.calendar.filter((e) => e.date && e.date >= thisWeek).length

  return (
    <div className="flex flex-col gap-5">
      <GoalsForm
        value={st.goals}
        onSave={async (g) => {
          await run(window.ftn.planSaveGoals(g))
          onGoalsSaved()
        }}
      />

      {!plan && (
        <Card className="flex items-center justify-between gap-6">
          <div>
            <Label icon={Sparkles}>Tu plan de entrenamiento</Label>
            <p className="text-plata mt-2 leading-relaxed max-w-[640px]">
              El coach mira todo lo que corriste, lo que te viene marcando en cada sesión, tu objetivo y {upcoming ? `las ${upcoming} carreras de tu calendario` : 'tu calendario (todavía vacío)'}, y te arma qué practicar cada semana.
            </p>
          </div>
          <Button variant="primary" disabled={busy || !!st.busy} onClick={() => void run(window.ftn.planGenerate(null))}>
            {busy ? 'Armando…' : 'Armar mi plan'}
          </Button>
        </Card>
      )}
      {busy && <p className="text-plata text-[14px]">{st.streaming || 'Mirando tu progreso y tu calendario…'}</p>}
      {(st.error || error) && !busy && <p className="text-alerta text-[14px]">{error ?? st.error}</p>}

      {plan && (
        <>
          <Card className="border-ultramar">
            <div className="flex items-start justify-between gap-4">
              <Label icon={Sparkles} color="var(--ftn-azul)">
                Tu plan
              </Label>
              <span className="data text-[12px] text-niebla">
                {new Date(plan.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · {plan.model}
              </span>
            </div>
            {plan.summary && <p className="mt-3 text-[16px] leading-relaxed">{plan.summary}</p>}
            {plan.milestones.length > 0 && (
              <div className="mt-4">
                <Label icon={Milestone}>Los pasos después</Label>
                <ol className="mt-2 flex flex-col gap-1.5 list-decimal pl-5 text-[14px] leading-relaxed text-plata">
                  {plan.milestones.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ol>
              </div>
            )}
          </Card>

          {plan.weeks.map((w) => {
            const week = sessionsOfWeek(w.start, sessions)
            const current = w.start === thisWeek
            const past = w.start < thisWeek
            return (
              <Card key={w.start} className={current ? 'border-ultramar' : past ? 'opacity-60' : ''}>
                <div className="flex items-center justify-between gap-4">
                  <Label icon={CalendarDays} color={current ? 'var(--ftn-azul)' : undefined}>
                    {current ? `Esta semana · ${weekLabel(w.start).toLowerCase()}` : weekLabel(w.start)}
                  </Label>
                </div>
                {w.focus && <p className="mt-2 text-[15px] leading-relaxed">{w.focus}</p>}
                <div className="mt-1 divide-y divide-grafito">
                  {w.items.map((i) => (
                    <Item key={i.id} item={i} week={week} event={i.eventId ? (events.get(i.eventId) ?? null) : null} onToggle={() => void run(window.ftn.planToggleDone(i.id))} />
                  ))}
                </div>
              </Card>
            )
          })}

          <Card className="flex flex-col gap-3">
            <Label>Ajustar el plan</Label>
            <textarea
              value={change}
              onChange={(e) => setChange(e.target.value)}
              rows={2}
              disabled={busy}
              placeholder="«Esta semana no puedo el jueves», «quiero más trabajo en lluvia», «sumá la carrera del domingo»"
              className={`${INPUT} py-2.5 leading-relaxed resize-y`}
            />
            <div className="flex justify-between gap-3">
              <div className="flex gap-3">
                <Button variant="ghost" disabled={busy} onClick={() => void run(window.ftn.planGenerate(null))}>
                  Rehacer desde cero
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  className={confirmDelete ? 'text-alerta hover:text-alerta' : ''}
                  onBlur={() => setConfirmDelete(false)}
                  onClick={() => {
                    if (!confirmDelete) return setConfirmDelete(true)
                    setConfirmDelete(false)
                    void run(window.ftn.planDelete())
                  }}
                >
                  {confirmDelete ? '¿Seguro? Tocá de nuevo para borrarlo' : 'Borrar el plan'}
                </Button>
              </div>
              <Button
                variant="primary"
                disabled={busy || !change.trim()}
                onClick={() => {
                  const c = change
                  setChange('')
                  void run(window.ftn.planGenerate(c))
                }}
              >
                {busy ? 'Ajustando…' : 'Pedir el cambio'}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
