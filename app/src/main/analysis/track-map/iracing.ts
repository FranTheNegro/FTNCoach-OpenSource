/**
 * Mapa oficial de iRacing.
 *
 * El dibujo de cada trazado (capa `active` de los mapas que iRacing publica en
 * members-assets.iracing.com) es el contorno del asfalto a escala. Se baja una
 * sola vez. Está en píxeles; la telemetría trae latitud/longitud reales: la
 * primera sesión con GPS de cada trazado registra el dibujo contra el GPS con una
 * semejanza (escala fijada por el largo oficial, rotación y desplazamiento: la
 * forma no se toca) y la guarda en `align.json`. Desde ahí todas las sesiones de
 * ese trazado usan el mismo marco.
 *
 * Sin dibujo publicado o sin GPS no se inventan bordes.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Point, TrackGeometry } from '@shared/analysis'
import {
  PointGrid,
  Raster,
  fitSimilarity,
  insetContours,
  median,
  nelderMead,
  percentile,
  polylineLength,
  rotate,
  type Similarity,
} from './geom'
import { svgContours, svgLabels } from './svg'

const MAP_BASE_URL = 'https://members-assets.iracing.com/public/track-maps/'
const EARTH_R = 6371000
/** Por debajo de esto el registro no es confiable (el dibujo no corresponde al trazado). */
export const MIN_INSIDE_FRACTION = 0.75
/**
 * iRacing dibuja la cinta con ~20 px fijos: en metros depende del tamaño del
 * circuito (10 m en Tsukuba, 22 m en Spa). Si el dibujo es más ancho se angosta
 * a este valor; `width.json` ({"width_m": 11}) lo fija a mano.
 */
const DEFAULT_WIDTH_M = 12
/** Los pianos quedan fuera del dibujo: hasta esto afuera del borde cuenta como dentro. */
const KERB_M = 1.5
/** Solo se angosta un dibujo claramente más ancho que una pista real (Spa: 22 m). */
const NARROW_OVER_M = 3
// 4: ancho real del dibujo y tolerancia de pianos
const ALIGN_VERSION = 4
const RETRY_MISSING_MS = 7 * 24 * 3600 * 1000

export interface IracingAlign {
  version: number
  lat0: number
  lon0: number
  scale: number
  theta: number
  tx: number
  ty: number
  insideFraction: number
  trackLengthM: number
  /** Posición típica por punto de la vuelta (m, marco de pantalla), 1000 tramos. */
  pctLine: Point[]
  registeredWith: { track: string; file: string; laps: number[] }
}

/** Lat/lon (grados) → metros en un plano local (x este, y norte). */
export function projectGps(lat: number, lon: number, lat0: number, lon0: number): Point {
  const r = Math.PI / 180
  return [(lon - lon0) * r * Math.cos(lat0 * r) * EARTH_R, (lat - lat0) * r * EARTH_R]
}

// ── Descarga ────────────────────────────────────────────────────────────────

/** Variantes conocidas de carpeta/slug ("tracks_oran/202-oran-gp", "tracks_silverstone_2019/…"). */
export function urlCandidates(id: string, slug: string): string[] {
  const t = slug.toLowerCase().split(/\s+/).filter(Boolean)
  if (!t.length) return []
  const out = [`tracks_${t[0]}/${id}-${t.join('-')}`]
  for (let k = 1; k < t.length; k++) {
    for (const folder of [t.slice(0, k).join(''), t.slice(0, k).join('_')]) {
      out.push(`tracks_${folder}/${id}-${t.join('-')}`)
      out.push(`tracks_${folder}/${id}-${folder}-${t.slice(k).join('-')}`)
    }
  }
  return [...new Set(out)]
}

async function getSvg(url: string): Promise<string | null> {
  const r = await fetch(url, { headers: { 'User-Agent': 'FTNCoach' }, signal: AbortSignal.timeout(20_000) })
  if (r.status !== 200) return null
  const text = await r.text()
  return text.includes('<svg') ? text : null
}

/**
 * Carpeta con el `active.svg` oficial (bajado una sola vez), o null si iRacing no
 * publica mapa. Sin red tira error y se reintenta la próxima vez.
 */
export async function ensureIracingSvgs(dir: string, id: string, slug: string | null): Promise<string | null> {
  if (existsSync(join(dir, 'active.svg'))) return dir
  const metaFile = join(dir, 'meta.json')
  if (existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    if (meta.missing && Date.now() - statSync(metaFile).mtimeMs < RETRY_MISSING_MS) return null
  }
  if (!slug) return null
  const tried: string[] = []
  for (const path of urlCandidates(id, slug)) {
    tried.push(path)
    const active = await getSvg(`${MAP_BASE_URL}${path}/active.svg`)
    if (!active) continue
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'active.svg'), active)
    for (const layer of ['start-finish', 'turns']) {
      const extra = await getSvg(`${MAP_BASE_URL}${path}/${layer}.svg`).catch(() => null)
      if (extra) writeFileSync(join(dir, `${layer}.svg`), extra)
    }
    writeFileSync(metaFile, JSON.stringify({ id, slug, path }, null, 2))
    return dir
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(metaFile, JSON.stringify({ id, slug, missing: true, tried }, null, 2))
  return null
}

// ── Registro dibujo ↔ GPS ───────────────────────────────────────────────────

function every<T>(a: T[], max: number): T[] {
  const step = Math.max(1, Math.floor(a.length / max))
  return a.filter((_, i) => i % step === 0)
}

/** px → m con la semejanza. */
function toM(t: Similarity, p: Point): Point {
  const [x, y] = rotate(t.theta, p[0], p[1])
  return [t.s * x + t.tx, t.s * y + t.ty]
}

/** m → px. */
function toPx(t: Similarity, q: Point): Point {
  const [x, y] = rotate(-t.theta, q[0] - t.tx, q[1] - t.ty)
  return [x / t.s, y / t.s]
}

/**
 * Semejanza px → m que apoya el dibujo sobre el GPS. La escala sale del largo
 * oficial (el contorno de la cinta mide ~2 × largo) y solo se ajusta ±5 %;
 * rotación y desplazamiento por ICP y después se refina pidiendo que la trazada
 * quede DENTRO del asfalto.
 */
export function registerToGps(contoursPx: Point[][], gps: Point[], trackLengthM: number): Similarity & { insideFraction: number } {
  const allp = contoursPx.flat()
  const perim = contoursPx.reduce((acc, c) => acc + polylineLength(c), 0)
  const sLen = (2 * trackLengthM) / perim
  const g = every(gps, 900)
  const gridPx = new PointGrid(allp)
  const gridG = new PointGrid(g)
  const allpS = every(allp, 1500)
  const meanOf = (pts: Point[]): Point => {
    let x = 0
    let y = 0
    for (const p of pts) {
      x += p[0]
      y += p[1]
    }
    return [x / pts.length, y / pts.length]
  }
  const gMean = meanOf(g)
  const pMean = meanOf(allp)

  // ICP desde una semejanza inicial; la escala queda fija las primeras iteraciones
  const icp = (pts: Point[], t0: Similarity, iters: number, freeScaleFrom: number): Similarity => {
    let t = t0
    const d = new Float64Array(pts.length)
    const idx = new Int32Array(pts.length)
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < pts.length; k++) {
        const q = toPx(t, pts[k])
        const nn = gridPx.nearest(q[0], q[1])
        d[k] = nn.d
        idx[k] = nn.i
      }
      const cut = percentile(d, 90)
      const a: Point[] = []
      const b: Point[] = []
      for (let k = 0; k < pts.length; k++)
        if (d[k] < cut) {
          a.push(allp[idx[k]])
          b.push(pts[k])
        }
      if (a.length < 10) break
      const fit = fitSimilarity(a, b)
      const s = it < freeScaleFrom ? sLen : Math.min(1.05 * sLen, Math.max(0.95 * sLen, fit.s))
      // Con la escala fija se recalcula el desplazamiento
      const am = meanOf(a)
      const bm = meanOf(b)
      const [ax, ay] = rotate(fit.theta, am[0], am[1])
      t = { s, theta: fit.theta, tx: bm[0] - s * ax, ty: bm[1] - s * ay }
    }
    return t
  }
  const score = (pts: Point[], t: Similarity): number => {
    const dm = pts.map((p) => {
      const q = toPx(t, p)
      return gridPx.nearest(q[0], q[1]).d * t.s
    })
    // Cobertura: todo el dibujo tiene que estar recorrido (evita calzar media pista en un "8")
    const cover = allpS.map((p) => {
      const m = toM(t, p)
      return gridG.nearest(m[0], m[1]).d
    })
    return median(dm) + 0.2 * median(cover)
  }

  // 1) Búsqueda gruesa de rotación con pocos puntos; las 3 mejores se pulen con todos
  const gC = every(g, 250)
  const coarse: { err: number; t: Similarity }[] = []
  for (let deg = 0; deg < 360; deg += 3) {
    const theta = (deg * Math.PI) / 180
    const [rx, ry] = rotate(theta, pMean[0], pMean[1])
    const t = icp(gC, { s: sLen, theta, tx: gMean[0] - sLen * rx, ty: gMean[1] - sLen * ry }, 15, 8)
    coarse.push({ err: score(gC, t), t })
  }
  coarse.sort((a, b) => a.err - b.err)
  let best: { err: number; t: Similarity } | null = null
  for (const c of coarse.slice(0, 3)) {
    const t = icp(g, c.t, 30, 0)
    const err = score(g, t)
    if (!best || err < best.err) best = { err, t }
  }
  let t = best!.t

  // 2) Refinamiento: dentro del asfalto. Si el dibujo es más ancho que una pista real,
  // contra la cinta ya angostada (con 22 m de margen el registro quedaría flojo).
  let raster = new Raster(contoursPx, 1)
  const wPx = raster.ribbonWidth()
  const wTargetPx = DEFAULT_WIDTH_M / sLen
  let refContours = contoursPx
  if ((wPx - wTargetPx) * sLen > NARROW_OVER_M) {
    refContours = insetContours(contoursPx, (wPx - wTargetPx) / 2, raster)
    raster = new Raster(refContours, 1)
  }

  const refine = (pts: Point[], x0: number[]): number[] =>
    nelderMead(
      ([th, tx, ty, ls]) => {
        const sc = sLen * Math.exp(ls)
        const tt: Similarity = { s: sc, theta: th, tx, ty }
        let acc = 0
        for (const p of pts) {
          const q = toPx(tt, p)
          const sd = raster.sample(q[0], q[1])
          const dm = Math.abs(sd) * sc
          acc += sd > 0 ? -0.05 * Math.min(dm, 3) : dm + 1
        }
        return acc / pts.length + 20 * ls * ls
      },
      x0,
      [0.02, 4, 4, 0.02],
      { maxIter: 2500, xatol: 1e-4, fatol: 1e-5 },
    )

  let x = refine(g, [t.theta, t.tx, t.ty, Math.log(t.s / sLen)])
  const simOf = (v: number[]): Similarity => ({ s: sLen * Math.exp(v[3]), theta: v[0], tx: v[1], ty: v[2] })
  // Un trompo o un salto del GPS (a más de 15 m del dibujo) no debe arrastrar el registro
  t = simOf(x)
  const far = g.map((p) => {
    const q = toPx(t, p)
    return Math.abs(Math.min(0, raster.sample(q[0], q[1]))) * t.s > 15
  })
  const farFrac = far.filter(Boolean).length / g.length
  if (farFrac > 0 && farFrac < 0.05) x = refine(g.filter((_, k) => !far[k]), x)
  t = simOf(x)
  const check = every(gps, 1500)
  const inside = check.filter((p) => {
    const q = toPx(t, p)
    return raster.sample(q[0], q[1]) * t.s > -KERB_M
  }).length
  return { ...t, insideFraction: Math.round((inside / check.length) * 1000) / 1000 }
}

// ── Geometría para la UI ────────────────────────────────────────────────────

/** Marco de pantalla: x este, y hacia abajo (sur). */
const screen = (p: Point): Point => [p[0], -p[1]]

function readOpt(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

export function readAlign(dir: string): IracingAlign | null {
  const raw = readOpt(join(dir, 'align.json'))
  if (!raw) return null
  try {
    const a = JSON.parse(raw) as IracingAlign
    return a.version === ALIGN_VERSION ? a : null
  } catch {
    return null
  }
}

export function writeAlign(dir: string, align: Omit<IracingAlign, 'version'>): IracingAlign {
  const full = { version: ALIGN_VERSION, ...align }
  writeFileSync(join(dir, 'align.json'), JSON.stringify(full))
  return full
}

export function contoursOf(dir: string): Point[][] {
  const svg = readOpt(join(dir, 'active.svg'))
  return svg ? svgContours(svg) : []
}

/** Geometría del trazado en metros (marco de pantalla) a partir del registro. */
export function iracingGeometry(dir: string, align: IracingAlign): TrackGeometry {
  const contoursPx = contoursOf(dir)
  const sim: Similarity = { s: align.scale, theta: align.theta, tx: align.tx, ty: align.ty }
  const raster = new Raster(contoursPx, 1)
  const drawn = raster.ribbonWidth() * align.scale

  // Ancho real: el dibujo solo se angosta (nunca se ensancha) hasta el ancho de la pista
  const manualRaw = readOpt(join(dir, 'width.json'))
  const manual = manualRaw ? Number(JSON.parse(manualRaw).width_m) : NaN
  let width: number
  let note: string
  if (Number.isFinite(manual) && manual > 0) {
    width = manual
    note = 'Ancho fijado a mano'
  } else if (drawn > DEFAULT_WIDTH_M + NARROW_OVER_M) {
    width = DEFAULT_WIDTH_M
    note = `Ancho estimado en ${DEFAULT_WIDTH_M} m: el dibujo oficial es más ancho que la pista`
  } else {
    width = drawn
    note = 'Ancho del dibujo oficial'
  }
  const px = drawn - width > 0.4 ? insetContours(contoursPx, (drawn - width) / 2 / align.scale, raster) : contoursPx
  const asphalt = px.map((c) => c.filter((_, i) => i % 2 === 0).map((p) => screen(toM(sim, p))))

  const sfSvg = readOpt(join(dir, 'start-finish.svg'))
  const startFinish = sfSvg ? svgContours(sfSvg, 1).map((c) => c.map((p) => screen(toM(sim, p)))) : []
  const turnsSvg = readOpt(join(dir, 'turns.svg'))
  const labels = turnsSvg
    ? svgLabels(turnsSvg).map((l) => {
        const [x, y] = screen(toM(sim, [l.x, l.y]))
        const n = /^\d+[a-z]?$/i.test(l.text) ? parseInt(l.text, 10) : null
        return { text: l.text, x, y, turn: n }
      })
    : []

  return {
    source: 'iracing',
    asphalt,
    startFinish,
    labels,
    widthM: Math.round(width * 10) / 10,
    widthNote: note,
    pctLine: align.pctLine,
    bounds: boundsOf(asphalt),
  }
}

export function boundsOf(contours: Point[][]): TrackGeometry['bounds'] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contours)
    for (const [x, y] of c) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  return { minX, minY, maxX, maxY }
}

/** Posición en el marco de pantalla del mapa para una muestra de GPS. */
export function gpsToScreen(align: Pick<IracingAlign, 'lat0' | 'lon0'>, lat: number, lon: number): Point {
  return screen(projectGps(lat, lon, align.lat0, align.lon0))
}
