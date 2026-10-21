/**
 * Session info de iRacing: un YAML embebido en la memoria compartida y en el .ibt
 * con la pista, el auto, los pilotos y el setup.
 *
 * No siempre es YAML válido: los nombres de pilotos y equipos van sin comillas y
 * pueden traer `:`, `#` o comillas. Se entrecomillan antes de parsear (lo mismo
 * que hace pyirsdk).
 */
import { parse } from 'yaml'
import type { Conditions, SetupGroup } from '@shared/analysis'
import type { SessionMeta, SimId } from '@shared/live'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SessionInfo = Record<string, any>

const FREE_TEXT_KEYS = /^(\s*(?:- )?)(DriverSetupName|UserName|TeamName|AbbrevName|Initials|CarDesignStr|HelmetDesignStr|SuitDesignStr|CarNumber|ClubName|DivisionName|CarScreenName|CarScreenNameShort|CarClassShortName|TrackDisplayName|TrackDisplayShortName|TrackConfigName|TrackCity|TrackCountry|SeriesName|SessionName|EventType|Category): (.*)$/

export function sanitizeYaml(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const m = FREE_TEXT_KEYS.exec(line)
      if (!m) return line
      const value = m[3].replace(/\r$/, '')
      if (value.startsWith('"') && value.endsWith('"') && value.length > 1) return line
      return `${m[1]}${m[2]}: "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    })
    .join('\n')
}

function infoText(raw: Buffer): string {
  const end = raw.indexOf(0)
  return raw.toString('latin1', 0, end >= 0 ? end : raw.length)
}

/** Lo que cambia cada pocos segundos en carrera y en vivo no se usa: resultados, incidentes, setup, cámaras y radio. */
const VOLATILE = /^(\s*)(?:- )?(Results\w*|QualifyResultsInfo|CarSetup|CameraInfo|RadioInfo|\w*IncidentCount):/

/**
 * Session info sin las partes volátiles. iRacing la reescribe seguido en carrera
 * y parsear el YAML entero frena la lectura a 60 Hz (cortes en la tablet): si
 * esto no cambió, no hace falta volver a parsear.
 */
export function liveInfoText(raw: Buffer): string {
  const lines = infoText(raw).split('\n')
  const out: string[] = []
  let skip = -1
  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    if (skip >= 0) {
      // Dentro del bloque: más indentado, o un ítem de lista al mismo nivel
      if (indent > skip || (indent === skip && line.trimStart().startsWith('- ')) || !line.trim()) continue
      skip = -1
    }
    const m = VOLATILE.exec(line)
    if (m) {
      // Escalar (Results...: 3) o bloque (ResultsPositions:)
      if (/:\s*$/.test(line)) skip = m[1].length
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

export function parseSessionInfo(raw: Buffer | string): SessionInfo {
  const text = typeof raw === 'string' ? raw : infoText(raw)
  try {
    return (parse(sanitizeYaml(text), { uniqueKeys: false, strict: false }) as SessionInfo) ?? {}
  } catch {
    return {}
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /^\s*([+-]?\d+(?:[.,]\d+)?)/.exec(v)
  return m ? Number(m[1].replace(',', '.')) : null
}

export function playerDriver(info: SessionInfo): Record<string, any> | null {
  const di = info.DriverInfo ?? {}
  const drivers: any[] = Array.isArray(di.Drivers) ? di.Drivers : []
  const idx = di.DriverCarIdx
  return (
    drivers.find((d) => d?.CarIdx === idx) ??
    drivers.find((d) => d && String(d.CarIsPaceCar) !== '1' && String(d.IsSpectator) !== '1') ??
    null
  )
}

export function sessionTypeOf(info: SessionInfo, sessionNum: number | null): string {
  const sessions: any[] = info.SessionInfo?.Sessions ?? []
  const s = sessions.find((x) => x?.SessionNum === sessionNum) ?? sessions[sessions.length - 1]
  return String(s?.SessionType ?? s?.SessionName ?? 'Sesión')
}

/** Inscripción a la que pertenece la sesión: práctica, qualy y carrera comparten SubSessionID. */
export function eventIdOf(info: SessionInfo): string | null {
  const w = info.WeekendInfo ?? {}
  const sub = num(w.SubSessionID)
  if (sub && sub > 0) return `iracing/${sub}`
  const id = num(w.SessionID)
  return id && id > 0 ? `iracing/s${id}` : null
}

export function trackName(info: SessionInfo): string {
  const w = info.WeekendInfo ?? {}
  const disp = String(w.TrackDisplayName ?? w.TrackName ?? 'Pista')
  const cfg = w.TrackConfigName ? String(w.TrackConfigName) : ''
  return cfg && !disp.toLowerCase().includes(cfg.toLowerCase()) ? `${disp} ${cfg}` : disp
}

/** Inicio de cada sector según iRacing (SplitTimeInfo), o null si no viene. */
export function sectorsOf(info: SessionInfo): number[] | null {
  const sectors: any[] = info.SplitTimeInfo?.Sectors ?? []
  const pcts = sectors
    .map((x) => num(x?.SectorStartPct))
    .filter((x): x is number => x !== null && x >= 0 && x < 1)
    .sort((a, b) => a - b)
  if (pcts.length < 2 || pcts[0] !== 0) return null
  return pcts
}

export function metaFromSessionInfo(info: SessionInfo, sim: SimId, sessionNum: number | null): SessionMeta {
  const w = info.WeekendInfo ?? {}
  const di = info.DriverInfo ?? {}
  const me = playerDriver(info)
  const km = num(w.TrackLength)
  const fuelMax = num(di.DriverCarFuelMaxLtr)
  const fuelPct = num(di.DriverCarMaxFuelPct)
  return {
    sim,
    car: String(me?.CarScreenName ?? me?.CarPath ?? 'Auto'),
    track: trackName(info),
    trackId: w.TrackID !== undefined ? `iracing/${w.TrackID}` : null,
    trackSlug: w.TrackName ? String(w.TrackName).toLowerCase() : null,
    trackLengthM: km !== null ? km * 1000 : null,
    sectorsPct: sectorsOf(info),
    driver: me?.UserName ? String(me.UserName) : null,
    sessionType: sessionTypeOf(info, sessionNum),
    firstRpm: num(di.DriverCarSLFirstRPM),
    shiftRpm: num(di.DriverCarSLShiftRPM),
    blinkRpm: num(di.DriverCarSLBlinkRPM),
    maxRpm: num(di.DriverCarRedLine),
    fuelMaxL: fuelMax !== null ? fuelMax * (fuelPct ?? 1) : null,
  }
}

/** "iracing/{CarID}" del auto del piloto. */
export function carIdOf(info: SessionInfo): string | null {
  const id = playerDriver(info)?.CarID
  return id !== undefined && id !== null ? `iracing/${id}` : null
}

const SETUP_NAMES: Record<string, string> = {
  Tires: 'Neumáticos',
  TiresAero: 'Neumáticos y aero',
  Chassis: 'Chasis',
  Suspension: 'Suspensión',
  Dampers: 'Amortiguadores',
  BrakesDriveUnit: 'Frenos y transmisión',
  Drivetrain: 'Transmisión',
  Brakes: 'Frenos',
  Aero: 'Aero',
  AeroBalanceCalc: 'Balance aerodinámico',
  InCarDials: 'Ajustes en el auto',
  Systems: 'Sistemas',
  Front: 'Delantero',
  Rear: 'Trasero',
  LeftFront: 'Delantera izquierda',
  RightFront: 'Delantera derecha',
  LeftRear: 'Trasera izquierda',
  RightRear: 'Trasera derecha',
  FrontBrakes: 'Frenos',
  RearDiff: 'Diferencial',
  Differential: 'Diferencial',
  GearRatios: 'Relaciones',
  Fuel: 'Combustible',
  General: 'General',
}

/** "LastHotPressure" → "Last hot pressure" (los valores quedan como en el garage de iRacing). */
function prettyKey(k: string): string {
  if (SETUP_NAMES[k]) return SETUP_NAMES[k]
  const s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/\b(lf|rf|lr|rr|abs|tc|arb|omi|imo)\b/g, (m) => m.toUpperCase())
}

function leaves(v: any, prefix: string, out: [string, string][]): void {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) leaves(x, prefix ? `${prefix} · ${prettyKey(k)}` : prettyKey(k), out)
  } else if (v !== null && v !== undefined && String(v).trim() !== '') out.push([prefix, String(v).trim()])
}

/** Setup del auto (CarSetup) agrupado por sección y parte. */
export function setupOf(info: SessionInfo): SetupGroup[] | null {
  const cs = info.CarSetup
  if (!cs || typeof cs !== 'object') return null
  const groups: SetupGroup[] = []
  for (const [section, body] of Object.entries(cs)) {
    if (section === 'UpdateCount' || !body || typeof body !== 'object') continue
    const parts: { name: string; values: [string, string][] }[] = []
    const loose: [string, string][] = []
    for (const [k, v] of Object.entries(body as Record<string, any>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const values: [string, string][] = []
        leaves(v, '', values)
        if (values.length) parts.push({ name: prettyKey(k), values })
      } else leaves(v, prettyKey(k), loose)
    }
    if (loose.length) parts.unshift({ name: 'General', values: loose })
    if (parts.length) groups.push({ name: prettyKey(section), parts })
  }
  return groups.length ? groups : null
}

const SKIES: Record<string, string> = {
  clear: 'Despejado',
  'partly cloudy': 'Parcialmente nublado',
  'mostly cloudy': 'Mayormente nublado',
  overcast: 'Cubierto',
  dynamic: 'Dinámico',
}

/** Clima de la sesión (WeekendInfo). */
export function conditionsOf(info: SessionInfo): Conditions | null {
  const w = info.WeekendInfo
  if (!w) return null
  const wind = num(w.TrackWindVel)
  const precip = num(w.TrackPrecipitation)
  const skies = w.TrackSkies ? String(w.TrackSkies) : null
  return {
    airC: num(w.TrackAirTemp),
    trackC: num(w.TrackSurfaceTemp),
    skies: skies ? (SKIES[skies.toLowerCase()] ?? skies) : null,
    wind: wind !== null ? `${Math.round(wind * 3.6)} km/h` : null,
    humidityPct: num(w.TrackRelativeHumidity),
    wetness: precip !== null && precip > 0 ? `Lluvia ${Math.round(precip)} %` : null,
  }
}
