/**
 * Memoria del coach: qué le pidió al piloto en sesiones anteriores y qué pasó
 * después. El veredicto lo calcula la app con la telemetría de las dos sesiones;
 * la IA lo recibe hecho y no puede inventar una mejora.
 */
import { isLocal, type CoachFollowUp, type CoachReport, type FollowUpItem, type FollowUpVerdict, type SessionSummary } from '@shared/analysis'
import { sameCombo, sameCorner } from '@shared/history'

/** Reportes anteriores que se leen: en este auto y pista, y en otros. */
const SAME_COMBO = 2
const OTHER_COMBOS = 3
/** Con menos pasadas limpias, la mediana de la curva no dice nada. */
const MIN_CLEAN_LAPS = 3
/** Por debajo de esta diferencia en la mediana, la curva quedó igual. */
const SAME_BAND_S = 0.05

export interface MemorySources {
  sessions(): SessionSummary[]
  report(id: string): CoachReport | null
  /** Datos de una sesión para el coach (los de `coachData`). */
  data(id: string): Promise<Record<string, unknown>>
}

/** Lo que usa la memoria de cada curva de `coachData`. */
interface CornerData {
  label: string
  name: string | null
  apex_pct: number | null
  clean_laps: number
  best_execution: { brake_point_m: number | null; full_throttle_m: number | null } | null
  median_clean: { segment_time_s: number | null; min_kmh: number | null } | null
}

const cornersOf = (data: Record<string, unknown>): CornerData[] => (Array.isArray(data.corners) ? (data.corners as CornerData[]) : [])

const round = (v: number, k: number) => Math.round(v * 10 ** k) / 10 ** k
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Sin la T del principio: el reporte puede decir "T4" y el mapa oficial "4". */
const cornerKey = (s: string) => s.trim().toLowerCase().replace(/^t(?=\d)/, '')

/** La curva de una corrección, por el título que escribió el coach ("T7 · FRENADA"). */
function cornerOfTitle(title: string, corners: CornerData[]): CornerData | null {
  const head = cornerKey(title.split('·')[0])
  const first = head.split(/\s+/)[0]
  const matches = (c: CornerData, text: string) => cornerKey(c.label) === text || (c.name !== null && cornerKey(c.name) === text)
  return corners.find((c) => matches(c, head)) ?? corners.find((c) => matches(c, first)) ?? null
}

const placed = (c: CornerData) => ({ label: c.label, apexPct: (c.apex_pct ?? -100) / 100 })

interface Measured {
  corner: string | null
  verdict: FollowUpVerdict
  medianGainS: number | null
  minKmhDiff: number | null
  /** Los números para la IA (null si no hay con qué comparar). */
  forCoach: Record<string, unknown> | null
}

/** Compara la curva de una corrección entre la sesión de entonces y la de ahora. */
function measure(title: string, then: CornerData[] | null, now: CornerData[]): Measured {
  const a = then && cornerOfTitle(title, then)
  if (!a || a.apex_pct === null) return { corner: null, verdict: 'unknown', medianGainS: null, minKmhDiff: null, forCoach: null }
  const b = now.find((c) => c.apex_pct !== null && sameCorner(placed(a), placed(c)))
  const before = a.median_clean?.segment_time_s ?? null
  const after = b?.median_clean?.segment_time_s ?? null
  if (!b || before === null || after === null || a.clean_laps < MIN_CLEAN_LAPS || b.clean_laps < MIN_CLEAN_LAPS)
    return { corner: a.label, verdict: 'unknown', medianGainS: null, minKmhDiff: null, forCoach: null }

  const gain = round(before - after, 3)
  const minBefore = a.median_clean?.min_kmh ?? null
  const minAfter = b.median_clean?.min_kmh ?? null
  const verdict: FollowUpVerdict = gain >= SAME_BAND_S ? 'better' : gain <= -SAME_BAND_S ? 'worse' : 'same'
  return {
    corner: a.label,
    verdict,
    medianGainS: gain,
    minKmhDiff: minBefore !== null && minAfter !== null ? minAfter - minBefore : null,
    forCoach: {
      verdict,
      clean_laps_then: a.clean_laps,
      clean_laps_now: b.clean_laps,
      median_then_s: before,
      median_now_s: after,
      median_gain_s: gain,
      median_min_kmh_then: minBefore,
      median_min_kmh_now: minAfter,
      best_brake_point_then_m: a.best_execution?.brake_point_m ?? null,
      best_brake_point_now_m: b.best_execution?.brake_point_m ?? null,
      best_full_throttle_then_m: a.best_execution?.full_throttle_m ?? null,
      best_full_throttle_now_m: b.best_execution?.full_throttle_m ?? null,
    },
  }
}

export interface CoachMemory {
  /** Para el modelo: `coach_memory` en los datos de la sesión. */
  memory: Record<string, unknown> | null
  /** Para la pantalla: lo que se pidió en el último reporte y qué pasó. */
  followUp: CoachFollowUp | null
}

export async function buildMemory(id: string, data: Record<string, unknown>, src: MemorySources): Promise<CoachMemory> {
  const all = src.sessions()
  const current = all.find((s) => s.id === id)
  if (!current) return { memory: null, followUp: null }
  const now = cornersOf(data)

  const earlier = all.filter((s) => s.id !== id && s.startedAt < current.startedAt).sort((a, b) => b.startedAt - a.startedAt)
  const same: { session: SessionSummary; report: CoachReport }[] = []
  const others: { session: SessionSummary; report: CoachReport }[] = []
  for (const session of earlier) {
    if (same.length >= SAME_COMBO && others.length >= OTHER_COMBOS) break
    const list = sameCombo(session, current) ? same : others
    if (list.length >= (list === same ? SAME_COMBO : OTHER_COMBOS)) continue
    const report = src.report(session.id)
    if (report) list.push({ session, report })
  }
  if (!same.length && !others.length) return { memory: null, followUp: null }

  let followUp: CoachFollowUp | null = null
  const sameForCoach: Record<string, unknown>[] = []
  for (const { session, report } of same) {
    // Sin el archivo de la sesión anterior queda lo que se pidió, sin medir
    const then = isLocal(session) ? await src.data(session.id).then(cornersOf, () => null) : null
    const results = report.corrections.map((c) => ({ c, m: measure(c.title, then, now) }))
    sameForCoach.push({
      date: day(session.startedAt),
      best_lap_s: session.bestLapS,
      corrections: results.map(({ c, m }) => ({ title: c.title, current: c.current, target: c.target, solution: c.solution, measured: m.forCoach ?? { verdict: 'unknown' } })),
      drill: report.drill,
    })
    if (!followUp) {
      const items: FollowUpItem[] = results.map(({ c, m }) => ({
        title: c.title,
        solution: c.solution,
        corner: m.corner,
        verdict: m.verdict,
        medianGainS: m.medianGainS,
        minKmhDiff: m.minKmhDiff,
      }))
      followUp = { sessionId: session.id, startedAt: session.startedAt, items, drill: report.drill.description ? report.drill : null }
    }
  }

  return {
    memory: {
      ...(sameForCoach.length ? { same_car_track: sameForCoach } : {}),
      ...(others.length
        ? {
            other_tracks: others.map(({ session, report }) => ({
              date: day(session.startedAt),
              track: session.track,
              car: session.car,
              corrections: report.corrections.map((c) => ({ title: c.title, current: c.current })),
            })),
          }
        : {}),
    },
    followUp,
  }
}
