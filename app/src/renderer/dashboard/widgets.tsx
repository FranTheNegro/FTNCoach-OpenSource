import { useRef } from 'react'
import type { Flag } from '@shared/live'

export const FLAG_INFO: Record<Flag, { label: string; color: string; wave?: boolean }> = {
  checkered: { label: 'Bandera a cuadros', color: 'var(--ftn-blanco)' },
  red: { label: 'Bandera roja', color: 'var(--ftn-error)', wave: true },
  black: { label: 'Bandera negra', color: 'var(--ftn-niebla)', wave: true },
  meatball: { label: 'Reparación obligatoria', color: 'var(--ftn-alerta)', wave: true },
  penalty: { label: 'Penalización', color: 'var(--ftn-error)', wave: true },
  yellow: { label: 'Bandera amarilla', color: 'var(--ftn-alerta)', wave: true },
  blue: { label: 'Bandera azul', color: 'var(--ftn-azul)', wave: true },
  white: { label: 'Última vuelta', color: 'var(--ftn-blanco)' },
  green: { label: 'Bandera verde', color: 'var(--ftn-record)' },
}

/** La verde se anuncia al aparecer; después es el estado normal de la pista y no hace falta mirarla. */
const GREEN_SHOW_MS = 8000

/** La bandera a mostrar: la más importante, o la verde durante sus primeros segundos. */
export function useShownFlag(flags: Flag[]): Flag | null {
  const greenSince = useRef<number | null>(null)
  const green = flags.includes('green')
  if (!green) greenSince.current = null
  else greenSince.current ??= Date.now()
  const other = flags.find((x) => x !== 'green')
  if (other) return other
  return green && Date.now() - greenSince.current! < GREEN_SHOW_MS ? 'green' : null
}

/** Marco de color alrededor de toda la pantalla. Va en el margen del escenario: no tapa nada. */
export function FlagFrame({ flag }: { flag: Flag | null }) {
  if (!flag) return null
  const info = FLAG_INFO[flag]
  return <div className={`flag-frame ${info.wave ? 'wave' : ''} ${flag === 'checkered' ? 'checkered' : ''}`} style={{ ['--flag' as string]: info.color }} />
}
