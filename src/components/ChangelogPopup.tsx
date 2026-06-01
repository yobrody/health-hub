import { useEffect, useState } from 'react'
import { getUnseenChangelog, markChangelogSeen } from '../lib/changelog'
import type { ChangelogEntry } from '../lib/changelog'

export default function ChangelogPopup() {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    // Wait a beat so onboarding and other modals settle first
    const timer = setTimeout(() => {
      const unseen = getUnseenChangelog()
      if (unseen && localStorage.getItem('onboarding_done') === '1') {
        setEntry(unseen)
        // Trigger slide-up on next frame
        requestAnimationFrame(() => setVisible(true))
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [])

  function dismiss() {
    setClosing(true)
    markChangelogSeen()
    setTimeout(() => {
      setEntry(null)
      setVisible(false)
      setClosing(false)
    }, 300)
  }

  if (!entry) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 450,
        display: 'flex',
        alignItems: 'flex-end',
        opacity: visible && !closing ? 1 : 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      onClick={e => { if (e.target === e.currentTarget) dismiss() }}
    >
      <div
        style={{
          width: '100%',
          maxHeight: '80vh',
          background: 'var(--card)',
          borderRadius: '22px 22px 0 0',
          padding: '18px 20px calc(24px + var(--safe-bottom))',
          transform: visible && !closing ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--gray4)', margin: '0 auto 16px', flexShrink: 0 }} />

        {/* Header */}
        <div style={{ flexShrink: 0, marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--label)' }}>
            What's new in v{entry.version}
          </div>
          <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>
            {entry.date}
          </div>
        </div>

        {/* Scrollable change list */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, WebkitOverflowScrolling: 'touch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {entry.changes.map((change, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg
                  width="18" height="18" viewBox="0 0 24 24" fill="none"
                  style={{ flexShrink: 0, marginTop: 1 }}
                >
                  <circle cx="12" cy="12" r="12" fill="var(--blue)" opacity="0.15" />
                  <path d="M8 12.5l2.5 2.5 5.5-5.5" stroke="var(--blue)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 14, color: 'var(--label)', lineHeight: '1.4' }}>
                  {change}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          className="btn-primary"
          onClick={dismiss}
          style={{ flexShrink: 0 }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
