/** Mensajes entre el proceso principal y el hilo de análisis. */
import type { CompareResult, LibraryState, SessionDetail, TrackMapResult } from '@shared/analysis'

export interface AnalysisInit {
  cacheFile: string
  geoDir: string
}

export type AnalysisRequest =
  | { type: 'scan'; dirs: string[]; exclude: string[] }
  | { type: 'detail'; sessionId: string }
  | { type: 'compare'; sessionId: string; a: number; b: number }
  | { type: 'liveMap'; trackId: string; slug: string | null }
  | { type: 'coachData'; sessionId: string; lap: number | null }
  | { type: 'tips'; trackId: string; car: string }

export interface AnalysisResults {
  scan: null
  detail: SessionDetail
  compare: CompareResult
  liveMap: TrackMapResult
  coachData: Record<string, unknown>
  tips: CornerTip[]
}

/** Dónde se pierde tiempo en una curva, para mostrarlo dentro del juego al llegar. */
export interface CornerTip {
  startPct: number
  apexPct: number
  title: string
  text: string
  lossS: number
}

export type AnalysisMessage =
  | { type: 'result'; id: number; ok: true; result: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'library'; state: LibraryState }
