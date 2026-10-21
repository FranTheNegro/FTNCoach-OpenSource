import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePath, svgLabels } from '../src/main/analysis/track-map/svg'
import { Raster, fitSimilarity, nelderMead, PointGrid } from '../src/main/analysis/track-map/geom'
import { acGeometry, findAcRoot, parseFastLane } from '../src/main/analysis/track-map/ac'
import { TrackMaps } from '../src/main/analysis/track-map'
import { loadSession } from '../src/main/analysis/session'
import { localIbtFiles } from './fixtures'

describe('geometría', () => {
  it('parsea paths con líneas, curvas y arcos', () => {
    const [sq] = parsePath('M0,0 H10 V10 h-10 z', 1)
    expect(sq.length).toBeGreaterThan(30)
    const [circle] = parsePath('M0,5 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0', 0.5)
    for (const [x, y] of circle) expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(5, 1)
  })

  it('ráster nonzero con distancia al borde', () => {
    // Anillo: cuadrado de 100 con agujero de 60 (sentido contrario)
    const outer = parsePath('M0,0 H100 V100 H0 Z', 1)[0]
    const inner = parsePath('M20,20 V80 H80 V20 Z', 1)[0]
    const r = new Raster([outer, inner], 1, 5)
    expect(r.isInside(10, 50)).toBe(true)
    expect(r.isInside(50, 50)).toBe(false)
    expect(r.sample(10, 50)).toBeGreaterThan(8)
    expect(r.sample(10, 50)).toBeLessThan(12)
    expect(r.sample(50, 50)).toBeLessThan(-25)
    expect(r.ribbonWidth()).toBeGreaterThan(18)
    expect(r.ribbonWidth()).toBeLessThan(22)
  })

  it('ajuste de semejanza, vecino más cercano y Nelder-Mead', () => {
    const a: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [3, 8],
    ]
    const th = 0.7
    const b = a.map(([x, y]) => [2 * (Math.cos(th) * x - Math.sin(th) * y) + 5, 2 * (Math.sin(th) * x + Math.cos(th) * y) - 3] as [number, number])
    const t = fitSimilarity(a, b)
    expect(t.s).toBeCloseTo(2, 6)
    expect(t.theta).toBeCloseTo(th, 6)
    expect(t.tx).toBeCloseTo(5, 6)
    const g = new PointGrid(b)
    expect(g.nearest(b[2][0] + 0.1, b[2][1]).i).toBe(2)
    const x = nelderMead(([p, q]) => (p - 3) ** 2 + (q + 1) ** 2, [0, 0], [1, 1])
    expect(x[0]).toBeCloseTo(3, 3)
    expect(x[1]).toBeCloseTo(-1, 3)
  })

  it('lee los textos del mapa de curvas', () => {
    const svg = `<style>.st2{font-size:36px;}</style><text transform="matrix(1 0 0 1 838.6 108.85)" class="st0">1</text>
      <text transform="matrix(1 0 0 1 944.6 274.72)" class="st0">The Avenue</text>`
    const labels = svgLabels(svg)
    expect(labels.map((l) => l.text)).toEqual(['1', 'The Avenue'])
    expect(labels[0].y).toBeLessThan(0)
  })
})

const acRoot = findAcRoot()

describe.skipIf(!acRoot)('Assetto Corsa', () => {
  it('fast_lane.ai de Monza: línea y bordes reales', () => {
    const pts = parseFastLane(readFileSync(join(acRoot!, 'content', 'tracks', 'monza', 'ai', 'fast_lane.ai')))
    expect(pts.length).toBeGreaterThan(1000)
    expect(pts[pts.length - 1].len).toBeGreaterThan(5500)
    const widths = pts.map((p) => p.left + p.right).sort((a, b) => a - b)
    expect(widths[widths.length >> 1]).toBeGreaterThan(8)
    expect(widths[widths.length >> 1]).toBeLessThan(16)
  })

  it('geometría de Spa con nombres de curvas', () => {
    const g = acGeometry(acRoot!, 'ac/spa')
    expect(g).not.toBeNull()
    expect(g!.asphalt.length).toBe(2)
    expect(g!.labels.some((l) => l.text === 'Eau Rouge')).toBe(true)
    expect(g!.pctLine!.length).toBe(1001)
  })
})

const ibt = localIbtFiles().filter((f) => f.includes('tsukuba')).at(-1)
const svgDir = join(import.meta.dirname, '..', '..', 'data', 'track_geo', 'iracing', '324')

describe.skipIf(!ibt || !existsSync(join(svgDir, 'active.svg')))('mapa oficial de iRacing', () => {
  it('registra el dibujo de Tsukuba contra el GPS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ftn-geo-'))
    const dir = join(root, 'iracing', '324')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    for (const f of ['active.svg', 'turns.svg', 'start-finish.svg', 'meta.json']) copyFileSync(join(svgDir, f), join(dir, f))

    const s = loadSession(ibt!)
    expect(s.posKind).toBe('gps')
    const maps = new TrackMaps(root)
    const t0 = Date.now()
    const { result, mapper } = await maps.forSession(s)
    console.log('registro', Date.now() - t0, 'ms', result.note)
    expect(result.map).not.toBeNull()
    const align = JSON.parse(readFileSync(join(dir, 'align.json'), 'utf8'))
    console.log('inside', align.insideFraction, 'scale', align.scale, 'theta', align.theta)
    expect(align.insideFraction).toBeGreaterThan(0.8)
    expect(result.map!.widthM).toBeGreaterThan(7)
    expect(result.map!.widthM).toBeLessThan(14)
    expect(result.map!.labels.some((l) => l.turn === 1)).toBe(true)
    expect(mapper).not.toBeNull()
  }, 60_000)
})
