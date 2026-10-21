/**
 * Ajustes del usuario en %APPDATA%/FTN Coach/settings.json. Todo tiene un valor
 * por defecto que funciona sin tocar nada: el piloto abre la app y listo.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { COACH_PROVIDERS } from '@shared/analysis'
import type { DeepPartial, Settings } from '@shared/api'

function defaults(): Settings {
  return {
    lan: { exposed: true, port: 8090, hz: 30 },
    units: 'metric',
    app: { closeToTray: true, startWithWindows: false },
    paths: {
      iracingTelemetry: join(app.getPath('documents'), 'iRacing', 'telemetry'),
      recordings: join(app.getPath('documents'), 'FTN Coach', 'Sesiones'),
    },
    recording: { ac: true, iracing: false },
    coach: {
      provider: 'gemini',
      models: Object.fromEntries(COACH_PROVIDERS.map((p) => [p.id, p.defaultModel])) as Settings['coach']['models'],
    },
    profile: { name: '', experienceYears: 0, discipline: '', about: '', goals: '' },
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function merge<T>(base: T, patch: any): T {
  if (!patch || typeof patch !== 'object') return base
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in (base as any))) continue
    const cur = (base as any)[k]
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) ? merge(cur, v) : typeof v === typeof cur ? v : cur
  }
  return out
}

export class SettingsStore {
  private value: Settings
  readonly file = join(app.getPath('userData'), 'settings.json')

  constructor() {
    let saved: unknown = null
    try {
      if (existsSync(this.file)) saved = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (err) {
      console.error('[settings] archivo dañado, se usan los valores por defecto:', err)
    }
    // Versiones anteriores guardaban solo el modelo de Claude en coach.model
    const old = (saved as { coach?: { model?: unknown } } | null)?.coach?.model
    if (typeof old === 'string') (saved as any).coach.models = { claude: old }
    this.value = merge(defaults(), saved)
    if (!COACH_PROVIDERS.some((p) => p.id === this.value.coach.provider)) this.value.coach.provider = 'gemini'
    // Los modelos gratis de OpenCode solo andan dentro de OpenCode: se pasa al más barato
    const m = this.value.coach.models
    for (const id of ['opencode-zen', 'opencode-go'] as const) if (!m[id] || /-free$|^big-pickle$/.test(m[id])) m[id] = 'deepseek-v4.1-flash'
  }

  get(): Settings {
    return this.value
  }

  update(patch: DeepPartial<Settings>): Settings {
    const next = merge(this.value, patch)
    next.lan.port = Math.min(65535, Math.max(1024, Math.round(next.lan.port)))
    next.lan.hz = Math.min(60, Math.max(5, Math.round(next.lan.hz)))
    next.profile.experienceYears = Math.min(80, Math.max(0, Math.round(next.profile.experienceYears) || 0))
    this.value = next
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, this.file)
    return next
  }
}
