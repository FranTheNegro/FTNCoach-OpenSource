/**
 * Carga una pasada grabada con el sondeo (sondeo-acr-*.jsonl) como si se hubiera
 * corrido con la app: aprende el tramo (largada, meta, línea, mejor pasada) y lo
 * guarda donde lo busca FTN Coach. Sirve para tener el mapa sin volver a correr.
 *
 * Uso (desde app/, Node 24):
 *   node scripts/acr-importar.mts <grabación.jsonl> [carpeta de tramos]
 *
 * La grabación del sondeo es de 20 Hz: la llegada se detecta igual que en vivo
 * (el cronómetro se congela mientras graphics sigue avanzando).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StageRun, loadStage, newStage, saveStage, stageId, stageLength } from '../src/main/telemetry/acr/stage-store.ts'

const [file, dirArg] = process.argv.slice(2)
if (!file) {
  console.log('Uso: node scripts/acr-importar.mts <grabación.jsonl> [carpeta de tramos]')
  process.exit(1)
}
const dir = dirArg ?? join(process.env.APPDATA ?? '', 'FTN Coach', 'acr', 'stages')

const parse = (s: string): number | null => {
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(s)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const st = lines.filter((l) => l.kind === 'static').at(-1)?.static
if (!st?.track) throw new Error('La grabación no tiene la página static completa')
const id = stageId(st.track, st.trackSPlineLength)
const stage = loadStage(dir, id) ?? newStage(id, st.track, st.trackSPlineLength, NaN)
const car: string = st.carModel

let run: StageRun | null = null
let lastText = ''
let lastGfx = -1
let frozen = 0
let timerDist = 0
let finished = false
for (const l of lines) {
  if (l.kind) continue
  const g = l.graphics
  const t = parse(g.currentTime)
  const gfxAdvanced = g.packetId !== lastGfx
  lastGfx = g.packetId
  if (!t) {
    run = null
    finished = false
    lastText = g.currentTime
    continue
  }
  if (!run && !finished) {
    if (!Number.isFinite(stage.startDistM)) stage.startDistM = g.distanceTraveled
    run = new StageRun(stage, car)
  }
  if (g.currentTime !== lastText) {
    lastText = g.currentTime
    frozen = 0
    timerDist = g.distanceTraveled
  } else if (gfxAdvanced && run && !finished && (frozen += 3) >= 30) {
    finished = true
    const ok = run.finish(t, timerDist)
    console.log(ok ? `Llegada: ${g.currentTime} a ${(timerDist - stage.startDistM).toFixed(0)} m de la largada` : 'La pasada no cubrió el tramo entero')
    continue
  }
  if (run && !finished) {
    const [x, y, z] = g.player.xyz
    const gH = Math.hypot(l.physics.accG[0], l.physics.accG[2])
    run.sample(g.distanceTraveled - stage.startDistM, t, x, y, z, gH)
  }
}
if (!finished || !run) {
  console.log('No se encontró una pasada completa en la grabación.')
  process.exit(1)
}
saveStage(dir, stage)
console.log(`Tramo ${stage.name} (${id}) guardado en ${dir}`)
console.log(`  largo ${stageLength(stage)?.toFixed(0)} m · línea ${stage.line.length} puntos · reubicaciones ${run.resets} · golpes ${JSON.stringify(run.impacts)}`)
