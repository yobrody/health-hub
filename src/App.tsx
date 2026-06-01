import { useEffect, useRef, useState } from 'react'
import Today from './pages/Today'
import Nutrition from './pages/Nutrition'
import Fridge from './pages/Fridge'
import Workout from './pages/Workout'
import GoalsPage from './pages/Goals'
import Skincare from './pages/Skincare'
import Lists from './pages/Lists'
import Agenda from './pages/Agenda'
import Routines from './pages/Routines'
import Metrics from './pages/Metrics'
import Timeline from './pages/Timeline'
import Barcode from './pages/Barcode'
import WeeklyReport from './pages/WeeklyReport'
import Chat from './pages/Chat'
import Insights from './pages/Insights'
import MealPlan from './pages/MealPlan'
import Streaks from './pages/Streaks'
import CameraSheet from './components/CameraSheet'
import SmartScanner from './components/SmartScanner'
import { UpdatePrompt } from './components/UpdatePrompt'
import Celebrations from './components/Celebrations'
import { api } from './api/client'
import type { FridgeData } from './api/client'
import { registerToastHandler } from './toast'
import type { Theme } from './main'
import './App.css'

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'chat' | 'goals' | 'skincare' | 'lists' | 'agenda' | 'routines' | 'metrics' | 'timeline' | 'barcode' | 'weekly-report' | 'insights' | 'meal-plan' | 'streaks'

// 4 visible tabs + camera FAB. Chat accessible via Today tile.
const TABS: { id: Tab; label: string }[] = [
  { id: 'today',     label: 'Today'    },
  { id: 'nutrition', label: 'Nutrition'},
  { id: 'workout',   label: 'Workout'  },
  { id: 'fridge',    label: 'Fridge'   },
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
    case 'fridge': return (
      <svg {...s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="2" width="12" height="20" rx="2"/>
        <line x1="6" y1="10" x2="18" y2="10"/>
        <line x1="9" y1="6" x2="9" y2="7"/>
        <line x1="9" y1="13" x2="9" y2="14"/>
      </svg>
    )
    case 'chat': return (
      <svg {...s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    )
    default: return null
  }
}

function OnboardingFlow({ name, setName, calories, setCalories, protein, setProtein, onComplete }: {
  name: string; setName: (v: string) => void
  calories: string; setCalories: (v: string) => void
  protein: string; setProtein: (v: string) => void
  onComplete: () => void
}) {
  const [step, setStep] = useState(0)

  const dots = (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 20 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: i === step ? 18 : 6, height: 6, borderRadius: 3,
          background: i === step ? 'var(--blue)' : 'var(--gray4)',
          transition: 'width 0.2s ease, background 0.2s ease',
        }} />
      ))}
    </div>
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget && step === 2) onComplete() }}
    >
      <div style={{ width: '100%', background: 'var(--card)', borderRadius: '22px 22px 0 0', padding: '18px 20px calc(38px + var(--safe-bottom))' }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--gray4)', margin: '0 auto 20px' }} />

        {step === 0 && (
          <div className="onboard-step-enter" key="step-0">
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>
              {'\uD83C\uDF31'}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>Welcome to Health Hub</div>
            <div style={{ fontSize: 15, color: 'var(--label2)', textAlign: 'center', marginBottom: 24 }}>
              Track nutrition, workouts, and habits — all in one place.
            </div>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)', marginBottom: 6 }}>What should we call you?</div>
              <input
                className="input-field"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>
            <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setStep(1)}>Next</button>
          </div>
        )}

        {step === 1 && (
          <div className="onboard-step-enter" key="step-1">
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>
              {'\uD83C\uDFAF'}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>Daily targets</div>
            <div style={{ fontSize: 15, color: 'var(--label2)', textAlign: 'center', marginBottom: 24 }}>
              Set your nutrition goals. You can change these any time.
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)', marginBottom: 6 }}>Calories</div>
                <input className="input-field" type="number" inputMode="numeric" placeholder="2800" value={calories} onChange={e => setCalories(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)', marginBottom: 6 }}>Protein (g)</div>
                <input className="input-field" type="number" inputMode="numeric" placeholder="140" value={protein} onChange={e => setProtein(e.target.value)} />
              </div>
            </div>
            <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setStep(2)}>Next</button>
          </div>
        )}

        {step === 2 && (
          <div className="onboard-step-enter" key="step-2">
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>
              {'\uD83D\uDE80'}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>You're all set!</div>
            <div style={{ fontSize: 15, color: 'var(--label2)', textAlign: 'center', marginBottom: 24 }}>
              {name.trim() ? `Welcome, ${name.trim()}!` : 'Welcome!'} Start logging meals, workouts, and habits.
            </div>
            <button className="btn-primary" onClick={onComplete}>Get started</button>
          </div>
        )}

        {dots}
      </div>
    </div>
  )
}

type ToastState = { msg: string; type: 'ok' | 'err' | 'info'; id: number } | null

interface Props {
  onToggleTheme: () => void
  theme: Theme
}

export default function App({ onToggleTheme, theme }: Props) {
  const [tab, setTab] = useState<Tab>('today')
  const [showOnboarding, setShowOnboarding] = useState(false)
  // Audit P2-8: empty default; onboarding will fill it. The Today header
  // hides the "Brody" suffix when name is empty, so a fresh install reads
  // 'Good morning' rather than 'Good morning, Brody' before sign-up.
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('2800')
  const [protein, setProtein] = useState('140')
  const [toast, setToast] = useState<ToastState>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [toastExiting, setToastExiting] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [showSmartScan, setShowSmartScan] = useState(false)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time onboarding flag check on mount
    if (!done) setShowOnboarding(true)

    api.getProfile().then(profile => {
      setName(profile.name)
      setCalories(String(profile.calories))
      setProtein(String(profile.protein))
      try {
        localStorage.setItem('user_profile', JSON.stringify(profile))
        localStorage.setItem('onboarding_done', '1')
      } catch { /* ignore quota/access errors */ }
    }).catch(() => {
      try {
        const raw = localStorage.getItem('user_profile')
        if (raw) {
          const p = JSON.parse(raw) as { name?: string; calories?: number; protein?: number }
          if (p.name) setName(p.name)
          if (p.calories) setCalories(String(p.calories))
          if (p.protein) setProtein(String(p.protein))
        }
      } catch { /* ignore parse errors */ }
    })

    // Pre-load fridge data for camera cross-ref
    api.getFridge().then(setFridgeData).catch(() => {})
  }, [])

  function refreshFridge() {
    api.getFridge().then(setFridgeData).catch(() => {})
  }

  function saveOnboarding() {
    const profile = {
      // Empty name falls through to a friendly "there" rather than baking
      // the developer's name into every install (audit P2-8).
      name: name.trim() || 'there',
      calories: Number(calories) || 2800,
      protein: Number(protein) || 140,
    }
    try {
      localStorage.setItem('user_profile', JSON.stringify(profile))
      localStorage.setItem('onboarding_done', '1')
    } catch { /* ignore quota/access errors */ }
    api.saveProfile(profile).catch(() => {})
    setShowOnboarding(false)
  }

  // Three states cycle: light → dark → system → light. Auto state shown as a
  // half-filled circle SVG (rendered by Today's header) so it reads as "auto"
  // not as a stray dot. Keeping a string here for the type contract — Today
  // checks for the literal 'auto' to render the SVG.
  const themeIcon = theme === 'dark' ? '☀' : theme === 'light' ? '☾' : 'auto'

  // Pages reachable only by tile-click (not in the bottom nav) get a small
  // back-to-Today chevron, fixed top-left, so the route isn't a one-way
  // trip (audit P1-5). The bottom nav still works for jumping anywhere.
  const SECONDARY_TABS = new Set<Tab>(['skincare', 'goals', 'lists', 'agenda', 'routines', 'metrics', 'timeline', 'barcode', 'weekly-report', 'chat', 'insights', 'meal-plan', 'streaks'])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {SECONDARY_TABS.has(tab) && (
          <button
            onClick={() => setTab('today')}
            aria-label="Back to Today"
            style={{
              position: 'absolute', top: 'max(14px, env(safe-area-inset-top, 0px) + 14px)', left: 12,
              width: 36, height: 36, borderRadius: 18,
              background: 'var(--card, rgba(255,255,255,0.9))',
              border: '0.5px solid var(--separator, rgba(0,0,0,0.1))',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', zIndex: 50,
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
        )}
        <div key={tab} className="page-transition-enter" style={{ height: '100%' }}>
          {tab === 'today'     && <Today onNavigate={setTab} onToggleTheme={onToggleTheme} themeIcon={themeIcon} />}
          {tab === 'nutrition' && <Nutrition />}
          {tab === 'fridge'    && <Fridge />}
          {tab === 'workout'   && <Workout />}
          {tab === 'chat'      && <Chat />}
          {tab === 'insights'  && <Insights />}
          {tab === 'meal-plan' && <MealPlan />}
          {tab === 'skincare'  && <Skincare />}
          {tab === 'goals'     && <GoalsPage />}
          {tab === 'lists'     && <Lists />}
          {tab === 'agenda'    && <Agenda />}
          {tab === 'routines'  && <Routines />}
          {tab === 'metrics'   && <Metrics />}
          {tab === 'timeline'  && <Timeline />}
          {tab === 'barcode'   && <Barcode />}
        {tab === 'weekly-report' && <WeeklyReport />}
          {tab === 'streaks'       && <Streaks />}
        </div>
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
            onClick={() => setShowSmartScan(true)}
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

      {/* Legacy camera sheet (accessible from other entry points) */}
      <CameraSheet
        open={showCamera}
        onClose={() => setShowCamera(false)}
        fridgeData={fridgeData}
        onFridgeUpdated={refreshFridge}
      />

      {/* Smart scanner — unified barcode/receipt/food auto-detect */}
      <SmartScanner
        open={showSmartScan}
        onClose={() => setShowSmartScan(false)}
        fridgeData={fridgeData}
        onFridgeUpdated={refreshFridge}
      />

      {/* PWA update prompt — appears when a newer SW is waiting. */}
      <UpdatePrompt />

      {/* Celebration animations (confetti, streak flames) */}
      <Celebrations />

      {/* Toast */}
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.type}${toastExiting ? ' toast-exit' : ''}`}>
          {toast.msg}
        </div>
      )}

      {/* Onboarding — multi-step */}
      {showOnboarding && <OnboardingFlow
        name={name} setName={setName}
        calories={calories} setCalories={setCalories}
        protein={protein} setProtein={setProtein}
        onComplete={saveOnboarding}
      />}
    </div>
  )
}
