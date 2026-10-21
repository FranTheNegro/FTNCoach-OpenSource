import { useEffect, useRef, useState } from 'react'
import type { LanState, LiveState, Settings } from '@shared/api'
import type { LibraryState } from '@shared/analysis'

export function useLiveState(): LiveState | null {
  const [state, setState] = useState<LiveState | null>(null)
  useEffect(() => {
    void window.ftn.live().then(setState)
    return window.ftn.onLive(setState)
  }, [])
  return state
}

/** Estado del servidor de la red (se refresca para mostrar los dispositivos conectados). */
export function useLanState(refreshMs = 2000): [LanState | null, () => void] {
  const [state, setState] = useState<LanState | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () => void window.ftn.lan().then((s) => alive && setState(s))
    load()
    const t = setInterval(load, refreshMs)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [refreshMs, tick])
  return [state, () => setTick((t) => t + 1)]
}

export function useSettings(): [Settings | null, (s: Settings) => void] {
  const [s, set] = useState<Settings | null>(null)
  useEffect(() => {
    void window.ftn.settings().then(set)
  }, [])
  return [s, set]
}

export function useLibrary(): LibraryState | null {
  const [state, setState] = useState<LibraryState | null>(null)
  useEffect(() => {
    void window.ftn.library().then(setState)
    return window.ftn.onLibrary(setState)
  }, [])
  return state
}

/** Ancho real de un elemento (para gráficos que dibujan en píxeles). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
