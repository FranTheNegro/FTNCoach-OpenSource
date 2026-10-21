/**
 * Formato irsdk de iRacing: el mismo header y las mismas definiciones de
 * variables se usan en la memoria compartida en vivo y en los archivos .ibt.
 *
 *   irsdk_header (112 B)
 *     0 ver · 4 status · 8 tickRate · 12 sessionInfoUpdate · 16 sessionInfoLen
 *    20 sessionInfoOffset · 24 numVars · 28 varHeaderOffset · 32 numBuf · 36 bufLen
 *    48 varBuf[4] = { tickCount, bufOffset, pad[2] } (16 B c/u)
 *   irsdk_varHeader (144 B)
 *     0 type · 4 offset · 8 count · 12 countAsTime · 16 name[32] · 48 desc[64] · 112 unit[32]
 */

export const HEADER_SIZE = 112
export const VAR_HEADER_SIZE = 144
export const MAX_BUFS = 4
export const STATUS_CONNECTED = 1

export enum VarType {
  Char = 0,
  Bool = 1,
  Int = 2,
  BitField = 3,
  Float = 4,
  Double = 5,
}

const TYPE_SIZE: Record<VarType, number> = { 0: 1, 1: 1, 2: 4, 3: 4, 4: 4, 5: 8 }

export interface IrHeader {
  ver: number
  status: number
  tickRate: number
  sessionInfoUpdate: number
  sessionInfoLen: number
  sessionInfoOffset: number
  numVars: number
  varHeaderOffset: number
  numBuf: number
  bufLen: number
  bufs: { tickCount: number; bufOffset: number }[]
}

export interface IrVar {
  name: string
  type: VarType
  offset: number
  count: number
  unit: string
  desc: string
}

export type VarMap = Map<string, IrVar>

export function parseHeader(b: Buffer): IrHeader {
  const numBuf = Math.min(b.readInt32LE(32), MAX_BUFS)
  const bufs = []
  for (let i = 0; i < Math.max(numBuf, 1); i++) {
    bufs.push({ tickCount: b.readInt32LE(48 + i * 16), bufOffset: b.readInt32LE(52 + i * 16) })
  }
  return {
    ver: b.readInt32LE(0),
    status: b.readInt32LE(4),
    tickRate: b.readInt32LE(8),
    sessionInfoUpdate: b.readInt32LE(12),
    sessionInfoLen: b.readInt32LE(16),
    sessionInfoOffset: b.readInt32LE(20),
    numVars: b.readInt32LE(24),
    varHeaderOffset: b.readInt32LE(28),
    numBuf,
    bufLen: b.readInt32LE(36),
    bufs,
  }
}

function cstr(b: Buffer, start: number, len: number): string {
  const end = b.indexOf(0, start)
  return b.toString('latin1', start, end >= 0 && end < start + len ? end : start + len)
}

/** `b` contiene numVars definiciones contiguas, desde el byte 0. */
export function parseVarHeaders(b: Buffer, numVars: number): VarMap {
  const vars: VarMap = new Map()
  for (let i = 0; i < numVars; i++) {
    const o = i * VAR_HEADER_SIZE
    if (o + VAR_HEADER_SIZE > b.length) break
    const v: IrVar = {
      type: b.readInt32LE(o) as VarType,
      offset: b.readInt32LE(o + 4),
      count: b.readInt32LE(o + 8),
      name: cstr(b, o + 16, 32),
      desc: cstr(b, o + 48, 64),
      unit: cstr(b, o + 112, 32),
    }
    vars.set(v.name, v)
  }
  return vars
}

/** Lee el valor `index` de una variable dentro de una fila de datos (bufLen bytes). */
export function readVar(row: Buffer, v: IrVar, index = 0, base = 0): number {
  const o = base + v.offset + index * TYPE_SIZE[v.type]
  switch (v.type) {
    case VarType.Char:
      return row.readUInt8(o)
    case VarType.Bool:
      return row.readUInt8(o) ? 1 : 0
    case VarType.Int:
      return row.readInt32LE(o)
    case VarType.BitField:
      return row.readUInt32LE(o)
    case VarType.Float:
      return row.readFloatLE(o)
    case VarType.Double:
      return row.readDoubleLE(o)
  }
}

/**
 * Acceso por nombre a una fila. Las variables que no existen en esta versión del
 * sim o de este auto devuelven null: cada canal es opcional.
 */
export class RowReader {
  row: Buffer = Buffer.alloc(0)
  base = 0

  constructor(readonly vars: VarMap) {}

  has(name: string): boolean {
    return this.vars.has(name)
  }

  num(name: string, index = 0): number | null {
    const v = this.vars.get(name)
    if (!v || index >= v.count) return null
    const x = readVar(this.row, v, index, this.base)
    return Number.isFinite(x) ? x : null
  }

  /** Primer canal disponible de la lista. */
  first(...names: string[]): number | null {
    for (const n of names) {
      const x = this.num(n)
      if (x !== null) return x
    }
    return null
  }
}
