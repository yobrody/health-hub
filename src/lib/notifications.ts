// Push notification reminders — local only, no backend push server needed.
// Fires when the app is open and conditions are met (meal not logged, weight
// not logged, routine not done).

/**
 * Request notification permission from the user. Safe to call multiple
 * times — browsers remember the choice after the first prompt.
 */
const NOTIF_PREF = 'hh_notifications_enabled'
/** Whether the user has reminders enabled (default on). */
export function notificationsEnabled(): boolean {
  try { return localStorage.getItem(NOTIF_PREF) !== 'off' } catch { return true }
}
/** Turn reminders on/off (persisted locally). */
export function setNotificationsEnabled(on: boolean): void {
  try { localStorage.setItem(NOTIF_PREF, on ? 'on' : 'off') } catch { /* quota */ }
}

export async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

/** Key used in localStorage to track which reminders we already fired today. */
function reminderKey(type: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return `reminder_fired_${type}_${today}`
}

/** Returns true if we already sent this reminder today. */
function alreadyFired(type: string): boolean {
  try {
    return localStorage.getItem(reminderKey(type)) === '1'
  } catch {
    return false
  }
}

/** Mark a reminder as fired for today. */
function markFired(type: string): void {
  try {
    localStorage.setItem(reminderKey(type), '1')
  } catch { /* quota */ }
}

/** Check if a meal was logged today by looking at localStorage food cache. */
function mealLoggedToday(meal: 'lunch' | 'dinner'): boolean {
  try {
    // The Today page caches entries via the API response; we check for meal
    // keywords in the food log for today. A simple heuristic that avoids an
    // API call from the notification layer.
    const raw = localStorage.getItem('today_food_entries')
    if (raw) {
      const entries = JSON.parse(raw) as Array<{ meal?: string }>
      return entries.some(e =>
        e.meal?.toLowerCase().includes(meal)
      )
    }
  } catch { /* ignore */ }
  return false
}

/** Check if weight was logged today. */
function weightLoggedToday(): boolean {
  try {
    const raw = localStorage.getItem('weight_log')
    if (raw) {
      const entries = JSON.parse(raw) as Array<{ date: string }>
      const today = new Date().toISOString().slice(0, 10)
      return entries.some(e => e.date === today)
    }
  } catch { /* ignore */ }
  return false
}

/** Check if a routine is done today by looking at cached routine data. */
function routineDoneToday(name: string): boolean {
  try {
    const raw = localStorage.getItem(`routine_${name}`)
    if (raw) {
      const data = JSON.parse(raw) as { done_today?: boolean; date?: string }
      const today = new Date().toISOString().slice(0, 10)
      return data.done_today === true && data.date === today
    }
  } catch { /* ignore */ }
  return false
}

function fireNotification(title: string, body: string, tag: string): void {
  if (!notificationsEnabled()) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  // Never fire while the app is in the foreground. A reminder to do something
  // in the app, shown while you're actively looking at the app, is just spam —
  // this was the cause of "notifications every time I open the app". Reminders
  // only make sense when the app is backgrounded.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
  if (alreadyFired(tag)) return

  try {
    new Notification(title, {
      body,
      tag, // prevents duplicate notifications with the same tag
      icon: '/icon-192.png',
    })
    markFired(tag)
  } catch { /* SW-only environments may throw */ }
}

/** Check for fridge items expiring soon (cached from last /fridge fetch). */
function checkFridgeExpiring(): void {
  try {
    const raw = localStorage.getItem('fridge_expiring_items')
    if (!raw) return
    const items = JSON.parse(raw) as Array<{ name: string; freshness: string }>
    const expiring = items.filter(i => i.freshness === 'use_soon' || i.freshness === 'expired')
    if (expiring.length === 0) return

    // Fire one notification per item (max 3 to avoid spam)
    for (const item of expiring.slice(0, 3)) {
      const label = item.freshness === 'expired' ? 'has expired' : 'needs using soon'
      fireNotification(
        `Use your ${item.name} before it goes off`,
        `${item.name} ${label}. Check your fridge.`,
        `fridge_expiry_${item.name.toLowerCase().replace(/\s+/g, '_')}`
      )
    }
  } catch { /* ignore */ }
}

/**
 * Check all reminder conditions and fire notifications as needed.
 * Call this on every Today page load. Idempotent per day per reminder type.
 */
export function scheduleReminders(): void {
  if (!notificationsEnabled()) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const now = new Date()
  const hour = now.getHours()

  // Morning (6am-11am): weight reminder
  if (hour >= 6 && hour < 11 && !weightLoggedToday()) {
    fireNotification(
      'Morning weigh-in?',
      'Step on the scale and log your weight.',
      'weight_morning'
    )
  }

  // After 12pm: lunch reminder
  if (hour >= 12 && hour < 16 && !mealLoggedToday('lunch')) {
    fireNotification(
      'Time to log lunch?',
      'Don\'t forget to track your midday meal.',
      'lunch_reminder'
    )
  }

  // After 7pm: dinner reminder
  if (hour >= 19 && hour < 22 && !mealLoggedToday('dinner')) {
    fireNotification(
      'Don\'t forget to log dinner',
      'Log your evening meal before the day ends.',
      'dinner_reminder'
    )
  }

  // After 9pm: evening skincare routine reminder
  if (hour >= 21 && !routineDoneToday('evening-skincare')) {
    fireNotification(
      'Evening skincare?',
      'Your evening skincare routine isn\'t done yet.',
      'skincare_evening'
    )
  }

  // Morning (8am-12pm): fridge expiry check
  if (hour >= 8 && hour < 12) {
    checkFridgeExpiring()
  }
}
