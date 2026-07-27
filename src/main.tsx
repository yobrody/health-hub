/* eslint-disable react-refresh/only-export-components -- this file intentionally exports the Theme type and storage helpers alongside ThemeProvider */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

// Auto-reload the page when a newly-installed service worker takes control.
// Pairs with VitePWA's registerType:'autoUpdate' + skipWaiting + clientsClaim
// to make a fresh deploy land on every open client (including iOS PWAs)
// without needing the user to manually refresh.
//
// Two suppressions are necessary to avoid a spurious reload on first paint:
//   • If there's no controller when the listener mounts, the very next
//     controllerchange is the *initial* SW activation on a fresh install —
//     we ignore that one. Otherwise the user reloads immediately on first
//     visit, which is jarring + can flicker the splash screen.
//   • Once we DO trigger a reload, latch a flag so we don't fire twice.
if ('serviceWorker' in navigator) {
  let alreadyReloading = false
  let suppressInitialActivation = !navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (suppressInitialActivation) { suppressInitialActivation = false; return }
    if (alreadyReloading) return
    alreadyReloading = true
    window.location.reload()
  })
}

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
  // Default to dark: the app's identity is dark, and several core pages are
  // hard-dark via --c-* tokens. Defaulting to dark keeps every page consistent
  // (older --bg/--label pages no longer render light while the rest stay dark).
  return (localStorage.getItem('app_theme') as Theme) ?? 'dark'
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
    <ErrorBoundary>
      <ThemeProvider />
    </ErrorBoundary>
  </StrictMode>,
)
