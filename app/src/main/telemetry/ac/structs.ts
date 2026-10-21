/**
 * Memoria compartida de Assetto Corsa (AC1): tres páginas que publica el propio
 * juego, sin apps instaladas. Estructuras C con `#pragma pack(4)` según la
 * documentación oficial (ACSharedMemoryDocumentation) y sim_info.py.
 *
 * Solo se declaran los campos hasta donde la estructura es estable entre
 * versiones de AC1; los campos agregados al final por versiones nuevas no se usan.
 */

type FieldType = 'i32' | 'f32' | `f32[${number}]` | `i32[${number}]` | `wchar[${number}]`

export interface Field {
  offset: number
  type: FieldType
  count: number
}

export type Layout<K extends string> = Record<K, Field> & { readonly size: number }

function sizeOf(t: FieldType): { size: number; align: number; count: number } {
  const m = /^(\w+)(?:\[(\d+)\])?$/.exec(t)!
  const count = m[2] ? Number(m[2]) : 1
  if (m[1] === 'wchar') return { size: 2 * count, align: 2, count }
  return { size: 4 * count, align: 4, count }
}

function layout<K extends string>(fields: [K, FieldType][]): Layout<K> {
  const out = {} as Record<K, Field>
  let off = 0
  for (const [name, type] of fields) {
    const { size, align, count } = sizeOf(type)
    off = Math.ceil(off / align) * align
    out[name] = { offset: off, type, count }
    off += size
  }
  return Object.assign(out, { size: Math.ceil(off / 4) * 4 })
}

export const PHYSICS = layout([
  ['packetId', 'i32'],
  ['gas', 'f32'],
  ['brake', 'f32'],
  ['fuel', 'f32'],
  ['gear', 'i32'],
  ['rpms', 'i32'],
  ['steerAngle', 'f32'],
  ['speedKmh', 'f32'],
  ['velocity', 'f32[3]'],
  ['accG', 'f32[3]'],
  ['wheelSlip', 'f32[4]'],
  ['wheelLoad', 'f32[4]'],
  ['wheelsPressure', 'f32[4]'],
  ['wheelAngularSpeed', 'f32[4]'],
  ['tyreWear', 'f32[4]'],
  ['tyreDirtyLevel', 'f32[4]'],
  ['tyreCoreTemperature', 'f32[4]'],
  ['camberRAD', 'f32[4]'],
  ['suspensionTravel', 'f32[4]'],
  ['drs', 'f32'],
  ['tc', 'f32'],
  ['heading', 'f32'],
  ['pitch', 'f32'],
  ['roll', 'f32'],
  ['cgHeight', 'f32'],
  ['carDamage', 'f32[5]'],
  ['numberOfTyresOut', 'i32'],
  ['pitLimiterOn', 'i32'],
  ['abs', 'f32'],
  ['kersCharge', 'f32'],
  ['kersInput', 'f32'],
  ['autoShifterOn', 'i32'],
  ['rideHeight', 'f32[2]'],
  ['turboBoost', 'f32'],
  ['ballast', 'f32'],
  ['airDensity', 'f32'],
  ['airTemp', 'f32'],
  ['roadTemp', 'f32'],
  ['localAngularVel', 'f32[3]'],
  ['finalFF', 'f32'],
  ['performanceMeter', 'f32'],
  ['engineBrake', 'i32'],
  ['ersRecoveryLevel', 'i32'],
  ['ersPowerLevel', 'i32'],
  ['ersHeatCharging', 'i32'],
  ['ersIsCharging', 'i32'],
  ['kersCurrentKJ', 'f32'],
  ['drsAvailable', 'i32'],
  ['drsEnabled', 'i32'],
  ['brakeTemp', 'f32[4]'],
  ['clutch', 'f32'],
  ['tyreTempI', 'f32[4]'],
  ['tyreTempM', 'f32[4]'],
  ['tyreTempO', 'f32[4]'],
  ['isAIControlled', 'i32'],
  ['tyreContactPoint', 'f32[12]'],
  ['tyreContactNormal', 'f32[12]'],
  ['tyreContactHeading', 'f32[12]'],
  ['brakeBias', 'f32'],
  ['localVelocity', 'f32[3]'],
])

export const GRAPHICS = layout([
  ['packetId', 'i32'],
  ['status', 'i32'],
  ['session', 'i32'],
  ['currentTime', 'wchar[15]'],
  ['lastTime', 'wchar[15]'],
  ['bestTime', 'wchar[15]'],
  ['split', 'wchar[15]'],
  ['completedLaps', 'i32'],
  ['position', 'i32'],
  ['iCurrentTime', 'i32'],
  ['iLastTime', 'i32'],
  ['iBestTime', 'i32'],
  ['sessionTimeLeft', 'f32'],
  ['distanceTraveled', 'f32'],
  ['isInPit', 'i32'],
  ['currentSectorIndex', 'i32'],
  ['lastSectorTime', 'i32'],
  ['numberOfLaps', 'i32'],
  ['tyreCompound', 'wchar[33]'],
  ['replayTimeMultiplier', 'f32'],
  ['normalizedCarPosition', 'f32'],
  ['carCoordinates', 'f32[3]'],
  ['penaltyTime', 'f32'],
  ['flag', 'i32'],
  ['idealLineOn', 'i32'],
  ['isInPitLane', 'i32'],
  ['surfaceGrip', 'f32'],
])

export const STATIC = layout([
  ['smVersion', 'wchar[15]'],
  ['acVersion', 'wchar[15]'],
  ['numberOfSessions', 'i32'],
  ['numCars', 'i32'],
  ['carModel', 'wchar[33]'],
  ['track', 'wchar[33]'],
  ['playerName', 'wchar[33]'],
  ['playerSurname', 'wchar[33]'],
  ['playerNick', 'wchar[33]'],
  ['sectorCount', 'i32'],
  ['maxTorque', 'f32'],
  ['maxPower', 'f32'],
  ['maxRpm', 'i32'],
  ['maxFuel', 'f32'],
  ['suspensionMaxTravel', 'f32[4]'],
  ['tyreRadius', 'f32[4]'],
  ['maxTurboBoost', 'f32'],
  ['deprecated1', 'f32'],
  ['deprecated2', 'f32'],
  ['penaltiesEnabled', 'i32'],
  ['aidFuelRate', 'f32'],
  ['aidTireRate', 'f32'],
  ['aidMechanicalDamage', 'f32'],
  ['aidAllowTyreBlankets', 'i32'],
  ['aidStability', 'f32'],
  ['aidAutoClutch', 'i32'],
  ['aidAutoBlip', 'i32'],
  ['hasDRS', 'i32'],
  ['hasERS', 'i32'],
  ['hasKERS', 'i32'],
  ['kersMaxJ', 'f32'],
  ['engineBrakeSettingsCount', 'i32'],
  ['ersPowerControllerCount', 'i32'],
  ['trackSPlineLength', 'f32'],
  ['trackConfiguration', 'wchar[33]'],
])

export const AC_STATUS = { off: 0, replay: 1, live: 2, pause: 3 } as const
export const AC_SESSION = ['Práctica', 'Clasificación', 'Carrera', 'Hotlap', 'Time attack', 'Drift', 'Drag'] as const
export const AC_FLAG = { none: 0, blue: 1, yellow: 2, black: 3, white: 4, checkered: 5, penalty: 6 } as const

export function f32(b: Buffer, f: Field, i = 0): number {
  return b.readFloatLE(f.offset + i * 4)
}

export function i32(b: Buffer, f: Field, i = 0): number {
  return b.readInt32LE(f.offset + i * 4)
}

export function wstr(b: Buffer, f: Field): string {
  const s = b.toString('utf16le', f.offset, f.offset + f.count * 2)
  const end = s.indexOf('\0')
  return (end >= 0 ? s.slice(0, end) : s).trim()
}
