/**
 * Geometría 2D para el mapa de pista: vecino más cercano, ajuste de semejanza,
 * ráster del asfalto con distancia al borde y optimización Nelder-Mead.
 */
import type { Point } from '@shared/analysis'

export function polylineLength(c: Point[]): number {
  let len = 0
  for (let i = 1; i < c.length; i++) len += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1])
  return len
}

export function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((x, y) => x - y)
  if (!a.length) return NaN
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const a = Array.from(values).sort((x, y) => x - y)
  if (!a.length) return NaN
  const k = (a.length - 1) * (p / 100)
  const i = Math.floor(k)
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * (k - i) : a[i]
}

/** Índice de grilla para buscar el punto más cercano. */
export class PointGrid {
  private cells = new Map<number, number[]>()
  private readonly cell: number

  constructor(
    readonly pts: Point[],
    cell?: number,
  ) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of pts) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    this.cell = cell ?? Math.max(1e-6, Math.sqrt(((maxX - minX) * (maxY - minY)) / Math.max(1, pts.length)) * 2)
    pts.forEach(([x, y], i) => {
      const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell))
      const list = this.cells.get(k)
      if (list) list.push(i)
      else this.cells.set(k, [i])
    })
  }

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768)
  }

  /** Índice y distancia del punto más cercano. */
  nearest(x: number, y: number): { i: number; d: number } {
    const cx = Math.floor(x / this.cell)
    const cy = Math.floor(y / this.cell)
    let best = -1
    let bestD2 = Infinity
    for (let r = 0; r < 4096; r++) {
      // Ya no puede haber nada más cerca que lo encontrado
      if (best >= 0 && (r - 1) * this.cell > Math.sqrt(bestD2)) break
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue
          const list = this.cells.get(this.key(cx + i, cy + j))
          if (!list) continue
          for (const k of list) {
            const dx = this.pts[k][0] - x
            const dy = this.pts[k][1] - y
            const d2 = dx * dx + dy * dy
            if (d2 < bestD2) {
              bestD2 = d2
              best = k
            }
          }
        }
      }
      if (r > 64 && best < 0) break
    }
    return { i: best, d: Math.sqrt(bestD2) }
  }
}

export interface Similarity {
  s: number
  theta: number
  tx: number
  ty: number
}

export function rotate(theta: number, x: number, y: number): Point {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [c * x - s * y, s * x + c * y]
}

/** b ≈ s·R·a + t (Procrustes 2D, sin reflexión). */
export function fitSimilarity(a: Point[], b: Point[]): Similarity {
  const n = a.length
  let ax = 0
  let ay = 0
  let bx = 0
  let by = 0
  for (let i = 0; i < n; i++) {
    ax += a[i][0]
    ay += a[i][1]
    bx += b[i][0]
    by += b[i][1]
  }
  ax /= n
  ay /= n
  bx /= n
  by /= n
  let sc = 0
  let ss = 0
  let aa = 0
  for (let i = 0; i < n; i++) {
    const x0 = a[i][0] - ax
    const y0 = a[i][1] - ay
    const x1 = b[i][0] - bx
    const y1 = b[i][1] - by
    sc += x0 * x1 + y0 * y1
    ss += x0 * y1 - y0 * x1
    aa += x0 * x0 + y0 * y0
  }
  const theta = Math.atan2(ss, sc)
  const s = Math.hypot(sc, ss) / Math.max(aa, 1e-9)
  const [rx, ry] = rotate(theta, ax, ay)
  return { s, theta, tx: bx - s * rx, ty: by - s * ry }
}

/** Aplica la semejanza: s·R·p + t. */
export function applySim(t: Similarity, p: Point): Point {
  const [x, y] = rotate(t.theta, p[0], p[1])
  return [t.s * x + t.tx, t.s * y + t.ty]
}

/** Inversa: Rᵀ·(q − t)/s. */
export function invertSim(t: Similarity, q: Point): Point {
  const [x, y] = rotate(-t.theta, q[0] - t.tx, q[1] - t.ty)
  return [x / t.s, y / t.s]
}

// ── Ráster del asfalto ──────────────────────────────────────────────────────

/** Transformada de distancia euclídea 1D (Felzenszwalb & Huttenlocher) sobre f². */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/**
 * El asfalto rasterizado (regla nonzero, la del SVG: en trazados con cruce la
 * par-impar rellenaría el infield) con la distancia con signo al borde:
 * positiva adentro, negativa afuera, en las unidades de los contornos.
 */
export class Raster {
  readonly w: number
  readonly h: number
  readonly x0: number
  readonly y0: number
  readonly inside: Uint8Array
  readonly sdf: Float32Array

  constructor(
    contours: Point[][],
    readonly cell: number,
    margin = 40,
  ) {
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
    this.x0 = minX - margin
    this.y0 = minY - margin
    this.w = Math.ceil((maxX - minX + 2 * margin) / cell) + 1
    this.h = Math.ceil((maxY - minY + 2 * margin) / cell) + 1
    this.inside = new Uint8Array(this.w * this.h)
    this.fill(contours)
    this.sdf = this.distance()
  }

  private fill(contours: Point[][]): void {
    // Aristas con su sentido, para el número de vueltas
    const edges: [number, number, number, number, number][] = []
    for (const c of contours)
      for (let i = 0; i < c.length; i++) {
        const [x1, y1] = c[i]
        const [x2, y2] = c[(i + 1) % c.length]
        if (y1 !== y2) edges.push([x1, y1, x2, y2, y2 > y1 ? 1 : -1])
      }
    const xs: [number, number][] = []
    for (let r = 0; r < this.h; r++) {
      const y = this.y0 + (r + 0.5) * this.cell
      xs.length = 0
      for (const [x1, y1, x2, y2, dir] of edges) {
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push([x1 + ((y - y1) * (x2 - x1)) / (y2 - y1), dir])
      }
      xs.sort((a, b) => a[0] - b[0])
      let wind = 0
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1]
        if (wind === 0) continue
        const c0 = Math.max(0, Math.ceil((xs[k][0] - this.x0) / this.cell - 0.5))
        const c1 = Math.min(this.w - 1, Math.floor((xs[k + 1][0] - this.x0) / this.cell - 0.5))
        for (let c = c0; c <= c1; c++) this.inside[r * this.w + c] = 1
      }
    }
  }

  private distance(): Float32Array {
    const { w, h, inside } = this
    // Borde = celdas de asfalto con un vecino afuera
    const n = Math.max(w, h)
    const f = new Float64Array(n)
    const d = new Float64Array(n)
    const v = new Int32Array(n)
    const z = new Float64Array(n + 1)
    const grid = new Float64Array(w * h)
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const i = r * w + c
        const edge =
          inside[i] &&
          ((c > 0 && !inside[i - 1]) || (c < w - 1 && !inside[i + 1]) || (r > 0 && !inside[i - w]) || (r < h - 1 && !inside[i + w]))
        grid[i] = edge ? 0 : 1e20
      }
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) f[r] = grid[r * w + c]
      edt1d(f, h, d, v, z)
      for (let r = 0; r < h; r++) grid[r * w + c] = d[r]
    }
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) f[c] = grid[r * w + c]
      edt1d(f, w, d, v, z)
      for (let c = 0; c < w; c++) grid[r * w + c] = d[c]
    }
    const out = new Float32Array(w * h)
    // +½ celda: el borde real está entre la celda de asfalto y la de afuera
    for (let i = 0; i < w * h; i++) {
      const dist = Math.sqrt(grid[i]) * this.cell
      out[i] = inside[i] ? dist + this.cell / 2 : -(dist - this.cell / 2)
    }
    return out
  }

  /** Distancia con signo al borde en (x, y), interpolada. Afuera del ráster: muy negativa. */
  sample(x: number, y: number): number {
    const fx = (x - this.x0) / this.cell - 0.5
    const fy = (y - this.y0) / this.cell - 0.5
    const c = Math.floor(fx)
    const r = Math.floor(fy)
    if (c < 0 || r < 0 || c >= this.w - 1 || r >= this.h - 1) return -1e6
    const tx = fx - c
    const ty = fy - r
    const i = r * this.w + c
    const s = this.sdf
    return (s[i] * (1 - tx) + s[i + 1] * tx) * (1 - ty) + (s[i + this.w] * (1 - tx) + s[i + this.w + 1] * tx) * ty
  }

  isInside(x: number, y: number): boolean {
    const c = Math.floor((x - this.x0) / this.cell)
    const r = Math.floor((y - this.y0) / this.cell)
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return false
    return this.inside[r * this.w + c] === 1
  }

  /** Ancho de la cinta: dos veces la distancia al borde sobre el eje medio (mediana). */
  ribbonWidth(): number {
    const { w, h, sdf } = this
    const ridge: number[] = []
    for (let r = 1; r < h - 1; r++)
      for (let c = 1; c < w - 1; c++) {
        const i = r * w + c
        const v = sdf[i]
        if (v <= this.cell) continue
        let max = true
        for (const o of [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1])
          if (sdf[i + o] > v) {
            max = false
            break
          }
        if (max) ridge.push(v)
      }
    return ridge.length ? 2 * median(ridge) : 0
  }
}

/** Corre cada borde `delta` hacia adentro del asfalto (angosta la cinta sin cambiar su forma). */
export function insetContours(contours: Point[][], delta: number, raster: Raster): Point[][] {
  return contours.map((c) =>
    c.map((p, i) => {
      const a = c[(i - 1 + c.length) % c.length]
      const b = c[(i + 1) % c.length]
      let nx = -(b[1] - a[1])
      let ny = b[0] - a[0]
      const len = Math.hypot(nx, ny) || 1
      nx /= len
      ny /= len
      const probe = Math.max(raster.cell, 0.5)
      const sign = raster.isInside(p[0] + nx * probe, p[1] + ny * probe) ? 1 : -1
      return [p[0] + nx * sign * delta, p[1] + ny * sign * delta] as Point
    }),
  )
}

/** Nelder-Mead clásico (reflexión, expansión, contracción, encogimiento). */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  steps: number[],
  opts: { maxIter?: number; xatol?: number; fatol?: number } = {},
): number[] {
  const n = x0.length
  const maxIter = opts.maxIter ?? 200 * n
  const xatol = opts.xatol ?? 1e-4
  const fatol = opts.fatol ?? 1e-5
  let simplex = [x0.slice(), ...steps.map((s, i) => x0.map((v, j) => (j === i ? v + s : v)))]
  let values = simplex.map(f)
  for (let it = 0; it < maxIter; it++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
    simplex = order.map((i) => simplex[i])
    values = order.map((i) => values[i])
    const spreadX = Math.max(...simplex.slice(1).map((p) => Math.max(...p.map((v, j) => Math.abs(v - simplex[0][j])))))
    const spreadF = Math.max(...values.slice(1).map((v) => Math.abs(v - values[0])))
    if (spreadX <= xatol && spreadF <= fatol) break
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((acc, p) => acc + p[j], 0) / n)
    const worst = simplex[n]
    const at = (t: number) => centroid.map((c, j) => c + t * (worst[j] - c))
    const xr = at(-1)
    const fr = f(xr)
    if (fr < values[0]) {
      const xe = at(-2)
      const fe = f(xe)
      if (fe < fr) {
        simplex[n] = xe
        values[n] = fe
      } else {
        simplex[n] = xr
        values[n] = fr
      }
    } else if (fr < values[n - 1]) {
      simplex[n] = xr
      values[n] = fr
    } else {
      const outside = fr < values[n]
      const xc = at(outside ? -0.5 : 0.5)
      const fc = f(xc)
      if (fc < (outside ? fr : values[n])) {
        simplex[n] = xc
        values[n] = fc
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]))
          values[i] = f(simplex[i])
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values))
  return simplex[best]
}
