/**
 * Skins por categoría: solo presentación (colores, tipografías, logo, layout y
 * campos). Los datos son siempre los del modelo de telemetría (`LiveFrame`); una
 * skin no calcula nada.
 *
 * Cada skin vive en `app/skins/<id>/` con un `skin.json` y sus archivos (logo,
 * fuentes). La misma carpeta la usan el dashboard de la tablet y la app de AC,
 * que la copia a `apps/lua/FTNCoach/skins/<id>/`.
 */

import type { CarCategory } from './category'

/**
 * Plantillas de la pantalla "En vivo":
 * - arco: tacómetro en arco con la marcha al centro y los datos a los costados
 * - barra: luces de cambio arriba, marcha grande y columnas de datos
 * - tramo: rally (tiempo de tramo, parciales, distancia y avisos)
 */
export const SKIN_TEMPLATES = ['arco', 'barra', 'tramo'] as const
export type SkinTemplate = (typeof SKIN_TEMPLATES)[number]

/** Bloques que puede mostrar una skin. */
export const SKIN_FIELDS = [
  'rpm',
  'gear',
  'speed',
  'lap',
  'best',
  'position',
  'laps',
  'gap',
  'fuel',
  'map',
  'standings',
  // Rally
  'stage',
  'splits',
  'distance',
  'warnings',
] as const
export type SkinField = (typeof SKIN_FIELDS)[number]

export interface SkinColors {
  /** Fondo de la pantalla. */
  background: string
  /** Fondo de los paneles. */
  panel: string
  /** Bordes y separadores. */
  line: string
  /** Texto principal. */
  text: string
  /** Texto secundario. */
  muted: string
  /** Color de la categoría: tacómetro, barras, auto propio. */
  accent: string
  /** Segundo color de la categoría (detalles). */
  accent2: string
  /** Etiquetas de los datos ("VUELTA", "GAP"). */
  label: string
  /** Números de los datos. */
  number: string
  /** Zona roja del tacómetro y luces de cambio al final. */
  redline: string
}

export interface SkinFont {
  /** Nombre de la familia. */
  family: string
  /** Archivo dentro de la carpeta de la skin (.ttf, .otf o .woff2). Sin archivo = FTN. */
  file?: string
  /** Peso (100–900). */
  weight?: number
  /** Ancho, solo para la tipografía display de FTN (Archivo: 62 condensada … 125 expandida). */
  width?: number
  italic?: boolean
}

export interface SkinManifest {
  id: string
  /** Nombre visible ("Turismo Carretera"). */
  name: string
  /** Sigla corta para el selector ("TC"). */
  short: string
  /** Categoría del auto para la que está pensada (sugerencia, no obliga). */
  category: CarCategory | null
  template: SkinTemplate
  colors: SkinColors
  fonts: {
    /** Marcha, posición y títulos. */
    display?: SkinFont
    /** Números de los datos. */
    data?: SkinFont
  }
  /**
   * Estilo de las etiquetas: `underline` (línea con quiebre debajo), `plain`
   * (solo texto) o `tab` (pestaña de color).
   */
  labels: 'underline' | 'plain' | 'tab'
  /** Archivo del logo dentro de la carpeta (PNG con fondo transparente; en el dashboard también SVG). */
  logo: string | null
  /** Bloques que muestra, en orden de importancia (en pantallas chicas se caen los últimos). */
  fields: SkinField[]
  /** Si el sim no da un dato: mostrar "--" o esconder el bloque. */
  missing: 'dash' | 'hide'
  /** Texto de créditos o aclaraciones (marcas de terceros). */
  credits?: string
}

const HEX = /^#[0-9a-f]{6}$/i

export const DEFAULT_COLORS: SkinColors = {
  background: '#12151a',
  panel: '#1e2229',
  line: '#2c313a',
  text: '#f0f3fa',
  muted: '#8e96a3',
  accent: '#5b7bff',
  accent2: '#1d2be0',
  label: '#8e96a3',
  number: '#f0f3fa',
  redline: '#ff5c5c',
}

function pick<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback
}

function font(v: unknown): SkinFont | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.family !== 'string' || !o.family) return undefined
  return {
    family: o.family,
    file: typeof o.file === 'string' ? o.file : undefined,
    weight: typeof o.weight === 'number' ? o.weight : undefined,
    width: typeof o.width === 'number' ? o.width : undefined,
    italic: o.italic === true,
  }
}

/**
 * Lee un skin.json escrito a mano: lo que falte o esté mal toma el valor de FTN,
 * así una skin a medio hacer no rompe el dashboard. Devuelve null solo si no
 * tiene id o nombre.
 */
export function parseSkin(raw: unknown, id: string): SkinManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name) return null
  const colorsIn = (o.colors && typeof o.colors === 'object' ? o.colors : {}) as Record<string, unknown>
  const colors = { ...DEFAULT_COLORS }
  for (const k of Object.keys(DEFAULT_COLORS) as (keyof SkinColors)[]) {
    const v = colorsIn[k]
    if (typeof v === 'string' && HEX.test(v)) colors[k] = v
  }
  const fontsIn = (o.fonts && typeof o.fonts === 'object' ? o.fonts : {}) as Record<string, unknown>
  const fields = Array.isArray(o.fields) ? o.fields.filter((f): f is SkinField => SKIN_FIELDS.includes(f as SkinField)) : []
  return {
    id,
    name: o.name,
    short: typeof o.short === 'string' && o.short ? o.short : o.name.slice(0, 4).toUpperCase(),
    category: typeof o.category === 'string' ? (o.category as CarCategory) : null,
    template: pick(SKIN_TEMPLATES, o.template, 'arco'),
    colors,
    fonts: { display: font(fontsIn.display), data: font(fontsIn.data) },
    labels: pick(['underline', 'plain', 'tab'] as const, o.labels, 'plain'),
    logo: typeof o.logo === 'string' && o.logo ? o.logo : null,
    fields: fields.length ? fields : ['rpm', 'gear', 'speed', 'lap', 'best', 'position', 'laps', 'gap', 'fuel', 'map', 'standings'],
    missing: o.missing === 'hide' ? 'hide' : 'dash',
    credits: typeof o.credits === 'string' ? o.credits : undefined,
  }
}
