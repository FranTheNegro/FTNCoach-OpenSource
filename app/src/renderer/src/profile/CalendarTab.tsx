/**
 * Calendario del piloto: sus carreras y torneos. Se carga adjuntando el PDF de la
 * temporada o la foto del torneo; el coach lo lee, pregunta qué quiere correr y
 * propone la tabla, que el piloto revisa antes de guardar. También a mano.
 */
import { useEffect, useRef, useState } from 'react'
import { CalendarDays, FileText, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { PLAN_SIM_LABEL, isoDay, type PlanSim, type PlanState, type RaceEvent } from '@shared/plan'
import { Button, Card, Label } from '../components/ui'
import { GoLink } from '../nav'
import { INPUT, daysUntil, shortDate } from './plan-data'

const OWNED: { value: boolean | null; label: string; cls: string }[] = [
  { value: true, label: 'La tengo', cls: 'text-record border-record/40' },
  { value: false, label: 'Me falta', cls: 'text-alerta border-alerta/40' },
  { value: null, label: '¿La tenés?', cls: 'text-niebla border-acero' },
]

/** Auto y pista: si los tiene, si le faltan o si no se sabe. Se cambia con un clic. */
function OwnedBadge({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  const cur = OWNED.find((o) => o.value === value)!
  const next = OWNED[(OWNED.indexOf(cur) + 1) % OWNED.length].value
  return (
    <button
      title="El auto y la pista: tocá para cambiar"
      onClick={() => onChange(next)}
      className={`data text-[11px] tracking-[0.08em] uppercase border rounded-control px-2 h-7 whitespace-nowrap ${cur.cls}`}
    >
      {cur.label}
    </button>
  )
}

const blank = (): RaceEvent => ({
  id: '',
  date: isoDay(new Date()),
  series: '',
  round: '',
  sim: 'iracing',
  car: '',
  track: '',
  format: '',
  notes: '',
  owned: null,
  source: 'manual',
})

function EventForm({ value, onSave, onCancel }: { value: RaceEvent; onSave: (e: RaceEvent) => void; onCancel: () => void }) {
  const [e, setE] = useState(value)
  const set = <K extends keyof RaceEvent>(k: K, v: RaceEvent[K]) => setE((x) => ({ ...x, [k]: v }))
  const field = (k: 'series' | 'round' | 'car' | 'track' | 'format' | 'notes', label: string, placeholder: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">{label}</span>
      <input value={e[k]} onChange={(x) => set(k, x.target.value)} placeholder={placeholder} className={`${INPUT} h-10`} />
    </label>
  )
  return (
    <Card className="flex flex-col gap-3">
      <div className="grid grid-cols-[160px_1fr_160px_180px] gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Fecha</span>
          <input type="date" value={e.date ?? ''} onChange={(x) => set('date', x.target.value || null)} className={`${INPUT} h-10 data`} />
        </label>
        {field('series', 'Serie o torneo', 'GT3 Fixed, Liga AC Argentina…')}
        {field('round', 'Fecha / semana', 'Semana 3')}
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Simulador</span>
          <select value={e.sim} onChange={(x) => set('sim', x.target.value as PlanSim)} className={`${INPUT} h-10`}>
            {Object.entries(PLAN_SIM_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-[1fr_1fr_180px] gap-3">
        {field('car', 'Auto', 'Ferrari 296 GT3')}
        {field('track', 'Pista', 'Spa-Francorchamps')}
        {field('format', 'Formato', '40 min, 2 × 20 min…')}
      </div>
      {field('notes', 'Notas', 'Setup fijo, horario, lo que quieras recordar')}
      <div className="flex gap-3 justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" disabled={!e.series.trim() && !e.track.trim()} onClick={() => onSave(e)}>
          Guardar
        </Button>
      </div>
    </Card>
  )
}

function EventRow({ e, onChange, onEdit, onRemove }: { e: RaceEvent; onChange: (e: RaceEvent) => void; onEdit?: () => void; onRemove: () => void }) {
  const left = e.date ? daysUntil(e.date) : null
  const past = left !== null && left < -6
  return (
    <div className={`px-4 py-3 grid grid-cols-[120px_minmax(0,1fr)_auto_auto] gap-4 items-center ${past ? 'opacity-50' : ''}`}>
      <div className="data text-[13px]">
        <div>{e.date ? shortDate(e.date) : 'Sin fecha'}</div>
        {left !== null && left >= 0 && left <= 14 && <div className="text-azul text-[12px]">{left === 0 ? 'hoy' : `en ${left} ${left === 1 ? 'día' : 'días'}`}</div>}
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold truncate">
          {e.series || 'Carrera'}
          {e.round && <span className="text-plata font-normal"> · {e.round}</span>}
        </div>
        <div className="text-[13px] text-plata truncate">
          {[e.car, e.track, e.format, PLAN_SIM_LABEL[e.sim]].filter(Boolean).join(' · ')}
        </div>
        {e.notes && <div className="text-[12px] text-niebla truncate">{e.notes}</div>}
      </div>
      <OwnedBadge value={e.owned} onChange={(owned) => onChange({ ...e, owned })} />
      <div className="flex gap-1">
        {onEdit && (
          <button aria-label="Editar" title="Editar" onClick={onEdit} className="w-8 h-8 grid place-items-center text-niebla hover:text-blanco">
            <Pencil size={15} />
          </button>
        )}
        <button aria-label="Quitar" title="Quitar" onClick={onRemove} className="w-8 h-8 grid place-items-center text-niebla hover:text-alerta">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

/** La conversación con el coach sobre el archivo, y la tabla que propone. */
function ImportPanel({ st, run }: { st: PlanState; run: (p: Promise<PlanState>) => Promise<void> }) {
  const imp = st.import!
  const [text, setText] = useState('')
  const [rows, setRows] = useState<RaceEvent[]>(imp.proposal ?? [])
  useEffect(() => setRows(imp.proposal ?? []), [imp.proposal])
  const end = useRef<HTMLDivElement>(null)
  const busy = st.busy === 'import'
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [imp.chat.length, st.streaming])

  return (
    <Card className="border-ultramar flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Label icon={FileText} color="var(--ftn-azul)">
          {imp.files.map((f) => f.name).join(' · ')}
        </Label>
        <Button variant="ghost" onClick={() => void run(window.ftn.planImportCancel())}>
          <X size={16} /> Cancelar
        </Button>
      </div>
      <div className="max-h-[420px] overflow-y-auto flex flex-col gap-3">
        {imp.chat.map((m, i) => (
          <div
            key={i}
            className={`text-[14px] leading-relaxed whitespace-pre-wrap rounded-control px-3.5 py-2.5 ${m.role === 'user' ? 'bg-ultramar self-end max-w-[80%]' : 'bg-carbono self-start max-w-[90%]'}`}
          >
            {m.text}
          </div>
        ))}
        {busy && <div className="text-[14px] leading-relaxed whitespace-pre-wrap rounded-control px-3.5 py-2.5 bg-carbono self-start text-plata max-w-[90%]">{st.streaming || 'Leyendo el calendario…'}</div>}
        <div ref={end} />
      </div>
      {st.error && !busy && <p className="text-alerta text-[14px]">{st.error}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text
          setText('')
          void run(window.ftn.planImportAsk(t))
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder="Contale qué querés correr: «GT3 Fixed y el IMSA, las semanas 2 a 8»"
          className={`${INPUT} h-11 flex-1 min-w-0`}
        />
        <Button variant="primary" type="submit" disabled={busy || !text.trim()}>
          Enviar
        </Button>
      </form>

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-[16px] font-bold">Revisá antes de guardar</h3>
            <p className="text-[13px] text-niebla">Quitá lo que no vas a correr y marcá si tenés el auto y la pista. Después lo podés editar.</p>
          </div>
          <div className="bg-carbono border border-grafito rounded-card divide-y divide-grafito">
            {rows.map((e) => (
              <EventRow key={e.id} e={e} onChange={(x) => setRows((r) => r.map((y) => (y.id === x.id ? x : y)))} onRemove={() => setRows((r) => r.filter((y) => y.id !== e.id))} />
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" disabled={busy} onClick={() => void run(window.ftn.planImportAccept(rows))}>
              Guardar {rows.length} {rows.length === 1 ? 'carrera' : 'carreras'} en mi calendario
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export function CalendarTab({ st, run, error }: { st: PlanState; run: (p: Promise<PlanState>) => Promise<void>; error: string | null }) {
  const [editing, setEditing] = useState<RaceEvent | null>(null)
  const [showPast, setShowPast] = useState(false)
  const save = (events: RaceEvent[]) => void run(window.ftn.planSaveCalendar(events))
  const past = st.calendar.filter((e) => e.date && daysUntil(e.date) < -6)
  const list = showPast ? st.calendar : st.calendar.filter((e) => !past.includes(e))
  const months = new Map<string, RaceEvent[]>()
  for (const e of list) {
    const key = e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : 'Sin fecha'
    months.set(key, [...(months.get(key) ?? []), e])
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <p className="text-plata leading-relaxed max-w-[640px]">
          Tus carreras y torneos. Adjuntá el PDF de la temporada de iRacing o la foto del torneo: el coach lo lee, te pregunta qué querés correr y te arma la tabla.
        </p>
        <div className="flex gap-3">
          <Button onClick={() => setEditing(blank())} disabled={!!editing}>
            <Plus size={16} /> Agregar a mano
          </Button>
          <Button variant="primary" disabled={!!st.import || !!st.busy} onClick={() => void run(window.ftn.planImport())}>
            <Upload size={16} /> Cargar PDF o foto
          </Button>
        </div>
      </div>
      {error && <p className="text-alerta text-[14px]">{error}</p>}

      {st.import && <ImportPanel st={st} run={run} />}

      {editing && (
        <EventForm
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={(e) => {
            save(e.id ? st.calendar.map((x) => (x.id === e.id ? e : x)) : [...st.calendar, e])
            setEditing(null)
          }}
        />
      )}

      {st.calendar.length === 0 && !st.import && !editing && (
        <Card>
          <Label icon={CalendarDays}>Todavía no hay carreras</Label>
          <p className="text-plata mt-2 leading-relaxed">
            Funciona con cualquier documento que tenga fechas: el PDF de la temporada, la captura de una liga o la foto del afiche de un torneo. Para leer archivos hace falta un modelo que los acepte: Gemini, Claude o tu Claude Code (
            <GoLink to="settings" section="coach">
              Ajustes → Coach
            </GoLink>
            ).
          </p>
        </Card>
      )}

      {[...months.entries()].map(([month, events]) => (
        <section key={month}>
          <h2 className="text-[15px] font-bold mb-2 first-letter:uppercase">{month}</h2>
          <div className="bg-carbono-2 border border-grafito rounded-card divide-y divide-grafito">
            {events.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                onChange={(x) => save(st.calendar.map((y) => (y.id === x.id ? x : y)))}
                onEdit={() => setEditing(e)}
                onRemove={() => save(st.calendar.filter((y) => y.id !== e.id))}
              />
            ))}
          </div>
        </section>
      ))}
      {past.length > 0 && (
        <button className="self-start text-[13px] text-niebla hover:text-blanco" onClick={() => setShowPast((v) => !v)}>
          {showPast ? 'Ocultar las carreras pasadas' : `Mostrar ${past.length} ${past.length === 1 ? 'carrera pasada' : 'carreras pasadas'}`}
        </button>
      )}
    </div>
  )
}
