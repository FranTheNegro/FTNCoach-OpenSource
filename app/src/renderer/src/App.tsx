import { useMemo, useState } from 'react'
import type { SessionSummary } from '@shared/analysis'
import { LogoHorizontal } from '@ui/Logo'
import { NavContext, type Nav, type Route, type SettingsSection } from './nav'
import { LivePage } from './pages/LivePage'
import { ProfilePage } from './pages/ProfilePage'
import { ProgressPage } from './pages/ProgressPage'
import { SessionsPage } from './pages/SessionsPage'
import { SettingsPage } from './pages/SettingsPage'

const NAV: { id: Route; label: string; icon: React.ReactNode }[] = [
  {
    id: 'live',
    label: 'En vivo',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 12h4l3-8 4 16 3-8h4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'sessions',
    label: 'Sesiones',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    id: 'progress',
    label: 'Progreso',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 18l5-6 4 3 7-9" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'profile',
    label: 'Perfil',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="8" y="4" width="8" height="8" rx="4" />
        <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Ajustes',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <rect x="14" y="5" width="4" height="4" />
        <rect x="8" y="15" width="4" height="4" />
      </svg>
    ),
  },
]

export function App() {
  const [route, setRoute] = useState<Route>('live')
  // Viven acá para que la sesión abierta y la búsqueda sigan al volver de otra sección
  const [openSession, setOpenSession] = useState<SessionSummary | null>(null)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<SettingsSection | null>(null)
  const nav = useMemo<Nav>(
    () => ({
      go: (to, opts) => {
        setSection(opts?.section ?? null)
        if (opts?.query !== undefined) {
          setQuery(opts.query)
          setOpenSession(null)
        }
        setRoute(to)
      },
    }),
    [],
  )
  const select = (id: Route) => {
    // Tocar "Sesiones" estando en Sesiones vuelve a la lista
    if (id === 'sessions' && route === 'sessions') setOpenSession(null)
    setSection(null)
    setRoute(id)
  }
  return (
    <NavContext.Provider value={nav}>
    <div className="h-full grid grid-rows-[40px_1fr] grid-cols-[220px_1fr]">
      <div className="drag col-span-2 flex items-center px-4 border-b border-grafito">
        <LogoHorizontal height={26} />
      </div>
      <nav className="border-r border-grafito p-3 flex flex-col gap-1">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => select(n.id)}
            aria-current={route === n.id ? 'page' : undefined}
            className={`h-11 px-3 rounded-control flex items-center gap-3 text-[14px] font-semibold transition-colors ${
              route === n.id ? 'bg-ultramar text-blanco' : 'text-plata hover:bg-grafito hover:text-blanco'
            }`}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
        <div className="mt-auto px-3 pb-1 data text-[11px] text-niebla">v{window.ftn.version}</div>
      </nav>
      <main className="overflow-y-auto p-8 min-w-0">
        {route === 'live' && <LivePage />}
        {route === 'sessions' && <SessionsPage open={openSession} onOpen={setOpenSession} query={query} onQuery={setQuery} />}
        {route === 'progress' && <ProgressPage />}
        {route === 'profile' && <ProfilePage />}
        {route === 'settings' && <SettingsPage focus={section} />}
      </main>
    </div>
    </NavContext.Provider>
  )
}
