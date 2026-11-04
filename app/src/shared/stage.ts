/**
 * Rally: el tramo en vivo y su mapa. Los tramos se aprenden pasada a pasada (ver
 * main/telemetry/acr/stage-store.ts) y el mapa sale de la cartografía oficial del
 * lugar, registrada a las coordenadas del juego.
 */

export type StageState = 'idle' | 'ready' | 'running' | 'finished'

export interface StageSplitLive {
  /** Distancia del parcial desde la largada (m). */
  distM: number
  /** Tiempo desde la largada hasta este parcial en la pasada en curso. */
  timeS: number | null
  /** Contra el mismo parcial de tu mejor pasada (negativo = más rápido). */
  diffS: number | null
  /** Es el mejor tiempo que hiciste a este parcial. */
  best: boolean
}

export interface StageLive {
  state: StageState
  /** Archivo del tramo (para pedir el mapa). */
  stageId: string | null
  /** Distancia recorrida desde la largada (m). */
  distM: number
  /** Largo del tramo, si ya se completó una pasada. */
  lengthM: number | null
  /** Altitud del auto (m sobre el nivel del mar). */
  altM: number
  /** Veces que el juego te reubicó en esta pasada. */
  resets: number
  /** Golpes de esta pasada: dónde y con cuántos G. */
  impacts: { distM: number; g: number }[]
  splits: StageSplitLive[]
  /** De dónde salen los parciales: los del juego o ninguno todavía. */
  splitsSource: 'game' | null
  bestS: number | null
}

export interface StagePoint {
  /** Distancia desde la largada (m). */
  d: number
  /** Coordenadas del juego: x = norte, z = este, y = altitud (m). */
  x: number
  y: number
  z: number
}

export type StageLayer = 'orto' | 'relieve' | 'curvas'

export interface StageTile {
  layer: StageLayer
  /** Rectángulo en coordenadas del juego (z = este, x = norte). */
  z0: number
  x0: number
  z1: number
  x1: number
  url: string
}

export interface StageSurface {
  fromM: number
  toM: number
  /** Superficie según OpenStreetMap (asfalto, grava, tierra…). */
  kind: string
  road: string | null
}

export interface StageStats {
  altStartM: number
  altFinishM: number
  altMinM: number
  altMaxM: number
  climbM: number
  descentM: number
  /** Pendiente máxima en 50 m (%; positiva = subida). */
  maxUpPct: number
  maxDownPct: number
  hairpins: { distM: number }[]
}

export interface StageMapData {
  stageId: string
  name: string
  lengthM: number | null
  line: StagePoint[]
  splitsM: number[]
  splitsSource: 'game' | null
  stats: StageStats | null
  /** Registro a la cartografía: coordenadas del juego + corrimiento = Lambert-93. */
  geo: { crs: 'EPSG:2154'; offsetE: number; offsetN: number; errorM: number } | null
  tiles: StageTile[]
  surfaces: StageSurface[]
  credits: string[]
  note: string
}
