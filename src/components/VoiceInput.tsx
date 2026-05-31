// ── Voice Input Component ─────────────────────────────────────────────
// Circular mic button using Web Speech API (SpeechRecognition).
// Falls back to a text input when the browser doesn't support it.

import { useState, useRef, useEffect, useCallback } from 'react'

// TypeScript declarations for the Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  readonly length: number
  readonly isFinal: boolean
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

const SpeechRecognitionAPI: SpeechRecognitionConstructor | undefined =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined

interface VoiceInputProps {
  onTranscript: (text: string) => void
  /** Optional: compact mode for inline use next to a text input */
  compact?: boolean
  disabled?: boolean
}

export default function VoiceInput({ onTranscript, compact, disabled }: VoiceInputProps) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [fallbackText, setFallbackText] = useState('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
    setListening(false)
    setInterim('')
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
    }
  }, [])

  function startListening() {
    if (!SpeechRecognitionAPI || disabled) return

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort()
    }

    const recognition = new SpeechRecognitionAPI()
    recognition.lang = 'en-GB'
    recognition.continuous = false
    recognition.interimResults = true
    recognitionRef.current = recognition

    recognition.onstart = () => {
      setListening(true)
      setInterim('')
    }

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        } else {
          interimTranscript += result[0].transcript
        }
      }

      if (finalTranscript) {
        setListening(false)
        setInterim('')
        onTranscript(finalTranscript.trim())
        recognitionRef.current = null
      } else {
        setInterim(interimTranscript)
      }
    }

    recognition.onerror = () => {
      stop()
    }

    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }

    recognition.start()
  }

  function toggle() {
    if (listening) {
      stop()
    } else {
      startListening()
    }
  }

  // Fallback: no SpeechRecognition available — show a text input
  if (!SpeechRecognitionAPI) {
    if (compact) return null // Don't show fallback in compact/inline mode
    return (
      <form
        onSubmit={e => {
          e.preventDefault()
          if (fallbackText.trim()) {
            onTranscript(fallbackText.trim())
            setFallbackText('')
          }
        }}
        className="flex gap-2"
      >
        <input
          className="flex-1 min-w-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-[14px] text-[var(--c-label)] placeholder:text-[var(--c-label-faint)] focus:outline-none focus:border-[var(--c-accent)] transition-colors"
          placeholder="Type or paste here (voice not available)..."
          value={fallbackText}
          onChange={e => setFallbackText(e.target.value)}
        />
        <button
          type="submit"
          disabled={!fallbackText.trim()}
          className="bg-[var(--c-accent)] text-white rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-30"
        >
          Send
        </button>
      </form>
    )
  }

  const size = compact ? 36 : 56
  const iconSize = compact ? 18 : 24

  return (
    <div className="relative flex flex-col items-center gap-2">
      {/* Mic button with pulsing ring */}
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={listening ? 'Stop listening' : 'Start voice input'}
        className="relative flex items-center justify-center rounded-full transition-all disabled:opacity-40"
        style={{
          width: size,
          height: size,
          background: listening ? 'var(--c-red)' : 'var(--c-accent)',
          boxShadow: listening
            ? '0 0 0 0 rgba(239, 68, 68, 0.4)'
            : '0 2px 8px rgba(59, 130, 246, 0.3)',
          flexShrink: 0,
        }}
      >
        {/* Pulsing ring when listening */}
        {listening && (
          <span
            className="absolute inset-0 rounded-full"
            style={{
              border: '2px solid var(--c-red)',
              animation: 'voicePulse 1.5s ease-in-out infinite',
            }}
          />
        )}
        {/* Mic icon */}
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="11" rx="3" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      {/* Interim transcript display */}
      {listening && interim && !compact && (
        <div
          className="text-[13px] text-[var(--c-label-dim)] text-center max-w-[280px] leading-snug"
          style={{ animation: 'slideUpSubtle 0.15s ease-out' }}
        >
          {interim}
        </div>
      )}

      {/* Inline CSS for the pulse animation */}
      <style>{`
        @keyframes voicePulse {
          0% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.35); opacity: 0; }
          100% { transform: scale(1.35); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
