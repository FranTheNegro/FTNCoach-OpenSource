/**
 * Navegación entre secciones: cualquier pantalla puede mandar a Ajustes (a la
 * tarjeta justa) o a Sesiones con una búsqueda, sin perder la sesión abierta.
 */
import { createContext, useContext, type ReactNode } from 'react'

export type Route = 'live' | 'sessions' | 'progress' | 'profile' | 'settings'
export type SettingsSection = 'lan' | 'coach'

export interface Nav {
  go(route: Route, opts?: { section?: SettingsSection; query?: string }): void
}

export const NavContext = createContext<Nav>({ go: () => {} })

export const useNav = (): Nav => useContext(NavContext)

/** Texto que lleva a otra sección ("Ajustes → Coach"). */
export function GoLink({ to, section, query, children }: { to: Route; section?: SettingsSection; query?: string; children: ReactNode }) {
  const nav = useNav()
  return (
    <button className="text-azul font-semibold hover:underline" onClick={() => nav.go(to, { section, query })}>
      {children}
    </button>
  )
}
