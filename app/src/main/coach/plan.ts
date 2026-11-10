/**
 * Calendario y plan de entrenamiento del piloto. El calendario se carga
 * conversando: el piloto adjunta el PDF de la temporada o la foto de un torneo,
 * el coach lo lee y le pregunta qué quiere correr. Con eso, sus objetivos y su
 * progreso real, el coach arma el plan semana a semana.
 *
 * Todo queda en `coach/plan.json` de esta PC: es del piloto, no se comparte.
 */
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ChatMessage, CoachProvider, SessionSummary } from '@shared/analysis'
import type { CoachStyle } from '@shared/coach-quiz'
import { emptyGoals, isoDay, itemDone, sameName, sessionsOfWeek, weekStart, type CalendarImport, type PlanGoals, type PlanState, type RaceEvent, type TrainingPlan } from '@shared/plan'
import type { Attachment } from './claude'
import { streamLlm, stripThinking } from './llm'
import { CALENDAR_START, assistantSystem, calendarSystem, parseCalendarReply, parsePlan, planRequest, planSystem } from './plan-prompt'

const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
export const PLAN_FILE_EXTENSIONS = Object.keys(MIME).map((e) => e.slice(1))
/** Gemini acepta hasta 20 MB por pedido; el resto, parecido. */
const MAX_BYTES = 18 * 1024 * 1024
const MAX_IMPORT_TURNS = 12
const MAX_ASSISTANT_TURNS = 20
const DAY_MS = 24 * 3600 * 1000

interface Saved {
  goals: PlanGoals
  calendar: RaceEvent[]
  import: (CalendarImport & { stored: string[] }) | null
  plan: TrainingPlan | null
  assistant: ChatMessage[]
}

/** Lo que el plan necesita saber del piloto; lo arma `index.ts` con lo que hay en la app. */
export interface PlanContext {
  profile: Record<string, unknown> | null
  driverStyle: Record<string, unknown> | null
  licences: unknown[] | null
  /** Autos y pistas que manejó, con sus mejores vueltas. */
  progress: Record<string, unknown>[]
  recentCoaching: Record<string, unknown>[]
  /** Nombres de autos y pistas que ya manejó (para adivinar qué contenido tiene). */
  driven: { cars: string[]; tracks: string[] }
}

export interface PlanDeps {
  connection: () => { provider: CoachProvider; model: string; apiKey: string; label: string }
  style: () => CoachStyle
  context: () => PlanContext
  /** Las sesiones grabadas: con ellas se sabe qué salidas del plan ya hizo. */
  sessions: () => SessionSummary[]
  /** El objetivo vive en el perfil: lo comparten el coach de sesiones y el plan. */
  goalText: { get(): string; set(v: string): void }
}

function atomicWrite(file: string, data: string): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

const today = () => isoDay(new Date())

export class PlanService extends EventEmitter<{ state: [PlanState] }> {
  private dir = join(app.getPath('userData'), 'coach')
  private file = join(this.dir, 'plan.json')
  private filesDir = join(this.dir, 'plan-files')
  private busy: PlanState['busy'] = null
  private streaming: string | null = null
  private error: string | null = null

  constructor(private deps: PlanDeps) {
    super()
  }

  private load(): Saved {
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>
      return { goals: { ...emptyGoals(), ...s.goals }, calendar: s.calendar ?? [], import: s.import ?? null, plan: s.plan ?? null, assistant: s.assistant ?? [] }
    } catch {
      return { goals: emptyGoals(), calendar: [], import: null, plan: null, assistant: [] }
    }
  }

  private save(s: Saved): void {
    mkdirSync(this.dir, { recursive: true })
    atomicWrite(this.file, JSON.stringify(s))
  }

  state(): PlanState {
    const s = this.load()
    const imp = s.import ? { files: s.import.files, chat: s.import.chat, proposal: s.import.proposal } : null
    return {
      goals: { ...s.goals, main: this.deps.goalText.get() },
      calendar: s.calendar,
      import: imp,
      plan: s.plan,
      assistant: s.assistant,
      busy: this.busy,
      streaming: this.streaming,
      error: this.error,
    }
  }

  private push(): void {
    this.emit('state', this.state())
  }

  private async run(kind: NonNullable<PlanState['busy']>, job: () => Promise<void>): Promise<PlanState> {
    if (this.busy) return this.state()
    this.busy = kind
    this.error = null
    this.streaming = ''
    this.push()
    try {
      await job()
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.busy = null
      this.streaming = null
      this.push()
    }
    return this.state()
  }

  // ── Objetivos y calendario ──

  saveGoals(goals: PlanGoals): PlanState {
    const s = this.load()
    this.deps.goalText.set(goals.main.trim())
    const hours = Math.min(60, Math.max(0, Math.round(goals.hoursPerWeek) || 0))
    this.save({ ...s, goals: { main: '', deadline: /^\d{4}-\d{2}-\d{2}$/.test(goals.deadline) ? goals.deadline : '', hoursPerWeek: hours, availability: goals.availability.trim() } })
    this.push()
    return this.state()
  }

  saveCalendar(events: RaceEvent[]): PlanState {
    const s = this.load()
    const calendar = events.map((e) => ({ ...e, id: e.id || randomUUID() })).sort(byDate)
    this.save({ ...s, calendar })
    this.push()
    return this.state()
  }

  // ── Cargar un calendario conversando ──

  /** Copia los archivos elegidos y arranca la conversación: el coach los lee y pregunta qué correr. */
  startImport(paths: string[]): Promise<PlanState> {
    if (!paths.length) return Promise.resolve(this.state())
    for (const p of paths) {
      if (!MIME[extname(p).toLowerCase()]) throw new Error(`No se puede leer ${basename(p)}: tiene que ser PDF, PNG, JPG o WEBP.`)
      if (statSync(p).size > MAX_BYTES) throw new Error(`${basename(p)} pesa más de 18 MB. Probá con un archivo más chico o solo las páginas que te interesan.`)
    }
    this.clearFiles()
    mkdirSync(this.filesDir, { recursive: true })
    const stored = paths.map((p, i) => {
      const dest = join(this.filesDir, `${i}${extname(p).toLowerCase()}`)
      copyFileSync(p, dest)
      return dest
    })
    const files = paths.map((p) => ({ name: basename(p), mime: MIME[extname(p).toLowerCase()] }))
    const s = this.load()
    this.save({ ...s, import: { files, stored, chat: [{ role: 'user', text: `Adjunté ${files.map((f) => f.name).join(', ')}`, at: Date.now() }], proposal: null } })
    return this.converse()
  }

  askImport(text: string): Promise<PlanState> {
    const q = text.trim()
    const s = this.load()
    if (!q || !s.import) return Promise.resolve(this.state())
    this.save({ ...s, import: { ...s.import, chat: [...s.import.chat, { role: 'user', text: q, at: Date.now() }] } })
    return this.converse()
  }

  private converse(): Promise<PlanState> {
    return this.run('import', async () => {
      const s = this.load()
      const imp = s.import!
      if (imp.chat.length > MAX_IMPORT_TURNS * 2) throw new Error('La conversación ya es muy larga. Guardá lo que tengas o empezá de nuevo con el archivo.')
      const llm = this.deps.connection()
      const ctx = this.deps.context()
      const attachments: Attachment[] = imp.stored.map((path, i) => {
        if (!existsSync(path)) throw new Error('No se encuentra el archivo adjunto. Volvé a cargarlo.')
        return { name: imp.files[i].name, mime: imp.files[i].mime, data: readFileSync(path).toString('base64') }
      })
      const context = {
        profile: ctx.profile,
        goal: this.deps.goalText.get() || null,
        ...(ctx.licences?.length ? { licences: ctx.licences } : {}),
        driven: ctx.driven,
        existing_calendar: s.calendar.map((e) => `${e.date ?? 'sin fecha'} · ${e.series} ${e.round} · ${e.track}`),
      }
      const messages = imp.chat.map((m, i) => ({ role: m.role, content: i === 0 ? CALENDAR_START : m.text }))
      let acc = ''
      const answer = await streamLlm({
        ...llm,
        conversation: 'calendar',
        system: calendarSystem(this.deps.style(), context, today()),
        messages,
        attachments,
        maxTokens: 8000,
        onText: (t) => {
          acc += t
          // El bloque del calendario no se muestra mientras llega
          this.streaming = stripThinking(acc).split('```')[0].trim() || 'Leyendo el calendario…'
          this.push()
        },
      })
      const { message, events } = parseCalendarReply(stripThinking(answer))
      const source = imp.files.map((f) => f.name).join(', ')
      const proposal = events
        ? events.map((e): RaceEvent => ({ ...e, id: randomUUID(), owned: guessOwned(e.car, e.track, ctx.driven), source }))
        : imp.proposal
      const chat: ChatMessage[] = [...imp.chat, { role: 'assistant', text: message || 'Listo, revisá la tabla.', at: Date.now() }]
      const now = this.load()
      if (now.import) this.save({ ...now, import: { ...now.import, chat, proposal } })
    })
  }

  /** Guarda en el calendario lo que el piloto revisó y cierra la conversación. */
  acceptImport(events: RaceEvent[]): PlanState {
    const s = this.load()
    const calendar = [...s.calendar, ...events.map((e) => ({ ...e, id: e.id || randomUUID() }))].sort(byDate)
    this.clearFiles()
    this.save({ ...s, calendar, import: null })
    this.push()
    return this.state()
  }

  cancelImport(): PlanState {
    this.clearFiles()
    this.save({ ...this.load(), import: null })
    this.error = null
    this.push()
    return this.state()
  }

  private clearFiles(): void {
    rmSync(this.filesDir, { recursive: true, force: true })
  }

  // ── Plan de entrenamiento ──

  /** Arma el plan (o lo ajusta con lo que pidió el piloto). */
  generate(changeRequest: string | null): Promise<PlanState> {
    return this.run('plan', async () => {
      const s = this.load()
      const llm = this.deps.connection()
      const ctx = this.deps.context()
      const now = new Date()
      const upcoming = s.calendar.filter((e) => !e.date || e.date >= weekStart(now))
      const weeks = horizon(now, s.goals.deadline, upcoming)
      const change = changeRequest?.trim()
      const { plan: current, ...career } = this.career(s, ctx)
      const data = {
        ...career,
        week_starts: Array.from({ length: weeks }, (_, i) => weekStart(new Date(now.getTime() + i * 7 * DAY_MS))),
        // Rehacer desde cero no mira el plan anterior; un pedido de cambio, sí
        ...(current && change ? { previous_plan: current } : {}),
        ...(change ? { change_request: change } : {}),
      }
      let shown = 0
      const text = await streamLlm({
        ...llm,
        conversation: 'plan',
        system: planSystem(this.deps.style(), weeks),
        messages: [{ role: 'user', content: planRequest(data) }],
        maxTokens: 12000,
        json: true,
        onText: (t) => {
          shown += t.length
          if (shown > 400) {
            shown = 0
            this.streaming = 'Armando las semanas…'
            this.push()
          }
        },
      })
      const parsed = parsePlan(stripThinking(text), new Set(s.calendar.map((e) => e.id)), randomUUID)
      this.save({ ...this.load(), plan: { ...parsed, createdAt: Date.now(), model: llm.label } })
    })
  }

  /** Todo lo que el coach sabe de la carrera del piloto, para el plan y para la charla. */
  private career(s: Saved, ctx: PlanContext): Record<string, unknown> {
    const now = new Date()
    const from = weekStart(now)
    const week = sessionsOfWeek(from, this.deps.sessions())
    return {
      today: `${today()} (${now.toLocaleDateString('es-AR', { weekday: 'long' })})`,
      goals: {
        main: this.deps.goalText.get() || null,
        deadline: s.goals.deadline || null,
        hours_per_week: s.goals.hoursPerWeek,
        availability: s.goals.availability || null,
      },
      calendar: s.calendar
        .filter((e) => !e.date || e.date >= from)
        .map((e) => ({ id: e.id, date: e.date, series: e.series, round: e.round, sim: e.sim, car: e.car, track: e.track, format: e.format, owned: e.owned, notes: e.notes || undefined })),
      ...(s.plan ? { plan: this.planForModel(s.plan) } : {}),
      this_week: { sessions: week.length, time_on_track_h: Math.round(week.reduce((a, x) => a + x.durationS, 0) / 360) / 10 },
      profile: ctx.profile,
      ...(ctx.licences?.length ? { licences: ctx.licences } : {}),
      ...(ctx.driverStyle ? { driver_style: ctx.driverStyle } : {}),
      progress: ctx.progress,
      recent_coaching: ctx.recentCoaching,
    }
  }

  /** El plan como lo lee el modelo, con cada salida marcada como hecha si lo está (a mano o por una sesión grabada). */
  private planForModel(p: TrainingPlan): Record<string, unknown> {
    const sessions = this.deps.sessions()
    return {
      summary: p.summary,
      milestones: p.milestones,
      weeks: p.weeks.map((w) => {
        const week = sessionsOfWeek(w.start, sessions)
        return { start: w.start, focus: w.focus, items: w.items.map(({ id: _id, ...i }) => ({ ...i, done: itemDone({ ...i, id: _id }, week) })) }
      }),
    }
  }

  // ── Charla con el coach ──

  askAssistant(text: string): Promise<PlanState> {
    const q = text.trim()
    if (!q) return Promise.resolve(this.state())
    return this.run('assistant', async () => {
      const s = this.load()
      const chat: ChatMessage[] = [...s.assistant, { role: 'user', text: q, at: Date.now() }]
      this.save({ ...s, assistant: chat })
      this.push()
      const llm = this.deps.connection()
      const history = chat.slice(-MAX_ASSISTANT_TURNS * 2)
      while (history[0]?.role === 'assistant') history.shift()
      let acc = ''
      const answer = await streamLlm({
        ...llm,
        conversation: 'assistant',
        system: assistantSystem(this.deps.style(), this.career(s, this.deps.context())),
        messages: history.map((m) => ({ role: m.role, content: m.text })),
        maxTokens: 2000,
        onText: (t) => {
          acc += t
          this.streaming = stripThinking(acc)
          this.push()
        },
      })
      this.save({ ...this.load(), assistant: [...chat, { role: 'assistant', text: stripThinking(answer).trim(), at: Date.now() }] })
    })
  }

  clearAssistant(): PlanState {
    this.save({ ...this.load(), assistant: [] })
    this.push()
    return this.state()
  }

  toggleDone(itemId: string): PlanState {
    const s = this.load()
    if (!s.plan) return this.state()
    const weeks = s.plan.weeks.map((w) => ({ ...w, items: w.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)) }))
    this.save({ ...s, plan: { ...s.plan, weeks } })
    this.push()
    return this.state()
  }

  deletePlan(): PlanState {
    this.save({ ...this.load(), plan: null })
    this.push()
    return this.state()
  }

  /** Lo que ve el coach de sesiones: las próximas carreras y el plan de esta semana. */
  coachContext(): Record<string, unknown> | null {
    const s = this.load()
    const now = new Date()
    const from = weekStart(now)
    const next = s.calendar.filter((e) => e.date && e.date >= from).slice(0, 3)
    const week = s.plan?.weeks.find((w) => w.start === from)
    if (!next.length && !week) return null
    return {
      ...(next.length ? { next_races: next.map((e) => ({ date: e.date, series: e.series, round: e.round, car: e.car, track: e.track, format: e.format })) } : {}),
      ...(week ? { this_week: { focus: week.focus, outings: week.items.map((i) => ({ title: i.title, car: i.car, track: i.track, drill: i.drill, kpi: i.kpi })) } } : {}),
    }
  }
}

const byDate = (a: RaceEvent, b: RaceEvent) => (a.date ?? '9999').localeCompare(b.date ?? '9999')

/** Con auto y pista conocidos, seguro los tiene; si no, no se sabe (puede haberlos comprado sin usarlos). */
function guessOwned(car: string, track: string, driven: PlanContext['driven']): boolean | null {
  const hasCar = !car || driven.cars.some((c) => sameName(c, car))
  const hasTrack = !track || driven.tracks.some((t) => sameName(t, track))
  return hasCar && hasTrack && (car || track) ? true : null
}

/** Semanas a planear: hasta el objetivo o la última carrera cargada, entre 2 y 8 (4 si no hay nada). */
function horizon(now: Date, deadline: string, upcoming: RaceEvent[]): number {
  const last = [deadline, ...upcoming.map((e) => e.date ?? '')].filter(Boolean).sort().pop()
  if (!last) return 4
  const weeks = Math.ceil((new Date(last + 'T12:00:00').getTime() - new Date(weekStart(now) + 'T00:00:00').getTime()) / (7 * DAY_MS))
  return Math.min(8, Math.max(2, weeks))
}
