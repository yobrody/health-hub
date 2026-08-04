import { useEffect, useState } from 'react'
import {
  pushSupported,
  isStandalone,
  getPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  getPushPrefs,
  setPushPref,
} from '../lib/push'
import type { PushPrefs } from '../api/client'
import { showToast } from '../toast'

// Per-type opt-in controls for real web-push. New devices start with every
// type OFF (see lib/push.ts); the user turns on just what they want. Each hint
// states the honesty gate — the server only sends when that signal is real.
const TYPES: { key: keyof PushPrefs; label: string; hint: string }[] = [
  {
    key: 'readiness',
    label: 'Recovery readiness',
    hint: 'Morning ping before you train — only when last night’s sleep is logged and recent.',
  },
  {
    key: 'weekly',
    label: 'Weekly check-in',
    hint: 'Sunday nudge, only when the scale trend actually warrants a calorie tweak.',
  },
  {
    key: 'hydration',
    label: 'Hydration',
    hint: 'Afternoon reminder, only when the day’s water is genuinely low.',
  },
]

const EMPTY: PushPrefs = { readiness: false, weekly: false, hydration: false }

export function PushSettings() {
  const supported = pushSupported()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [prefs, setPrefs] = useState<PushPrefs>(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supported) {
      setSubscribed(false)
      return
    }
    getPushSubscription()
      .then(async (sub) => {
        setSubscribed(!!sub)
        if (sub) {
          const p = await getPushPrefs()
          if (p) setPrefs(p)
        }
      })
      .catch(() => setSubscribed(false))
  }, [supported])

  if (!supported) return null

  async function enable() {
    setBusy(true)
    try {
      const r = await subscribeToPush()
      if (r.ok) {
        setSubscribed(true)
        showToast('Push enabled — now pick which notifications below')
      } else if (r.reason === 'denied') {
        showToast('Notifications are blocked in your browser settings', 'err')
      } else if (r.reason === 'no-server-key') {
        showToast('Push isn’t configured on the server yet', 'err')
      } else {
        showToast('Could not enable push', 'err')
      }
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      await unsubscribeFromPush()
      setSubscribed(false)
      setPrefs(EMPTY)
    } catch {
      showToast('Could not disable push', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(key: keyof PushPrefs) {
    const next = !prefs[key]
    setPrefs((p) => ({ ...p, [key]: next })) // optimistic
    try {
      await setPushPref(key, next)
    } catch {
      setPrefs((p) => ({ ...p, [key]: !next })) // revert
      showToast('Could not save — try again', 'err')
    }
  }

  const iosNotInstalled = !isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)

  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div
        style={{
          fontSize: 13,
          color: 'var(--label2)',
          fontWeight: 600,
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Push notifications
      </div>
      <div style={{ fontSize: 13, color: 'var(--label3)', lineHeight: 1.5, marginBottom: 12 }}>
        Reach your phone even when Health Hub is closed. All types start off — turn on just what you
        want.
      </div>

      {iosNotInstalled && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--orange)',
            background: 'var(--orange)14',
            border: '1px solid var(--orange)33',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 12,
            lineHeight: 1.4,
          }}
        >
          On iPhone, push only works once you add Health Hub to your Home Screen (Share → Add to Home
          Screen) and open it from there.
        </div>
      )}

      {subscribed === null ? (
        <div style={{ fontSize: 13, color: 'var(--label3)' }}>Checking…</div>
      ) : !subscribed ? (
        <button
          onClick={enable}
          disabled={busy}
          style={{
            background: 'var(--blue)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '11px 16px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Enabling…' : 'Enable push on this device'}
        </button>
      ) : (
        <div>
          {TYPES.map((t) => (
            <label
              key={t.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 0',
                borderTop: '0.5px solid var(--separator)',
                cursor: 'pointer',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--label)' }}>{t.label}</div>
                <div style={{ fontSize: 12, color: 'var(--label3)', marginTop: 2, lineHeight: 1.4 }}>
                  {t.hint}
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs[t.key]}
                onChange={() => toggle(t.key)}
                style={{ width: 20, height: 20, accentColor: 'var(--blue)', marginTop: 2 }}
              />
            </label>
          ))}
          <button
            onClick={disable}
            disabled={busy}
            style={{
              marginTop: 12,
              background: 'none',
              border: '1px solid var(--separator)',
              borderRadius: 8,
              padding: '8px 14px',
              color: 'var(--label2)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Turn off push on this device
          </button>
        </div>
      )}
    </div>
  )
}
