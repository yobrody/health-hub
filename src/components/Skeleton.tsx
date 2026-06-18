import type { CSSProperties } from 'react'

// A single shimmering placeholder block. Use while data is loading so first
// paint reads as "loading" instead of showing zeros/empty state. The shimmer
// animation is defined in index.css and auto-disabled under prefers-reduced-motion.
export default function Skeleton({
  w,
  h = 12,
  radius = 6,
  className = '',
  style,
}: {
  w?: number | string
  h?: number | string
  radius?: number | string
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton ${className}`.trim()}
      style={{ width: w, height: h, borderRadius: radius, ...style }}
    />
  )
}
