import { useEffect, useRef, useState } from 'react'
import { subscribeConn, getConnStatus, probeBackend, getOutbox, subscribeOutbox, getStale, subscribeStale, type ConnStatus } from '../api/client'
import { summarize } from '../lib/outbox'

// A slim, self-managing banner that slides down from the top whenever the
// backend is unreachable or erroring, and clears itself (with a brief "Back
// online") the moment things recover. Driven by api/client connectivity
// tracking, device online/offline events, and a recovery probe while down.
export default function ConnectionBanner() {
  const [status, setStatus] = useState<ConnStatus>(getConnStatus())
  const [recovered, setRecovered] = useState(false)
  const [pending, setPending] = useState(() => summarize(getOutbox()))
  const [stale, setStale] = useState(getStale)
  const prev = useRef<ConnStatus>(getConnStatus())
  const recoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track how many writes are waiting to sync.
  useEffect(() => subscribeOutbox(items => setPending(summarize(items))), [])
  // Track whether the last read came from the SW cache (stale).
  useEffect(() => subscribeStale(setStale), [])

  // One handler for every connectivity transition (API subscription + device
  // online/offline events). setState here is event-driven, not a synchronous
  // effect body, so it doesn't cascade renders.
  useEffect(() => {
    function apply(s: ConnStatus) {
      if (prev.current !== 'online' && s === 'online') {
        setRecovered(true)
        if (recoverTimer.current) clearTimeout(recoverTimer.current)
        recoverTimer.current = setTimeout(() => setRecovered(false), 2200)
      }
      prev.current = s
      setStatus(s)
    }
    const unsub = subscribeConn(apply)
    const onOffline = () => apply('offline')
    const onOnline = () => { probeBackend() } // resolves → subscription fires apply('online')
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      unsub()
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      if (recoverTimer.current) clearTimeout(recoverTimer.current)
    }
  }, [])

  // While we're not online, gently poll so the banner clears on its own.
  useEffect(() => {
    if (status === 'online') return
    const id = setInterval(() => { probeBackend() }, 5000)
    return () => clearInterval(id)
  }, [status])

  const isRecovered = recovered && status === 'online'
  // Online but the last read came from the SW cache — the numbers on screen may
  // be old. Surface it (muted) rather than passing stale data off as live.
  const showStale = status === 'online' && stale && !isRecovered
  const visible = status !== 'online' || isRecovered || showStale
  const bg = isRecovered ? '#16a34a' : status === 'offline' ? '#d97706' : showStale ? '#64748b' : '#ea580c'
  const msg = isRecovered
    ? 'Back online'
    : status === 'offline'
      ? (pending ? `Offline — ${pending} saved, will sync` : 'Offline — showing saved data.')
      : showStale
        ? 'Showing saved data — refreshing…'
        : 'Trouble reaching the server — retrying…'

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 600,
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.32s cubic-bezier(0.22,1,0.36,1)',
        background: bg, color: '#fff',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)', paddingBottom: 6,
        paddingLeft: 12, paddingRight: 12,
        textAlign: 'center', fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.1px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        pointerEvents: 'none',
      }}
    >
      {msg}
    </div>
  )
}
