/**
 * Notas del piloto en un tramo de rally: peligros, consejos y notas sueltas, cada
 * una en un metro del tramo. Van en un archivo aparte del tramo porque el lector
 * reescribe el del tramo al terminar cada pasada y se perderían.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StageNote, StageNoteKind } from '@shared/stage'

const KINDS: StageNoteKind[] = ['peligro', 'consejo', 'nota']
const MAX_TEXT = 280
const MAX_NOTES = 300
/** Los ids de tramo salen de `stageId()`: letras, números y guiones. */
const VALID_ID = /^[a-z0-9-]{1,120}$/

export class StageNotes {
  constructor(private dir: string) {}

  private file(stageId: string): string {
    if (!VALID_ID.test(stageId)) throw new Error('Tramo inválido')
    return join(this.dir, `${stageId}.json`)
  }

  list(stageId: string): StageNote[] {
    const f = this.file(stageId)
    if (!existsSync(f)) return []
    try {
      const notes = JSON.parse(readFileSync(f, 'utf8')) as StageNote[]
      return Array.isArray(notes) ? notes.sort((a, b) => a.distM - b.distM) : []
    } catch {
      return []
    }
  }

  add(stageId: string, input: { distM: unknown; kind: unknown; text: unknown }): StageNote[] {
    const distM = Number(input.distM)
    const kind = input.kind as StageNoteKind
    const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT) : ''
    if (!Number.isFinite(distM) || distM < 0 || !KINDS.includes(kind) || !text) throw new Error('Nota inválida')
    const notes = this.list(stageId)
    if (notes.length >= MAX_NOTES) throw new Error('Este tramo ya tiene demasiadas notas')
    notes.push({ id: randomUUID(), distM: Math.round(distM), kind, text, createdAt: new Date().toISOString() })
    return this.save(stageId, notes)
  }

  remove(stageId: string, id: string): StageNote[] {
    return this.save(
      stageId,
      this.list(stageId).filter((n) => n.id !== id),
    )
  }

  private save(stageId: string, notes: StageNote[]): StageNote[] {
    const f = this.file(stageId)
    mkdirSync(this.dir, { recursive: true })
    const sorted = notes.sort((a, b) => a.distM - b.distM)
    writeFileSync(f + '.tmp', JSON.stringify(sorted, null, 1))
    renameSync(f + '.tmp', f)
    return sorted
  }
}
