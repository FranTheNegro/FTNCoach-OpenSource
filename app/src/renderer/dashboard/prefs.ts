/** Preferencias de cada dispositivo (la tablet puede usar mph aunque la PC use km/h). */
import { useCallback, useState } from 'react'
import type { Units } from '@shared/api'
import { LAYOUT_IDS, SKIN_IDS, type LayoutId, type SkinId } from './v2/layouts'

export const PAGE_IDS = ['live', 'car', 'laps', 'rivals', 'inputs', 'map'] as const
export type PageId = (typeof PAGE_IDS)[number]

export interface Prefs {
  units: Units
  page: PageId
  /** El layout de "En vivo" sigue la categoría del auto. */
  layoutAuto: boolean
  /** Layout elegido a mano (cuando no es automático). */
  layout: LayoutId
  skin: SkinId
  /** Qué panel muestra cada zona alternable de "En vivo". */
  panels: Record<string, number>
}

const KEY = 'ftn.dashboard.prefs'
const DEFAULTS: Prefs = { units: 'metric', page: 'live', layoutAuto: true, layout: 'gt', skin: 'ftn', panels: {} }

function pick<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback
}

function load(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    // Versiones anteriores guardaban 'race': se vuelve a la pantalla principal
    return {
      ...DEFAULTS,
      ...stored,
      page: pick(PAGE_IDS, stored.page, DEFAULTS.page),
      layout: pick(LAYOUT_IDS, stored.layout, DEFAULTS.layout),
      skin: pick(SKIN_IDS, stored.skin, DEFAULTS.skin),
      layoutAuto: typeof stored.layoutAuto === 'boolean' ? stored.layoutAuto : DEFAULTS.layoutAuto,
      panels: stored.panels && typeof stored.panels === 'object' ? stored.panels : DEFAULTS.panels,
    }
  } catch {
    return DEFAULTS
  }
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(load)
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // Navegación privada o almacenamiento lleno: la preferencia dura hasta recargar
      }
      return next
    })
  }, [])
  return [prefs, update]
}
