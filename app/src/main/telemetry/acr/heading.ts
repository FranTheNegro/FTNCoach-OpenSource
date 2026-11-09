/**
 * Hacia dónde apunta el auto en ACR, en grados de brújula (0 = norte, 90 = este).
 *
 * ACR publica `physics.heading`, pero no está documentado en qué eje arranca ni
 * para qué lado crece. En vez de suponerlo, se compara contra el rumbo del
 * movimiento cuando el auto va rápido y derecho: de las ocho convenciones posibles
 * queda la que coincide. Hasta calibrar (o si el juego no lo publica) se usa el
 * rumbo del movimiento, que en un auto que no derrapa es casi lo mismo.
 */

/** Convenciones probadas: rumbo = signo · heading + giro. */
const CANDIDATES = [1, -1].flatMap((sign) => [0, 90, 180, 270].map((turn) => ({ sign, turn })))
/** Muestras buenas para decidir. */
const SAMPLES = 80
/** Error medio máximo aceptado (°). */
const MAX_ERROR_DEG = 12
/** Distancia mínima entre dos puntos para medir el rumbo del movimiento (m). */
const STEP_M = 3

const wrap = (deg: number) => ((deg % 360) + 360) % 360
const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

export class HeadingCalibrator {
  private errors = CANDIDATES.map(() => 0)
  private count = 0
  private minH = Infinity
  private maxH = -Infinity
  /** Convención elegida; null = todavía no, false = el heading no sirve. */
  private chosen: (typeof CANDIDATES)[number] | null | false = null
  private ref: { north: number; east: number } | null = null
  private moving: number | null = null

  /**
   * @param north x del juego (m) · @param east z del juego (m)
   * @param headingRad lo que publica physics.heading
   */
  update(north: number, east: number, headingRad: number, speedKmh: number, steer: number): number | null {
    const ref = this.ref
    if (!ref || Math.hypot(north - ref.north, east - ref.east) > 40) {
      // Primer punto o salto (reubicación del juego): se vuelve a medir desde acá
      this.ref = { north, east }
    } else if (Math.hypot(north - ref.north, east - ref.east) >= STEP_M) {
      this.moving = wrap((Math.atan2(east - ref.east, north - ref.north) * 180) / Math.PI)
      this.ref = { north, east }
      if (this.chosen === null && speedKmh > 30 && Math.abs(steer) < 0.08) this.learn(headingRad, this.moving)
    }
    if (speedKmh < 3) this.moving = null

    const c = this.chosen
    if (c) return wrap(c.sign * ((headingRad * 180) / Math.PI) + c.turn)
    return this.moving
  }

  private learn(headingRad: number, moving: number): void {
    const h = (headingRad * 180) / Math.PI
    this.minH = Math.min(this.minH, h)
    this.maxH = Math.max(this.maxH, h)
    CANDIDATES.forEach((c, i) => (this.errors[i] += diff(wrap(c.sign * h + c.turn), moving)))
    if (++this.count < SAMPLES) return
    // Un heading que no se mueve no está publicado
    if (this.maxH - this.minH < 20) {
      this.chosen = false
      return
    }
    const best = this.errors.indexOf(Math.min(...this.errors))
    this.chosen = this.errors[best] / this.count <= MAX_ERROR_DEG ? CANDIDATES[best] : false
    if (this.chosen) console.log(`[acr] heading calibrado: signo ${this.chosen.sign}, giro ${this.chosen.turn}°`)
    else console.log('[acr] heading no coincide con el movimiento: se usa el rumbo del movimiento')
  }
}
