/**
 * Grabaciones propias (.ftnrec): Assetto Corsa no guarda telemetría, así que
 * FTN Coach graba cada sesión mientras corrés.
 *
 * Formato: gzip de
 *   línea 1  "FTNREC 1"
 *   línea 2  JSON con la cabecera (sim, auto, pista, columnas…)
 *   resto    filas de float32 (una por muestra, en el orden de `columns`)
 *
 * Se va escribiendo con flush periódico: si la app se cierra de golpe, el archivo
 * se puede leer hasta el último flush.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { constants, createGzip, gunzipSync, type Gzip } from 'node:zlib'
import type { SessionMeta } from '@shared/live'
import type { RawSample } from '../telemetry/types'

export const REC_EXT = '.ftnrec'
const MAGIC = 'FTNREC 1'

export const REC_COLUMNS = [
  'clock',
  'lap',
  'pct',
  'lapTime',
  'lastLap',
  'speed',
  'throttle',
  'brake',
  'clutch',
  'steer',
  'gear',
  'rpm',
  'gLat',
  'gLon',
  'fuel',
  'off',
  'inPit',
  'posX',
  'posZ',
] as const

export type RecColumn = (typeof REC_COLUMNS)[number]

export interface RecHeader {
  version: 1
  sim: 'iracing' | 'ac'
  car: string
  track: string
  trackId: string | null
  trackSlug: string | null
  trackLengthM: number | null
  sectorsPct: number[] | null
  sessionType: string
  driver: string | null
  startedAt: number
  columns: RecColumn[]
}

export interface Recording {
  header: RecHeader
  rows: number
  col(name: RecColumn): Float32Array
}

export function readRecording(path: string): Recording {
  // Archivo cortado (la app se cerró grabando): se lee hasta donde llegó
  const raw = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH })
  const nl1 = raw.indexOf(10)
  const nl2 = raw.indexOf(10, nl1 + 1)
  if (nl1 < 0 || nl2 < 0 || raw.toString('utf8', 0, nl1) !== MAGIC) throw new Error('No es una grabación de FTN Coach')
  const header = JSON.parse(raw.toString('utf8', nl1 + 1, nl2)) as RecHeader
  const width = header.columns.length
  const start = nl2 + 1
  const rows = Math.floor((raw.length - start) / (4 * width))
  // Copia alineada: Float32Array necesita offset múltiplo de 4
  const data = new Float32Array(rows * width)
  Buffer.from(data.buffer).set(raw.subarray(start, start + rows * width * 4))
  const cache = new Map<RecColumn, Float32Array>()
  return {
    header,
    rows,
    col(name) {
      let c = cache.get(name)
      if (c) return c
      const j = header.columns.indexOf(name)
      c = new Float32Array(rows)
      if (j >= 0) for (let i = 0; i < rows; i++) c[i] = data[i * width + j]
      else c.fill(NaN)
      cache.set(name, c)
      return c
    },
  }
}

const safe = (s: string) =>
  s
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

const FLUSH_MS = 5000
const ROW = new Float32Array(REC_COLUMNS.length)

/**
 * Graba las muestras de una sesión. Arranca con la primera muestra en pista y
 * corta al cambiar de sesión (auto, pista o tipo). Si no se completó ninguna
 * vuelta, el archivo se borra.
 */
export class Recorder {
  private gz: Gzip | null = null
  private out: WriteStream | null = null
  private file: string | null = null
  private key = ''
  private laps = 0
  private lastLap: number | null = null
  private lastFlush = 0
  private chunk: Buffer[] = []

  constructor(private dir: () => string) {}

  /** Archivo que se está escribiendo (para que la biblioteca no lo lea a medias). */
  get current(): string | null {
    return this.file
  }

  sample(s: RawSample, meta: SessionMeta | null): void {
    if (!meta || s.sim === 'replay') return
    const key = `${meta.sim}|${meta.car}|${meta.trackId ?? meta.track}|${meta.sessionType}`
    if (key !== this.key) {
      this.stop()
      this.key = key
    }
    if (!this.gz) {
      if (s.paused || !s.onTrack || s.speedKmh < 1) return
      this.begin(meta)
    }
    if (s.paused) return
    if (this.lastLap !== null && s.lap === this.lastLap + 1) this.laps++
    this.lastLap = s.lap

    const v: Record<RecColumn, number> = {
      clock: s.clockS,
      lap: s.lap,
      pct: s.lapPct,
      lapTime: s.lapTimeS,
      lastLap: s.lastLapS ?? NaN,
      speed: s.speedKmh,
      throttle: s.throttle,
      brake: s.brake,
      clutch: s.clutch,
      steer: s.steer,
      gear: s.gear,
      rpm: s.rpm,
      gLat: s.gLat,
      gLon: s.gLon,
      fuel: s.fuelL ?? NaN,
      off: s.offTrack ? 1 : 0,
      inPit: s.inPit ? 1 : 0,
      posX: s.pos ? s.pos[0] : NaN,
      posZ: s.pos ? s.pos[1] : NaN,
    }
    REC_COLUMNS.forEach((c, j) => (ROW[j] = v[c]))
    this.chunk.push(Buffer.from(ROW.buffer.slice(0)))
    if (this.chunk.length >= 60) this.write()
    const now = Date.now()
    if (now - this.lastFlush > FLUSH_MS) {
      this.lastFlush = now
      this.write()
      this.gz?.flush(constants.Z_SYNC_FLUSH)
    }
  }

  private begin(meta: SessionMeta): void {
    const dir = this.dir()
    mkdirSync(dir, { recursive: true })
    const started = new Date()
    const name = safe(`${stamp(started)} ${meta.track} ${meta.car}`)
    this.file = join(dir, name + REC_EXT)
    const header: RecHeader = {
      version: 1,
      sim: meta.sim === 'ac' ? 'ac' : 'iracing',
      car: meta.car,
      track: meta.track,
      trackId: meta.trackId,
      trackSlug: meta.trackSlug,
      trackLengthM: meta.trackLengthM,
      sectorsPct: meta.sectorsPct,
      sessionType: meta.sessionType,
      driver: meta.driver,
      startedAt: started.getTime(),
      columns: [...REC_COLUMNS],
    }
    this.out = createWriteStream(this.file)
    this.gz = createGzip({ level: 6 })
    this.gz.pipe(this.out)
    this.gz.write(`${MAGIC}\n${JSON.stringify(header)}\n`)
    this.laps = 0
    this.lastLap = null
    this.lastFlush = Date.now()
    console.log('[recorder] grabando', this.file)
  }

  private write(): void {
    if (!this.gz || !this.chunk.length) return
    this.gz.write(Buffer.concat(this.chunk))
    this.chunk = []
  }

  /** Cierra el archivo; sin vueltas completas lo borra. */
  stop(): Promise<void> {
    const gz = this.gz
    const out = this.out
    const file = this.file
    const keep = this.laps >= 1
    this.write()
    this.gz = null
    this.out = null
    this.file = null
    this.key = ''
    if (!gz || !out || !file) return Promise.resolve()
    return new Promise((resolve) => {
      out.on('close', () => {
        if (!keep && existsSync(file)) {
          try {
            unlinkSync(file)
          } catch {
            // Lo puede tener abierto otro programa: queda y la biblioteca lo ignora
          }
        } else if (keep) console.log('[recorder] guardado', file, `${Math.round(statSync(file).size / 1024)} KB`)
        resolve()
      })
      gz.end()
    })
  }
}
