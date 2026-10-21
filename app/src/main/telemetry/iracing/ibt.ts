/**
 * Archivo .ibt de iRacing: irsdk_header + irsdk_diskSubHeader + definiciones de
 * variables + session info + una fila por tick (normalmente 60 Hz).
 *
 * Las filas se leen del disco a pedido: una sesión larga pesa cientos de MB y no
 * hace falta tenerla entera en memoria.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { HEADER_SIZE, VAR_HEADER_SIZE, parseHeader, parseVarHeaders, type IrHeader, type VarMap } from './irsdk'
import { parseSessionInfo, type SessionInfo } from './session-info'

export interface DiskHeader {
  /** time_t del inicio de la sesión (s epoch). */
  startDate: number
  startTime: number
  endTime: number
  lapCount: number
  recordCount: number
}

const DISK_HEADER_SIZE = 32

export class IbtFile {
  readonly header: IrHeader
  readonly disk: DiskHeader
  readonly vars: VarMap
  readonly info: SessionInfo
  readonly rowCount: number
  readonly rowOffset: number
  readonly rowLen: number
  private fd: number

  constructor(readonly path: string) {
    this.fd = openSync(path, 'r')
    const size = fstatSync(this.fd).size
    const head = this.readAt(0, HEADER_SIZE + DISK_HEADER_SIZE)
    this.header = parseHeader(head)
    this.disk = {
      startDate: Number(head.readBigInt64LE(HEADER_SIZE)),
      startTime: head.readDoubleLE(HEADER_SIZE + 8),
      endTime: head.readDoubleLE(HEADER_SIZE + 16),
      lapCount: head.readInt32LE(HEADER_SIZE + 24),
      recordCount: head.readInt32LE(HEADER_SIZE + 28),
    }
    const h = this.header
    if (h.bufLen <= 0 || h.numVars <= 0) throw new Error('No es un archivo .ibt válido')
    this.vars = parseVarHeaders(this.readAt(h.varHeaderOffset, h.numVars * VAR_HEADER_SIZE), h.numVars)
    this.info = h.sessionInfoLen > 0 ? parseSessionInfo(this.readAt(h.sessionInfoOffset, h.sessionInfoLen)) : {}
    this.rowOffset = h.bufs[0].bufOffset
    this.rowLen = h.bufLen
    // recordCount puede faltar si el sim se cerró mientras grababa: se usa el tamaño real
    const fit = Math.max(0, Math.floor((size - this.rowOffset) / this.rowLen))
    this.rowCount = this.disk.recordCount > 0 ? Math.min(this.disk.recordCount, fit) : fit
  }

  get tickRate(): number {
    return this.header.tickRate || 60
  }

  private readAt(pos: number, len: number, into?: Buffer): Buffer {
    const b = into ?? Buffer.alloc(len)
    readSync(this.fd, b, 0, len, pos)
    return b
  }

  /** Lee `count` filas consecutivas desde `first` en un solo bloque. */
  readRows(first: number, count: number, into?: Buffer): Buffer {
    const n = Math.max(0, Math.min(count, this.rowCount - first))
    const len = n * this.rowLen
    const b = into && into.length >= len ? into : Buffer.alloc(len)
    if (n > 0) this.readAt(this.rowOffset + first * this.rowLen, len, b)
    return b
  }

  close(): void {
    if (this.fd >= 0) closeSync(this.fd)
    this.fd = -1
  }
}
