/**
 * Parser mínimo de los SVG de mapas de iRacing: paths (M L H V C S Q T A Z,
 * absolutos y relativos) muestreados como polilíneas, y los textos de curvas.
 * Todo sale con y hacia arriba (como el norte), igual que la telemetría.
 */
import type { Point } from '@shared/analysis'

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

export function parsePath(d: string, step = 1.5): Point[][] {
  const toks = d.match(TOKEN) ?? []
  let i = 0
  let cur: Point = [0, 0]
  let start: Point = [0, 0]
  let lastCtrl: Point | null = null
  let cmd = 'M'
  const subs: Point[][] = []
  let pts: Point[] = []

  const num = (): number => Number(toks[i++])
  const isCmd = (t: string | undefined) => t !== undefined && /^[A-Za-z]$/.test(t)

  const line = (p0: Point, p1: Point) => {
    const n = Math.max(1, Math.floor(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / step))
    for (let k = 1; k <= n; k++) pts.push([p0[0] + ((p1[0] - p0[0]) * k) / n, p0[1] + ((p1[1] - p0[1]) * k) / n])
  }
  const cubic = (p0: Point, p1: Point, p2: Point, p3: Point) => {
    const len =
      Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1])
    const n = Math.max(2, Math.floor(len / step))
    for (let k = 1; k < n; k++) {
      const t = k / (n - 1)
      const u = 1 - t
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ])
    }
  }
  // Parametrización por centro (SVG 1.1, apéndice F.6.5)
  const arc = (p0: Point, p1: Point, rx: number, ry: number, phi: number, large: number, sweep: number) => {
    if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) {
      pts.push(p1)
      return
    }
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    const dx = (p0[0] - p1[0]) / 2
    const dy = (p0[1] - p1[1]) / 2
    const x1 = c * dx + s * dy
    const y1 = -s * dx + c * dy
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if (lam > 1) {
      rx *= Math.sqrt(lam)
      ry *= Math.sqrt(lam)
    }
    const num_ = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    let k = Math.sqrt(Math.max(0, num_ / (rx * rx * y1 * y1 + ry * ry * x1 * x1)))
    if (large === sweep) k = -k
    const cx1 = (k * rx * y1) / ry
    const cy1 = (-k * ry * x1) / rx
    const cx = c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2
    const cy = s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
    if (!sweep && dt > 0) dt -= 2 * Math.PI
    else if (sweep && dt < 0) dt += 2 * Math.PI
    const n = Math.max(2, Math.floor((Math.abs(dt) * Math.max(rx, ry)) / step))
    for (let j = 1; j < n; j++) {
      const t = t1 + (dt * j) / (n - 1)
      pts.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c])
    }
  }

  while (i < toks.length) {
    if (isCmd(toks[i])) {
      cmd = toks[i++]
      if (cmd === 'Z' || cmd === 'z') {
        if (pts.length) {
          line(cur, start)
          subs.push(pts)
          pts = []
        }
        cur = [start[0], start[1]]
        lastCtrl = null
        continue
      }
    }
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const bx = rel ? cur[0] : 0
    const by = rel ? cur[1] : 0
    const P = (): Point => {
      const x = num()
      const y = num()
      return [bx + x, by + y]
    }
    if (C === 'M') {
      if (pts.length) subs.push(pts)
      cur = P()
      start = [cur[0], cur[1]]
      pts = [[cur[0], cur[1]]]
      // Coordenadas extra después de M son líneas
      cmd = rel ? 'l' : 'L'
      lastCtrl = null
    } else if (C === 'L') {
      const p1 = P()
      line(cur, p1)
      cur = p1
      lastCtrl = null
    } else if (C === 'H') {
      const x = num()
      const p1: Point = [rel ? cur[0] + x : x, cur[1]]
      line(cur, p1)
      cur = p1
      lastCtrl = null
    } else if (C === 'V') {
      const y = num()
      const p1: Point = [cur[0], rel ? cur[1] + y : y]
      line(cur, p1)
      cur = p1
      lastCtrl = null
    } else if (C === 'C') {
      const p1 = P()
      const p2 = P()
      const p3 = P()
      cubic(cur, p1, p2, p3)
      lastCtrl = p2
      cur = p3
    } else if (C === 'S') {
      const p1: Point = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur
      const p2 = P()
      const p3 = P()
      cubic(cur, p1, p2, p3)
      lastCtrl = p2
      cur = p3
    } else if (C === 'Q') {
      const q = P()
      const p3 = P()
      cubic(
        cur,
        [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])],
        [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])],
        p3,
      )
      lastCtrl = null
      cur = p3
    } else if (C === 'T') {
      const p3 = P()
      line(cur, p3)
      lastCtrl = null
      cur = p3
    } else if (C === 'A') {
      const rx = Math.abs(num())
      const ry = Math.abs(num())
      const phi = (num() * Math.PI) / 180
      const large = num()
      const sweep = num()
      const p3 = P()
      arc(cur, p3, rx, ry, phi, large, sweep)
      lastCtrl = null
      cur = p3
    } else {
      throw new Error(`Comando SVG no soportado: ${cmd}`)
    }
  }
  if (pts.length) subs.push(pts)
  return subs.filter((s) => s.length > 2)
}

/** Todos los contornos de los <path> del SVG, con y hacia arriba. */
export function svgContours(svg: string, step = 1.5): Point[][] {
  const out: Point[][] = []
  for (const m of svg.matchAll(/<path[^>]*?\sd="([^"]+)"/gs)) {
    for (const sub of parsePath(m[1], step)) out.push(sub.map(([x, y]) => [x, -y]))
  }
  return out
}

export interface SvgLabel {
  text: string
  /** Centro aproximado del texto, con y hacia arriba. */
  x: number
  y: number
}

/** Textos del mapa de curvas: números ("4") y nombres ("Foster's"). */
export function svgLabels(svg: string): SvgLabel[] {
  const out: SvgLabel[] = []
  const size = Number(/font-size:\s*([\d.]+)px/.exec(svg)?.[1] ?? 36)
  for (const m of svg.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = m[1]
    const text = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#x27;|&apos;|&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    let x: number | null = null
    let y: number | null = null
    const mt = /matrix\(\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+[-\d.e]+[\s,]+[-\d.e]+[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(attrs)
    const tr = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(attrs)
    if (mt) {
      x = Number(mt[1])
      y = Number(mt[2])
    } else if (tr) {
      x = Number(tr[1])
      y = Number(tr[2])
    } else {
      const ax = /\sx="([-\d.e]+)"/.exec(attrs)
      const ay = /\sy="([-\d.e]+)"/.exec(attrs)
      if (ax && ay) {
        x = Number(ax[1])
        y = Number(ay[1])
      }
    }
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue
    // El ancla es la línea base a la izquierda: se lleva al centro del texto
    out.push({ text, x: x + text.length * size * 0.28, y: -(y - size * 0.35) })
  }
  return out
}
