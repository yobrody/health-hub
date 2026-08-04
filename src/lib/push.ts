// Real web-push: subscribes this device with the backend so the server can
// deliver notifications (recovery readiness, weekly check-in, hydration) even
// when the app is fully closed.
//
// This is distinct from notifications.ts, which only fires local Notifications
// while the app is open/backgrounded — that path can never reach a closed PWA.
// Here the browser registers a push subscription against the server's VAPID
// key; the VPS then pushes to it on a schedule.
//
// iOS caveat: web-push is only delivered when the PWA is installed to the Home
// Screen and opened from there — the UI surfaces this so it isn't a silent dud.

import { api, type PushPrefs } from '../api/client'

export type { PushPrefs }

/** Decode a URL-safe base64 VAPID key into the buffer PushManager wants.
 * Built over an explicit ArrayBuffer so the type is a concrete BufferSource
 * (a bare `new Uint8Array(n)` widens to ArrayBufferLike and won't assign). */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** True when running as an installed PWA — required for push on iOS. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

export type SubscribeResult = { ok: boolean; reason?: 'unsupported' | 'denied' | 'no-server-key' | 'error' }

/**
 * Subscribe this device. Requests notification permission, registers a push
 * subscription with the server's VAPID key, and stores it server-side. New
 * subscriptions start with EVERY notification type OFF — the user opts in per
 * type afterwards (see setPushPref).
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }

  const perm =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: 'denied' }

  try {
    const { publicKey } = await api.getPushKey()
    if (!publicKey) return { ok: false, reason: 'no-server-key' }

    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }))

    await api.pushSubscribe(sub.toJSON())
    return { ok: true }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getPushSubscription()
  if (!sub) return
  // Tell the server first (so it stops sending), then drop the browser sub.
  try { await api.pushUnsubscribe({ endpoint: sub.endpoint }) } catch { /* server prunes dead endpoints anyway */ }
  try { await sub.unsubscribe() } catch { /* already gone */ }
}

export async function getPushPrefs(): Promise<PushPrefs | null> {
  const sub = await getPushSubscription()
  if (!sub) return null
  try {
    return (await api.getPushPrefs(sub.endpoint)).prefs
  } catch {
    return null
  }
}

/** Flip a single notification type on/off for this device. */
export async function setPushPref(type: keyof PushPrefs, on: boolean): Promise<void> {
  const sub = await getPushSubscription()
  if (!sub) return
  await api.setPushPrefs({ endpoint: sub.endpoint, prefs: { [type]: on } })
}
