/**
 * Sondeo de la memoria compartida de Assetto Corsa Rally (o cualquier juego de Kunos).
 *
 * Uso, con el juego abierto y el auto en el tramo (desde app/):
 *   node scripts/sondeo-acr.mjs            lista las memorias y muestra los datos 10 s
 *   node scripts/sondeo-acr.mjs --grabar   además graba la pasada completa (Ctrl+C corta)
 *   node scripts/sondeo-acr.mjs --todas    lista todas las memorias con nombre, no solo las de Kunos
 *
 * Cada página se decodifica con dos formatos: el de AC1 (el que usa la app) y el de
 * ACC. Physics y static son iguales al principio en los dos; graphics cambia desde
 * `normalizedCarPosition` (ACC agrega `activeCars` y las coordenadas de 60 autos),
 * así que mirando cuál da una posición y una bandera coherentes se sabe el formato.
 *
 * La grabación (sondeo-acr-<fecha>.jsonl) guarda cada muestra a 20 Hz con los dos
 * formatos y los bytes crudos de las tres páginas: alcanza para mapear campos nuevos
 * y para registrar el trazado del tramo sin volver a correrlo.
 */
import koffi from 'koffi'
import { writeFileSync, appendFileSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const RECORD = args.has('--grabar')
const ALL = args.has('--todas')

// ── Win32 ──────────────────────────────────────────────────────────────────

const k32 = koffi.load('kernel32.dll')
const ntdll = koffi.load('ntdll.dll')
const OpenFileMappingW = k32.func('void* __stdcall OpenFileMappingW(uint32_t access, int inherit, str16 name)')
const MapViewOfFile = k32.func('void* __stdcall MapViewOfFile(void* h, uint32_t access, uint32_t offHigh, uint32_t offLow, size_t bytes)')
const VirtualQuery = k32.func('size_t __stdcall VirtualQuery(void* addr, void* info, size_t len)')
// Los punteros de koffi son bigint; los Buffer se pasan como void* sin copiar
const RtlMoveMemory = k32.func('void __stdcall RtlMoveMemory(void* dst, void* src, size_t len)')
const ProcessIdToSessionId = k32.func('int __stdcall ProcessIdToSessionId(uint32_t pid, _Out_ uint32_t* session)')
const GetCurrentProcessId = k32.func('uint32_t __stdcall GetCurrentProcessId()')
const NtOpenDirectoryObject = ntdll.func('int32_t __stdcall NtOpenDirectoryObject(_Out_ void** handle, uint32_t access, void* attrs)')
const NtQueryDirectoryObject = ntdll.func(
  'int32_t __stdcall NtQueryDirectoryObject(void* handle, void* buf, uint32_t len, int single, int restart, _Inout_ uint32_t* ctx, _Out_ uint32_t* ret)',
)

/** Copia `len` bytes de una dirección a un Buffer nuevo. */
function peek(addr, len) {
  const b = Buffer.alloc(len)
  if (len) RtlMoveMemory(b, addr, len)
  return b
}

/** Nombres de las secciones (memorias compartidas) de la sesión de Windows actual. */
function listSections() {
  const sid = [0]
  ProcessIdToSessionId(GetCurrentProcessId(), sid)
  const dir = Buffer.from(['', 'Sessions', String(sid[0]), 'BaseNamedObjects'].join('\\'), 'utf16le')
  // UNICODE_STRING { u16 Length; u16 MaximumLength; (pad) ; void* Buffer } y OBJECT_ATTRIBUTES (48 bytes en x64)
  const us = Buffer.alloc(16)
  us.writeUInt16LE(dir.length, 0)
  us.writeUInt16LE(dir.length, 2)
  us.writeBigUInt64LE(BigInt(koffi.address(dir)), 8)
  const attrs = Buffer.alloc(48)
  attrs.writeUInt32LE(48, 0)
  attrs.writeBigUInt64LE(BigInt(koffi.address(us)), 16)
  attrs.writeUInt32LE(0x40, 24) // OBJ_CASE_INSENSITIVE
  const h = [null]
  if (NtOpenDirectoryObject(h, 0x1, attrs) !== 0) return null
  const out = []
  const buf = Buffer.alloc(1 << 16)
  const ctx = [0]
  const ret = [0]
  for (let restart = 1; ; restart = 0) {
    const st = NtQueryDirectoryObject(h[0], buf, buf.length, 0, restart, ctx, ret)
    if (st !== 0 && st !== 0x105) break // 0x105 = STATUS_MORE_ENTRIES
    // OBJECT_DIRECTORY_INFORMATION: { UNICODE_STRING Name; UNICODE_STRING TypeName } (32 bytes en x64)
    for (let off = 0; off + 32 <= buf.length; off += 32) {
      const nameLen = buf.readUInt16LE(off)
      const typeLen = buf.readUInt16LE(off + 16)
      if (!nameLen && !typeLen) break
      out.push({
        name: peek(buf.readBigUInt64LE(off + 8), nameLen).toString('utf16le'),
        type: peek(buf.readBigUInt64LE(off + 24), typeLen).toString('utf16le'),
      })
    }
    if (st !== 0x105) break
  }
  return out
}

function openPage(name) {
  const h = OpenFileMappingW(0x4, 0, name)
  if (!h) return null
  const base = MapViewOfFile(h, 0x4, 0, 0, 0)
  if (!base) return null
  // Tamaño real de la vista: RegionSize de MEMORY_BASIC_INFORMATION (offset 24 en x64)
  const mbi = Buffer.alloc(48)
  VirtualQuery(base, mbi, mbi.length)
  const size = Number(mbi.readBigUInt64LE(24))
  return { name, base, size, read: (len = size) => {
    const b = Buffer.alloc(Math.min(len, size))
    RtlMoveMemory(b, base, b.length)
    return b
  } }
}

// ── Formatos ───────────────────────────────────────────────────────────────

function layout(fields) {
  const out = {}
  let off = 0
  for (const [name, type] of fields) {
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(type)
    const count = m[2] ? Number(m[2]) : 1
    const size = m[1] === 'w' ? 2 * count : 4 * count
    off = Math.ceil(off / (m[1] === 'w' ? 2 : 4)) * (m[1] === 'w' ? 2 : 4)
    out[name] = { off, kind: m[1], count }
    off += size
  }
  return out
}

function decode(b, lay) {
  const o = {}
  for (const [name, f] of Object.entries(lay)) {
    if (f.off + (f.kind === 'w' ? 2 : 4) * f.count > b.length) continue
    if (f.kind === 'w') {
      const s = b.toString('utf16le', f.off, f.off + f.count * 2)
      o[name] = s.slice(0, Math.max(0, s.indexOf('\0') >= 0 ? s.indexOf('\0') : s.length)).trim()
    } else {
      const rd = (i) => (f.kind === 'f' ? b.readFloatLE(f.off + i * 4) : b.readInt32LE(f.off + i * 4))
      o[name] = f.count === 1 ? rd(0) : Array.from({ length: Math.min(f.count, 12) }, (_, i) => +rd(i).toFixed(3))
    }
  }
  return o
}

const PHYSICS = layout([
  ['packetId', 'i'], ['gas', 'f'], ['brake', 'f'], ['fuel', 'f'], ['gear', 'i'], ['rpms', 'i'], ['steerAngle', 'f'], ['speedKmh', 'f'],
  ['velocity', 'f[3]'], ['accG', 'f[3]'], ['wheelSlip', 'f[4]'], ['wheelLoad', 'f[4]'], ['wheelsPressure', 'f[4]'], ['wheelAngularSpeed', 'f[4]'],
  ['tyreWear', 'f[4]'], ['tyreDirtyLevel', 'f[4]'], ['tyreCoreTemperature', 'f[4]'], ['camberRAD', 'f[4]'], ['suspensionTravel', 'f[4]'],
  ['drs', 'f'], ['tc', 'f'], ['heading', 'f'], ['pitch', 'f'], ['roll', 'f'], ['cgHeight', 'f'], ['carDamage', 'f[5]'], ['numberOfTyresOut', 'i'],
  ['pitLimiterOn', 'i'], ['abs', 'f'], ['kersCharge', 'f'], ['kersInput', 'f'], ['autoShifterOn', 'i'], ['rideHeight', 'f[2]'], ['turboBoost', 'f'],
  ['ballast', 'f'], ['airDensity', 'f'], ['airTemp', 'f'], ['roadTemp', 'f'], ['localAngularVel', 'f[3]'], ['finalFF', 'f'], ['performanceMeter', 'f'],
  ['engineBrake', 'i'], ['ersRecoveryLevel', 'i'], ['ersPowerLevel', 'i'], ['ersHeatCharging', 'i'], ['ersIsCharging', 'i'], ['kersCurrentKJ', 'f'],
  ['drsAvailable', 'i'], ['drsEnabled', 'i'], ['brakeTemp', 'f[4]'], ['clutch', 'f'], ['tyreTempI', 'f[4]'], ['tyreTempM', 'f[4]'], ['tyreTempO', 'f[4]'],
  ['isAIControlled', 'i'], ['tyreContactPoint', 'f[12]'], ['tyreContactNormal', 'f[12]'], ['tyreContactHeading', 'f[12]'], ['brakeBias', 'f'], ['localVelocity', 'f[3]'],
])

const GRAPHICS_HEAD = [
  ['packetId', 'i'], ['status', 'i'], ['session', 'i'], ['currentTime', 'w[15]'], ['lastTime', 'w[15]'], ['bestTime', 'w[15]'], ['split', 'w[15]'],
  ['completedLaps', 'i'], ['position', 'i'], ['iCurrentTime', 'i'], ['iLastTime', 'i'], ['iBestTime', 'i'], ['sessionTimeLeft', 'f'],
  ['distanceTraveled', 'f'], ['isInPit', 'i'], ['currentSectorIndex', 'i'], ['lastSectorTime', 'i'], ['numberOfLaps', 'i'], ['tyreCompound', 'w[33]'],
  ['replayTimeMultiplier', 'f'], ['normalizedCarPosition', 'f'],
]
const GRAPHICS_AC1 = layout([
  ...GRAPHICS_HEAD,
  ['carCoordinates', 'f[3]'], ['penaltyTime', 'f'], ['flag', 'i'], ['idealLineOn', 'i'], ['isInPitLane', 'i'], ['surfaceGrip', 'f'],
])
const GRAPHICS_ACC = layout([
  ...GRAPHICS_HEAD,
  ['activeCars', 'i'], ['carCoordinates', 'f[180]'], ['carID', 'i[60]'], ['playerCarID', 'i'], ['penaltyTime', 'f'], ['flag', 'i'], ['penalty', 'i'],
  ['idealLineOn', 'i'], ['isInPitLane', 'i'], ['surfaceGrip', 'f'], ['mandatoryPitDone', 'i'], ['windSpeed', 'f'], ['windDirection', 'f'],
  ['isSetupMenuVisible', 'i'], ['mainDisplayIndex', 'i'], ['secondaryDisplayIndex', 'i'], ['TC', 'i'], ['TCCut', 'i'], ['EngineMap', 'i'], ['ABS', 'i'],
  ['fuelXLap', 'f'], ['rainLights', 'i'], ['flashingLights', 'i'], ['lightsStage', 'i'], ['exhaustTemperature', 'f'], ['wiperLV', 'i'],
  ['DriverStintTotalTimeLeft', 'i'], ['DriverStintTimeLeft', 'i'], ['rainTyres', 'i'], ['sessionIndex', 'i'], ['usedFuel', 'f'],
  ['deltaLapTime', 'w[15]'], ['iDeltaLapTime', 'i'], ['estimatedLapTime', 'w[15]'], ['iEstimatedLapTime', 'i'], ['isDeltaPositive', 'i'],
  ['iSplit', 'i'], ['isValidLap', 'i'], ['fuelEstimatedLaps', 'f'], ['trackStatus', 'w[33]'], ['missingMandatoryPits', 'i'], ['Clock', 'f'],
])
const STATIC = layout([
  ['smVersion', 'w[15]'], ['acVersion', 'w[15]'], ['numberOfSessions', 'i'], ['numCars', 'i'], ['carModel', 'w[33]'], ['track', 'w[33]'],
  ['playerName', 'w[33]'], ['playerSurname', 'w[33]'], ['playerNick', 'w[33]'], ['sectorCount', 'i'], ['maxTorque', 'f'], ['maxPower', 'f'],
  ['maxRpm', 'i'], ['maxFuel', 'f'], ['suspensionMaxTravel', 'f[4]'], ['tyreRadius', 'f[4]'], ['maxTurboBoost', 'f'], ['deprecated1', 'f'],
  ['deprecated2', 'f'], ['penaltiesEnabled', 'i'], ['aidFuelRate', 'f'], ['aidTireRate', 'f'], ['aidMechanicalDamage', 'f'],
  ['aidAllowTyreBlankets', 'i'], ['aidStability', 'f'], ['aidAutoClutch', 'i'], ['aidAutoBlip', 'i'], ['hasDRS', 'i'], ['hasERS', 'i'],
  ['hasKERS', 'i'], ['kersMaxJ', 'f'], ['engineBrakeSettingsCount', 'i'], ['ersPowerControllerCount', 'i'], ['trackSPlineLength', 'f'],
  ['trackConfiguration', 'w[33]'],
])

// ── Sondeo ─────────────────────────────────────────────────────────────────

const sections = listSections()
if (!sections) console.log('No se pudo listar las memorias compartidas (sigo con los nombres conocidos).')
else {
  const shown = sections.filter((s) => s.type === 'Section' && (ALL || /pmf|acr|assetto|kunos|telemetry|evo|rally/i.test(s.name)))
  console.log(`Memorias compartidas${ALL ? '' : ' que parecen de Kunos'}: ${shown.length ? '' : 'ninguna'}`)
  for (const s of shown) console.log(`  Local\\${s.name}`)
}

const names = ['physics', 'graphics', 'static']
const pages = Object.fromEntries(names.map((n) => [n, openPage(`Local\\acpmf_${n}`)]))
const missing = names.filter((n) => !pages[n])
if (missing.length) {
  console.log(`\nNo están las páginas acpmf_${missing.join(', acpmf_')}. ¿Está el juego abierto y el auto en pista?`)
  process.exit(1)
}
for (const n of names) console.log(`acpmf_${n}: ${pages[n].size} bytes`)

const st = decode(pages.static.read(), STATIC)
console.log('\nStatic:', JSON.stringify(st, null, 1))

const file = RECORD ? `sondeo-acr-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl` : null
if (file) {
  writeFileSync(file, JSON.stringify({ kind: 'static', sizes: Object.fromEntries(names.map((n) => [n, pages[n].size])), static: st, raw: pages.static.read().toString('base64') }) + '\n')
  console.log(`\nGrabando en ${file} (Ctrl+C para cortar)…`)
}

const t0 = Date.now()
let lastPrint = 0
const timer = setInterval(() => {
  const now = Date.now()
  const pb = pages.physics.read()
  const gb = pages.graphics.read()
  const ph = decode(pb, PHYSICS)
  const ac1 = decode(gb, GRAPHICS_AC1)
  const acc = decode(gb, GRAPHICS_ACC)
  if (file) appendFileSync(file, JSON.stringify({ t: now - t0, physics: ph, ac1, acc, rawPhysics: pb.toString('base64'), rawGraphics: gb.toString('base64') }) + '\n')
  if (now - lastPrint >= 500) {
    lastPrint = now
    console.log(
      `\n[${((now - t0) / 1000).toFixed(1)} s] physics #${ph.packetId} · ${ph.speedKmh?.toFixed(1)} km/h · ${ph.rpms} rpm · marcha ${ph.gear} · gas ${ph.gas?.toFixed(2)} · freno ${ph.brake?.toFixed(2)} · rumbo ${ph.heading?.toFixed(2)}`,
    )
    console.log(`  graphics #${ac1.packetId} · status ${ac1.status} · sesión ${ac1.session} · vuelta ${ac1.currentTime} (${ac1.iCurrentTime} ms) · pos. en el tramo ${ac1.normalizedCarPosition?.toFixed(4)} · recorrido ${ac1.distanceTraveled?.toFixed(0)} m`)
    console.log(`  como AC1: coords ${JSON.stringify(ac1.carCoordinates)} · bandera ${ac1.flag} · boxes ${ac1.isInPitLane} · grip ${ac1.surfaceGrip?.toFixed(3)}`)
    console.log(`  como ACC: autos ${acc.activeCars} · coords ${JSON.stringify(acc.carCoordinates?.slice(0, 3))} · id ${acc.playerCarID} · bandera ${acc.flag} · grip ${acc.surfaceGrip?.toFixed(3)} · válida ${acc.isValidLap} · delta ${acc.deltaLapTime} · reloj ${acc.Clock?.toFixed(0)}`)
  }
  if (!file && now - t0 > 10_000) {
    clearInterval(timer)
    console.log('\nListo. Para grabar una pasada entera: node scripts/sondeo-acr.mjs --grabar')
  }
}, 50)

process.on('SIGINT', () => {
  clearInterval(timer)
  if (file) console.log(`\nGrabación guardada en ${file}`)
  process.exit(0)
})
