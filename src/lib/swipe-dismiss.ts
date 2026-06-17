// Pure decision logic for the swipe-right-to-dismiss gesture used by the Today
// detail portal (see App.tsx). Kept dependency-free and side-effect-free so it
// can be unit-tested without a DOM — the gesture's "feel" lives in these two
// thresholds.

/** Fraction of the viewport width a drag must cross to dismiss on release. */
export const DISMISS_DISTANCE_FRACTION = 0.32
/** Flick velocity (px per ms) that dismisses regardless of distance. */
export const DISMISS_VELOCITY = 0.45
/** Min pointer travel (px) before we decide drag-vs-scroll intent. */
export const DRAG_ACTIVATION_PX = 8

/** Clamp a raw horizontal delta to the rightward-only drag range. */
export function clampDragX(dx: number): number {
  return dx > 0 ? dx : 0
}

/**
 * Decide whether a released swipe should complete (dismiss) or spring back.
 * `dx` = horizontal travel (px, rightward positive), `vx` = release velocity
 * (px/ms), `width` = viewport width.
 */
export function shouldDismiss(dx: number, vx: number, width: number): boolean {
  if (dx <= 0) return false
  const w = width > 0 ? width : 400
  return dx > w * DISMISS_DISTANCE_FRACTION || vx > DISMISS_VELOCITY
}

/**
 * Given the first significant pointer movement, classify intent: a rightward,
 * horizontal-dominant move is a dismiss drag; anything else is a scroll.
 * Returns null while movement is still below the activation threshold.
 */
export function classifyGesture(dx: number, dy: number): 'drag' | 'scroll' | null {
  if (Math.abs(dx) < DRAG_ACTIVATION_PX && Math.abs(dy) < DRAG_ACTIVATION_PX) return null
  return dx > 0 && Math.abs(dx) > Math.abs(dy) ? 'drag' : 'scroll'
}
