/**
 * Eventos: las sesiones de una misma inscripción (práctica, qualy, warmup y
 * carrera) van juntas. iRacing lo dice con el SubSessionID; sin ese dato (AC,
 * sesiones offline) se juntan las del mismo auto y pista que van una detrás de
 * la otra.
 */
import type { SessionSummary } from './analysis'
import { sameCombo } from './history'

/** Más que esto entre el final de una sesión y el inicio de la siguiente: otro evento. */
const GAP_MS = 20 * 60 * 1000

/** "Lone Qualify" → "Qualy". Si el archivo pasó por varias sesiones, todas. */
export function sessionLabel(type: string): string {
  return type
    .split(' + ')
    .map((t) => {
      if (/warm/i.test(t)) return 'Warmup'
      if (/qual/i.test(t)) return 'Qualy'
      if (/pr[aá]ctic/i.test(t)) return 'Práctica'
      if (/race|carrera/i.test(t)) return 'Carrera'
      if (/test/i.test(t)) return 'Test'
      if (/hot ?lap|time ?attack/i.test(t)) return 'Hotlap'
      return t
    })
    .join(' + ')
}

/** Orden dentro del evento: práctica, qualy, warmup, carrera. */
function phase(type: string): number {
  const t = sessionLabel(type.split(' + ')[0])
  return ({ Test: 0, Práctica: 1, Hotlap: 1, Qualy: 2, Warmup: 3, Carrera: 4 } as Record<string, number>)[t] ?? 1
}

export interface SessionEvent {
  key: string
  /** En orden: práctica, qualy, warmup, carrera (y por hora dentro de cada una). */
  sessions: SessionSummary[]
  startedAt: number
  endedAt: number
  bestLapS: number | null
}

/** Agrupa las sesiones (cualquier orden) en eventos, del más nuevo al más viejo. */
export function groupEvents(sessions: SessionSummary[]): SessionEvent[] {
  const byTime = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
  const events: SessionEvent[] = []
  const byId = new Map<string, SessionEvent>()
  let loose: SessionEvent | null = null
  for (const s of byTime) {
    const end = s.startedAt + s.durationS * 1000
    let ev = s.eventId ? byId.get(s.eventId) : undefined
    if (!ev && !s.eventId && loose) {
      const last = loose.sessions[loose.sessions.length - 1]
      if (!last.eventId && sameCombo(last, s) && s.startedAt - loose.endedAt < GAP_MS) ev = loose
    }
    if (!ev) {
      ev = { key: s.eventId ?? s.id, sessions: [], startedAt: s.startedAt, endedAt: end, bestLapS: null }
      events.push(ev)
      if (s.eventId) byId.set(s.eventId, ev)
    }
    ev.sessions.push(s)
    ev.endedAt = Math.max(ev.endedAt, end)
    if (s.bestLapS !== null && (ev.bestLapS === null || s.bestLapS < ev.bestLapS)) ev.bestLapS = s.bestLapS
    if (!s.eventId) loose = ev
  }
  for (const ev of events) ev.sessions.sort((a, b) => phase(a.sessionType) - phase(b.sessionType) || a.startedAt - b.startedAt)
  return events.sort((a, b) => b.startedAt - a.startedAt)
}

/** Nombre corto de cada sesión del evento: "Práctica 1", "Práctica 2", "Qualy", "Carrera". */
export function sessionNames(ev: SessionEvent): Map<string, string> {
  const count = new Map<string, number>()
  for (const s of ev.sessions) count.set(sessionLabel(s.sessionType), (count.get(sessionLabel(s.sessionType)) ?? 0) + 1)
  const seen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const s of ev.sessions) {
    const label = sessionLabel(s.sessionType)
    const k = (seen.get(label) ?? 0) + 1
    seen.set(label, k)
    out.set(s.id, count.get(label)! > 1 ? `${label} ${k}` : label)
  }
  return out
}
