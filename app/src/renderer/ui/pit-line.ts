/**
 * Calle de boxes como línea. El mapa oficial de iRacing la trae como cápsulas sueltas
 * (cada guion es un contorno cerrado con las puntas redondeadas); de Assetto Corsa llega
 * ya como línea. Acá todo queda como líneas centrales, para dibujarlas con un mismo
 * punteado parejo en vez de repetir el contorno de cada pieza.
 */
type Point = [number, number]

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

function lengthOf(c: Point[]): number {
  let len = 0
  for (let i = 1; i < c.length; i++) len += dist(c[i - 1], c[i])
  return len
}

/** Puntos repartidos a distancia pareja a lo largo del trazo. */
function resample(c: Point[], n: number): Point[] {
  const total = lengthOf(c)
  if (total === 0) return Array.from({ length: n }, () => c[0])
  const out: Point[] = []
  let seg = 1
  let walked = 0
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total
    while (seg < c.length - 1 && walked + dist(c[seg - 1], c[seg]) < target) {
      walked += dist(c[seg - 1], c[seg])
      seg++
    }
    const d = dist(c[seg - 1], c[seg]) || 1
    const t = Math.min(1, Math.max(0, (target - walked) / d))
    out.push([c[seg - 1][0] + (c[seg][0] - c[seg - 1][0]) * t, c[seg - 1][1] + (c[seg][1] - c[seg - 1][1]) * t])
  }
  return out
}

/** Contorno cerrado y fino → línea por el medio: se parte en sus dos puntas y se promedian los lados. */
function centerOf(contour: Point[]): Point[] {
  const c = dist(contour[0], contour[contour.length - 1]) < 1e-6 ? contour.slice(0, -1) : contour
  if (c.length < 4) return c
  let ia = 0
  let ib = 0
  let far = -1
  const stride = Math.max(1, Math.floor(c.length / 200))
  for (let i = 0; i < c.length; i += stride)
    for (let k = i + 1; k < c.length; k += stride) {
      const d = dist(c[i], c[k])
      if (d > far) {
        far = d
        ia = i
        ib = k
      }
    }
  const sideA = c.slice(ia, ib + 1)
  const sideB = [...c.slice(ib), ...c.slice(0, ia + 1)].reverse()
  const n = Math.max(2, Math.min(200, Math.round(Math.max(sideA.length, sideB.length) / 2)))
  const a = resample(sideA, n)
  const b = resample(sideB, n)
  return a.map((p, i) => [(p[0] + b[i][0]) / 2, (p[1] + b[i][1]) / 2])
}

/** Un contorno cerrado vuelve a su inicio; una línea abierta termina lejos. */
const isClosed = (c: Point[]) => c.length >= 4 && dist(c[0], c[c.length - 1]) < Math.max(lengthOf(c) * 0.05, 1e-3)

/** Une las piezas seguidas: cada una continúa por la punta libre más cercana. */
function chain(pieces: Point[][]): Point[][] {
  if (pieces.length < 2) return pieces
  const gaps = pieces.map((p, i) => {
    let best = Infinity
    pieces.forEach((q, k) => {
      if (k !== i) for (const a of [p[0], p[p.length - 1]]) for (const b of [q[0], q[q.length - 1]]) best = Math.min(best, dist(a, b))
    })
    return best
  })
  const typical = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1]
  // Más lejos que esto ya no es el guion siguiente, sino otra parte del mapa
  const maxGap = Math.max(typical * 4, 1e-6)

  const free = new Set(pieces.map((_, i) => i))
  const out: Point[][] = []
  const take = (from: Point): Point[] | null => {
    let found = -1
    let flip = false
    let best = maxGap
    for (const i of free) {
      const p = pieces[i]
      const toStart = dist(from, p[0])
      const toEnd = dist(from, p[p.length - 1])
      if (toStart <= best) {
        best = toStart
        found = i
        flip = false
      }
      if (toEnd <= best) {
        best = toEnd
        found = i
        flip = true
      }
    }
    if (found < 0) return null
    free.delete(found)
    return flip ? pieces[found].slice().reverse() : pieces[found]
  }
  while (free.size) {
    const first = free.values().next().value as number
    free.delete(first)
    let line = pieces[first].slice()
    for (let next = take(line[line.length - 1]); next; next = take(line[line.length - 1])) line = line.concat(next)
    for (let prev = take(line[0]); prev; prev = take(line[0])) line = prev.slice().reverse().concat(line)
    out.push(line)
  }
  return out
}

export function pitLines(contours: Point[][] | null | undefined): Point[][] {
  if (!contours?.length) return []
  return chain(contours.filter((c) => c.length >= 2).map((c) => (isClosed(c) ? centerOf(c) : c)))
}
