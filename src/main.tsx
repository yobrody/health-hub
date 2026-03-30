import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function ThemeScheduler() {
  useEffect(() => {
    const applyTheme = () => {
      const hour = new Date().getHours()
      const mode = hour >= 14 ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', mode)
    }
    applyTheme()
    const timer = window.setInterval(applyTheme, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeScheduler />
  </StrictMode>,
)
