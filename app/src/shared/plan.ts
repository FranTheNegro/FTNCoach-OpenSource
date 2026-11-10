/**
 * Calendario, objetivos y plan de entrenamiento del piloto. Todo vive en su PC
 * (`coach/plan.json`): cada piloto tiene sus carreras, sus torneos y su plan.
 */
import type { ChatMessage, SessionSummary } from './analysis'

export type PlanSim = 'iracing' | 'ac' | 'acc' | 'acr' | 'lmu' | 'otro'

export const PLAN_SIM_LABEL: Record<PlanSim, string> = {
  iracing: 'iRacing',
  ac: 'Assetto Corsa',
  acc: 'ACC',
  acr: 'AC Rally',
  lmu: 'Le Mans Ultimate',
  otro: 'Otro',
}

/** Una carrera o fecha de un campeonato del piloto. */
export interface RaceEvent {
  id: string
  /** YYYY-MM-DD. En las series semanales de iRacing, el primer día de la semana. null = sin fecha en el documento. */
  date: string | null
  /** Serie, liga o torneo. */
  series: string
  /** "Semana 3", "Fecha 2", "Final". */
  round: string
  sim: PlanSim
  car: string
  track: string
  /** Duración o formato ("40 min", "2 × 20 min", "6 h"). */
  format: string
  notes: string
  /** Si el piloto tiene el auto y la pista: true, false o null (no se sabe). */
  owned: boolean | null
  /** De dónde salió: el nombre del archivo o "manual". */
  source: string
}

export interface PlanGoals {
  /** Lo que quiere lograr, en sus palabras (es el "Objetivo actual" del perfil). */
  main: string
  /** YYYY-MM-DD o vacío. */
  deadline: string
  /** Horas por semana para practicar (0 = no dijo). */
  hoursPerWeek: number
  /** Qué días puede ("martes y jueves a la noche, sábado"). */
  availability: string
}

/** Una salida a pista del plan. */
export interface PlanItem {
  id: string
  title: string
  sim: PlanSim
  car: string
  track: string
  minutes: number
  /** Qué hacer en pista. */
  drill: string
  /** Cómo saber que salió. */
  kpi: string
  /** La carrera del calendario que prepara, si es una. */
  eventId: string | null
  /** El piloto la marcó como hecha a mano (las sesiones grabadas se cuentan solas). */
  done: boolean
}

export interface PlanWeek {
  /** YYYY-MM-DD, lunes. */
  start: string
  /** En qué se trabaja esa semana. */
  focus: string
  items: PlanItem[]
}

export interface TrainingPlan {
  createdAt: number
  model: string
  /** El plan en dos o tres frases: hacia dónde va y por qué. */
  summary: string
  /** Pasos hacia el objetivo más allá de estas semanas (licencia, series, compras). */
  milestones: string[]
  weeks: PlanWeek[]
}

/** La conversación para cargar un calendario desde un PDF o una imagen. */
export interface CalendarImport {
  files: { name: string; mime: string }[]
  chat: ChatMessage[]
  /** Lo último que propuso la IA, para revisar antes de guardarlo. */
  proposal: RaceEvent[] | null
}

export interface PlanState {
  goals: PlanGoals
  calendar: RaceEvent[]
  import: CalendarImport | null
  plan: TrainingPlan | null
  /** Charla libre con el coach sobre la carrera del piloto (fuera de una sesión). */
  assistant: ChatMessage[]
  busy: 'import' | 'plan' | 'assistant' | null
  streaming: string | null
  error: string | null
}

export const emptyGoals = (): PlanGoals => ({ main: '', deadline: '', hoursPerWeek: 0, availability: '' })

/** YYYY-MM-DD en hora local. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** El lunes de la semana de una fecha. */
export function weekStart(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return isoDay(x)
}

export const dayDate = (day: string) => new Date(day + 'T12:00:00')

// ── Coincidencias de nombres ──
// Cada fuente nombra distinto lo mismo ("Circuit de Spa-Francorchamps" y "Spa"),
// así que se compara por palabras significativas.

const FILLER = new Set([
  'circuit', 'circuito', 'raceway', 'speedway', 'international', 'internacional', 'motor', 'motorsport', 'motorsports', 'park', 'ring',
  'race', 'racing', 'course', 'track', 'autodromo', 'autódromo', 'grand', 'prix', 'full', 'gp', 'the', 'and', 'del', 'de', 'la', 'el',
  'cup', 'edition', 'evo', 'gt3', 'gt4', 'gte', 'car', 'series', 'serie',
])

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !FILLER.has(w))
}

/** Dos nombres hablan de lo mismo si comparten una palabra significativa. */
export function sameName(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false
  const wa = new Set(words(a))
  return words(b).some((w) => wa.has(w))
}

// ── Plan contra sesiones grabadas ──

const DAY_MS = 24 * 3600 * 1000

/** Sesiones de la semana que empieza el lunes `start`. */
export function sessionsOfWeek(start: string, sessions: SessionSummary[]): SessionSummary[] {
  const from = new Date(start + 'T00:00:00').getTime()
  return sessions.filter((s) => s.startedAt >= from && s.startedAt < from + 7 * DAY_MS)
}

/** La sesión hace lo que pide la salida (o prepara la carrera) si coinciden el auto y la pista que se nombran. */
export function matches(target: { car: string; track: string }, s: SessionSummary): boolean {
  if (!target.car.trim() && !target.track.trim()) return false
  return (!target.car.trim() || sameName(target.car, s.car)) && (!target.track.trim() || sameName(target.track, s.track))
}

/** La sesión grabada que cumple esta salida del plan, si la hubo esa semana. */
export function sessionFor(item: PlanItem, week: SessionSummary[]): SessionSummary | null {
  return week.find((s) => matches(item, s)) ?? null
}

export const itemDone = (item: PlanItem, week: SessionSummary[]) => item.done || !!sessionFor(item, week)
