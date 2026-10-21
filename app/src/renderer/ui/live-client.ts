/**
 * Cliente del WebSocket de telemetría. Se reconecta solo y agrupa las
 * actualizaciones en un render por cuadro de animación: aunque lleguen 30–60
 * frames por segundo, React dibuja como mucho una vez por refresco de pantalla.
 */
import { useSyncExternalStore } from 'react'
import { PROTOCOL_VERSION, type EngineStatus, type LapRecord, type LiveFrame, type ServerMessage, type SessionMeta } from '@shared/live'

export interface LiveSnapshot {
  /** Conectado al servidor de FTN Coach (no implica que haya un sim abierto). */
  connected: boolean
  /** El servidor habla otra versión del protocolo: hay que recargar la página. */
  outdated: boolean
  status: EngineStatus | null
  meta: SessionMeta | null
  frame: LiveFrame | null
  laps: LapRecord[]
}

/** Últimos segundos de pedales, volante y G para los gráficos en vivo. */
export class History {
  readonly size: number
  readonly throttle: Float32Array
  readonly brake: Float32Array
  readonly steer: Float32Array
  readonly gLat: Float32Array
  readonly gLon: Float32Array
  readonly speed: Float32Array
  head = 0
  count = 0

  constructor(size = 600) {
    this.size = size
    this.throttle = new Float32Array(size)
    this.brake = new Float32Array(size)
    this.steer = new Float32Array(size)
    this.gLat = new Float32Array(size)
    this.gLon = new Float32Array(size)
    this.speed = new Float32Array(size)
  }

  push(f: LiveFrame): void {
    const i = this.head
    this.throttle[i] = f.throttle
    this.brake[i] = f.brake
    this.steer[i] = f.steer
    this.gLat[i] = f.gLat
    this.gLon[i] = f.gLon
    this.speed[i] = f.speedKmh
    this.head = (i + 1) % this.size
    this.count = Math.min(this.size, this.count + 1)
  }

  /** Índice del k-ésimo valor más viejo (0 = el más viejo guardado). */
  at(k: number): number {
    return (this.head - this.count + k + this.size) % this.size
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }
}

/** Sin mensajes del servidor durante esto: la conexión está colgada. */
const STALE_MS = 3500

export class LiveClient {
  private ws: WebSocket | null = null
  private snap: LiveSnapshot = { connected: false, outdated: false, status: null, meta: null, frame: null, laps: [] }
  private listeners = new Set<() => void>()
  private scheduled = false
  private retry = 500
  private closed = false
  private lastMsgAt = 0
  readonly history = new History()

  constructor(private url: string) {
    this.connect()
    // El servidor manda algo al menos cada segundo: si se calla, la conexión quedó
    // colgada (wifi que se cortó sin cerrar el socket) y se reconecta sin esperar
    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastMsgAt > STALE_MS) this.ws.close()
    }, 1000)
  }

  static forPage(): LiveClient {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return new LiveClient(`${proto}://${location.host}/ws`)
  }

  private connect(): void {
    if (this.closed) return
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 500
      this.lastMsgAt = Date.now()
      this.set({ connected: true })
    }
    ws.onmessage = (ev) => {
      this.lastMsgAt = Date.now()
      this.onMessage(JSON.parse(String(ev.data)) as ServerMessage)
    }
    ws.onclose = () => {
      this.ws = null
      this.set({ connected: false })
      if (!this.closed) setTimeout(() => this.connect(), this.retry)
      this.retry = Math.min(3000, this.retry * 2)
    }
    ws.onerror = () => ws.close()
  }

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'hello':
        if (m.protocol !== PROTOCOL_VERSION) this.set({ outdated: true })
        break
      case 'status':
        if (m.status.state === 'waiting') this.history.clear()
        this.set({ status: m.status, ...(m.status.state === 'waiting' ? { frame: null } : {}) })
        break
      case 'meta':
        this.set({ meta: m.meta })
        break
      case 'laps':
        this.set({ laps: m.laps })
        break
      case 'frame':
        this.history.push(m.frame)
        this.set({ frame: m.frame })
        break
    }
  }

  private set(patch: Partial<LiveSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    if (this.scheduled) return
    this.scheduled = true
    requestAnimationFrame(() => {
      this.scheduled = false
      for (const l of this.listeners) l()
    })
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): LiveSnapshot => this.snap

  close(): void {
    this.closed = true
    this.ws?.close()
  }
}

export function useLive(client: LiveClient): LiveSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot)
}
