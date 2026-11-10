/**
 * Estado del calendario y del plan en la ventana, y cómo se cruza con las
 * sesiones grabadas: una salida del plan cuenta como hecha si esa semana hubo una
 * sesión con ese auto y esa pista.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SessionSummary } from '@shared/analysis'
import { dayDate, matches, type PlanState, type RaceEvent } from '@shared/plan'

export const cleanError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** El estado del plan, una forma de correr acciones y el error de la última que falló al pedirla. */
export function usePlan(): [PlanState | null, (p: Promise<PlanState>) => Promise<void>, string | null] {
  const [st, setSt] = useState<PlanState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.ftn.planState().then(setSt)
    return window.ftn.onPlan(setSt)
  }, [])
  const run = useCallback(async (p: Promise<PlanState>) => {
    setError(null)
    try {
      setSt(await p)
    } catch (e) {
      setError(cleanError(e))
    }
  }, [])
  return [st, run, error]
}

const DAY_MS = 24 * 3600 * 1000

export { itemDone, matches, sessionFor, sessionsOfWeek } from '@shared/plan'

/** Cómo llega a una carrera: sesiones con ese auto y esa pista. */
export function readiness(e: RaceEvent, sessions: SessionSummary[]): { sessions: number; bestS: number | null; last: number | null } {
  const list = sessions.filter((s) => matches(e, s))
  const best = list.map((s) => s.bestLapS).filter((v): v is number => v !== null)
  return { sessions: list.length, bestS: best.length ? Math.min(...best) : null, last: list.length ? Math.max(...list.map((s) => s.startedAt)) : null }
}

export const shortDate = (day: string) => dayDate(day).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

export const weekLabel = (start: string) => `Semana del ${dayDate(start).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`

export function daysUntil(day: string): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((dayDate(day).getTime() - 12 * 3600 * 1000 - today) / DAY_MS)
}

export const INPUT = 'w-full px-3 rounded-control bg-carbono border border-acero text-blanco placeholder:text-niebla focus:border-azul outline-none'
