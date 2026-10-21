/**
 * Modo demo: reproduce un .ibt a velocidad real como si fuera iRacing en vivo.
 * Sirve para probar el dashboard de la tablet sin abrir el simulador.
 */
import type { SessionMeta } from '@shared/live'
import type { RawSample, TelemetrySource } from './types'
import { IbtFile } from './iracing/ibt'
import { RowReader } from './iracing/irsdk'
import { metaFromSessionInfo } from './iracing/session-info'
import { irSample, type IrContext } from './iracing/normalize'
import { irContext } from './iracing/context'

const CHUNK = 120

export class IbtReplay implements TelemetrySource {
  readonly sim = 'replay' as const
  private file: IbtFile
  private reader: RowReader
  private ctx: IrContext
  private _meta: SessionMeta
  private firstRow = 0
  private startedAt = 0
  private lastRow = -1
  /** Primera fila del bloque leído; null = todavía no se leyó nada. */
  private chunkStart: number | null = null
  private chunk: Buffer = Buffer.alloc(0)
  private open = true

  constructor(path: string) {
    this.file = new IbtFile(path)
    this.reader = new RowReader(this.file.vars)
    const sessionNum = this.rowValue(0, 'SessionNum')
    this.ctx = irContext(this.file.info, 'replay', sessionNum)
    this._meta = metaFromSessionInfo(this.file.info, 'replay', sessionNum)
    this.firstRow = this.findFirstDrivingRow()
    this.startedAt = Date.now()
  }

  get path(): string {
    return this.file.path
  }

  private loadRow(i: number): void {
    if (this.chunkStart === null || i < this.chunkStart || i >= this.chunkStart + CHUNK) {
      this.chunk = this.file.readRows(i, CHUNK, this.chunk.length ? this.chunk : undefined)
      this.chunkStart = i
    }
    this.reader.row = this.chunk
    this.reader.base = (i - this.chunkStart!) * this.file.rowLen
  }

  private rowValue(i: number, name: string): number | null {
    if (this.file.rowCount === 0) return null
    this.loadRow(i)
    return this.reader.num(name)
  }

  /** Saltea el rato en el garage: arranca cuando el auto ya se mueve. */
  private findFirstDrivingRow(): number {
    const step = this.file.tickRate
    for (let i = 0; i < this.file.rowCount; i += step) {
      if ((this.rowValue(i, 'Speed') ?? 0) > 5) return Math.max(0, i - step * 2)
    }
    return 0
  }

  meta(): SessionMeta {
    return this._meta
  }

  alive(): boolean {
    return this.open && this.file.rowCount > 0
  }

  poll(): RawSample | null {
    const n = this.file.rowCount - this.firstRow
    if (n <= 0) return null
    const elapsedTicks = Math.floor(((Date.now() - this.startedAt) / 1000) * this.file.tickRate)
    const row = this.firstRow + (elapsedTicks % n)
    if (row === this.lastRow) return null
    this.lastRow = row
    this.loadRow(row)
    return irSample(this.reader, this.ctx)
  }

  close(): void {
    this.open = false
    this.file.close()
  }
}
