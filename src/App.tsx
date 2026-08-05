import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
import Seasonings from './pages/Seasonings'
import WeeklyReport from './pages/WeeklyReport'
import Chat from './pages/Chat'
import Insights from './pages/Insights'
import MealPlan from './pages/MealPlan'
import Streaks from './pages/Streaks'
import Stats from './pages/Stats'
import Transformation from './pages/Transformation'
import SkillBlock from './pages/SkillBlock'
import SmartScanner from './components/SmartScanner'
import { UpdatePrompt } from './components/UpdatePrompt'
import ChangelogPopup from './components/ChangelogPopup'
import ConnectionBanner from './components/ConnectionBanner'
import Celebrations from './components/Celebrations'
import { api } from './api/client'
import type { FridgeData } from './api/client'
import { registerToastHandler, showToast } from './toast'
import { clampDragX, shouldDismiss, classifyGesture, DISMISS_DISTANCE_FRACTION } from './lib/swipe-dismiss'
import type { Theme } from './main'
import './App.css'

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'chat' | 'goals' | 'skincare' | 'lists' | 'agenda' | 'routines' | 'metrics' | 'timeline' | 'barcode' | 'weekly-report' | 'insights' | 'meal-plan' | 'streaks' | 'skill' | 'seasonings' | 'stats' | 'transformation'

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
  // ── The Living Today — tapping a Today tile opens its detail as a portal
  // overlay that expands from the tapped point while Today blurs behind, so it
  // never feels like you left. closePortal reverses the animation.
  const [portal, setPortal] = useState<Tab | null>(null)
  const [portalClosing, setPortalClosing] = useState(false)
  const portalOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const [portalOriginPos, setPortalOriginPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Swipe-right-to-dismiss: a second way to close a Today detail overlay. The
  // panel tracks the finger and, past a distance/velocity threshold, slides off
  // to the right; otherwise it springs back. The back chevron + Escape still
  // collapse it to the tapped tile (the original gesture). Because every Today
  // detail renders through this one portal, the gesture applies everywhere.
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [swipeClosing, setSwipeClosing] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; lastX: number; lastT: number; mode: 'idle' | 'drag' | 'scroll'; active: boolean; crossed: boolean }>({ startX: 0, startY: 0, lastX: 0, lastT: 0, mode: 'idle', active: false, crossed: false })
  function openPortal(t: Tab) { if (t === 'today') { setTab('today'); return } setPortalOriginPos({ x: portalOrigin.current.x, y: portalOrigin.current.y }); setPortalClosing(false); setSwipeClosing(false); setDragX(0); setPortal(t) }
  function closePortal() { setPortalClosing(true); window.setTimeout(() => { setPortal(null); setPortalClosing(false); setDragX(0) }, 260) }
  function onPortalPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (portalClosing || swipeClosing) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastT: performance.now(), mode: 'idle', active: true, crossed: false }
  }
  function onPortalPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.mode === 'idle') {
      // Engage the dismiss drag only when the first real movement is horizontal
      // AND rightward — so vertical scrolling inside the detail is never
      // hijacked. (Decision logic is unit-tested in lib/swipe-dismiss.)
      const intent = classifyGesture(dx, dy)
      if (intent === null) return
      if (intent === 'drag') {
        d.mode = 'drag'; setDragging(true)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      } else {
        d.mode = 'scroll'
      }
    }
    if (d.mode === 'drag') {
      d.lastX = e.clientX; d.lastT = performance.now()
      const next = clampDragX(dx)
      setDragX(next)
      // Haptic tick the moment you cross the dismiss threshold (and reset if
      // you pull back), matching the bottom-sheet swipe-down feel.
      const past = next > (window.innerWidth || 400) * DISMISS_DISTANCE_FRACTION
      if (past && !d.crossed) { d.crossed = true; if (navigator.vibrate) navigator.vibrate(12) }
      else if (!past && d.crossed) { d.crossed = false }
    }
  }
  function onPortalPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d.active) return
    d.active = false
    if (d.mode !== 'drag') return
    setDragging(false)
    const dx = Math.max(0, e.clientX - d.startX)
    const dt = Math.max(1, performance.now() - d.lastT)
    const vx = (e.clientX - d.lastX) / dt // px/ms — flick velocity
    const w = window.innerWidth || 400
    if (shouldDismiss(dx, vx, w)) {
      // Past the threshold (or a fast flick): complete the dismissal by
      // sliding the panel off to the right, then unmount.
      setSwipeClosing(true); setDragX(w + 40)
      window.setTimeout(() => { setPortal(null); setSwipeClosing(false); setDragX(0) }, 300)
    } else {
      setDragX(0) // spring back to rest
    }
  }
  function onPortalPointerCancel() { dragRef.current.active = false; setDragging(false); setDragX(0) }
  useEffect(() => {
    const onPointer = (e: PointerEvent) => { portalOrigin.current = { x: e.clientX, y: e.clientY } }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePortal() }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey) }
  }, [])
  // Barcode page "Add to food log" — the page has always supported this via
  // an optional prop that was never passed, leaving it a lookup-only viewer.
  async function handleBarcodeAddFood(name: string, kcal: number, protein: number) {
    try {
      await api.addFood({ meal: 'Snack', description: name, kcal, protein_g: protein })
      showToast(`Logged ${name} (${kcal} kcal)`, 'ok')
    } catch {
      showToast('Could not log — check connection', 'err')
    }
  }

  function renderPortal(t: Tab) {
    switch (t) {
      case 'nutrition': return <Nutrition />
      case 'fridge': return <Fridge />
      case 'workout': return <Workout onOpenSkill={() => setTab('skill')} onOpenTransformation={() => setTab('transformation')} />
      case 'chat': return <Chat />
      case 'insights': return <Insights />
      case 'meal-plan': return <MealPlan />
      case 'skincare': return <Skincare />
      case 'goals': return <GoalsPage />
      case 'lists': return <Lists />
      case 'agenda': return <Agenda />
      case 'routines': return <Routines />
      case 'metrics': return <Metrics />
      case 'timeline': return <Timeline />
      case 'barcode': return <Barcode onAddFood={handleBarcodeAddFood} />
      case 'weekly-report': return <WeeklyReport />
      case 'streaks': return <Streaks />
      case 'stats': return <Stats />
      case 'transformation': return <Transformation />
      case 'skill': return <SkillBlock onBack={() => setTab('workout')} />
      case 'seasonings': return <Seasonings />
      default: return null
    }
  }
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
  const SECONDARY_TABS = new Set<Tab>(['skincare', 'goals', 'lists', 'agenda', 'routines', 'metrics', 'timeline', 'barcode', 'weekly-report', 'chat', 'insights', 'meal-plan', 'streaks', 'skill', 'seasonings', 'stats', 'transformation'])

  // Drag progress 0→1 drives the portal's slide-out scale/opacity feedback.
  const portalW = (typeof window !== 'undefined' && window.innerWidth) || 400
  const portalProgress = Math.min(1, dragX / portalW)

  return (
    <div className={portal ? 'hh-portal-open' : undefined} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ConnectionBanner />
      <div className="hh-blurable" style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
          {tab === 'today'     && <Today onNavigate={openPortal} onToggleTheme={onToggleTheme} themeIcon={themeIcon} />}
          {tab === 'nutrition' && <Nutrition />}
          {tab === 'fridge'    && <Fridge />}
          {tab === 'workout'   && <Workout onOpenSkill={() => setTab('skill')} onOpenTransformation={() => setTab('transformation')} />}
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
          {tab === 'barcode'   && <Barcode onAddFood={handleBarcodeAddFood} />}
        {tab === 'weekly-report' && <WeeklyReport />}
          {tab === 'streaks'       && <Streaks />}
          {tab === 'stats'         && <Stats />}
          {tab === 'transformation' && <Transformation />}
          {tab === 'skill'         && <SkillBlock onBack={() => setTab('workout')} />}
          {tab === 'seasonings'    && <Seasonings />}
        </div>
      </div>

      {/* Tab Bar — 2 tabs | camera FAB | 2 tabs */}
      <div className="hh-blurable" style={{
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

      {/* ── The Living Today portal — detail expands from the tapped tile over
          a blurred Today, and collapses back. ── */}
      {portal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
          {/* Outer wrapper owns the open/collapse animation (expand from the
              tapped tile). The inner layer owns the swipe-to-dismiss translate
              so the two transforms never fight. */}
          <div
            style={{
              position: 'absolute', inset: 0,
              transformOrigin: `${portalOriginPos.x}px ${portalOriginPos.y}px`,
              animation: portalClosing ? 'hhPortalOut 0.24s ease-in forwards' : 'hhPortalIn 0.36s cubic-bezier(0.22,1,0.36,1)',
            }}
          >
            <div
              onPointerDown={onPortalPointerDown}
              onPointerMove={onPortalPointerMove}
              onPointerUp={onPortalPointerUp}
              onPointerCancel={onPortalPointerCancel}
              style={{
                position: 'absolute', inset: 0,
                background: 'var(--bg, #09090b)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                transform: `translateX(${dragX}px) scale(${1 - portalProgress * 0.04})`,
                transformOrigin: 'center left',
                transition: dragging ? 'none' : 'transform 0.34s cubic-bezier(0.22,1,0.36,1), opacity 0.34s ease',
                opacity: 1 - portalProgress * 0.15,
                borderRadius: dragX > 4 ? 22 : 0,
                boxShadow: '0 0 60px rgba(0,0,0,0.55)',
                touchAction: 'pan-y',
              }}
            >
              <button
                onClick={closePortal}
                aria-label="Back to Today"
                style={{
                  position: 'absolute', top: 'max(14px, env(safe-area-inset-top, 0px) + 14px)', left: 12, zIndex: 10,
                  width: 38, height: 38, borderRadius: 19,
                  background: 'var(--card, rgba(255,255,255,0.9))', border: '1px solid var(--separator, rgba(0,0,0,0.1))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  color: 'var(--label)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {renderPortal(portal)}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .hh-portal-open .hh-blurable { filter: blur(7px) saturate(0.92); transform: scale(0.975); pointer-events: none; }
        .hh-blurable { transition: filter 0.32s ease, transform 0.32s ease; }
        @keyframes hhPortalIn { from { opacity: 0.3; transform: scale(0.32); border-radius: 30px; } to { opacity: 1; transform: scale(1); border-radius: 0; } }
        @keyframes hhPortalOut { from { opacity: 1; transform: scale(1); border-radius: 0; } to { opacity: 0; transform: scale(0.4); border-radius: 30px; } }
      `}</style>


      {/* Smart scanner — unified barcode/receipt/food auto-detect */}
      <SmartScanner
        open={showSmartScan}
        onClose={() => setShowSmartScan(false)}
        fridgeData={fridgeData}
        onFridgeUpdated={refreshFridge}
      />

      {/* PWA update prompt — appears when a newer SW is waiting. */}
      <UpdatePrompt />

      {/* What's new popup — shows once per version after onboarding */}
      <ChangelogPopup />

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
