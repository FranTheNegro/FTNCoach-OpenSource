import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './dashboard.css'
import './v2/live.css'
import './v2/skins.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
