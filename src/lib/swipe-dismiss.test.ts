import { describe, it, expect } from 'vitest'
import {
  clampDragX,
  shouldDismiss,
  classifyGesture,
  classifyGestureVertical,
  shouldDismissSheet,
  DISMISS_DISTANCE_FRACTION,
  DISMISS_VELOCITY,
  DRAG_ACTIVATION_PX,
  SHEET_DISMISS_PX,
} from './swipe-dismiss'

describe('clampDragX', () => {
  it('passes through rightward drags', () => {
    expect(clampDragX(120)).toBe(120)
  })
  it('clamps leftward / negative drags to zero', () => {
    expect(clampDragX(-50)).toBe(0)
    expect(clampDragX(0)).toBe(0)
  })
})

describe('shouldDismiss', () => {
  const W = 400
  it('dismisses past the distance threshold', () => {
    expect(shouldDismiss(W * DISMISS_DISTANCE_FRACTION + 1, 0, W)).toBe(true)
  })
  it('keeps open below the distance threshold with no velocity', () => {
    expect(shouldDismiss(W * DISMISS_DISTANCE_FRACTION - 1, 0, W)).toBe(false)
  })
  it('dismisses on a fast flick even when short', () => {
    expect(shouldDismiss(20, DISMISS_VELOCITY + 0.1, W)).toBe(true)
  })
  it('never dismisses on a zero or leftward drag', () => {
    expect(shouldDismiss(0, 5, W)).toBe(false)
    expect(shouldDismiss(-100, 5, W)).toBe(false)
  })
  it('falls back to a sane width when width is invalid', () => {
    // width 0 → uses 400; 200px (>128) should dismiss
    expect(shouldDismiss(200, 0, 0)).toBe(true)
    expect(shouldDismiss(100, 0, 0)).toBe(false)
  })
})

describe('classifyGesture', () => {
  it('returns null below the activation threshold', () => {
    expect(classifyGesture(DRAG_ACTIVATION_PX - 1, 2)).toBeNull()
  })
  it('classifies a rightward horizontal move as a drag', () => {
    expect(classifyGesture(40, 5)).toBe('drag')
  })
  it('classifies a vertical-dominant move as scroll', () => {
    expect(classifyGesture(10, 40)).toBe('scroll')
  })
  it('classifies a leftward move as scroll (never dismiss)', () => {
    expect(classifyGesture(-40, 5)).toBe('scroll')
  })
})

describe('classifyGestureVertical', () => {
  it('returns null below the activation threshold', () => {
    expect(classifyGestureVertical(2, DRAG_ACTIVATION_PX - 1)).toBeNull()
  })
  it('classifies a downward vertical move as a drag', () => {
    expect(classifyGestureVertical(5, 40)).toBe('drag')
  })
  it('classifies an upward move as scroll (never dismiss)', () => {
    expect(classifyGestureVertical(5, -40)).toBe('scroll')
  })
  it('classifies a horizontal-dominant move as scroll', () => {
    expect(classifyGestureVertical(40, 10)).toBe('scroll')
  })
})

describe('shouldDismissSheet', () => {
  it('dismisses past the absolute distance threshold', () => {
    expect(shouldDismissSheet(SHEET_DISMISS_PX + 1, 0)).toBe(true)
  })
  it('keeps open below the threshold with no velocity', () => {
    expect(shouldDismissSheet(SHEET_DISMISS_PX - 1, 0)).toBe(false)
  })
  it('dismisses on a fast downward flick even when short', () => {
    expect(shouldDismissSheet(20, DISMISS_VELOCITY + 0.1)).toBe(true)
  })
  it('never dismisses on zero or upward drag', () => {
    expect(shouldDismissSheet(0, 5)).toBe(false)
    expect(shouldDismissSheet(-50, 5)).toBe(false)
  })
})
