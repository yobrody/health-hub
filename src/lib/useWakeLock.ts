import { useEffect } from 'react'

/**
 * Keep the screen awake while a workout is live.
 *
 * Without this the phone sleeps between sets and has to be unlocked again
 * before every single log - roughly twenty times in a session, with chalky
 * or sweaty hands. The lock is released automatically by the browser when the
 * page is hidden, so it must be re-acquired on visibilitychange rather than
 * requested once.
 *
 * Unsupported on some browsers (notably older iOS Safari); failure is silent
 * and harmless by design.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    type Sentinel = { release: () => Promise<void>; released: boolean }
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }
    if (!nav.wakeLock) return

    let sentinel: Sentinel | null = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      try {
        if (sentinel && !sentinel.released) return
        sentinel = await nav.wakeLock!.request('screen')
      } catch { /* denied, low battery, or unsupported - not worth surfacing */ }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') void acquire() }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {})
    }
  }, [active])
}