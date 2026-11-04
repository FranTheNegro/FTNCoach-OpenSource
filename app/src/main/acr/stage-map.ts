/**
 * Mapa de un tramo de rally (ACR): la línea del camino aprendida en una pasada,
 * registrada a la cartografía oficial, con ortofoto, relieve LiDAR HD y curvas de
 * nivel del IGN, la superficie y el nombre de cada calle (OpenStreetMap) y los
 * datos del tramo (desniveles, pendientes, horquillas).
 *
 * Registro: ACR ubica los tramos franceses en Lambert-93 corrido a un origen
 * propio (x = norte, z = este, y = altitud). Verificado el 31/10/2026 en Alsacia:
 * corrimiento constante en todo el tramo, 1,4 m de error medio contra las calles
 * de OSM y la altitud igual al modelo del IGN (±0,6 m). Para un tramo nuevo se
 * prueban los orígenes ya conocidos y, si no calzan, se busca el corrimiento
 * alrededor del lugar que dice el nombre del tramo. Fuera de Francia todavía no
 * hay fondo (cada país usa otra proyección): se dibuja solo la línea.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StageLayer, StageMapData, StagePoint, StageStats, StageSurface, StageTile } from '@shared/stage'
import { loadStage, saveStage, stageLength, type StageFile } from '../telemetry/acr/stage-store'
import { fromL93, inFrance, toL93 } from './l93'

const UA = 'FTNCoach/0.3 (telemetria de simracing)'
const TILE_M = 500
const TILE_PX = 1024
const TILE_MARGIN_M = 300
/** Error medio máximo (m) para aceptar un registro contra las calles de OSM. */
const MAX_FIT_ERROR_M = 4

/** Orígenes ya encontrados: [este, norte] que se suman a (z, x) del juego. */
const KNOWN_ORIGINS: [number, number][] = [
  // Alsacia (Munster, sondeo del 31/10/2026)
  [1006999.82, 6778195.51],
]

const LAYERS: Record<StageLayer, { wms: string; format: 'image/jpeg' | 'image/png' }> = {
  orto: { wms: 'HR.ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg' },
  relieve: { wms: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', format: 'image/png' },
  curvas: { wms: 'ELEVATION.CONTOUR.LINE', format: 'image/png' },
}

export const STAGE_CREDITS = [
  'Ortofoto, relieve LiDAR HD y curvas de nivel © IGN, Licence Ouverte 2.0',
  'Calles y superficies © colaboradores de OpenStreetMap, ODbL',
]

// ── Calles de OpenStreetMap ────────────────────────────────────────────────

interface Way {
  /** Puntos en Lambert-93. */
  pts: [number, number][]
  surface: string | null
  name: string | null
  highway: string
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

async function overpassWays(south: number, west: number, north: number, east: number): Promise<Way[]> {
  const hw = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service|road|living_street|primary_link|secondary_link|tertiary_link)$'
  const q = `[out:json][timeout:90];way["highway"~"${hw}"](${south},${west},${north},${east});out geom tags;`
  const body = new URLSearchParams({ data: q })
  const j = (await fetchJson('https://overpass-api.de/api/interpreter', { method: 'POST', body })) as {
    elements: { geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }[]
  }
  return j.elements
    .filter((e) => e.geometry && e.geometry.length > 1)
    .map((e) => ({
      pts: e.geometry!.map((g) => toL93(g.lat, g.lon)),
      surface: e.tags?.surface ?? null,
      name: e.tags?.name ?? e.tags?.ref ?? null,
      highway: e.tags?.highway ?? '',
    }))
}

/** Índice por celdas para la distancia de un punto a la calle más cercana. */
class WayIndex {
  private cells = new Map<string, { a: [number, number]; b: [number, number]; way: Way }[]>()
  private static CELL = 100

  constructor(ways: Way[]) {
    const C = WayIndex.CELL
    for (const way of ways) {
      for (let i = 1; i < way.pts.length; i++) {
        const a = way.pts[i - 1]
        const b = way.pts[i]
        const k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (C / 2)) + 1
        const keys = new Set<string>()
        for (let j = 0; j <= k; j++) keys.add(`${Math.floor((a[0] + ((b[0] - a[0]) * j) / k) / C)},${Math.floor((a[1] + ((b[1] - a[1]) * j) / k) / C)}`)
        for (const key of keys) {
          let list = this.cells.get(key)
          if (!list) this.cells.set(key, (list = []))
          list.push({ a, b, way })
        }
      }
    }
  }

  nearest(e: number, n: number, cap: number): { d: number; way: Way | null } {
    const C = WayIndex.CELL
    const cx = Math.floor(e / C)
    const cy = Math.floor(n / C)
    let best = cap
    let way: Way | null = null
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const s of this.cells.get(`${cx + i},${cy + j}`) ?? []) {
          const dx = s.b[0] - s.a[0]
          const dy = s.b[1] - s.a[1]
          const L = dx * dx + dy * dy
          const u = L ? Math.max(0, Math.min(1, ((e - s.a[0]) * dx + (n - s.a[1]) * dy) / L)) : 0
          const d = Math.hypot(e - s.a[0] - u * dx, n - s.a[1] - u * dy)
          if (d < best) {
            best = d
            way = s.way
          }
        }
      }
    }
    return { d: best, way }
  }
}

// ── Registro ───────────────────────────────────────────────────────────────

type Pt = { x: number; z: number }

function meanError(idx: WayIndex, pts: Pt[], oE: number, oN: number): number {
  let s = 0
  for (const p of pts) s += idx.nearest(p.z + oE, p.x + oN, 30).d
  return s / pts.length
}

/** Ajuste fino del corrimiento (descenso por coordenadas, de 10 m a 5 cm). */
function refine(idx: WayIndex, pts: Pt[], oE: number, oN: number): { oE: number; oN: number; err: number } {
  let err = meanError(idx, pts, oE, oN)
  for (const step of [10, 4, 1, 0.4, 0.15, 0.05]) {
    for (let it = 0; it < 40; it++) {
      let moved = false
      for (const [dE, dN] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const e2 = meanError(idx, pts, oE + dE, oN + dN)
        if (e2 < err) {
          err = e2
          oE += dE
          oN += dN
          moved = true
        }
      }
      if (!moved) break
    }
  }
  return { oE, oN, err }
}

/** Busca el corrimiento en ±`radius` m alrededor de `guess` con un campo de distancias de 10 m. */
function search(ways: Way[], pts: Pt[], guess: [number, number], radius: number): [number, number] {
  const R = 10
  let minE = Infinity
  let minN = Infinity
  let maxE = -Infinity
  let maxN = -Infinity
  for (const w of ways) for (const [e, n] of w.pts) ((minE = Math.min(minE, e)), (maxE = Math.max(maxE, e)), (minN = Math.min(minN, n)), (maxN = Math.max(maxN, n)))
  const W = Math.ceil((maxE - minE) / R) + 1
  const H = Math.ceil((maxN - minN) / R) + 1
  const dt = new Float32Array(W * H).fill(1e9)
  for (const w of ways) {
    for (let i = 1; i < w.pts.length; i++) {
      const [a, b] = [w.pts[i - 1], w.pts[i]]
      const k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (R / 2)) + 1
      for (let j = 0; j <= k; j++) {
        const x = Math.round((a[0] + ((b[0] - a[0]) * j) / k - minE) / R)
        const y = Math.round((a[1] + ((b[1] - a[1]) * j) / k - minN) / R)
        dt[y * W + x] = 0
      }
    }
  }
  const D2 = R * Math.SQRT2
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      let v = dt[i]
      if (x) v = Math.min(v, dt[i - 1] + R)
      if (y) {
        v = Math.min(v, dt[i - W] + R)
        if (x) v = Math.min(v, dt[i - W - 1] + D2)
        if (x < W - 1) v = Math.min(v, dt[i - W + 1] + D2)
      }
      dt[i] = v
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x
      let v = dt[i]
      if (x < W - 1) v = Math.min(v, dt[i + 1] + R)
      if (y < H - 1) {
        v = Math.min(v, dt[i + W] + R)
        if (x < W - 1) v = Math.min(v, dt[i + W + 1] + D2)
        if (x) v = Math.min(v, dt[i + W - 1] + D2)
      }
      dt[i] = v
    }
  const CAP = 100
  const cost = (e: number, n: number) => {
    const x = Math.round((e - minE) / R)
    const y = Math.round((n - minN) / R)
    return x < 0 || y < 0 || x >= W || y >= H ? CAP : Math.min(CAP, dt[y * W + x])
  }
  const sample = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 80)) === 0)
  let best = Infinity
  let out = guess
  for (let dN = -radius; dN <= radius; dN += 25) {
    for (let dE = -radius; dE <= radius; dE += 25) {
      const oE = guess[0] + dE
      const oN = guess[1] + dN
      let c = 0
      for (const p of sample) {
        c += cost(p.z + oE, p.x + oN)
        if (c >= best) break
      }
      if (c < best) {
        best = c
        out = [oE, oN]
      }
    }
  }
  return out
}

/** Lugar real del tramo a partir de su nombre ("Alsacia Luttenbach" → Luttenbach). */
async function geocode(name: string): Promise<[number, number] | null> {
  const words = name.split(/\s+/).filter((w) => w.length > 2)
  const tries = [name, ...[...words].sort((a, b) => b.length - a.length)]
  for (const q of tries) {
    try {
      const r = (await fetchJson(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'json', limit: '1' })}`)) as { lat: string; lon: string }[]
      if (r[0]) return [Number(r[0].lat), Number(r[0].lon)]
    } catch {
      // probar con la siguiente palabra
    }
    // Nominatim pide como mucho un pedido por segundo
    await new Promise((res) => setTimeout(res, 1100))
  }
  return null
}

function latLonBox(eMin: number, nMin: number, eMax: number, nMax: number): [number, number, number, number] {
  const a = fromL93(eMin, nMin)
  const b = fromL93(eMax, nMax)
  const c = fromL93(eMin, nMax)
  const d = fromL93(eMax, nMin)
  const lats = [a[0], b[0], c[0], d[0]]
  const lons = [a[1], b[1], c[1], d[1]]
  return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)]
}

async function waysAround(pts: Pt[], oE: number, oN: number, margin: number): Promise<Way[]> {
  const es = pts.map((p) => p.z + oE)
  const ns = pts.map((p) => p.x + oN)
  const [s, w, n, e] = latLonBox(Math.min(...es) - margin, Math.min(...ns) - margin, Math.max(...es) + margin, Math.max(...ns) + margin)
  if (!inFrance((s + n) / 2, (w + e) / 2)) return []
  return overpassWays(s, w, n, e)
}

/** Registra la línea del tramo a Lambert-93. Devuelve también las calles de alrededor. */
async function register(file: StageFile, pts: Pt[]): Promise<{ geo: NonNullable<StageFile['geo']>; ways: Way[] } | null> {
  const fine = pts.filter((_, i) => i % 3 === 0)
  // 1) Orígenes ya conocidos
  for (const [oE, oN] of KNOWN_ORIGINS) {
    const ways = await waysAround(pts, oE, oN, 300).catch(() => [])
    if (!ways.length) continue
    const idx = new WayIndex(ways)
    const r = refine(idx, fine, oE, oN)
    if (r.err < MAX_FIT_ERROR_M) return { geo: { crs: 'EPSG:2154', offsetE: r.oE, offsetN: r.oN, errorM: r.err }, ways }
  }
  // 2) Buscar alrededor del lugar que dice el nombre
  const place = await geocode(file.name)
  if (!place || !inFrance(place[0], place[1])) return null
  const [pe, pn] = toL93(place[0], place[1])
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const guess: [number, number] = [pe - cz, pn - cx]
  const RADIUS = 12000
  const [s, w, n, e] = latLonBox(pe - RADIUS - 6000, pn - RADIUS - 6000, pe + RADIUS + 6000, pn + RADIUS + 6000)
  const all = await overpassWays(s, w, n, e)
  const coarse = search(all, pts, guess, RADIUS)
  const ways = await waysAround(pts, coarse[0], coarse[1], 300)
  const r = refine(new WayIndex(ways), fine, coarse[0], coarse[1])
  if (r.err >= MAX_FIT_ERROR_M) return null
  KNOWN_ORIGINS.push([r.oE, r.oN])
  return { geo: { crs: 'EPSG:2154', offsetE: r.oE, offsetN: r.oN, errorM: r.err }, ways }
}

// ── Datos del tramo ────────────────────────────────────────────────────────

const SURFACE_LABEL: Record<string, string> = {
  asphalt: 'asfalto',
  paved: 'asfalto',
  concrete: 'hormigón',
  'concrete:plates': 'hormigón',
  paving_stones: 'adoquín',
  sett: 'adoquín',
  cobblestone: 'adoquín',
  gravel: 'grava',
  fine_gravel: 'grava fina',
  compacted: 'tierra compactada',
  unpaved: 'tierra',
  dirt: 'tierra',
  earth: 'tierra',
  ground: 'tierra',
  mud: 'barro',
  grass: 'pasto',
  sand: 'arena',
}

function surfacesOf(line: StagePoint[], ways: Way[], oE: number, oN: number): StageSurface[] {
  if (!ways.length) return []
  const idx = new WayIndex(ways)
  const out: StageSurface[] = []
  for (let i = 0; i < line.length; i += 4) {
    const p = line[i]
    const { way } = idx.nearest(p.z + oE, p.x + oN, 15)
    const kind = way?.surface ? (SURFACE_LABEL[way.surface] ?? way.surface) : 'sin dato'
    const road = way?.name ?? null
    const last = out[out.length - 1]
    if (last && last.kind === kind && last.road === road) last.toM = p.d
    else {
      if (last) last.toM = p.d
      out.push({ fromM: p.d, toM: p.d, kind, road })
    }
  }
  if (out.length) out[out.length - 1].toM = line[line.length - 1].d
  // Tramos cortitos (cruces, un dato suelto) se descartan y los vecinos iguales se unen
  const merged: StageSurface[] = []
  for (const s of out.filter((s, i) => i === 0 || s.toM - s.fromM >= 60 || i === out.length - 1)) {
    const last = merged[merged.length - 1]
    if (last && last.kind === s.kind && last.road === s.road) last.toM = s.toM
    else {
      if (last) last.toM = s.fromM
      merged.push({ ...s })
    }
  }
  return merged
}

function statsOf(line: StagePoint[]): StageStats | null {
  if (line.length < 10) return null
  const alts = line.map((p) => p.y)
  let climb = 0
  let descent = 0
  // Desnivel cada 25 m para no sumar el ruido de la suspensión
  for (let i = 5; i < line.length; i += 5) {
    const dy = line[i].y - line[i - 5].y
    if (dy > 0) climb += dy
    else descent -= dy
  }
  let maxUp = 0
  let maxDown = 0
  for (let i = 10; i < line.length; i++) {
    const dd = line[i].d - line[i - 10].d
    if (dd <= 0) continue
    const g = ((line[i].y - line[i - 10].y) / dd) * 100
    maxUp = Math.max(maxUp, g)
    maxDown = Math.min(maxDown, g)
  }
  // Horquillas: el camino da vuelta más de 150° en menos de 80 m
  const heading = line.map((_, i) => {
    const q = line[Math.min(line.length - 1, i + 1)]
    const o = line[Math.max(0, i - 1)]
    return Math.atan2(q.z - o.z, q.x - o.x)
  })
  const hairpins: { distM: number }[] = []
  let skipUntil = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i].d < skipUntil) continue
    let turn = 0
    for (let j = i + 1; j < line.length && line[j].d - line[i].d <= 80; j++) {
      let dh = heading[j] - heading[j - 1]
      if (dh > Math.PI) dh -= 2 * Math.PI
      if (dh < -Math.PI) dh += 2 * Math.PI
      turn += dh
      if (Math.abs(turn) > (150 * Math.PI) / 180) {
        hairpins.push({ distM: Math.round((line[i].d + line[j].d) / 2) })
        skipUntil = line[j].d + 40
        break
      }
    }
  }
  return {
    altStartM: Math.round(alts[0]),
    altFinishM: Math.round(alts[alts.length - 1]),
    altMinM: Math.round(Math.min(...alts)),
    altMaxM: Math.round(Math.max(...alts)),
    climbM: Math.round(climb),
    descentM: Math.round(descent),
    maxUpPct: Math.round(maxUp * 10) / 10,
    maxDownPct: Math.round(maxDown * 10) / 10,
    hairpins,
  }
}

function tilesOf(line: StagePoint[], oE: number, oN: number): StageTile[] {
  const keys = new Set<string>()
  for (let i = 0; i < line.length; i += 5) {
    const e = line[i].z + oE
    const n = line[i].x + oN
    for (const de of [-TILE_MARGIN_M, 0, TILE_MARGIN_M])
      for (const dn of [-TILE_MARGIN_M, 0, TILE_MARGIN_M]) keys.add(`${Math.floor((e + de) / TILE_M) * TILE_M},${Math.floor((n + dn) / TILE_M) * TILE_M}`)
  }
  const out: StageTile[] = []
  for (const layer of Object.keys(LAYERS) as StageLayer[]) {
    for (const k of keys) {
      const [e, n] = k.split(',').map(Number)
      out.push({ layer, z0: e - oE, x0: n - oN, z1: e + TILE_M - oE, x1: n + TILE_M - oN, url: `/api/stage-tile?${new URLSearchParams({ layer, e: String(e), n: String(n) })}` })
    }
  }
  return out
}

// ── API ────────────────────────────────────────────────────────────────────

export class StageMaps {
  private pending = new Map<string, Promise<StageMapData>>()

  constructor(
    private stagesDir: string,
    private tilesDir: string,
  ) {}

  /** Mapa del tramo (`id` = archivo del tramo, sin el prefijo "acr/"). */
  get(id: string): Promise<StageMapData> {
    const file = loadStage(this.stagesDir, id)
    const key = `${id}|${file?.line.length ?? 0}|${file?.splitsM.join(',') ?? ''}|${file?.geo ? 1 : 0}`
    let p = this.pending.get(key)
    if (!p) {
      p = this.build(id, file).catch((err) => {
        this.pending.delete(key)
        throw err
      })
      this.pending.set(key, p)
    }
    return p
  }

  private async build(id: string, file: StageFile | null): Promise<StageMapData> {
    const empty = (note: string): StageMapData => ({
      stageId: id,
      name: file?.name ?? id,
      lengthM: file ? stageLength(file) : null,
      line: [],
      splitsM: file?.splitsM ?? [],
      splitsSource: file?.splitsSource ?? null,
      stats: null,
      geo: null,
      tiles: [],
      surfaces: [],
      credits: [],
      note,
    })
    if (!file) return empty('Todavía no hay datos de este tramo.')
    if (!file.line.length) return empty('El mapa aparece después de la primera pasada completa.')
    const line: StagePoint[] = file.line.map(([d, x, y, z]) => ({ d, x, y, z }))

    let ways: Way[] = []
    if (file.geo === undefined) {
      try {
        const r = await register(file, line)
        file.geo = r?.geo ?? null
        ways = r?.ways ?? []
        if (r) file.surfaces = surfacesOf(line, ways, r.geo.offsetE, r.geo.offsetN)
      } catch (err) {
        // Sin conexión: se reintenta en el próximo pedido
        console.error('[acr] no se pudo registrar el tramo:', err)
        return { ...empty('No se pudo descargar la cartografía (¿sin conexión?). Se reintenta al volver a abrir el mapa.'), line, stats: statsOf(line) }
      }
      saveStage(this.stagesDir, file)
    }
    const geo = file.geo ?? null
    return {
      stageId: id,
      name: file.name,
      lengthM: stageLength(file),
      line,
      splitsM: file.splitsM,
      splitsSource: file.splitsSource,
      stats: statsOf(line),
      geo,
      tiles: geo ? tilesOf(line, geo.offsetE, geo.offsetN) : [],
      surfaces: file.surfaces ?? [],
      credits: geo ? STAGE_CREDITS : [],
      note: geo
        ? `Registrado a la cartografía del IGN (error medio ${geo.errorM.toFixed(1)} m)`
        : 'Sin fondo: este tramo no calzó con la cartografía de Francia (los de otros países todavía no tienen fondo).',
    }
  }

  /** Tesela del IGN (500 m en Lambert-93), guardada en disco la primera vez. */
  async tile(layer: string, e: number, n: number): Promise<{ body: Buffer; mime: string }> {
    const spec = LAYERS[layer as StageLayer]
    if (!spec || !Number.isFinite(e) || !Number.isFinite(n) || e % TILE_M || n % TILE_M) throw new Error('Tesela inválida')
    const ext = spec.format === 'image/jpeg' ? 'jpg' : 'png'
    const dir = join(this.tilesDir, layer)
    const file = join(dir, `${e}_${n}.${ext}`)
    if (existsSync(file)) return { body: readFileSync(file), mime: spec.format }
    const q = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.3.0',
      REQUEST: 'GetMap',
      LAYERS: spec.wms,
      STYLES: '',
      CRS: 'EPSG:2154',
      BBOX: `${e},${n},${e + TILE_M},${n + TILE_M}`,
      WIDTH: String(TILE_PX),
      HEIGHT: String(TILE_PX),
      FORMAT: spec.format,
      TRANSPARENT: 'true',
    })
    const r = await fetch(`https://data.geopf.fr/wms-r/wms?${q}`, { headers: { 'User-Agent': UA } })
    const type = r.headers.get('content-type') ?? ''
    if (!r.ok || !type.startsWith('image/')) throw new Error(`IGN respondió ${r.status} (${type})`)
    const body = Buffer.from(await r.arrayBuffer())
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, body)
    return { body, mime: spec.format }
  }
}
