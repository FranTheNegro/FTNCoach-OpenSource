/** Contrato entre el proceso principal y la app de escritorio (window.ftn). */
import type { CoachKeyId, CoachProvider, CoachState, CompareResult, DriverStyle, LibraryState, SessionDetail, TrackMapResult } from './analysis'
import type { EngineStatus, SessionMeta } from './live'


export type VideoCam = 'onboard' | 'top'

/** Video de una cámara de la sesión y su sincronización con la telemetría. */
export interface VideoSource {
  path: string
  name: string
  /** Para el reproductor (protocolo propio, solo sirve el archivo elegido). */
  url: string
  missing: boolean
  /** "La vuelta (índice) empieza en el segundo videoS del video". */
  anchor: { lap: number; videoS: number } | null
}

export type VideoConfig = Partial<Record<VideoCam, VideoSource>>

export type Units = 'metric' | 'imperial'

export interface Settings {
  lan: {
    /** Dashboards desde otros dispositivos de la red (tablet, celular). */
    exposed: boolean
    port: number
    /** Frames por segundo hacia los dashboards. */
    hz: number
  }
  units: Units
  app: {
    /** Cerrar la ventana deja FTN Coach en la bandeja (la tablet sigue andando). */
    closeToTray: boolean
    /** Arrancar con Windows, directo en la bandeja. */
    startWithWindows: boolean
  }
  paths: {
    iracingTelemetry: string
    /** Grabaciones propias (Assetto Corsa). */
    recordings: string
  }
  recording: {
    /** Grabar las sesiones de AC (no guarda telemetría por su cuenta). */
    ac: boolean
    /** Grabar también iRacing (normalmente no hace falta: iRacing guarda sus .ibt). */
    iracing: boolean
  }
  coach: {
    provider: CoachProvider
    /** Modelo elegido para cada proveedor. */
    models: Record<CoachProvider, string>
  }
  /** Quién maneja: lo usa el coach como contexto y se muestra en Perfil. */
  profile: {
    name: string
    /** 0 = sin cargar. */
    experienceYears: number
    discipline: string
    about: string
    goals: string
  }
}

export interface AcAppStatus {
  acFound: boolean
  root: string | null
  /** Custom Shaders Patch instalado (las apps Lua lo necesitan). */
  csp: boolean
  /** Versión instalada en AC, o null. */
  installed: string | null
  /** Versión que trae esta versión de FTN Coach. */
  bundled: string | null
}

export interface LanState {
  running: boolean
  exposed: boolean
  port: number
  urls: string[]
  localUrl: string
  clients: number
  error: string | null
  /** QR (data URL) de la primera URL de la red. */
  qr: string | null
}

export interface LiveState {
  status: EngineStatus
  meta: SessionMeta | null
  /** Archivo que se está reproduciendo en modo demo. */
  demo: string | null
}

export interface FtnApi {
  version: string
  live(): Promise<LiveState>
  onLive(cb: (s: LiveState) => void): () => void
  lan(): Promise<LanState>
  settings(): Promise<Settings>
  saveSettings(patch: DeepPartial<Settings>): Promise<Settings>
  /** Elige un .ibt y lo reproduce como si fuera en vivo. Devuelve el archivo o null si se canceló. */
  startDemo(): Promise<string | null>
  stopDemo(): Promise<void>
  pickFolder(current: string): Promise<string | null>
  openExternal(url: string): Promise<void>
  showFile(path: string): Promise<void>

  library(): Promise<LibraryState>
  onLibrary(cb: (s: LibraryState) => void): () => void
  rescan(): Promise<void>
  sessionDetail(id: string): Promise<SessionDetail>
  /** Avance al abrir una sesión que hay que bajar antes de analizarla. */
  onSessionProgress(cb: (p: { id: string; text: string }) => void): () => void
  /** Rasgos de manejo promediados de las sesiones que abriste. */
  driverStyle(): Promise<DriverStyle | null>
  compareLaps(id: string, a: number, b: number): Promise<CompareResult>
  trackMap(trackId: string, slug: string | null): Promise<TrackMapResult>

  coachState(id: string): Promise<CoachState>
  coachAnalyze(id: string, lap: number | null): Promise<CoachState>
  coachAsk(id: string, question: string): Promise<CoachState>
  coachClear(id: string): Promise<CoachState>
  onCoach(cb: (s: CoachState) => void): () => void
  hasCoachKey(key: CoachKeyId): Promise<boolean>
  setCoachKey(key: CoachKeyId, value: string | null): Promise<boolean>
  /** Versión de Claude Code instalada (null si no está). */
  claudeCodeVersion(): Promise<string | null>

  acApp(): Promise<AcAppStatus>
  installAcApp(): Promise<AcAppStatus>

  videoConfig(sessionId: string): Promise<VideoConfig>
  /** Elige el archivo de una cámara (null si se canceló). */
  videoPick(sessionId: string, cam: VideoCam): Promise<VideoConfig | null>
  videoSync(sessionId: string, cam: VideoCam, anchor: { lap: number; videoS: number } | null): Promise<VideoConfig>
  videoRemove(sessionId: string, cam: VideoCam): Promise<VideoConfig>

}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
