/**
 * Tu estilo de manejo: cada sesión que abrís deja sus métricas y el perfil
 * muestra el promedio de las últimas. No inventa análisis: resume lo que el
 * análisis de cada sesión ya midió.
 */
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DriverStyle, DriverTrait, SessionSummary, StyleSample } from '@shared/analysis'

/** Ventana del promedio: lo que manejás hoy, no hace un año. */
const KEEP = 20
const MIN_SESSIONS = 5

interface Data {
  version: 1
  sessions: Record<string, { startedAt: number; sample: StyleSample }>
}

const pct = (v: number) => `${Math.round(v * 100)} %`

function trait(id: DriverTrait['id'], v: number | null): DriverTrait | null {
  if (v === null) return null
  switch (id) {
    case 'braking':
      return v >= 0.75
        ? { id, title: 'Frenada', value: pct(v), text: 'Agresiva y tardía: pisás fuerte de entrada.', good: true }
        : v < 0.5
          ? { id, title: 'Frenada', value: pct(v), text: 'Conservadora: hay margen para frenar más tarde y más fuerte.', good: false }
          : { id, title: 'Frenada', value: pct(v), text: 'Moderada.', good: null }
    case 'trail':
      return v >= 0.3
        ? { id, title: 'Trail-braking', value: pct(v), text: 'Buen uso: seguís frenando mientras girás hacia el apex.', good: true }
        : { id, title: 'Trail-braking', value: pct(v), text: 'Poco: soltás el freno antes de girar y el auto no rota.', good: false }
    case 'throttle':
      return v >= 0.8
        ? { id, title: 'Acelerador', value: pct(v), text: 'Suave y progresivo a la salida.', good: true }
        : { id, title: 'Acelerador', value: pct(v), text: 'Brusco: levantás en la salida. Trabajá la progresividad.', good: false }
    case 'consistency':
      return v >= 0.8
        ? { id, title: 'Consistencia', value: pct(v), text: 'Muy consistente vuelta a vuelta.', good: true }
        : v < 0.5
          ? { id, title: 'Consistencia', value: pct(v), text: 'Irregular: los tiempos varían mucho entre vueltas.', good: false }
          : { id, title: 'Consistencia', value: pct(v), text: 'Moderada.', good: null }
    case 'grip':
      return v >= 65
        ? { id, title: 'Uso del grip', value: `${Math.round(v)} %`, text: 'Buen aprovechamiento del límite en curva.', good: true }
        : { id, title: 'Uso del grip', value: `${Math.round(v)} %`, text: 'Queda grip sin usar en varias curvas.', good: false }
  }
}

export class StyleStore {
  private file = join(app.getPath('userData'), 'style.json')
  private d: Data = { version: 1, sessions: {} }

  constructor() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Data
      if (raw.version === 1) this.d = raw
    } catch {
      // Todavía sin sesiones analizadas
    }
  }

  record(s: SessionSummary, sample: StyleSample | null): void {
    if (!sample || sample.laps < 2) return
    const prev = this.d.sessions[s.id]
    if (prev && JSON.stringify(prev.sample) === JSON.stringify(sample)) return
    this.d.sessions[s.id] = { startedAt: s.startedAt, sample }
    const keep = Object.entries(this.d.sessions)
      .sort((a, b) => b[1].startedAt - a[1].startedAt)
      .slice(0, KEEP)
    this.d.sessions = Object.fromEntries(keep)
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.d))
    renameSync(tmp, this.file)
  }

  style(): DriverStyle | null {
    const samples = Object.values(this.d.sessions).map((x) => x.sample)
    if (!samples.length) return null
    const avg = (k: keyof Omit<StyleSample, 'laps'>) => {
      const v = samples.map((x) => x[k]).filter((x): x is number => x !== null)
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    const traits = [
      trait('braking', avg('brakePeak')),
      trait('trail', avg('trailRatio')),
      trait('throttle', avg('throttleSmooth')),
      trait('consistency', avg('consistency')),
      trait('grip', avg('gripPct')),
    ].filter((t): t is DriverTrait => !!t)
    return { sessions: samples.length, tentative: samples.length < MIN_SESSIONS, traits }
  }

  /** Para el coach: rasgos en texto, aclarando si todavía son pocos datos. */
  coachContext(): Record<string, unknown> | null {
    const st = this.style()
    if (!st) return null
    return {
      source: `promedio de tus últimas ${st.sessions} sesiones analizadas${st.tentative ? ' (todavía con pocos datos)' : ''}`,
      traits: Object.fromEntries(st.traits.map((t) => [t.title, `${t.value} · ${t.text}`])),
    }
  }
}
