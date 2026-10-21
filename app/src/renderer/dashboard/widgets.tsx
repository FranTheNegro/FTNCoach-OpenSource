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

/** Marco de color en toda la pantalla con la bandera más importante (no la verde de siempre). */
export function FlagFrame({ flags }: { flags: Flag[] }) {
  const flag = flags.find((x) => x !== 'green')
  if (!flag) return null
  const info = FLAG_INFO[flag]
  return (
    <div
      className={`flag-frame ${info.wave ? 'wave' : ''} ${flag === 'checkered' ? 'checkered' : ''}`}
      style={{ ['--flag' as string]: info.color }}
    >
      <span className="flag-label">{info.label}</span>
    </div>
  )
}
