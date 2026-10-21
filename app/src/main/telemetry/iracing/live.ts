/**
 * iRacing en vivo: memoria compartida `Local\IRSDKMemMapFileName`.
 *
 * El sim escribe en un anillo de hasta 4 buffers; se toma el de tickCount más
 * alto y se vuelve a mirar el tickCount después de copiar para descartar una
 * fila a medio escribir.
 */
import type { SessionMeta } from '@shared/live'
import { SharedMemory } from '../win32'
import type { RawSample, TelemetrySource } from '../types'
import { HEADER_SIZE, RowReader, STATUS_CONNECTED, VAR_HEADER_SIZE, parseHeader, parseVarHeaders } from './irsdk'
import { liveInfoText, metaFromSessionInfo, parseSessionInfo, type SessionInfo } from './session-info'
import { irSample, type IrContext } from './normalize'
import { irContext } from './context'

const MEM_NAME = 'Local\\IRSDKMemMapFileName'
/** Sin ticks nuevos durante este tiempo = el sim se cerró (nuestro handle mantiene viva la memoria). */
const STALE_MS = 4000

export class IracingLive implements TelemetrySource {
  readonly sim = 'iracing' as const
  private reader: RowReader | null = null
  private varsKey = ''
  private infoUpdate = -1
  private info: SessionInfo = {}
  private infoText = ''
  private ctx: IrContext = { sim: 'iracing', lapsTotal: null, carsInSession: null }
  private sessionNum: number | null = null
  private lastTick = -1
  private lastTickAt = Date.now()
  private connected = true
  private headerBuf = Buffer.alloc(HEADER_SIZE)
  private rowBuf = Buffer.alloc(0)
  private _meta: SessionMeta | null = null

  private constructor(private mem: SharedMemory) {}

  /** null si iRacing no está abierto o no está en una sesión. */
  static open(): IracingLive | null {
    const mem = SharedMemory.open(MEM_NAME)
    if (!mem) return null
    const src = new IracingLive(mem)
    const h = parseHeader(mem.read(0, HEADER_SIZE, src.headerBuf))
    if (!(h.status & STATUS_CONNECTED)) {
      mem.close()
      return null
    }
    return src
  }

  meta(): SessionMeta | null {
    return this._meta
  }

  alive(): boolean {
    return this.connected && Date.now() - this.lastTickAt < STALE_MS
  }

  poll(): RawSample | null {
    const h = parseHeader(this.mem.read(0, HEADER_SIZE, this.headerBuf))
    this.connected = (h.status & STATUS_CONNECTED) !== 0
    if (!this.connected || h.bufLen <= 0) return null

    const key = `${h.numVars}:${h.varHeaderOffset}:${h.bufLen}`
    if (key !== this.varsKey) {
      this.reader = new RowReader(parseVarHeaders(this.mem.read(h.varHeaderOffset, h.numVars * VAR_HEADER_SIZE), h.numVars))
      this.rowBuf = Buffer.alloc(h.bufLen)
      this.varsKey = key
      this.infoUpdate = -1
    }
    const reader = this.reader!

    let latest = 0
    for (let i = 1; i < h.numBuf; i++) if (h.bufs[i].tickCount > h.bufs[latest].tickCount) latest = i
    const { tickCount, bufOffset } = h.bufs[latest]
    if (tickCount === this.lastTick) return null

    this.mem.read(bufOffset, h.bufLen, this.rowBuf)
    // Si el sim reescribió ese buffer mientras copiábamos, se descarta y se espera al próximo
    if (this.mem.read(48 + latest * 16, 4).readInt32LE(0) !== tickCount) return null
    this.lastTick = tickCount
    this.lastTickAt = Date.now()
    reader.row = this.rowBuf

    const sessionNum = reader.num('SessionNum')
    if (h.sessionInfoUpdate !== this.infoUpdate || sessionNum !== this.sessionNum) {
      this.infoUpdate = h.sessionInfoUpdate
      const text = liveInfoText(this.mem.read(h.sessionInfoOffset, h.sessionInfoLen))
      // En carrera casi todas las actualizaciones son de resultados: no se vuelve a parsear
      if (text === this.infoText && sessionNum === this.sessionNum) return irSample(reader, this.ctx)
      this.infoText = text
      this.sessionNum = sessionNum
      this.info = parseSessionInfo(text)
      this.ctx = irContext(this.info, 'iracing', sessionNum)
      this._meta = metaFromSessionInfo(this.info, 'iracing', sessionNum)
    }
    return irSample(reader, this.ctx)
  }

  close(): void {
    this.mem.close()
  }
}
