/**
 * Coach con IA (Claude, Gemini u OpenCode): reporte de la sesión y chat sobre
 * ella. Las API keys son del piloto y se guardan cifradas con el almacén seguro
 * del sistema (DPAPI en Windows); nunca se escriben en texto plano ni salen de
 * esta PC salvo hacia la API del proveedor.
 */
import { app, safeStorage } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { COACH_PROVIDERS, type ChatMessage, type CoachKeyId, type CoachProvider, type CoachReport, type CoachState } from '@shared/analysis'
import { streamLlm, stripThinking } from './llm'
import { PERSONA, REPORT_FORMAT, chatSystem, parseReport, reportRequest } from './prompt'

interface Saved {
  report: CoachReport | null
  model: string | null
  createdAt: number | null
  /** Vuelta analizada (índice) del reporte. */
  lap: number | null
  chat: ChatMessage[]
}

const MAX_CHAT_TURNS = 20

function atomicWrite(file: string, data: string | Buffer): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

export class CoachService extends EventEmitter<{ state: [CoachState] }> {
  private dir = join(app.getPath('userData'), 'coach')
  private live = new Map<string, { busy: boolean; error: string | null; streaming: string | null }>()

  constructor(
    private choice: () => { provider: CoachProvider; model: string },
    private sessionData: (id: string, lap: number | null) => Promise<Record<string, unknown>>,
  ) {
    super()
  }

  // ── API keys ──

  private keyFile(k: CoachKeyId): string {
    return join(app.getPath('userData'), `${k}-key.bin`)
  }

  hasKey(k: CoachKeyId): boolean {
    return existsSync(this.keyFile(k))
  }

  setKey(k: CoachKeyId, key: string | null): boolean {
    if (!key) {
      if (existsSync(this.keyFile(k))) unlinkSync(this.keyFile(k))
      return false
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no permite guardar la clave cifrada en esta cuenta')
    atomicWrite(this.keyFile(k), safeStorage.encryptString(key.trim()))
    return true
  }

  /** Proveedor y modelo activos, con su clave. */
  private llm(): { provider: CoachProvider; model: string; apiKey: string; label: string } {
    const { provider, model } = this.choice()
    const info = COACH_PROVIDERS.find((p) => p.id === provider)!
    const label = `${info.label.split(' · ')[0]} · ${model}`
    if (!info.key) return { provider, model, apiKey: '', label }
    if (!this.hasKey(info.key)) throw new Error(`Cargá tu API key de ${info.label.split(' · ')[0]} en Ajustes → Coach para usar el coach.`)
    return { provider, model, apiKey: safeStorage.decryptString(readFileSync(this.keyFile(info.key))), label }
  }

  // ── Estado por sesión ──

  private file(id: string): string {
    return join(this.dir, `${id.replace(/[^a-z0-9]/gi, '')}.json`)
  }

  private load(id: string): Saved {
    try {
      return JSON.parse(readFileSync(this.file(id), 'utf8')) as Saved
    } catch {
      return { report: null, model: null, createdAt: null, lap: null, chat: [] }
    }
  }

  private save(id: string, s: Saved): void {
    mkdirSync(this.dir, { recursive: true })
    atomicWrite(this.file(id), JSON.stringify(s))
  }

  state(id: string): CoachState {
    const s = this.load(id)
    const l = this.live.get(id)
    return {
      sessionId: id,
      report: s.report,
      model: s.model,
      createdAt: s.createdAt,
      chat: s.chat,
      busy: l?.busy ?? false,
      error: l?.error ?? null,
      streaming: l?.streaming ?? null,
    }
  }

  private set(id: string, patch: Partial<{ busy: boolean; error: string | null; streaming: string | null }>): void {
    const cur = this.live.get(id) ?? { busy: false, error: null, streaming: null }
    this.live.set(id, { ...cur, ...patch })
    this.emit('state', this.state(id))
  }

  private async run(id: string, job: () => Promise<void>): Promise<CoachState> {
    if (this.live.get(id)?.busy) return this.state(id)
    this.set(id, { busy: true, error: null, streaming: '' })
    try {
      await job()
      this.set(id, { busy: false, streaming: null })
    } catch (err) {
      this.set(id, { busy: false, streaming: null, error: err instanceof Error ? err.message : String(err) })
    }
    return this.state(id)
  }

  /** Reporte completo de la sesión (o de una vuelta puntual). */
  analyze(id: string, lap: number | null): Promise<CoachState> {
    return this.run(id, async () => {
      const llm = this.llm()
      const data = await this.sessionData(id, lap)
      let shown = 0
      const text = await streamLlm({
        ...llm,
        conversation: id,
        system: [PERSONA, REPORT_FORMAT],
        messages: [{ role: 'user', content: reportRequest(data) }],
        maxTokens: 8000,
        json: true,
        onText: (t) => {
          // El JSON va llegando: se avisa el avance sin mandar cada token a la ventana
          shown += t.length
          if (shown > 400) {
            shown = 0
            this.set(id, { streaming: 'Escribiendo el reporte…' })
          }
        },
      })
      const report = parseReport(text)
      const saved = this.load(id)
      this.save(id, { ...saved, report, model: llm.label, createdAt: Date.now(), lap })
    })
  }

  /** Pregunta del piloto sobre la sesión. */
  ask(id: string, question: string): Promise<CoachState> {
    const q = question.trim()
    if (!q) return Promise.resolve(this.state(id))
    return this.run(id, async () => {
      const llm = this.llm()
      const saved = this.load(id)
      const chat: ChatMessage[] = [...saved.chat, { role: 'user', text: q, at: Date.now() }]
      this.save(id, { ...saved, chat })
      this.emit('state', this.state(id))
      const data = await this.sessionData(id, saved.lap)
      // La API pide que la conversación empiece con el piloto
      const history = chat.slice(-MAX_CHAT_TURNS * 2)
      while (history[0]?.role === 'assistant') history.shift()
      let acc = ''
      const answer = await streamLlm({
        ...llm,
        conversation: id,
        system: [PERSONA, chatSystem(data, saved.report)],
        messages: history.map((m) => ({ role: m.role, content: m.text })),
        maxTokens: 1500,
        onText: (t) => {
          acc += t
          this.set(id, { streaming: stripThinking(acc) })
        },
      })
      this.save(id, { ...this.load(id), chat: [...chat, { role: 'assistant', text: answer.trim(), at: Date.now() }] })
    })
  }

  clearChat(id: string): CoachState {
    this.save(id, { ...this.load(id), chat: [] })
    return this.state(id)
  }
}
