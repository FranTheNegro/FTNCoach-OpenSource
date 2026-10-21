/** Lado del proceso principal del hilo de análisis: pedidos con promesa y estado de la biblioteca. */
import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import type { LibraryState } from '@shared/analysis'
import type { AnalysisMessage, AnalysisRequest, AnalysisResults } from './protocol'

export class AnalysisService extends EventEmitter<{ library: [LibraryState] }> {
  state: LibraryState = { scanning: false, sessions: [], error: null }
  private worker: Worker | null = null
  private spawn: (() => Worker) | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private stopping = false

  start(spawn: () => Worker): void {
    this.spawn = spawn
    this.launch()
  }

  private launch(): void {
    const w = this.spawn!()
    this.worker = w
    w.on('message', (m: AnalysisMessage) => {
      if (m.type === 'library') {
        this.state = m.state
        this.emit('library', m.state)
        return
      }
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error))
    })
    w.on('error', (err) => console.error('[analysis] el hilo falló:', err))
    w.on('exit', (code) => {
      if (this.worker === w) this.worker = null
      for (const p of this.pending.values()) p.reject(new Error('El análisis se interrumpió'))
      this.pending.clear()
      if (this.stopping) return
      console.error(`[analysis] el hilo terminó (código ${code}); se reinicia`)
      setTimeout(() => !this.stopping && !this.worker && this.launch(), 1000)
    })
  }

  request<T extends AnalysisRequest>(req: T): Promise<AnalysisResults[T['type']]> {
    if (!this.worker) return Promise.reject(new Error('El análisis no está disponible'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker!.postMessage({ id, req })
    })
  }

  stop(): void {
    this.stopping = true
    void this.worker?.terminate()
    this.worker = null
  }
}
