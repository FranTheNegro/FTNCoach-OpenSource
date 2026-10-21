/**
 * Biblioteca de sesiones: los .ibt de la carpeta de telemetría de iRacing y las
 * grabaciones propias. Leer un .ibt entero lleva ~1 s, así que el resumen de cada
 * archivo se guarda en caché (ruta + tamaño + fecha de modificación).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { SessionSummary } from '@shared/analysis'
import { SESSION_EXTS, loadSession, sectorBests } from './session'

function readSummary(path: string): SessionSummary {
  const s = loadSession(path)
  return { ...s.summary, sectors: sectorBests(s) }
}

// 3: mejores sectores de cada sesión · 4: evento, tipo de sesión real y vueltas cortadas
const CACHE_VERSION = 4
/** Un archivo que cambió hace menos que esto puede estar escribiéndose. */
const SETTLE_MS = 15_000

interface CacheEntry {
  size: number
  mtimeMs: number
  /** null = archivo sin vueltas o ilegible (no se vuelve a leer mientras no cambie). */
  summary: SessionSummary | null
}

export class Library {
  private entries = new Map<string, CacheEntry>()
  sessions: SessionSummary[] = []

  constructor(private cacheFile: string) {
    try {
      const raw = JSON.parse(readFileSync(cacheFile, 'utf8'))
      if (raw.version === CACHE_VERSION) for (const [k, v] of Object.entries(raw.entries)) this.entries.set(k, v as CacheEntry)
    } catch {
      // Sin caché todavía
    }
    this.refreshList()
  }

  private refreshList(): void {
    this.sessions = [...this.entries.values()]
      .map((e) => e.summary)
      .filter((s): s is SessionSummary => !!s && s.laps > 0)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  find(id: string): SessionSummary | null {
    return this.sessions.find((s) => s.id === id) ?? null
  }

  private save(): void {
    mkdirSync(dirname(this.cacheFile), { recursive: true })
    const tmp = this.cacheFile + '.tmp'
    writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(this.entries) }))
    renameSync(tmp, this.cacheFile)
  }

  /** Recorre las carpetas; `progress` se llama cada vez que entra una sesión nueva. */
  async scan(dirs: string[], exclude: string[], progress: () => void): Promise<void> {
    const seen = new Set<string>()
    const pending: { path: string; size: number; mtimeMs: number }[] = []
    const skip = new Set(exclude.map((p) => p.toLowerCase()))
    for (const dir of dirs) {
      if (!dir || !existsSync(dir)) continue
      for (const name of readdirSync(dir)) {
        if (!SESSION_EXTS.includes(extname(name).toLowerCase())) continue
        const path = join(dir, name)
        if (skip.has(path.toLowerCase())) continue
        let st
        try {
          st = statSync(path)
        } catch {
          continue
        }
        seen.add(path)
        const hit = this.entries.get(path)
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) continue
        if (Date.now() - st.mtimeMs < SETTLE_MS) continue
        pending.push({ path, size: st.size, mtimeMs: st.mtimeMs })
      }
    }
    let changed = false
    for (const key of [...this.entries.keys()])
      if (!seen.has(key)) {
        this.entries.delete(key)
        changed = true
      }
    if (changed) {
      this.refreshList()
      progress()
    }
    // Las más nuevas primero: son las que el piloto quiere ver
    pending.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const f of pending) {
      // Deja pasar otros pedidos (abrir una sesión) entre archivo y archivo
      await new Promise((r) => setImmediate(r))
      let summary: SessionSummary | null = null
      try {
        summary = readSummary(f.path)
      } catch (err) {
        console.error('[library] no se pudo leer', f.path, err)
      }
      this.entries.set(f.path, { size: f.size, mtimeMs: f.mtimeMs, summary })
      this.refreshList()
      progress()
    }
    if (pending.length || changed) this.save()
  }
}
