import { useEffect, useRef, useState } from 'react'

/** Animates a number from its previous value to a new target over `duration` ms
 *  using ease-out cubic easing. Returns the current animated value. */
export function useAnimatedNumber(target: number, duration = 600) {
  const [value, setValue] = useState(0)
  const prevTarget = useRef(0)

  useEffect(() => {
    const from = prevTarget.current
    prevTarget.current = target
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rAF-driven animation requires setState in effect
    if (target === 0) { setValue(0); return }

    const start = performance.now()
    let raf: number
    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setValue(Math.round(from + (target - from) * eased))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}
