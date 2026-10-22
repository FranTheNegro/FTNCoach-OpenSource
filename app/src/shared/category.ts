/**
 * Categoría del auto, para elegir el layout del dashboard. Mismas reglas que la
 * app de AC (resources/ac-app/FTNCoach/lib/presets.lua), más el óvalo de iRacing.
 */

export type CarCategory = 'formula' | 'gt' | 'proto' | 'turismo' | 'oval' | 'rally' | 'drift' | 'calle'

export const CATEGORY_LABEL: Record<CarCategory, string> = {
  formula: 'Fórmula',
  gt: 'GT',
  proto: 'Prototipos',
  turismo: 'Turismo',
  oval: 'Óvalo',
  rally: 'Rally',
  drift: 'Drift',
  calle: 'Calle',
}

// Palabras sueltas (tags, clase, nombre o carpeta del auto) que definen cada categoría
const WORDS = {
  formula: [
    'formula', 'f1', 'f2', 'f3', 'f4', 'indycar', 'indy', 'singleseater', 'openwheel', 'monoplaza', 'fnacional', 'superformula',
    // iRacing
    'dallara', 'ir18', 'ir-18', 'ir01', 'ir-01', 'ir-04', 'sf23', 'sf19', 'usf2000', 'usf', 'pro2000', 'indypro', 'pm18', 'ff1600', 'skipbarber', 'fr2', 'fr20', 'fr35', 'fw31', 'mp4-30', 'w12', 'w13', 'lotus79', 'lotus49',
  ],
  proto: ['lmp', 'lmp1', 'lmp2', 'lmp3', 'lmh', 'lmdh', 'hypercar', 'dpi', 'gtp', 'prototype', 'prototipo', 'groupc', 'sportprototype', 'oreca', 'hpd'],
  gt: ['gt', 'gt1', 'gt2', 'gt3', 'gt4', 'gte', 'gtlm', 'gtd', 'gtc', 'gte-gt3', 'cup', 'supercup', 'challenge', 'trofeo', 'endurance'],
  turismo: ['tcr', 'touring', 'turismo', 'dtm', 'btcc', 'wtcc', 'wtcr', 'tc', 'tc2000', 'tcpista', 'turismopista', 'trv6', 'trseries', 'toprace', 'tps', 'vasc', 'v8sc', 'stockcar', 'nascar', 'marcas', 'superturismo', 'gra'],
}
const RALLY_WORDS = ['rally', 'rally1', 'rally2', 'rally3', 'rally4', 'rally5', 'rallycross', 'r5', 'r4', 'wrc', 'gravel', 'maxi', 'dakar', 'rallyraid', 'baja']
const DRIFT_WORDS = ['drift', 'd1', 'fd']
// Clases de ui_car.json de autos de calle
const STREET_CLASSES = new Set(['street', 'road', 'shutoko', 'shuto', 'sport', 'stock', 'tuned', 'touge', 'traffic'])

function tokens(...parts: (string | null | undefined)[]): Set<string> {
  return new Set(
    parts
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/_/g, ' ')
      .match(/[\p{L}\p{N}-]+/gu) ?? [],
  )
}

const hasAny = (set: Set<string>, words: string[]) => words.some((w) => set.has(w))

export interface CarFacts {
  /** Nombre visible del auto. */
  name: string
  /** Carpeta o path interno ("ks_ferrari_488_gt3", "dallarair18"). */
  id?: string | null
  /** Clase: la de ui_car.json en AC, la de la sesión en iRacing ("GT3 Class"). */
  cls?: string | null
  tags?: string[]
  /** Tipo de pista de iRacing: "Road", "Oval", "DirtOval", "DirtRoad"… */
  trackCategory?: string | null
  /** Datos del sim que ya lo dicen (AC con CSP): monoplaza / auto de carrera. */
  openWheel?: boolean
  racing?: boolean
}

/** Rally y drift se miran en los tags y la clase: en el nombre suelen ser versiones de calle ("Gol Rally"). */
export function detectCategory(c: CarFacts): CarCategory {
  if (c.trackCategory && /oval/i.test(c.trackCategory)) return 'oval'
  const cls = (c.cls ?? '').toLowerCase()
  const tagSet = tokens(...(c.tags ?? []), cls)
  const set = tokens(...(c.tags ?? []), cls, c.id, c.name)
  const street = STREET_CLASSES.has(cls) || set.has('touge') || set.has('shutoko') || set.has('wangan') || (set.has('street') && !set.has('race'))

  if (hasAny(tagSet, DRIFT_WORDS) || set.has('drift')) return 'drift'
  if (hasAny(tagSet, RALLY_WORDS) || (!street && hasAny(set, RALLY_WORDS))) return 'rally'
  if (c.openWheel || hasAny(set, WORDS.formula)) return 'formula'
  if (!street) {
    if (hasAny(set, WORDS.proto)) return 'proto'
    if (hasAny(set, WORDS.turismo)) return 'turismo'
    if (hasAny(set, WORDS.gt)) return 'gt'
    // Autos de carrera sin una categoría reconocible: el layout de GT es el más completo
    if (c.racing || set.has('race') || c.trackCategory) return 'gt'
  }
  return 'calle'
}
