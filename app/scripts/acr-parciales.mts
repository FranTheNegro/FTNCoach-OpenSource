/**
 * Ubica los parciales del juego en un tramo a partir de los tiempos que ACR
 * muestra en pantalla al pasar por cada uno, en tu última pasada completa.
 * Con el tiempo por distancia de esa pasada se sabe en qué metro está cada
 * parcial: desde ahí valen para todas las pasadas.
 *
 * Uso (desde app/, Node 24, con FTN Coach cerrado o sin estar en el tramo):
 *   node scripts/acr-parciales.mts                       lista los tramos guardados
 *   node scripts/acr-parciales.mts <tramo> 1:12.4 2:40.9 tiempos de P1, P2… de la última pasada
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadStage, saveStage, splitsFromGameTimes, stageLength } from '../src/main/telemetry/acr/stage-store.ts'

const dir = process.env.FTN_ACR_STAGES ?? join(process.env.APPDATA ?? '', 'FTN Coach', 'acr', 'stages')
const [id, ...times] = process.argv.slice(2)

if (!id) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const s = loadStage(dir, f.replace(/\.json$/, ''))
    if (!s) continue
    console.log(`${s.id}  ${s.name}  ${stageLength(s)?.toFixed(0) ?? '?'} m  última pasada ${s.last ? `${s.last.timeS.toFixed(3)} s (${s.last.car})` : 'ninguna'}  parciales ${s.splitsM.join(', ') || 'sin definir'}`)
  }
  process.exit(0)
}

const parse = (v: string): number => {
  const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(v.trim())
  if (!m) throw new Error(`Tiempo inválido: ${v} (usar 1:12.4 o 72.4)`)
  return Number(m[1] ?? 0) * 60 + Number(m[2].replace(',', '.'))
}

const stage = loadStage(dir, id)
if (!stage) throw new Error(`No existe el tramo ${id} en ${dir}`)
const secs = times.map(parse)
if (secs.some((t, i) => i && t <= secs[i - 1])) throw new Error('Los tiempos tienen que ir en orden creciente')
const splits = splitsFromGameTimes(stage, secs)
if (!splits) throw new Error('La última pasada no llega a alguno de esos tiempos')
stage.splitsM = splits
stage.splitsSource = 'game'
saveStage(dir, stage)
console.log(`Parciales de ${stage.name}: ${splits.map((d, i) => `P${i + 1} a ${d} m`).join(' · ')}`)
