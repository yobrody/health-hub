import { useEffect, useRef, useState, useCallback } from 'react'
import { registerCelebrationHandler } from '../lib/celebrations'

// ── Confetti particle system ─────────────────────────────────────────────────
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rotation: number
  rotationSpeed: number
  opacity: number
}

const CONFETTI_COLORS = [
  '#3B82F6', // blue (--c-accent)
  '#10B981', // green (--c-green)
  '#F59E0B', // orange (--c-orange)
  '#8B5CF6', // purple
  '#3B82F6',
  '#10B981',
]

function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const startTime = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // Create 60-80 particles
    const count = 60 + Math.floor(Math.random() * 20)
    const centerX = canvas.width / 2
    const centerY = canvas.height * 0.35

    particles.current = Array.from({ length: count }, () => ({
      x: centerX,
      y: centerY,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 10 - 2,
      size: Math.random() * 6 + 3,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      opacity: 1,
    }))

    startTime.current = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime.current
      if (elapsed > 2000 || !ctx || !canvas) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const fadeProgress = Math.max(0, (elapsed - 1200) / 800) // fade after 1.2s

      for (const p of particles.current) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.25 // gravity
        p.vx *= 0.99 // air resistance
        p.rotation += p.rotationSpeed
        p.opacity = Math.max(0, 1 - fadeProgress)

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.globalAlpha = p.opacity
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.restore()
      }

      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    />
  )
}

// ── Streak flame ─────────────────────────────────────────────────────────────
function StreakFlame({ message }: { message: string }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        fontSize: 64,
        animation: 'streakPulse 0.5s ease-in-out infinite alternate',
      }}>
        🔥
      </div>
      <div style={{
        marginTop: 8,
        fontSize: 18,
        fontWeight: 700,
        color: '#F59E0B',
        textShadow: '0 0 20px rgba(245,158,11,0.5)',
        animation: 'streakTextFade 2s ease-out forwards',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}>
        {message}
      </div>
      <style>{`
        @keyframes streakPulse {
          from { transform: scale(1); }
          to { transform: scale(1.3); }
        }
        @keyframes streakTextFade {
          0% { opacity: 0; transform: translateY(10px); }
          20% { opacity: 1; transform: translateY(0); }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// ── Perfect day badge ────────────────────────────────────────────────────────
export function PerfectDayBadge() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: '10px 18px',
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04))',
      border: '1px solid rgba(245,158,11,0.2)',
      marginBottom: 12,
      animation: 'perfectDayShimmer 2s ease-in-out infinite',
    }}>
      <span style={{
        fontSize: 22,
        filter: 'drop-shadow(0 0 6px rgba(245,158,11,0.6))',
        animation: 'perfectDayStar 1.5s ease-in-out infinite',
      }}>
        ⭐
      </span>
      <span style={{
        fontSize: 14,
        fontWeight: 700,
        color: '#F59E0B',
        letterSpacing: '0.05em',
        textShadow: '0 0 12px rgba(245,158,11,0.3)',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}>
        PERFECT DAY
      </span>
      <style>{`
        @keyframes perfectDayStar {
          0%, 100% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.15) rotate(10deg); }
        }
        @keyframes perfectDayShimmer {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
          50% { box-shadow: 0 0 16px 2px rgba(245,158,11,0.12); }
        }
      `}</style>
    </div>
  )
}

// ── Main Celebrations container ──────────────────────────────────────────────
export default function Celebrations() {
  const [active, setActive] = useState<{ type: string; message?: string; id: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handle = useCallback((type: string, message?: string) => {
    if (timer.current) clearTimeout(timer.current)
    setActive({ type, message, id: performance.now() })
    timer.current = setTimeout(() => setActive(null), 2200)
  }, [])

  useEffect(() => {
    registerCelebrationHandler(handle)
  }, [handle])

  if (!active) return null

  return (
    <>
      {active.type === 'confetti' && <ConfettiBurst key={active.id} />}
      {active.type === 'streak' && <StreakFlame message={active.message || 'Streak!'} />}
    </>
  )
}
