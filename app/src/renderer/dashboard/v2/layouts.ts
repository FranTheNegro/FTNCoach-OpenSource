/** Layouts de la pantalla "En vivo" y skins del dashboard. */
import type { CarCategory } from '@shared/category'

export const LAYOUT_IDS = ['gt', 'formula', 'oval', 'rally'] as const
export type LayoutId = (typeof LAYOUT_IDS)[number]

export const LAYOUTS: Record<LayoutId, { name: string; hint: string }> = {
  gt: { name: 'GT / Sports car', hint: 'Tiempos, conducción, rivales y el auto completo' },
  formula: { name: 'Fórmula', hint: 'Luces de cambio y marcha grandes, sectores y gomas a la vista' },
  oval: { name: 'Óvalo', hint: 'Posición, vueltas que faltan, combustible al final y rivales grandes' },
  rally: { name: 'Rally', hint: 'Simple y opaco: marcha, tramo y parciales' },
}

/** Layout que corresponde a cada categoría de auto. */
export function layoutFor(category: CarCategory | null | undefined): LayoutId {
  switch (category) {
    case 'formula':
      return 'formula'
    case 'oval':
      return 'oval'
    case 'rally':
    case 'drift':
    case 'calle':
      return 'rally'
    default:
      return 'gt'
  }
}

export const SKIN_IDS = ['ftn', 'oled', 'ultramar', 'grafito', 'arena', 'bosque', 'borgona'] as const
export type SkinId = (typeof SKIN_IDS)[number]

/**
 * Variaciones de los tokens de superficie (fondos, paneles, bordes y acento).
 * Los colores de dato (mejor, récord, alerta, error) no cambian: dicen algo.
 */
export const SKINS: Record<SkinId, { name: string; vars: Record<string, string> }> = {
  ftn: { name: 'FTN', vars: {} },
  oled: { name: 'Negro OLED', vars: { '--ftn-carbono': '#000000', '--ftn-carbono-2': '#0b0c0f', '--ftn-grafito': '#1b1e24', '--ftn-acero': '#2a2e36' } },
  ultramar: {
    name: 'Ultramar',
    vars: { '--ftn-carbono': '#0a0e2a', '--ftn-carbono-2': '#121845', '--ftn-grafito': '#222a66', '--ftn-acero': '#323b80', '--ftn-azul': '#7d95ff' },
  },
  grafito: { name: 'Grafito', vars: { '--ftn-carbono': '#1c1f25', '--ftn-carbono-2': '#2a2e36', '--ftn-grafito': '#3b404b', '--ftn-acero': '#4c5260', '--ftn-niebla': '#a3aab6' } },
  arena: { name: 'Arena', vars: { '--ftn-carbono': '#17140f', '--ftn-carbono-2': '#221e17', '--ftn-grafito': '#352f25', '--ftn-acero': '#473f31', '--ftn-niebla': '#a09784' } },
  bosque: { name: 'Bosque', vars: { '--ftn-carbono': '#0c1411', '--ftn-carbono-2': '#14201b', '--ftn-grafito': '#22322b', '--ftn-acero': '#31453b', '--ftn-niebla': '#8ea398' } },
  borgona: { name: 'Borgoña', vars: { '--ftn-carbono': '#160c10', '--ftn-carbono-2': '#231419', '--ftn-grafito': '#372029', '--ftn-acero': '#4b2c37', '--ftn-niebla': '#a8909a' } },
}

/** Aplica la skin a toda la página (también al fondo fuera del escenario). */
export function applySkin(id: SkinId): void {
  const root = document.documentElement
  for (const skin of Object.values(SKINS)) for (const k of Object.keys(skin.vars)) root.style.removeProperty(k)
  for (const [k, v] of Object.entries(SKINS[id].vars)) root.style.setProperty(k, v)
}
