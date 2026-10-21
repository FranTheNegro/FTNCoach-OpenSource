import { useMemo } from 'react'
import type { SessionSummary } from '@shared/analysis'
import * as fmt from '@ui/format'
import { Button, Card, Label, PageHeader } from '../components/ui'
import { useLibrary } from '../hooks'
import { SessionDetailView } from '../sessions/SessionDetail'
import { groupEvents, sessionLabel, sessionNames, type SessionEvent } from '@shared/events'

const SIM = { iracing: 'iRacing', ac: 'Assetto Corsa' } as const

function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function hour(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function SessionRow({ s, name, onOpen, nested }: { s: SessionSummary; name: string; onOpen: () => void; nested?: boolean }) {
  return (
    <button
      onClick={onOpen}
      className={`w-full text-left grid grid-cols-[64px_minmax(0,1fr)_140px_120px_110px] items-center gap-4 px-5 border-b border-grafito last:border-0 hover:bg-grafito transition-colors ${
        nested ? 'h-[52px]' : 'h-[68px]'
      }`}
    >
      <span className="data text-[13px] text-plata">{hour(s.startedAt)}</span>
      <span className="min-w-0">
        {nested ? (
          <span className="block font-semibold truncate">{name}</span>
        ) : (
          <>
            <span className="block font-semibold truncate">{s.track}</span>
            <span className="block text-[13px] text-niebla truncate">
              {s.car} · {name}
            </span>
          </>
        )}
      </span>
      <span className="data text-[12px] text-niebla uppercase tracking-[0.08em]">
        {!nested && SIM[s.sim]}
      </span>
      <span className="data text-[13px] text-plata">
        {s.validLaps}/{s.laps} válidas
      </span>
      <span className={`data text-[16px] text-right ${s.bestLapS ? 'text-mejor' : 'text-niebla'}`}>{fmt.lapTime(s.bestLapS)}</span>
    </button>
  )
}

/** Un evento con varias sesiones: cabecera con pista y auto, y una fila por sesión. */
function EventBlock({ ev, onOpen }: { ev: SessionEvent; onOpen: (s: SessionSummary) => void }) {
  const names = sessionNames(ev)
  const first = ev.sessions[0]
  if (ev.sessions.length === 1) return <SessionRow s={first} name={names.get(first.id)!} onOpen={() => onOpen(first)} />
  return (
    <div className="border-b border-grafito last:border-0">
      <div className="grid grid-cols-[64px_minmax(0,1fr)_140px_120px_110px] items-center gap-4 px-5 h-[64px]">
        <span className="data text-[13px] text-plata">{hour(ev.startedAt)}</span>
        <span className="min-w-0">
          <span className="block font-semibold truncate">{first.track}</span>
          <span className="block text-[13px] text-niebla truncate">
            {first.car} · {ev.sessions.map((s) => names.get(s.id)).join(' · ')}
          </span>
        </span>
        <span className="data text-[12px] text-niebla uppercase tracking-[0.08em]">{SIM[first.sim]}</span>
        <span className="data text-[12px] text-niebla uppercase tracking-[0.08em]">Evento</span>
        <span className={`data text-[16px] text-right ${ev.bestLapS ? 'text-mejor' : 'text-niebla'}`}>{fmt.lapTime(ev.bestLapS)}</span>
      </div>
      <div className="ml-5 border-l-2 border-ultramar">
        {ev.sessions.map((s) => (
          <SessionRow key={s.id} s={s} name={names.get(s.id)!} nested onOpen={() => onOpen(s)} />
        ))}
      </div>
    </div>
  )
}

export function SessionsPage({
  open,
  onOpen: setOpen,
  query,
  onQuery: setQuery,
}: {
  open: SessionSummary | null
  onOpen: (s: SessionSummary | null) => void
  query: string
  onQuery: (q: string) => void
}) {
  const lib = useLibrary()

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (lib?.sessions ?? []).filter((s) => !q || `${s.track} ${s.car} ${s.sessionType} ${sessionLabel(s.sessionType)}`.toLowerCase().includes(q))
  }, [lib, query])

  const events = useMemo(() => groupEvents(list), [list])

  const groups = useMemo(() => {
    const out: { day: string; items: SessionEvent[] }[] = []
    for (const ev of events) {
      const day = dayKey(ev.startedAt)
      if (out[out.length - 1]?.day === day) out[out.length - 1].items.push(ev)
      else out.push({ day, items: [ev] })
    }
    return out
  }, [events])

  if (open) {
    // Las sesiones en el orden de la lista (de la más nueva a la más vieja, en orden dentro del evento)
    const flat = events.flatMap((ev) => [...ev.sessions].reverse())
    const i = flat.findIndex((s) => s.id === open.id)
    const older = i >= 0 ? flat[i + 1] : undefined
    const newer = i > 0 ? flat[i - 1] : undefined
    const ev = events.find((e) => e.sessions.some((s) => s.id === open.id))
    const names = ev ? sessionNames(ev) : null
    return (
      <SessionDetailView
        summary={open}
        onBack={() => setOpen(null)}
        onPrev={older ? () => setOpen(older) : undefined}
        onNext={newer ? () => setOpen(newer) : undefined}
        event={ev && ev.sessions.length > 1 ? ev.sessions.map((s) => ({ s, name: names!.get(s.id)! })) : null}
        onOpen={setOpen}
      />
    )
  }

  const empty = lib && !lib.sessions.length
  return (
    <div className="max-w-[1100px]">
      <PageHeader title="Sesiones">
        <div className="flex items-center gap-3">
          {lib?.scanning && <span className="data text-[12px] text-niebla">Buscando sesiones…</span>}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pista o auto"
            className="h-11 w-60 px-3 rounded-control bg-carbono border border-acero text-blanco placeholder:text-niebla focus:border-azul outline-none"
          />
          <Button onClick={() => void window.ftn.rescan()}>Actualizar</Button>
        </div>
      </PageHeader>

      {lib?.error && <p className="text-error mb-4">{lib.error}</p>}

      {empty && (
        <Card>
          <Label>Todavía no hay sesiones</Label>
          <div className="text-plata mt-3 leading-relaxed space-y-2">
            <p>
              <b className="text-blanco">iRacing:</b> FTN Coach lee los archivos <span className="data">.ibt</span> que guarda iRacing. Activá la
              telemetría en el auto con <span className="data">Alt+L</span> (o “Telemetry recording” en las opciones) y aparecen acá al salir de pista.
            </p>
            <p>
              <b className="text-blanco">Assetto Corsa:</b> no guarda telemetría, así que FTN Coach graba cada sesión mientras corrés. No hay que hacer
              nada.
            </p>
          </div>
        </Card>
      )}

      {!empty && query.trim() && !list.length && (
        <p className="text-plata">
          Ninguna sesión coincide con «{query.trim()}».{' '}
          <button className="text-azul font-semibold hover:underline" onClick={() => setQuery('')}>
            Ver todas
          </button>
        </p>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.day}>
            <div className="data text-[12px] tracking-[0.12em] uppercase text-niebla mb-2">{g.day}</div>
            <div className="bg-carbono-2 border border-grafito rounded-card overflow-hidden">
              {g.items.map((ev) => (
                <EventBlock key={ev.key} ev={ev} onOpen={setOpen} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
