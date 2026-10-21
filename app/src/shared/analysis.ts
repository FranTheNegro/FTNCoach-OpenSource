/**
 * Análisis de sesiones grabadas: biblioteca, vueltas, sectores, curvas y mapa.
 * Lo calcula el hilo de análisis (proceso principal) y lo muestra la app.
 */
import type { LapKind } from './live'

/** ibt: telemetría de iRacing; rec: grabación propia de FTN Coach. */
export type SessionSource = 'ibt' | 'rec'

/** La telemetría de la sesión está en esta PC (no hay que bajarla de ningún lado). */
export function isLocal(s: { source: SessionSource }): boolean {
  return s.source === 'ibt' || s.source === 'rec'
}

export interface SessionSummary {
  /** Estable por archivo (hash de la ruta). */
  id: string
  path: string
  source: SessionSource
  sim: 'iracing' | 'ac'
  car: string
  /** iRacing: "iracing/{CarID}" (sesiones viejas en caché pueden no tenerlo). */
  carId?: string | null
  track: string
  trackId: string | null
  trackLengthM: number | null
  sessionType: string
  driver: string | null
  /** ms epoch del inicio. */
  startedAt: number
  durationS: number
  laps: number
  validLaps: number
  bestLapS: number | null
  /** Hay posición en el mundo (GPS en iRacing, x/z en AC) para dibujar la trazada. */
  hasPosition: boolean
  /** Mejores sectores de la sesión, para la ideal histórica (sin dato en cachés viejas). */
  sectors?: SessionSectors | null
  /**
   * Evento al que pertenece (práctica, qualy, warmup y carrera de una misma
   * inscripción). iRacing: "iracing/{SubSessionID}". null = se agrupa por cercanía.
   */
  eventId?: string | null
}

export interface SessionSectors {
  /** Dónde empieza cada sector (fracción de la vuelta). */
  pct: number[]
  /** Mejor tiempo de cada sector en las vueltas válidas (null si ninguna lo cubre). */
  bestS: (number | null)[]
}

export interface LapInfo {
  /** Índice dentro de la sesión (0..n-1); `lap` es el número que da el sim. */
  index: number
  lap: number
  timeS: number
  /** Segundos desde el inicio de la grabación hasta que empezó la vuelta (para el video). */
  startS: number
  kind: LapKind
  reason: string | null
  fuelUsedL: number | null
  /** Tiempo de cada sector (null si la vuelta no lo cubre entero). */
  sectorsS: (number | null)[]
  /** Cuántos segundos más lenta que la mejor (null si no hay mejor o la vuelta está cortada). */
  gapS: number | null
  maxSpeedKmh: number
  /** Cubre la vuelta entera (las cortadas por reset o remolque no). */
  complete: boolean
  /** Sesión del evento en la que se dio (cuando el archivo trae más de una). */
  session: string | null
}

export interface Corner {
  id: number
  /** "T4" o el número oficial del mapa. */
  label: string
  /** Nombre oficial ("Foster's") si el mapa lo trae. */
  name: string | null
  /** Tramo de la curva (desde el final de la recta anterior hasta la siguiente). */
  startPct: number
  apexPct: number
  endPct: number
}

/** Cómo pasó una vuelta por una curva. Distancias en m desde el inicio de la vuelta. */
export interface CornerPass {
  timeS: number
  entryKmh: number
  minKmh: number
  exitKmh: number
  /** Donde empieza la frenada (null si pasó sin frenar). */
  brakeM: number | null
  /** Donde vuelve a fondo (null si no llega a fondo en la curva). */
  fullThrottleM: number | null
  /** Donde mínima la velocidad. */
  minM: number
  offTrack: boolean
}

export interface Insight {
  cornerId: number
  /** "T7 · FRENADA" */
  title: string
  /** Segundos que se pierden contra la referencia (positivo). */
  lossS: number
  text: string
}

export type Point = [number, number]

/**
 * Geometría fija del trazado en metros, x a la derecha e y hacia abajo (como en
 * pantalla). Nunca sale de la telemetría del piloto.
 */
export interface TrackGeometry {
  /** iracing: dibujo oficial registrado al GPS. ac: líneas y bordes del propio juego. */
  source: 'iracing' | 'ac'
  /** Contornos del asfalto (relleno nonzero). */
  asphalt: Point[][]
  /** Formas de la línea de largada (dibujo oficial) o el segmento que la marca. */
  startFinish: Point[][]
  /** Números y nombres de curva del mapa oficial. */
  labels: { text: string; x: number; y: number; turn: number | null }[]
  widthM: number | null
  widthNote: string
  /** Posición típica en cada punto de la vuelta (para ubicar el auto con lapPct). */
  pctLine: Point[] | null
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface TrackMapResult {
  map: TrackGeometry | null
  /** Por qué no hay mapa, o de dónde sale. */
  note: string
}

/** Canales de una vuelta remuestreados sobre la grilla de distancia de la sesión. */
export interface LapTrace {
  index: number
  timeS: number[]
  speed: number[]
  throttle: number[]
  brake: number[]
  steer: number[]
  gear: number[]
  rpm: number[]
  gLat: number[]
  gLon: number[]
  off: number[]
  /** Trazada en el marco del mapa (null sin posición). */
  x: number[] | null
  y: number[] | null
}

export interface SessionDetail {
  summary: SessionSummary
  trackLengthM: number
  /** Grilla de distancia común a todas las vueltas (m). */
  distM: number[]
  sectorsPct: number[]
  laps: LapInfo[]
  bestIndex: number | null
  /** Suma de los mejores sectores de las vueltas válidas. */
  theoreticalS: number | null
  /** Desvío estándar de las vueltas válidas (sin las muy lentas). */
  consistencyS: number | null
  corners: Corner[]
  /** passes[lapIndex][cornerIndex] */
  passes: (CornerPass | null)[][]
  map: TrackMapResult
  /** Setup del auto tal como lo guarda iRacing (null en AC). */
  setup: SetupGroup[] | null
  conditions: Conditions | null
  /** Rasgos de manejo medidos en esta sesión (null si no hay vueltas válidas completas). */
  style: StyleSample | null
}

/** Métricas de estilo de una sesión, en 0..1 salvo gripPct (0..100). */
export interface StyleSample {
  laps: number
  /** Presión máxima promedio en cada frenada. */
  brakePeak: number | null
  /** Parte de la frenada que se hace girando (trail-braking). */
  trailRatio: number | null
  /** 1 = el acelerador solo sube del vértice hasta el fondo. */
  throttleSmooth: number | null
  consistency: number | null
  /** g combinada en curva contra la máxima de la sesión. */
  gripPct: number | null
}

export interface DriverTrait {
  id: 'braking' | 'trail' | 'throttle' | 'consistency' | 'grip'
  title: string
  /** "82 %" */
  value: string
  text: string
  /** true = punto fuerte, false = a trabajar, null = neutro. */
  good: boolean | null
}

/** Tu estilo: promedio de las últimas sesiones analizadas. */
export interface DriverStyle {
  sessions: number
  /** Menos de 5 sesiones: todavía es una tendencia. */
  tentative: boolean
  traits: DriverTrait[]
}

/** Una sección del setup (Neumáticos, Chasis…) con sus partes y valores. */
export interface SetupGroup {
  name: string
  parts: { name: string; values: [string, string][] }[]
}

export interface Conditions {
  airC: number | null
  trackC: number | null
  skies: string | null
  wind: string | null
  humidityPct: number | null
  /** Pista mojada (iRacing con lluvia). */
  wetness: string | null
}

export interface CompareResult {
  a: LapTrace
  b: LapTrace
  /** Cómo se llama la referencia en los textos ("V12", "tu PB del 12/10"). */
  refLabel: string
  /** Tiempo de A menos B en cada punto de la grilla (positivo = A pierde). */
  delta: number[]
  insights: Insight[]
}

export interface LibraryState {
  scanning: boolean
  sessions: SessionSummary[]
  error: string | null
}

// ── Coach ──────────────────────────────────────────────────────────────────

export interface CoachReport {
  briefing: string
  corners: { corner: string; trackPct: number; speeds: string; diagnosis: string; lossS: number }[]
  dynamics: { braking: string; throttle: string; frictionCircle: string }
  corrections: { rank: number; title: string; current: string; target: string; gainS: number; solution: string }[]
  drill: { description: string; kpi: string }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  at: number
}

export interface CoachState {
  sessionId: string
  report: CoachReport | null
  /** Modelo y fecha del reporte. */
  model: string | null
  createdAt: number | null
  chat: ChatMessage[]
  busy: boolean
  error: string | null
  /** Texto que va llegando mientras el coach responde. */
  streaming: string | null
}

/** Cuánto le cuesta al piloto: gratis, ya incluido en un plan que paga, o por uso. */
export type CoachCost = 'free' | 'plan' | 'paid'

export interface CoachModel {
  id: string
  label: string
  cost: CoachCost
  /** En OpenCode cada familia va por su endpoint: los Claude y algunos Qwen por el de Anthropic. */
  api?: 'messages'
}

export const COACH_MODELS: CoachModel[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 · el más barato', cost: 'paid' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · equilibrado', cost: 'paid' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 · el más preciso', cost: 'paid' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 · el más capaz y el más caro', cost: 'paid' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', cost: 'paid' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', cost: 'paid' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', cost: 'paid' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', cost: 'paid' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', cost: 'paid' },
]

export type CoachProvider = 'gemini' | 'openrouter' | 'claude-code' | 'claude' | 'opencode-zen' | 'opencode-go'

export type CoachKeyId = 'claude' | 'gemini' | 'opencode' | 'openrouter'

export interface CoachProviderInfo {
  id: CoachProvider
  label: string
  /** Cómo se habla con el proveedor: su API, una compatible con OpenAI o el CLI que el piloto tiene instalado. */
  api: 'claude' | 'gemini' | 'openai' | 'opencode' | 'claude-code'
  /** Sin clave: usa la sesión del CLI instalado. */
  key?: CoachKeyId
  keyUrl?: string
  keyPlaceholder?: string
  baseUrl?: string
  /** Qué hace falta y cuánto se gasta, para Ajustes. */
  hint: string
  /** Sugerencias (el modelo se puede escribir a mano). */
  models: CoachModel[]
  defaultModel: string
}

export const COACH_PROVIDERS: CoachProviderInfo[] = [
  {
    id: 'gemini',
    label: 'Gemini · gratis',
    api: 'gemini',
    key: 'gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    hint: 'La clave de Google AI Studio es gratis y no pide tarjeta. Los modelos marcados gratis no cobran nada; tienen un límite de pedidos por minuto y por día (si lo pasás, esperá un rato o cambiá de modelo).',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash · el mejor gratis', cost: 'free' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', cost: 'free' },
      { id: 'gemini-flash-latest', label: 'Gemini Flash (siempre el último)', cost: 'free' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', cost: 'free' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite · el más rápido', cost: 'free' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', cost: 'free' },
      { id: 'gemma-4-31b-it', label: 'Gemma 4 31B', cost: 'free' },
      { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B', cost: 'free' },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon · el más capaz (pide facturación)', cost: 'paid' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (pide facturación)', cost: 'paid' },
    ],
    defaultModel: 'gemini-3.8-flash',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter · gratis',
    api: 'openai',
    key: 'openrouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-…',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: 'Cuenta gratis, sin tarjeta: 50 pedidos por día con los modelos «:free». Algunos proveedores gratis usan lo que les mandás para entrenar (solo van números de tu telemetría).',
    models: [
      { id: 'openrouter/free', label: 'El gratis que esté libre (automático)', cost: 'free' },
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', cost: 'free' },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra · el más grande', cost: 'free' },
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super', cost: 'free' },
      { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning · rápido', cost: 'free' },
      { id: 'thinkingmachines/inkling:free', label: 'Inkling', cost: 'free' },
      { id: 'poolside/laguna-s-2.1:free', label: 'Laguna S 2.1', cost: 'free' },
      { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B', cost: 'free' },
    ],
    defaultModel: 'openrouter/free',
  },
  {
    id: 'claude-code',
    label: 'Claude · tu suscripción (Claude Code)',
    api: 'claude-code',
    hint: 'Usa Claude Code instalado en esta PC con tu cuenta de Claude Pro o Max: no pide API key ni crédito aparte, gasta del límite de tu plan.',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · rinde más el plan', cost: 'plan' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 · el más preciso', cost: 'plan' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 · el más rápido', cost: 'plan' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 · el más capaz', cost: 'plan' },
    ],
    defaultModel: 'claude-sonnet-5-5',
  },
  {
    id: 'claude',
    label: 'Claude · API key',
    api: 'claude',
    key: 'claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    hint: 'Se paga por uso con crédito de la consola de Anthropic (los planes Max traen crédito de API todos los meses). Haiku cuesta menos de un centavo de dólar por reporte.',
    models: COACH_MODELS,
    defaultModel: 'claude-opus-5-5',
  },
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    api: 'opencode',
    key: 'opencode',
    keyUrl: 'https://opencode.ai/zen',
    keyPlaceholder: 'Clave de OpenCode',
    baseUrl: 'https://opencode.ai/inference',
    hint: 'Se paga por uso con crédito de OpenCode. Sus modelos gratis solo andan dentro de OpenCode, no desde otras apps.',
    models: [
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash · muy barato', cost: 'paid' },
      { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash · muy barato', cost: 'paid' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', cost: 'paid' },
      { id: 'glm-5.3', label: 'GLM 5.3', cost: 'paid' },
      { id: 'kimi-k3', label: 'Kimi K3', cost: 'paid' },
      { id: 'qwen3.8-max', label: 'Qwen 3.8 Max', cost: 'paid' },
      { id: 'minimax-m3', label: 'MiniMax M3', cost: 'paid' },
      { id: 'mistral-large-4', label: 'Mistral Large 4', cost: 'paid' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', cost: 'paid', api: 'messages' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', cost: 'paid', api: 'messages' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', cost: 'paid', api: 'messages' },
    ],
    defaultModel: 'deepseek-v4.1-flash',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    api: 'opencode',
    key: 'opencode',
    keyUrl: 'https://opencode.ai/go',
    keyPlaceholder: 'Clave de OpenCode',
    baseUrl: 'https://opencode.ai/inference/go',
    hint: 'Suscripción de OpenCode (US$10 por mes) con un tope de uso por modelo. Está pensada para agentes de código: OpenCode puede limitar el uso desde otras apps.',
    models: [
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash · rinde más el plan', cost: 'plan' },
      { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash', cost: 'plan' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', cost: 'plan' },
      { id: 'glm-5.3', label: 'GLM 5.3', cost: 'plan' },
      { id: 'kimi-k3', label: 'Kimi K3', cost: 'plan' },
      { id: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro', cost: 'plan' },
      { id: 'qwen3.8-max', label: 'Qwen 3.8 Max', cost: 'plan', api: 'messages' },
      { id: 'minimax-m3', label: 'MiniMax M3', cost: 'plan', api: 'messages' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', cost: 'plan', api: 'messages' },
    ],
    defaultModel: 'deepseek-v4.1-flash',
  },
]

/** Endpoint de OpenCode para un modelo: los de la lista lo dicen; uno escrito a mano va por el de OpenAI salvo los Claude. */
export function opencodeApi(info: CoachProviderInfo, model: string): 'chat' | 'messages' {
  const m = info.models.find((x) => x.id === model)
  return (m?.api ?? (model.startsWith('claude-') ? 'messages' : undefined)) === 'messages' ? 'messages' : 'chat'
}
