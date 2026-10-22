/**
 * Acceso de solo lectura a la memoria compartida de Windows (la que publican
 * iRacing y Assetto Corsa) mediante koffi, sin compilar módulos nativos.
 *
 * Electron no permite envolver memoria externa en un ArrayBuffer, así que cada
 * lectura copia los bytes pedidos a un Buffer propio con RtlMoveMemory. Copiar
 * unos KB por frame cuesta microsegundos.
 */
import koffi from 'koffi'

const FILE_MAP_READ = 0x0004

type Ptr = bigint

interface Kernel32 {
  OpenFileMappingW: (access: number, inherit: number, name: string) => Ptr | null
  MapViewOfFile: (h: Ptr, access: number, offHigh: number, offLow: number, bytes: number) => Ptr | null
  UnmapViewOfFile: (addr: Ptr) => number
  CloseHandle: (h: Ptr) => number
  RtlMoveMemory: (dst: Buffer, src: Ptr, len: number) => void
  CreateToolhelp32Snapshot: (flags: number, pid: number) => Ptr | null
  Process32FirstW: (snap: Ptr, entry: Buffer) => number
  Process32NextW: (snap: Ptr, entry: Buffer) => number
}

let k32: Kernel32 | null = null

function kernel32(): Kernel32 {
  if (k32) return k32
  const lib = koffi.load('kernel32.dll')
  k32 = {
    OpenFileMappingW: lib.func('void* __stdcall OpenFileMappingW(uint32_t access, int inherit, str16 name)'),
    MapViewOfFile: lib.func(
      'void* __stdcall MapViewOfFile(void* h, uint32_t access, uint32_t offHigh, uint32_t offLow, size_t bytes)',
    ),
    UnmapViewOfFile: lib.func('int __stdcall UnmapViewOfFile(void* addr)'),
    CloseHandle: lib.func('int __stdcall CloseHandle(void* h)'),
    RtlMoveMemory: lib.func('void __stdcall RtlMoveMemory(void* dst, void* src, size_t len)'),
    CreateToolhelp32Snapshot: lib.func('void* __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'),
    Process32FirstW: lib.func('int __stdcall Process32FirstW(void* snap, void* entry)'),
    Process32NextW: lib.func('int __stdcall Process32NextW(void* snap, void* entry)'),
  }
  return k32
}

export const isWindows = process.platform === 'win32'

const TH32CS_SNAPPROCESS = 0x2
const INVALID_HANDLE = 0xffffffffffffffffn
// PROCESSENTRY32W en x64: dwSize al principio y szExeFile (260 wchar) en el byte 44
const ENTRY_SIZE = 568
const EXE_OFFSET = 44

/** true si hay un proceso con ese ejecutable (sin distinguir mayúsculas, ej. "acr.exe"). */
export function isProcessRunning(exe: string): boolean {
  if (!isWindows) return false
  const k = kernel32()
  const snap = k.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  if (!snap || snap === INVALID_HANDLE) return false
  const want = exe.toLowerCase()
  const entry = Buffer.alloc(ENTRY_SIZE)
  entry.writeUInt32LE(ENTRY_SIZE, 0)
  try {
    for (let ok = k.Process32FirstW(snap, entry); ok; ok = k.Process32NextW(snap, entry)) {
      const name = entry.toString('utf16le', EXE_OFFSET, ENTRY_SIZE)
      const end = name.indexOf('\0')
      if ((end >= 0 ? name.slice(0, end) : name).toLowerCase() === want) return true
    }
    return false
  } finally {
    k.CloseHandle(snap)
  }
}

let winmm: { begin: (ms: number) => number; end: (ms: number) => number } | null = null
let highRes = false

// SetProcessInformation(ProcessPowerThrottling): Windows 11 aplica a Electron la
// política de ignorar los pedidos de resolución de timer. Se desactiva solo eso.
const PROCESS_POWER_THROTTLING = 4
const POWER_THROTTLING_IGNORE_TIMER_RESOLUTION = 0x4
let throttlingDisabled = false

function allowTimerResolution(): void {
  if (throttlingDisabled) return
  throttlingDisabled = true
  const lib = koffi.load('kernel32.dll')
  const State = koffi.struct('PROCESS_POWER_THROTTLING_STATE', {
    Version: 'uint32_t',
    ControlMask: 'uint32_t',
    StateMask: 'uint32_t',
  })
  const SetProcessInformation = lib.func('__stdcall', 'SetProcessInformation', 'int', ['intptr_t', 'int', koffi.pointer(State), 'uint32_t'])
  // -1 = GetCurrentProcess(). ControlMask sin StateMask = "no ignorar la resolución"
  SetProcessInformation(-1, PROCESS_POWER_THROTTLING, { Version: 1, ControlMask: POWER_THROTTLING_IGNORE_TIMER_RESOLUTION, StateMask: 0 }, 12)
}

/**
 * El timer de Windows salta de a 15,6 ms: un setInterval de 16 ms termina leyendo
 * a ~36 Hz. Mientras hay un sim conectado se pide resolución de 1 ms (lo mismo que
 * hacen los juegos); al desconectar se devuelve para no gastar batería.
 */
export function setHighResTimer(on: boolean): void {
  if (!isWindows || on === highRes) return
  try {
    if (!winmm) {
      const lib = koffi.load('winmm.dll')
      winmm = {
        begin: lib.func('uint32_t __stdcall timeBeginPeriod(uint32_t ms)'),
        end: lib.func('uint32_t __stdcall timeEndPeriod(uint32_t ms)'),
      }
    }
    if (on) allowTimerResolution()
    if (on) winmm.begin(1)
    else winmm.end(1)
    highRes = on
  } catch (err) {
    console.error('[win32] timer de alta resolución no disponible:', err)
  }
}

/** Una memoria compartida con nombre, abierta en modo lectura. */
export class SharedMemory {
  private constructor(
    private handle: Ptr,
    private base: Ptr,
    readonly name: string,
  ) {}

  /** null si el simulador no está corriendo (la memoria no existe). */
  static open(name: string): SharedMemory | null {
    if (!isWindows) return null
    const k = kernel32()
    const h = k.OpenFileMappingW(FILE_MAP_READ, 0, name)
    if (!h) return null
    const base = k.MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0)
    if (!base) {
      k.CloseHandle(h)
      return null
    }
    return new SharedMemory(h, base, name)
  }

  /** Copia `len` bytes desde `offset` en `into` (o en un Buffer nuevo). */
  read(offset: number, len: number, into?: Buffer): Buffer {
    const dst = into && into.length >= len ? into : Buffer.alloc(len)
    kernel32().RtlMoveMemory(dst, this.base + BigInt(offset), len)
    return dst
  }

  close(): void {
    if (!this.base) return
    const k = kernel32()
    k.UnmapViewOfFile(this.base)
    k.CloseHandle(this.handle)
    this.base = 0n
    this.handle = 0n
  }
}
