/**
 * Motor de telemetría en vivo. El hilo lector (reader-worker) busca el sim y le
 * pasa muestras a 60 Hz; acá se agrega lo que el sim no da (delta propio,
 * consumo por vuelta, historial de vueltas) y se publican los frames.
 */
import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import type { EngineStatus, LapRecord, LiveFrame, SessionMeta } from '@shared/live'
import type { RawSample } from './types'
import { LapTracker } from './lap-tracker'
import type { ReaderCommand, ReaderEvent } from './reader-protocol'

export interface EngineEvents {
  frame: [LiveFrame]
  status: [EngineStatus]
  meta: [SessionMeta | null]
  laps: [LapRecord[]]
  demo: [string | null]
  /** Cada muestra cruda del sim (para el grabador). */
  sample: [RawSample]
}

export class TelemetryEngine extends EventEmitter<EngineEvents> {
  status: EngineStatus = { state: 'waiting', sim: null, since: Date.now(), hz: 0 }
  meta: SessionMeta | null = null
  frame: LiveFrame | null = null
  demo: string | null = null
  readonly tracker = new LapTracker()

  private worker: Worker | null = null
  private spawn: (() => Worker) | null = null
  private stopping = false
  private seq = 0
  private hzCount = 0
  private hzSince = Date.now()
  private hzTimer: NodeJS.Timeout | null = null

  /** `spawn` crea el hilo lector (en la app, el worker que empaqueta electron-vite). */
  start(spawn: () => Worker): void {
    if (this.worker) return
    this.spawn = spawn
    this.stopping = false
    this.launch()
    this.hzTimer = setInterval(() => this.updateHz(), 1000)
  }

  private launch(): void {
    const w = this.spawn!()
    this.worker = w
    w.on('message', (e: ReaderEvent) => this.onReader(e))
    w.on('error', (err) => console.error('[telemetry] el hilo lector falló:', err))
    w.on('exit', (code) => {
      if (this.worker === w) this.worker = null
      this.onDisconnected()
      if (this.stopping) return
      // El hilo lector no debería terminar nunca: se levanta de nuevo (y retoma el demo)
      console.error(`[telemetry] el hilo lector terminó (código ${code}); se reinicia`)
      setTimeout(() => {
        if (this.stopping || this.worker) return
        this.launch()
        if (this.demo) this.setDemo(this.demo)
      }, 1000)
    })
  }

  stop(): void {
    this.stopping = true
    if (this.hzTimer) clearInterval(this.hzTimer)
    this.hzTimer = null
    this.command({ type: 'stop' })
    void this.worker?.terminate()
    this.worker = null
  }

  /** Reproduce un .ibt como si fuera en vivo (null = apagar el demo). */
  setDemo(path: string | null): void {
    this.command({ type: 'demo', path })
  }

  private command(c: ReaderCommand): void {
    this.worker?.postMessage(c)
  }

  private setStatus(next: Partial<EngineStatus>): void {
    const changed = (next.state !== undefined && next.state !== this.status.state) || (next.sim !== undefined && next.sim !== this.status.sim)
    this.status = { ...this.status, ...next, since: changed ? Date.now() : this.status.since }
    if (changed) console.log(`[telemetry] ${this.status.state}${this.status.sim ? ' · ' + this.status.sim : ''}`)
    this.emit('status', this.status)
  }

  private onReader(e: ReaderEvent): void {
    switch (e.type) {
      case 'connected':
        this.resetSession()
        this.setStatus({ state: 'connected', sim: e.sim })
        break
      case 'disconnected':
        this.onDisconnected()
        break
      case 'sample':
        if (e.meta !== undefined) this.setMeta(e.meta)
        this.process(e.sample)
        break
      case 'demo':
        this.demo = e.path
        this.emit('demo', e.path)
        break
      case 'error':
        console.error('[telemetry]', e.message)
        break
    }
  }

  private resetSession(): void {
    this.frame = null
    this.meta = null
    this.tracker.reset()
    this.emit('meta', null)
    this.emit('laps', [])
  }

  private onDisconnected(): void {
    if (this.status.state === 'waiting') return
    this.resetSession()
    this.setStatus({ state: 'waiting', sim: null, hz: 0 })
  }

  private setMeta(meta: SessionMeta | null): void {
    const key = (m: SessionMeta | null) => (m ? `${m.sim}|${m.car}|${m.track}|${m.sessionType}` : '')
    // Otra sesión (auto, pista o tipo): el historial de vueltas empieza de cero
    if (key(meta) !== key(this.meta)) {
      this.tracker.reset()
      this.emit('laps', [])
    }
    this.meta = meta
    this.emit('meta', meta)
  }

  private updateHz(): void {
    const now = Date.now()
    const hz = Math.round((this.hzCount * 1000) / Math.max(1, now - this.hzSince))
    this.hzCount = 0
    this.hzSince = now
    if (hz !== this.status.hz) this.setStatus({ hz })
  }

  private process(s: RawSample): void {
    this.hzCount++
    this.emit('sample', s)
    if (this.tracker.update(s)) this.emit('laps', this.tracker.laps)

    const fuelPerLap = this.tracker.fuelPerLap()
    const { clockS: _c, simDeltaS, offTrack: _o, ...rest } = s
    this.frame = {
      ...rest,
      seq: ++this.seq,
      bestLapS: s.bestLapS ?? this.tracker.bestLapS(),
      deltaS: simDeltaS ?? this.tracker.delta(s),
      fuelPerLapL: fuelPerLap,
      fuelLapsLeft: fuelPerLap && s.fuelL !== null ? s.fuelL / fuelPerLap : null,
    }
    this.emit('frame', this.frame)
  }
}
