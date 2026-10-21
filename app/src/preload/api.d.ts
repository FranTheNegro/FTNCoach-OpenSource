import type { FtnApi } from '@shared/api'

declare global {
  interface Window {
    /** Solo existe en la app de escritorio (no en los dashboards de la red). */
    ftn: FtnApi
  }
}

export {}
