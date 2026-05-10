import { useState } from 'react'
import Today from './pages/Today'
import Nutrition from './pages/Nutrition'
import Fridge from './pages/Fridge'
import Workout from './pages/Workout'
import GoalsPage from './pages/Goals'
import Metrics from './pages/Metrics'
import Timeline from './pages/Timeline'
import './App.css'

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'goals' | 'metrics' | 'timeline'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'sun.max.fill' },
  { id: 'metrics', label: 'Body', icon: 'heart.fill' },
  { id: 'timeline', label: 'Timeline', icon: 'clock.fill' },
  { id: 'nutrition', label: 'Food', icon: 'fork.knife' },
  { id: 'workout', label: 'Workout', icon: 'dumbbell.fill' },
]

// SF Symbol-inspired SVG icons
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
    case 'fridge': return (
      <svg {...s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="3"/>
        <line x1="4" y1="10" x2="20" y2="10"/>
        <line x1="8" y1="6" x2="8" y2="8"/>
        <line x1="8" y1="14" x2="8" y2="18"/>
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
    case 'metrics': return (
      <svg {...s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l.78.77L12 20.64l7.64-7.64.78-.77a5.4 5.4 0 0 0 0-7.65z" fill={active ? color : 'none'}/>
      </svg>
    )
    case 'timeline': return (
      <svg {...s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    )
    case 'goals': return (
      <svg {...s} viewBox="0 0 24 24" fill={color}>
        <rect x="3" y="14" width="4" height="8" rx="1" opacity={active ? 1 : 0.6}/>
        <rect x="10" y="9" width="4" height="13" rx="1" opacity={active ? 1 : 0.6}/>
        <rect x="17" y="4" width="4" height="18" rx="1" opacity={active ? 1 : 0.6}/>
      </svg>
    )
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('today')

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {tab === 'today' && <Today onNavigate={setTab} />}
        {tab === 'metrics' && <Metrics />}
        {tab === 'timeline' && <Timeline />}
        {tab === 'nutrition' && <Nutrition />}
        {tab === 'fridge' && <Fridge />}
        {tab === 'workout' && <Workout />}
        {tab === 'goals' && <GoalsPage />}
      </div>

      {/* Tab Bar */}
      <div className="tab-bar" style={{
        height: 'calc(var(--tab-bar-height) + var(--safe-bottom))',
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '0.5px solid var(--separator)',
        display: 'flex',
        alignItems: 'flex-start',
        paddingTop: 8,
        paddingBottom: 'var(--safe-bottom)',
        position: 'relative',
        zIndex: 100,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 3, background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 0', transition: 'transform 0.1s',
            }}
          >
            <TabIcon id={t.id} active={tab === t.id} />
            <span style={{
              fontSize: 10, fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--blue)' : 'var(--gray2)',
              letterSpacing: '-0.1px',
            }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
