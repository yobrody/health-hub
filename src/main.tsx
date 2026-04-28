import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

export type Theme = 'light' | 'dark' | 'system'

function applyTheme(theme: Theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

export function getStoredTheme(): Theme {
  return (localStorage.getItem('app_theme') as Theme) ?? 'system'
}

export function setStoredTheme(t: Theme) {
  localStorage.setItem('app_theme', t)
}

function ThemeProvider() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Track system preference changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  function toggleTheme() {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    setStoredTheme(next)
    setTheme(next)
  }

  return <App onToggleTheme={toggleTheme} theme={theme} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider />
  </StrictMode>,
)
