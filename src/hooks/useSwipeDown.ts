import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampDragX, classifyGestureVertical, shouldDismissSheet } from '../lib/swipe-dismiss'

// Reusable swipe-down-to-dismiss for bottom sheets. Spread `bind` onto the
// sheet's scrollable panel and merge `style` into that panel's style. The drag
// only engages when the panel is scrolled to the top and the gesture is a
// downward, vertical-dominant move — so scrolling sheet content is never
// hijacked. Past a threshold (or a flick) it slides the sheet off the bottom
// and calls `onClose`; otherwise it springs back.
//
// Decision logic (classifyGestureVertical / shouldDismissSheet) is unit-tested
// in lib/swipe-dismiss.
export function useSwipeDown(onClose: () => void) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [closing, setClosing] = useState(false)
  const ref = useRef({ startX: 0, startY: 0, lastY: 0, lastT: 0, mode: 'idle' as 'idle' | 'drag' | 'scroll', active: false })

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (closing) return
    const r = ref.current
    r.startX = e.clientX; r.startY = e.clientY; r.lastY = e.clientY
    r.lastT = performance.now(); r.mode = 'idle'; r.active = true
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const r = ref.current
    if (!r.active) return
    const dx = e.clientX - r.startX
    const dy = e.clientY - r.startY
    if (r.mode === 'idle') {
      const intent = classifyGestureVertical(dx, dy)
      if (intent === null) return
      // Only treat a downward drag as dismiss when the panel is at the top,
      // so mid-scroll content keeps scrolling normally.
      const atTop = e.currentTarget.scrollTop <= 0
      if (intent === 'drag' && atTop) {
        r.mode = 'drag'; setDragging(true)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      } else {
        r.mode = 'scroll'
      }
    }
    if (r.mode === 'drag') { r.lastY = e.clientY; r.lastT = performance.now(); setDragY(clampDragX(dy)) }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLElement>) {
    const r = ref.current
    if (!r.active) return
    r.active = false
    if (r.mode !== 'drag') return
    setDragging(false)
    const dy = Math.max(0, e.clientY - r.startY)
    const dt = Math.max(1, performance.now() - r.lastT)
    const vy = (e.clientY - r.lastY) / dt
    if (shouldDismissSheet(dy, vy)) {
      setClosing(true)
      setDragY(window.innerHeight || 800) // slide off the bottom, then unmount
      window.setTimeout(onClose, 280)
    } else {
      setDragY(0) // spring back
    }
  }

  function onPointerCancel() { ref.current.active = false; setDragging(false); setDragY(0) }

  return {
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    style: {
      transform: `translateY(${dragY}px)`,
      transition: dragging ? 'none' : 'transform 0.3s cubic-bezier(0.32,0.72,0,1)',
      touchAction: 'pan-y' as const,
    },
    dragY,
    closing,
  }
}
