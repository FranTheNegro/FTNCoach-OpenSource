/**
 * Todas las skins del dashboard: las variaciones de color de FTN (v2/layouts.ts)
 * y las de categoría, que salen de `app/skins/<id>/skin.json`. Para sumar una
 * skin de categoría alcanza con agregar su carpeta: Vite la levanta sola.
 */
import { parseSkin, type SkinManifest } from '@shared/skin'
import { SKINS as FTN_SKINS, SKIN_IDS as FTN_IDS } from './v2/layouts'

export interface SkinEntry {
  id: string
  name: string
  short: string
  kind: 'ftn' | 'category'
  /** Solo las de categoría. */
  manifest: SkinManifest | null
  logoUrl: string | null
  /** Fondo y acento para la muestra del selector. */
  swatch: [string, string]
}

const manifests = import.meta.glob<unknown>('../../../skins/*/skin.json', { eager: true, import: 'default' })
const files = import.meta.glob<string>('../../../skins/*/*.{png,svg,ttf,otf,woff2}', { eager: true, query: '?url', import: 'default' })

const fileUrl = (id: string, name: string | null | undefined): string | null => (name ? (files[`../../../skins/${id}/${name}`] ?? null) : null)

// Orden en el selector: el de las categorías que pidió el proyecto, después las que sume la comunidad
const ORDER = ['tc', 'tn', 'tcr', 'tp', 'f1', 'wrc']

const category: SkinEntry[] = Object.entries(manifests)
  .map(([path, raw]): SkinEntry | null => {
    const id = /skins\/([^/]+)\/skin\.json$/.exec(path)?.[1] ?? ''
    const m = id ? parseSkin(raw, id) : null
    if (!m) {
      console.warn(`[skins] ${path}: falta el nombre o no es un JSON válido`)
      return null
    }
    return { id, name: m.name, short: m.short, kind: 'category', manifest: m, logoUrl: fileUrl(id, m.logo), swatch: [m.colors.background, m.colors.accent] }
  })
  .filter((s): s is SkinEntry => s !== null)
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.id)
    const ib = ORDER.indexOf(b.id)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name)
  })

const ftn: SkinEntry[] = FTN_IDS.map((id) => ({
  id,
  name: FTN_SKINS[id].name,
  short: 'FTN',
  kind: 'ftn',
  manifest: null,
  logoUrl: null,
  swatch: [FTN_SKINS[id].vars['--ftn-carbono-2'] ?? '#1e2229', FTN_SKINS[id].vars['--ftn-azul'] ?? '#5b7bff'],
}))

export const SKIN_LIST: SkinEntry[] = [...ftn, ...category]
export const ALL_SKIN_IDS: string[] = SKIN_LIST.map((s) => s.id)

export function skinById(id: string): SkinEntry {
  return SKIN_LIST.find((s) => s.id === id) ?? ftn[0]
}

// ── Aplicar ─────────────────────────────────────────────────────────────

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2]
    .map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t)
      .toString(16)
      .padStart(2, '0'))
    .join('')}`
}

/** Variables CSS de una skin de categoría. Los colores de dato (mejor, récord, alerta, error) no cambian: dicen algo. */
function categoryVars(m: SkinManifest): Record<string, string> {
  const c = m.colors
  const d = m.fonts.display
  const data = m.fonts.data
  return {
    '--ftn-carbono': c.background,
    '--ftn-carbono-2': c.panel,
    '--ftn-grafito': c.line,
    '--ftn-acero': mix(c.line, c.muted, 0.3),
    '--ftn-niebla': c.muted,
    '--ftn-plata': mix(c.text, c.muted, 0.35),
    '--ftn-blanco': c.text,
    '--ftn-azul': c.accent,
    '--sk-accent': c.accent,
    '--sk-accent-2': c.accent2,
    '--sk-label': c.label,
    '--sk-number': c.number,
    '--sk-redline': c.redline,
    '--sk-font-display': d ? `'${d.family}', var(--ftn-font-display)` : 'var(--ftn-font-display)',
    '--sk-display-wdth': String(d?.width ?? 100),
    '--sk-display-weight': String(d?.weight ?? 800),
    '--sk-display-style': d?.italic ? 'oblique 9deg' : 'normal',
    '--sk-font-data': data ? `'${data.family}', var(--ftn-font-data)` : 'var(--ftn-font-data)',
    '--sk-data-weight': String(data?.weight ?? 700),
    '--sk-data-style': data?.italic ? 'oblique 9deg' : 'normal',
  }
}

const loadedFonts = new Set<string>()

/** Las fuentes que trae la carpeta de la skin se cargan recién cuando se elige. */
function loadFonts(s: SkinEntry): void {
  for (const f of [s.manifest?.fonts.display, s.manifest?.fonts.data]) {
    const url = f?.file ? fileUrl(s.id, f.file) : null
    if (!f || !url || loadedFonts.has(url)) continue
    loadedFonts.add(url)
    new FontFace(f.family, `url(${url})`)
      .load()
      .then((face) => document.fonts.add(face))
      .catch(() => console.warn(`[skins] no se pudo cargar la fuente ${f.file} de ${s.id}`))
  }
}

let applied: string[] = []

/** Aplica la skin a toda la página (también al fondo fuera del escenario). */
export function applySkin(id: string): void {
  const s = skinById(id)
  const root = document.documentElement
  for (const k of applied) root.style.removeProperty(k)
  const vars = s.manifest ? categoryVars(s.manifest) : FTN_SKINS[s.id as keyof typeof FTN_SKINS].vars
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  applied = Object.keys(vars)
  root.dataset.skin = s.id
  root.dataset.skinKind = s.kind
  if (s.manifest) {
    root.dataset.skinLabels = s.manifest.labels
    loadFonts(s)
  } else delete root.dataset.skinLabels
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.manifest?.colors.background ?? '#12151A')
}
