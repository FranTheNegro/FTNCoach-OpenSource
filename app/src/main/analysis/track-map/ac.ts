/**
 * Mapa de Assetto Corsa: sale de los archivos del propio trazado, en el mismo
 * marco que la posición del auto (x, z del mundo; z hacia abajo en pantalla,
 * igual que el map.png del juego).
 *
 * `ai/fast_lane.ai` trae la línea de la IA y, para cada punto, la distancia al
 * borde izquierdo y derecho: con eso los bordes son los del asfalto real.
 * `data/sections.ini` (cuando está) trae los nombres de las curvas.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Point, TrackGeometry } from '@shared/analysis'
import { boundsOf } from './iracing'

export interface AiPoint {
  x: number
  z: number
  /** Distancia acumulada desde la largada (m). */
  len: number
  left: number
  right: number
}

/**
 * Formato (versión 7): cabecera de 4 int32 (versión, cantidad, 0, 0), puntos de
 * 20 bytes (x, y, z, distancia, id), un int32 con la cantidad y 18 floats por
 * punto (velocidad, acelerador, freno, latG, radio, lado izquierdo, lado derecho,
 * peralte, dirección, normal ×3, largo, adelante ×3, tag, pendiente).
 */
export function parseFastLane(b: Buffer): AiPoint[] {
  if (b.length < 16) throw new Error('fast_lane.ai vacío')
  const n = b.readInt32LE(4)
  if (n <= 2 || 16 + n * 20 > b.length) throw new Error('fast_lane.ai con formato desconocido')
  const pts: AiPoint[] = []
  let o = 16
  for (let i = 0; i < n; i++, o += 20) {
    pts.push({ x: b.readFloatLE(o), z: b.readFloatLE(o + 8), len: b.readFloatLE(o + 12), left: NaN, right: NaN })
  }
  if (o + 4 <= b.length && b.readInt32LE(o) === n && o + 4 + n * 72 <= b.length) {
    o += 4
    for (let i = 0; i < n; i++) {
      pts[i].left = b.readFloatLE(o + i * 72 + 20)
      pts[i].right = b.readFloatLE(o + i * 72 + 24)
    }
  }
  return pts
}

/** Carpeta de AC: la biblioteca de Steam por defecto o las que figuren en libraryfolders.vdf. */
export function findAcRoot(): string | null {
  const steam = 'C:\\Program Files (x86)\\Steam'
  const libs = [steam]
  try {
    const vdf = readFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'))
  } catch {
    // Sin Steam en la ruta por defecto
  }
  for (const lib of libs) {
    const root = join(lib, 'steamapps', 'common', 'assettocorsa')
    if (existsSync(join(root, 'content', 'tracks'))) return root
  }
  return null
}

/** "ac/ks_brands_hatch/gp" → carpetas del trazado (con layout y sin él). */
export function acTrackDirs(root: string, trackId: string): { base: string; layout: string } | null {
  const [, track, layout] = trackId.split('/')
  if (!track) return null
  const base = join(root, 'content', 'tracks', track)
  if (!existsSync(base)) return null
  return { base, layout: layout ? join(base, layout) : base }
}

function sectionsOf(dirs: { base: string; layout: string }): { name: string; inPct: number; outPct: number }[] {
  for (const d of [dirs.layout, dirs.base]) {
    const file = join(d, 'data', 'sections.ini')
    if (!existsSync(file)) continue
    const out: { name: string; inPct: number; outPct: number }[] = []
    let cur: Record<string, string> = {}
    const flush = () => {
      const inPct = Number(cur.IN)
      const outPct = Number(cur.OUT)
      if (cur.TEXT && Number.isFinite(inPct) && Number.isFinite(outPct)) out.push({ name: cur.TEXT.trim(), inPct, outPct })
      cur = {}
    }
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) flush()
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line)
      if (m) cur[m[1]] = m[2]
    }
    flush()
    return out
  }
  return []
}

export interface AcSections {
  name: string
  inPct: number
  outPct: number
}

export function acSections(root: string, trackId: string): AcSections[] {
  const dirs = acTrackDirs(root, trackId)
  return dirs ? sectionsOf(dirs) : []
}

/** Geometría del trazado de AC, o null si no se encuentra su fast_lane.ai. */
export function acGeometry(root: string, trackId: string): TrackGeometry | null {
  const dirs = acTrackDirs(root, trackId)
  if (!dirs) return null
  const file = [join(dirs.layout, 'ai', 'fast_lane.ai'), join(dirs.base, 'ai', 'fast_lane.ai')].find(existsSync)
  if (!file) return null
  const pts = parseFastLane(readFileSync(file))
  const total = pts[pts.length - 1].len || 1

  // Hacia qué lado queda cada borde: en el plano (x, z), el lado "right" del archivo
  // es la normal (−dz, dx) (verificado con los ápices de Monza, Spa, Brands Hatch…)
  const left: Point[] = []
  const right: Point[] = []
  const widths: number[] = []
  const hasSides = pts.every((p) => Number.isFinite(p.left) && Number.isFinite(p.right) && p.left >= 0 && p.right >= 0 && p.left + p.right < 60)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    let dx = b.x - a.x
    let dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const p = pts[i]
    if (hasSides) {
      right.push([p.x - dz * p.right, p.z + dx * p.right])
      left.push([p.x + dz * p.left, p.z - dx * p.left])
      widths.push(p.left + p.right)
    }
  }
  const step = Math.max(1, Math.round(pts.length / 2500))
  const thin = (c: Point[]) => c.filter((_, i) => i % step === 0)
  const first = pts[0]
  const last = pts[pts.length - 1]
  const closed = Math.hypot(first.x - last.x, first.z - last.z) < 30

  let asphalt: Point[][]
  if (!hasSides) asphalt = []
  else if (closed) asphalt = [thin(left), thin(right).reverse()]
  else asphalt = [[...thin(left), ...thin(right).reverse()]]

  // Posición típica por punto de la vuelta
  const pctLine: Point[] = []
  let k = 0
  for (let i = 0; i <= 1000; i++) {
    const target = (i / 1000) * total
    while (k < pts.length - 2 && pts[k + 1].len < target) k++
    const p0 = pts[k]
    const p1 = pts[k + 1]
    const t = p1.len > p0.len ? Math.min(1, Math.max(0, (target - p0.len) / (p1.len - p0.len))) : 0
    pctLine.push([p0.x + (p1.x - p0.x) * t, p0.z + (p1.z - p0.z) * t])
  }

  const labels = sectionsOf(dirs).map((s) => {
    const mid = ((s.inPct + s.outPct) / 2) * 1000
    const [x, y] = pctLine[Math.max(0, Math.min(1000, Math.round(mid)))]
    return { text: s.name, x, y, turn: null }
  })

  const sorted = widths.slice().sort((a, b) => a - b)
  const widthM = sorted.length ? Math.round(sorted[sorted.length >> 1] * 10) / 10 : null
  const startFinish = hasSides ? [[left[0], right[0]]] : []
  const shape = asphalt.length ? asphalt : [pctLine]
  return {
    source: 'ac',
    asphalt,
    startFinish,
    labels,
    widthM,
    widthNote: hasSides ? 'Bordes del propio trazado de AC' : 'Este trazado no trae bordes: se muestra solo la línea',
    pctLine,
    bounds: boundsOf(shape),
  }
}

/** Para la UI de ajustes: si AC está instalado y dónde. */
export function acInstalled(): { root: string; tracks: number } | null {
  const root = findAcRoot()
  if (!root) return null
  return { root, tracks: readdirSync(join(root, 'content', 'tracks')).length }
}
