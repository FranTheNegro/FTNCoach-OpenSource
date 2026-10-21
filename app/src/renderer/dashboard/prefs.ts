/** Preferencias de cada dispositivo (la tablet puede usar mph aunque la PC use km/h). */
import { useCallback, useState } from 'react'
import type { Units } from '@shared/api'

export const PAGE_IDS = ['live', 'car', 'laps', 'rivals', 'inputs', 'map'] as const
export type PageId = (typeof PAGE_IDS)[number]

export interface Prefs {
  units: Units
  page: PageId
}

const KEY = 'ftn.dashboard.prefs'
const DEFAULTS: Prefs = { units: 'metric', page: 'live' }

function load(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    // Versiones anteriores guardaban 'race': se vuelve a la pantalla principal
    const page = PAGE_IDS.includes(stored.page as PageId) ? (stored.page as PageId) : DEFAULTS.page
    return { ...DEFAULTS, ...stored, page }
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
