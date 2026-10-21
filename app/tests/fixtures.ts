import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** .ibt reales del piloto (no se versionan). Los tests que los usan se saltean si no hay. */
export function localIbtFiles(): string[] {
  const dir = process.env.FTN_IBT_DIR ?? join(homedir(), 'Documents', 'iRacing', 'telemetry')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ibt'))
    .sort()
    .map((f) => join(dir, f))
}
