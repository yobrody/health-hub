// Small banner that appears when the PWA's service worker has fetched a
// newer build and is waiting to take over. Tap "Update" to skipWaiting +
// reload. Without this prompt the user keeps running stale assets until
// they happen to fully close + reopen the tab — a real day-1 problem
// when iterating.
import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdatePrompt() {
  const [dismissed, setDismissed] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) { console.warn('SW register failed', error) },
  })

  if (!needRefresh || dismissed) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 12, right: 12,
        bottom: 'calc(var(--tab-bar-height, 56px) + var(--safe-bottom, 0px) + 14px)',
        zIndex: 200,
        background: 'var(--card, rgba(24,24,27,0.95))',
        border: '0.5px solid var(--separator, rgba(255,255,255,0.1))',
        borderRadius: 14,
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        animation: 'slideUpSubtle 0.28s ease-out',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label, #fff)' }}>
          New version ready
        </div>
        <div style={{ fontSize: 12, color: 'var(--label2, rgba(255,255,255,0.6))', marginTop: 2 }}>
          Tap to refresh and pick up the latest changes.
        </div>
      </div>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: 'var(--blue, #3B82F6)',
          color: '#fff', border: 'none', borderRadius: 10,
          padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Update
      </button>
      <button
        onClick={() => { setNeedRefresh(false); setDismissed(true) }}
        aria-label="Dismiss"
        style={{
          background: 'none', border: 'none', color: 'var(--label3, rgba(255,255,255,0.4))',
          fontSize: 18, cursor: 'pointer', padding: '4px 6px', lineHeight: 1,
          flexShrink: 0,
        }}
      >×</button>
    </div>
  )
}
