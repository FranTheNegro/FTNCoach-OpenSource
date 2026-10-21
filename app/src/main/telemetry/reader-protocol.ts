import type { SessionMeta, SimId } from '@shared/live'
import type { RawSample } from './types'

/** Proceso principal → hilo lector. */
export type ReaderCommand = { type: 'demo'; path: string | null } | { type: 'stop' }

/** Hilo lector → proceso principal. */
export type ReaderEvent =
  | { type: 'connected'; sim: SimId }
  | { type: 'disconnected' }
  /** meta solo viaja cuando cambia (undefined = la misma que antes). */
  | { type: 'sample'; sample: RawSample; meta?: SessionMeta | null }
  | { type: 'demo'; path: string | null }
  | { type: 'error'; message: string }
