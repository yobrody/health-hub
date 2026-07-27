import { showToast } from '../toast'

// Two cheap defences against the failure modes that make the app feel unreliable.

/**
 * Ask the browser to mark our storage persistent.
 *
 * Workout templates, the LEARNED equipment catalog and any machine added via
 * chat live only in localStorage. iOS evicts non-persistent origin storage
 * under pressure with no warning and no recovery - that would silently throw
 * away the learned stack data that stops the engine prescribing 15kg on a
 * cable that tops out at 3.4kg. Granted automatically for installed PWAs.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false
    if (navigator.storage.persisted && await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch { return false }
}

let lastToastAt = 0
const TOAST_GAP_MS = 8000

function looksLikeNetwork(reason: unknown): boolean {
  const msg = reason instanceof Error ? reason.message : String(reason ?? '')
  return /failed to fetch|networkerror|load failed|api error 5\d\d|timed? ?out/i.test(msg)
}

/**
 * Catch promise rejections nobody handled.
 *
 * ~29 api.* calls fire without a .catch. Writes are protected by the outbox,
 * but reads just vanish - no error, no retry, no feedback. The screen keeps
 * its stale numbers and the app reads as "being weird" rather than honestly
 * offline. One listener turns every one of those into a visible message.
 */
export function installGlobalErrorReporting() {
  window.addEventListener('unhandledrejection', ev => {
    const reason: unknown = ev.reason
    // Offline writes are already captured by the outbox and surfaced there.
    if (reason && typeof reason === 'object' && 'queued' in (reason as object)) return

    const now = Date.now()
    if (now - lastToastAt < TOAST_GAP_MS) return
    lastToastAt = now

    if (looksLikeNetwork(reason)) {
      showToast("Can't reach the server - showing the last data I have", 'err')
    } else {
      console.error('[unhandled rejection]', reason)
      showToast('Something failed in the background', 'err')
    }
  })
}