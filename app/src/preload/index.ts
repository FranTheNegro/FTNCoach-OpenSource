import { contextBridge, ipcRenderer } from 'electron'
import type { CoachState, LibraryState } from '@shared/analysis'
import type { FtnApi, LiveState } from '@shared/api'

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.off(channel, fn)
}

const api: FtnApi = {
  version: ipcRenderer.sendSync('app:version') as string,
  live: () => ipcRenderer.invoke('live:state'),
  onLive: (cb) => listen<LiveState>('live:changed', cb),
  lan: () => ipcRenderer.invoke('lan:state'),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  startDemo: () => ipcRenderer.invoke('demo:start'),
  stopDemo: () => ipcRenderer.invoke('demo:stop'),
  pickFolder: (current) => ipcRenderer.invoke('dialog:folder', current),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  showFile: (path) => ipcRenderer.invoke('shell:showFile', path),

  library: () => ipcRenderer.invoke('library:get'),
  onLibrary: (cb) => listen<LibraryState>('library:changed', cb),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  sessionDetail: (id) => ipcRenderer.invoke('session:detail', id),
  onSessionProgress: (cb) => listen<{ id: string; text: string }>('session:progress', cb),
  driverStyle: () => ipcRenderer.invoke('profile:style'),
  compareLaps: (id, a, b) => ipcRenderer.invoke('session:compare', id, a, b),
  trackMap: (trackId, slug) => ipcRenderer.invoke('track:map', trackId, slug),

  coachState: (id) => ipcRenderer.invoke('coach:state', id),
  coachAnalyze: (id, lap) => ipcRenderer.invoke('coach:analyze', id, lap),
  coachAsk: (id, q) => ipcRenderer.invoke('coach:ask', id, q),
  coachClear: (id) => ipcRenderer.invoke('coach:clear', id),
  onCoach: (cb) => listen<CoachState>('coach:changed', cb),
  hasCoachKey: (key) => ipcRenderer.invoke('coach:hasKey', key),
  setCoachKey: (key, value) => ipcRenderer.invoke('coach:setKey', key, value),
  claudeCodeVersion: () => ipcRenderer.invoke('coach:claudeCode'),

  acApp: () => ipcRenderer.invoke('ac:status'),
  installAcApp: () => ipcRenderer.invoke('ac:install'),

  videoConfig: (id) => ipcRenderer.invoke('video:config', id),
  videoPick: (id, cam) => ipcRenderer.invoke('video:pick', id, cam),
  videoSync: (id, cam, anchor) => ipcRenderer.invoke('video:sync', id, cam, anchor),
  videoRemove: (id, cam) => ipcRenderer.invoke('video:remove', id, cam),

}

contextBridge.exposeInMainWorld('ftn', api)
