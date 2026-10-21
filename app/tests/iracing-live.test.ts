/**
 * Lectura en vivo sin iRacing: se publica una memoria compartida con el mismo
 * nombre y formato que el sim (header, variables y filas tomadas de un .ibt real)
 * y se lee con IracingLive.
 */
import * as nodeFs from 'node:fs'
import koffi from 'koffi'
import { afterAll, describe, expect, it } from 'vitest'
import { IbtFile } from '../src/main/telemetry/iracing/ibt'
import { HEADER_SIZE, VAR_HEADER_SIZE } from '../src/main/telemetry/iracing/irsdk'
import { IracingLive } from '../src/main/telemetry/iracing/live'
import { localIbtFiles } from './fixtures'

const files = localIbtFiles()
const isWin = process.platform === 'win32'

describe.skipIf(!files.length || !isWin)('iRacing en vivo (memoria simulada)', () => {
  const k32 = koffi.load('kernel32.dll')
  const CreateFileMappingW = k32.func('void* __stdcall CreateFileMappingW(intptr_t f, void* a, uint32_t p, uint32_t hi, uint32_t lo, str16 name)')
  const MapViewOfFile = k32.func('void* __stdcall MapViewOfFile(void* h, uint32_t access, uint32_t hi, uint32_t lo, size_t n)')
  const UnmapViewOfFile = k32.func('int __stdcall UnmapViewOfFile(void* addr)')
  const CloseHandle = k32.func('int __stdcall CloseHandle(void* h)')
  const RtlMoveMemory = k32.func('void __stdcall RtlMoveMemory(void* dst, void* src, size_t len)')

  const SIZE = 1 << 20
  const handle = CreateFileMappingW(-1, null, 0x04, 0, SIZE, 'Local\\IRSDKMemMapFileName')
  const base: bigint = MapViewOfFile(handle, 0xf001f, 0, 0, 0)
  const write = (offset: number, b: Buffer) => RtlMoveMemory(base + BigInt(offset), b, b.length)

  afterAll(() => {
    UnmapViewOfFile(base)
    CloseHandle(handle)
  })

  it('lee la fila más reciente del anillo y la session info', () => {
    const ibt = new IbtFile(files[files.length - 1])
    const h = ibt.header
    const varsOff = 1024
    const infoOff = varsOff + h.numVars * VAR_HEADER_SIZE
    const info = Buffer.alloc(h.sessionInfoLen)
    // Copia cruda de definiciones y YAML del .ibt
    const fs = nodeFs
    const fd = fs.openSync(ibt.path, 'r')
    const vars = Buffer.alloc(h.numVars * VAR_HEADER_SIZE)
    fs.readSync(fd, vars, 0, vars.length, h.varHeaderOffset)
    fs.readSync(fd, info, 0, info.length, h.sessionInfoOffset)
    fs.closeSync(fd)
    const bufOff = [infoOff + info.length + 64, 0, 0]
    bufOff[1] = bufOff[0] + h.bufLen
    bufOff[2] = bufOff[1] + h.bufLen

    const header = Buffer.alloc(HEADER_SIZE)
    header.writeInt32LE(2, 0) // ver
    header.writeInt32LE(1, 4) // status: conectado
    header.writeInt32LE(60, 8)
    header.writeInt32LE(1, 12) // sessionInfoUpdate
    header.writeInt32LE(info.length, 16)
    header.writeInt32LE(infoOff, 20)
    header.writeInt32LE(h.numVars, 24)
    header.writeInt32LE(varsOff, 28)
    header.writeInt32LE(3, 32) // numBuf
    header.writeInt32LE(h.bufLen, 36)
    // Tres filas de distintos momentos; la más nueva (tick 300) está en el buffer del medio
    const rows = [5000, 9000, 7000]
    const ticks = [100, 300, 200]
    rows.forEach((row, i) => {
      header.writeInt32LE(ticks[i], 48 + i * 16)
      header.writeInt32LE(bufOff[i], 52 + i * 16)
      write(bufOff[i], ibt.readRows(row, 1))
    })
    write(varsOff, vars)
    write(infoOff, info)
    write(0, header)

    const live = IracingLive.open()
    expect(live).not.toBeNull()
    const s = live!.poll()!
    expect(s).not.toBeNull()
    // Valores de la fila 9000 leídos directo del archivo
    const ref = ibt.readRows(9000, 1)
    const speed = ref.readFloatLE(ibt.vars.get('Speed')!.offset) * 3.6
    expect(s.speedKmh).toBeCloseTo(speed, 3)
    expect(s.sim).toBe('iracing')
    expect(live!.meta()?.car).toBe('Toyota GR86')
    // Sin tick nuevo no hay muestra nueva
    expect(live!.poll()).toBeNull()
    expect(live!.alive()).toBe(true)

    // El sim se cierra: status a 0
    header.writeInt32LE(0, 4)
    write(0, header)
    live!.poll()
    expect(live!.alive()).toBe(false)
    live!.close()
    ibt.close()
  })
})
