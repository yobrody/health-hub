import { useEffect, useRef, useState } from 'react'
import Today from './pages/Today'
import Nutrition from './pages/Nutrition'
import Fridge from './pages/Fridge'
import Workout from './pages/Workout'
import GoalsPage from './pages/Goals'
import Skincare from './pages/Skincare'
import CameraSheet from './components/CameraSheet'
import { api } from './api/client'
import type { FridgeData } from './api/client'
import { registerToastHandler } from './toast'
import type { Theme } from './main'
import './App.css'

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'goals' | 'skincare'

// 4 visible tabs — Fridge/Skincare accessible via navigation within pages
const TABS: { id: Tab; label: string }[] = [
  { id: 'today',     label: 'Today'    },
  { id: 'nutrition', label: 'Nutrition'},
  { id: 'workout',   label: 'Workout'  },
  { id: 'goals',     label: 'Goals'    },
]

function TabIcon({ id, active }: { id: Tab; active: boolean }) {
  const color = active ? 'var(--blue)' : 'var(--gray2)'
  const s = { width: 24, height: 24 }
  switch (id) {
    case 'today': return (
      <svg {...s} viewBox="0 0 24 24" fill={color}>
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="12" y1="21" x2="12" y2="23" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="1" y1="12" x2="3" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="21" y1="12" x2="23" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    )
    case 'nutrition': return (
      <svg {...s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <path d="M3 2l1.5 7H19.5L21 2"/>
        <path d="M4.5 9l1 11h13l1-11"/>
        <path d="M9 9v11M12 9v11M15 9v11"/>
      </svg>
    )
    case 'workout': return (
      <svg {...s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <circle cx="5" cy="12" r="2" fill={color} stroke="none"/>
        <circle cx="19" cy="12" r="2" fill={color} stroke="none"/>
        <line x1="7" y1="12" x2="10" y2="12"/>
        <line x1="14" y1="12" x2="17" y2="12"/>
        <rect x="10" y="8" width="4" height="8" rx="1" fill={color} stroke="none"/>
      </svg>
    )
    case 'goals': return (
      <svg {...s} viewBox="0 0 24 24" fill={color}>
        <rect x="3" y="14" width="4" height="8" rx="1" opacity={active ? 1 : 0.6}/>
        <rect x="10" y="9" width="4" height="13" rx="1" opacity={active ? 1 : 0.6}/>
        <rect x="17" y="4" width="4" height="18" rx="1" opacity={active ? 1 : 0.6}/>
      </svg>
    )
    default: return null
  }
}

type ToastState = { msg: string; type: 'ok' | 'err' | 'info'; id: number } | null

interface Props {
  onToggleTheme: () => void
  theme: Theme
}

export default function App({ onToggleTheme, theme }: Props) {
  const [tab, setTab] = useState<Tab>('today')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [name, setName] = useState('Brody')
  const [calories, setCalories] = useState('2800')
  const [protein, setProtein] = useState('140')
  const [toast, setToast] = useState<ToastState>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [toastExiting, setToastExiting] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [fridgeData, setFridgeData] = useState<FridgeData | null>(null)

  // Register module-level toast handler so any page can call showToast()
  useEffect(() => {
    registerToastHandler((msg, type) => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToastExiting(false)
      setToast({ msg, type, id: Date.now() })
      toastTimer.current = setTimeout(() => {
        setToastExiting(true)
        setTimeout(() => setToast(null), 220)
      }, 2400)
    })
  }, [])

  useEffect(() => {
    const done = localStorage.getItem('onboarding_done') === '1'
    if (!done) setShowOnboarding(true)

    api.getProfile().then(profile => {
      setName(profile.name)
      setCalories(String(profile.calories))
      setProtein(String(profile.protein))
      try {
        localStorage.setItem('user_profile', JSON.stringify(profile))
        localStorage.setItem('onboarding_done', '1')
      } catch {}
    }).catch(() => {
      try {
        const raw = localStorage.getItem('user_profile')
        if (raw) {
          const p = JSON.parse(raw) as { name?: string; calories?: number; protein?: number }
          if (p.name) setName(p.name)
          if (p.calories) setCalories(String(p.calories))
          if (p.protein) setProtein(String(p.protein))
        }
      } catch {}
    })

    // Pre-load fridge data for camera cross-ref
    api.getFridge().then(setFridgeData).catch(() => {})
  }, [])

  function refreshFridge() {
    api.getFridge().then(setFridgeData).catch(() => {})
  }

  function saveOnboarding() {
    const profile = {
      name: name.trim() || 'Brody',
      calories: Number(calories) || 2800,
      protein: Number(protein) || 140,
    }
    try {
      localStorage.setItem('user_profile', JSON.stringify(profile))
      localStorage.setItem('onboarding_done', '1')
    } catch {}
    api.saveProfile(profile).catch(() => {})
    setShowOnboarding(false)
  }

  const themeIcon = theme === 'dark' ? '☀️' : theme === 'light' ? '🌙' : '✦'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {tab === 'today'     && <Today onNavigate={setTab} onToggleTheme={onToggleTheme} themeIcon={themeIcon} />}
        {tab === 'nutrition' && <Nutrition onNavigate={setTab as (tab: string) => void} />}
        {tab === 'fridge'    && <Fridge />}
        {tab === 'workout'   && <Workout />}
        {tab === 'skincare'  && <Skincare />}
        {tab === 'goals'     && <GoalsPage />}
      </div>

      {/* Tab Bar — 2 tabs | camera FAB | 2 tabs */}
      <div style={{
        height: 'calc(var(--tab-bar-height) + var(--safe-bottom))',
        background: 'var(--tab-bar-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '0.5px solid var(--tab-bar-border)',
        display: 'flex',
        alignItems: 'flex-start',
        paddingTop: 8,
        paddingBottom: 'var(--safe-bottom)',
        position: 'relative',
        zIndex: 100,
      }}>
        {/* First 2 tabs */}
        {TABS.slice(0, 2).map(t => (
          <button key={t.id} className="tab-btn" onClick={() => setTab(t.id)}>
            <div style={{ transform: tab === t.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform 0.15s' }}>
              <TabIcon id={t.id} active={tab === t.id} />
            </div>
            <span className="tab-label" style={{ fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? 'var(--blue)' : 'var(--gray2)' }}>
              {t.label}
            </span>
          </button>
        ))}

        {/* Camera FAB — centre slot */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <button
            className="camera-fab"
            onClick={() => setShowCamera(true)}
            aria-label="Open camera"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        </div>

        {/* Last 2 tabs */}
        {TABS.slice(2).map(t => (
          <button key={t.id} className="tab-btn" onClick={() => setTab(t.id)}>
            <div style={{ transform: tab === t.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform 0.15s' }}>
              <TabIcon id={t.id} active={tab === t.id} />
            </div>
            <span className="tab-label" style={{ fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? 'var(--blue)' : 'var(--gray2)' }}>
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Camera sheet */}
      <CameraSheet
        open={showCamera}
        onClose={() => setShowCamera(false)}
        fridgeData={fridgeData}
        onFridgeUpdated={refreshFridge}
      />

      {/* Toast */}
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.type}${toastExiting ? ' toast-exit' : ''}`}>
          {toast.msg}
        </div>
      )}

      {/* Onboarding */}
      {showOnboarding && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) saveOnboarding() }}
        >
          <div style={{ width: '100%', background: 'var(--card)', borderRadius: '22px 22px 0 0', padding: '18px 20px calc(38px + var(--safe-bottom))' }}>
            <div style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--gray4)', margin: '0 auto 20px' }} />
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Welcome to Health Hub</div>
            <div style={{ fontSize: 15, color: 'var(--label2)', marginBottom: 20 }}>Quick setup — takes 10 seconds.</div>
            <input className="input-field" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <input className="input-field" type="number" inputMode="numeric" placeholder="Daily calories" value={calories} onChange={e => setCalories(e.target.value)} />
              <input className="input-field" type="number" inputMode="numeric" placeholder="Protein (g)" value={protein} onChange={e => setProtein(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={saveOnboarding}>Get started</button>
          </div>
        </div>
      )}
    </div>
  )
}
