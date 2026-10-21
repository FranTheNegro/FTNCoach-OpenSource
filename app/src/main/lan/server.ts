/**
 * Servidor de la red local: sirve el dashboard (HTML estático) y publica la
 * telemetría por WebSocket en /ws. Es de solo lectura: ningún cliente de la red
 * puede cambiar nada de la app.
 *
 * Con la red desactivada escucha solo en 127.0.0.1 (lo usa la vista previa de
 * la app de escritorio).
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { PROTOCOL_VERSION, type EngineStatus, type LapRecord, type LiveFrame, type ServerMessage, type SessionMeta } from '@shared/live'
import type { TrackMapResult } from '@shared/analysis'
import type { TelemetryEngine } from '../telemetry/engine'

/** Datos de solo lectura que el servidor pide a la app (mapa del trazado, app de AC). */
export interface LanApi {
  trackMap(trackId: string, slug: string | null): Promise<TrackMapResult>
  ingame(): Promise<unknown>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Un cliente lento (wifi mala) no debe acumular frames viejos: con más que esto
 * en cola (unos pocos frames) se saltean hasta que se vacíe, así al volver la
 * señal llega el dato actual y no una ráfaga de segundos atrasados.
 */
const MAX_BUFFERED = 16 * 1024
/** Cada cuánto se manda el latido y se revisa que los clientes contesten. */
const HEARTBEAT_MS = 1000
/** Sin pong durante esto: la conexión murió (tablet dormida, fuera de la red). */
const DEAD_MS = 6000

export interface LanOptions {
  port: number
  /** true = toda la red local; false = solo esta PC. */
  exposed: boolean
  /** Frames por segundo hacia los dashboards. */
  hz: number
  /** Carpeta con dashboard.html y sus assets (build del renderer). */
  staticDir: string
  /** En desarrollo, el servidor de Vite al que se le reenvían los pedidos de páginas. */
  devUrl?: string
  appVersion: string
}

export interface LanInfo {
  running: boolean
  exposed: boolean
  port: number
  /** URLs para abrir desde otro dispositivo (una por interfaz de red). */
  urls: string[]
  localUrl: string
  clients: number
  error: string | null
}

const VIRTUAL_IF =
  /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Tailscale|ZeroTier|Bluetooth|Docker|vboxnet|utun|Radmin|Hamachi|NordLynx|OpenVPN|WireGuard|TAP-|Npcap/i
/** Rangos de VPNs conocidas que no son la red de la casa (Radmin VPN usa 26.x, Hamachi 25.x). */
const VPN_RANGES = /^(26\.|25\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/

/** IPs de la red local, primero las de casa (192.168.x), sin adaptadores virtuales. */
export function lanAddresses(): string[] {
  const out: { ip: string; rank: number }[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_IF.test(name)) continue
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.') || VPN_RANGES.test(a.address)) continue
      const rank = a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : 2
      out.push({ ip: a.address, rank })
    }
  }
  return out.sort((x, y) => x.rank - y.rank).map((x) => x.ip)
}

export class LanServer {
  private http: Server | null = null
  private wss: WebSocketServer | null = null
  private lastSentAt = 0
  private opts: LanOptions | null = null
  private error: string | null = null
  private unsubscribe: (() => void) | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private lastPong = new WeakMap<WebSocket, number>()

  constructor(
    private engine: TelemetryEngine,
    private api: LanApi,
  ) {}

  info(): LanInfo {
    const o = this.opts
    const port = o?.port ?? 0
    return {
      running: !!this.http?.listening,
      exposed: !!o?.exposed,
      port,
      urls: o?.exposed ? lanAddresses().map((ip) => `http://${ip}:${port}/`) : [],
      localUrl: `http://127.0.0.1:${port}/`,
      clients: this.wss?.clients.size ?? 0,
      error: this.error,
    }
  }

  async start(opts: LanOptions): Promise<LanInfo> {
    await this.stop()
    this.opts = opts
    this.error = null
    const http = createServer((req, res) => this.handle(req, res))
    const wss = new WebSocketServer({ noServer: true })
    http.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/ws')) return socket.destroy()
      wss.handleUpgrade(req, socket, head, (ws) => this.welcome(ws))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject)
        http.listen(opts.port, opts.exposed ? '0.0.0.0' : '127.0.0.1', () => resolve())
      })
    } catch (err) {
      this.error =
        (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `El puerto ${opts.port} está ocupado por otro programa`
          : String((err as Error).message ?? err)
      http.close()
      return this.info()
    }
    this.http = http
    this.wss = wss
    this.subscribe()
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS)
    return this.info()
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const c of this.wss?.clients ?? []) c.terminate()
    this.wss?.close()
    this.wss = null
    const http = this.http
    this.http = null
    if (http) await new Promise<void>((r) => http.close(() => r()))
  }

  private subscribe(): void {
    const onStatus = (status: EngineStatus) => this.broadcast({ type: 'status', status })
    const onMeta = (meta: SessionMeta | null) => this.broadcast({ type: 'meta', meta })
    const onLaps = (laps: LapRecord[]) => this.broadcast({ type: 'laps', laps })
    const onFrame = (f: LiveFrame) => this.sendFrame(f)
    this.engine.on('frame', onFrame)
    this.engine.on('status', onStatus)
    this.engine.on('meta', onMeta)
    this.engine.on('laps', onLaps)
    this.unsubscribe = () => {
      this.engine.off('status', onStatus)
      this.engine.off('meta', onMeta)
      this.engine.off('laps', onLaps)
      this.engine.off('frame', onFrame)
    }
  }

  private welcome(ws: WebSocket): void {
    const e = this.engine
    const send = (m: ServerMessage) => ws.send(JSON.stringify(m))
    this.lastPong.set(ws, Date.now())
    ws.on('pong', () => this.lastPong.set(ws, Date.now()))
    send({ type: 'hello', protocol: PROTOCOL_VERSION, app: 'FTN Coach', version: this.opts?.appVersion ?? '' })
    send({ type: 'status', status: e.status })
    send({ type: 'meta', meta: e.meta })
    send({ type: 'laps', laps: e.tracker.laps })
    if (e.frame) send({ type: 'frame', frame: e.frame })
    // Los dashboards no mandan nada; cualquier mensaje se ignora
    ws.on('message', () => {})
  }

  /** Latido para los dashboards y ping de WebSocket para cortar las conexiones muertas. */
  private beat(): void {
    if (!this.wss?.clients.size) return
    const now = Date.now()
    const data = JSON.stringify({ type: 'ping' } satisfies ServerMessage)
    for (const c of this.wss.clients) {
      if (now - (this.lastPong.get(c) ?? now) > DEAD_MS) {
        c.terminate()
        continue
      }
      if (c.readyState !== c.OPEN) continue
      c.ping()
      if (c.bufferedAmount < MAX_BUFFERED) c.send(data)
    }
  }

  private broadcast(m: ServerMessage): void {
    if (!this.wss?.clients.size) return
    const data = JSON.stringify(m)
    for (const c of this.wss.clients) if (c.readyState === c.OPEN) c.send(data)
  }

  /** Los frames llegan a 60 Hz; a los dashboards se les manda a lo sumo `hz` por segundo. */
  private sendFrame(f: LiveFrame): void {
    if (!this.wss?.clients.size) return
    const now = performance.now()
    // 2 ms de margen: con 60 Hz de entrada y 30 de salida no se pierde uno de cada dos
    if (now - this.lastSentAt < 1000 / Math.max(1, this.opts?.hz ?? 30) - 2) return
    this.lastSentAt = now
    const data = JSON.stringify({ type: 'frame', frame: f } satisfies ServerMessage)
    for (const c of this.wss.clients) {
      if (c.readyState === c.OPEN && c.bufferedAmount < MAX_BUFFERED) c.send(data)
    }
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const o = this.opts!
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const path = decodeURIComponent(url.pathname)
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (path === '/api/info') return json(200, { app: 'FTN Coach', version: o.appVersion, protocol: PROTOCOL_VERSION })
    if (path === '/api/track-map') {
      const id = url.searchParams.get('id')
      if (!id) return json(400, { error: 'Falta id' })
      this.api
        .trackMap(id, url.searchParams.get('slug'))
        .then((r) => json(200, r))
        .catch((err) => json(500, { error: String(err?.message ?? err) }))
      return
    }
    if (path === '/api/ingame') {
      this.api
        .ingame()
        .then((r) => json(200, r))
        .catch((err) => json(500, { error: String(err?.message ?? err) }))
      return
    }
    const page = path === '/' || path === '/index.html' ? '/dashboard.html' : path
    if (o.devUrl) return this.proxy(o.devUrl, page, req, res)

    const file = normalize(join(o.staticDir, page))
    if (!file.startsWith(normalize(o.staticDir) + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado')
      return
    }
    const hashed = /[-.][A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(file)
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(file).pipe(res)
  }

  /** Desarrollo: reenvía la página al servidor de Vite (para usar la tablet con hot reload). */
  private proxy(devUrl: string, path: string, req: IncomingMessage, res: ServerResponse): void {
    const target = new URL(path + (req.url?.includes('?') ? '?' + req.url.split('?')[1] : ''), devUrl)
    const p = request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    })
    p.on('error', () => res.writeHead(502).end('Servidor de desarrollo no disponible'))
    req.pipe(p)
  }
}
