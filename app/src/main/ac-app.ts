/**
 * App de FTN Coach para dentro de Assetto Corsa (Lua, Custom Shaders Patch).
 * Viene con FTN Coach y se instala copiándola a `assettocorsa/apps/lua/FTNCoach`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AcAppStatus } from '@shared/api'
import { findAcRoot } from './analysis/track-map/ac'

const BUNDLED = join(__dirname, '../../resources/ac-app/FTNCoach')
const ICON = join(__dirname, '../../resources/icon.png')

function versionOf(manifest: string): string | null {
  return /^\s*VERSION\s*=\s*(.+)$/m.exec(manifest)?.[1].trim() ?? null
}

export function acAppStatus(): AcAppStatus {
  const root = findAcRoot()
  const bundled = existsSync(join(BUNDLED, 'manifest.ini')) ? versionOf(readFileSync(join(BUNDLED, 'manifest.ini'), 'utf8')) : null
  if (!root) return { acFound: false, root: null, csp: false, installed: null, bundled }
  const target = join(root, 'apps', 'lua', 'FTNCoach', 'manifest.ini')
  return {
    acFound: true,
    root,
    // Las apps Lua necesitan Custom Shaders Patch
    csp: existsSync(join(root, 'extension')),
    installed: existsSync(target) ? versionOf(readFileSync(target, 'utf8')) : null,
    bundled,
  }
}

/** Copia la carpeta con sus subcarpetas (los overlays están en módulos aparte). */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const f of readdirSync(from)) {
    const src = join(from, f)
    // Se lee y se escribe (en vez de copiar) porque en la app empaquetada vienen dentro del asar
    if (statSync(src).isDirectory()) copyDir(src, join(to, f))
    else writeFileSync(join(to, f), readFileSync(src))
  }
}

export function installAcApp(): AcAppStatus {
  const root = findAcRoot()
  if (!root) throw new Error('No se encontró Assetto Corsa instalado')
  const dest = join(root, 'apps', 'lua', 'FTNCoach')
  copyDir(BUNDLED, dest)
  if (existsSync(ICON)) writeFileSync(join(dest, 'icon.png'), readFileSync(ICON))
  return acAppStatus()
}
