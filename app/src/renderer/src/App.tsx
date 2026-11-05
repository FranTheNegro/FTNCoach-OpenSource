import { useMemo, useState } from 'react'
import type { SessionSummary } from '@shared/analysis'
import { Activity, History, SlidersHorizontal, TrendingUp, User } from 'lucide-react'
import { LogoHorizontal } from '@ui/Logo'
import { NavContext, type Nav, type Route, type SettingsSection } from './nav'
import { LivePage } from './pages/LivePage'
import { ProfilePage } from './pages/ProfilePage'
import { ProgressPage } from './pages/ProgressPage'
import { SessionsPage } from './pages/SessionsPage'
import { SettingsPage } from './pages/SettingsPage'

const NAV: { id: Route; label: string; icon: React.ReactNode }[] = [
  { id: 'live', label: 'En vivo', icon: <Activity size={18} aria-hidden="true" /> },
  { id: 'sessions', label: 'Sesiones', icon: <History size={18} aria-hidden="true" /> },
  { id: 'progress', label: 'Progreso', icon: <TrendingUp size={18} aria-hidden="true" /> },
  { id: 'profile', label: 'Perfil', icon: <User size={18} aria-hidden="true" /> },
  { id: 'settings', label: 'Ajustes', icon: <SlidersHorizontal size={18} aria-hidden="true" /> },
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
    <div className="h-full grid grid-rows-[40px_minmax(0,1fr)] grid-cols-[220px_minmax(0,1fr)]">
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
      <main className={route === 'sessions' && openSession ? 'overflow-hidden px-4 pt-1 pb-3 min-w-0 min-h-0' : 'overflow-y-auto p-8 min-w-0'}>
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
