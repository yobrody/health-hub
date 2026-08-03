// ── Chat — Voice-First AI Health Coach ───────────────────────────────
// Voice-first conversational interface for health logging and coaching.
// Large mic button as primary input; AI responses styled as coach messages.

import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import VoiceInput from '../components/VoiceInput'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const API_KEY: string | undefined = import.meta.env.VITE_API_KEY || undefined

// ── Types ────────────────────────────────────────────────────────────
interface ChatAction {
  type: string
  data: Record<string, unknown>
  label: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  action?: ChatAction | null
  actionDone?: boolean
  timestamp: number
}

// ── Persistence ──────────────────────────────────────────────────────
const STORAGE_KEY = 'health_chat_history'
const MAX_MESSAGES = 50

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    return parsed.slice(-MAX_MESSAGES)
  } catch {
    return []
  }
}

function saveHistory(msgs: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_MESSAGES)))
  } catch { /* quota exceeded — silently drop */ }
}

// ── Example prompt cards ─────────────────────────────────────────────
const EXAMPLE_PROMPTS = [
  { text: 'Log my breakfast', icon: '🍳', color: '#F97316' },
  { text: "How's my week?", icon: '📊', color: '#3B82F6' },
  { text: 'What should I eat?', icon: '💡', color: '#10B981' },
  { text: 'Log 79kg', icon: '⚖️', color: '#A855F7' },
]

// ── Action done checkmark animation ──────────────────────────────────
function ActionDoneCheck() {
  return (
    <div style={{
      marginTop: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      animation: 'checkPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
    }}>
      <div style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: '#10B981',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5 5L20 7" />
        </svg>
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#10B981' }}>Done</span>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────
export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Persist on change
  useEffect(() => {
    saveHistory(messages)
  }, [messages])

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), msg])
  }, [])

  async function sendMessage(text: string) {
    if (!text.trim() || sending) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')
    setInterimTranscript('')
    setSending(true)

    try {
      // Build context: today's totals + goals
      let context = {}
      try {
        const today = await api.getToday()
        const totalProtein = today.entries.reduce((s, e) => s + (e.protein_g ?? 0), 0)
        context = {
          date: today.date,
          total_kcal: today.total_kcal,
          total_protein_g: totalProtein,
          goal_kcal: today.goals.calories,
          goal_protein_g: today.goals.protein,
          remaining_kcal: Math.max(0, today.goals.calories - today.total_kcal),
          remaining_protein_g: Math.max(0, today.goals.protein - totalProtein),
          meals_logged: today.entries.length,
        }
      } catch {
        // Proceed without context
      }

      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (API_KEY) headers.set('X-Health-Key', API_KEY)

      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text.trim(), context }),
      })

      if (!res.ok) {
        throw new Error(`API error ${res.status}`)
      }

      const data = await res.json() as {
        reply: string
        action: string | null
        data: Record<string, unknown>
      }

      let action: ChatAction | null = null
      if (data.action) {
        const labelMap: Record<string, string> = {
          log_food: 'Log this meal',
          log_workout: 'Log workout',
          log_weight: 'Log weight',
          log_sleep: 'Log sleep',
          add_list_item: 'Add to list',
          // meal_suggestion intentionally has no button — executeAction never
          // supported it, so the button was a permanent no-op. Suggestions
          // live on the Fridge page.
          meal_suggestion: '',
          weekly_summary: '',
        }
        const label = labelMap[data.action] || ''
        if (label) {
          action = { type: data.action, data: data.data || {}, label }
        }
      }

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: data.reply,
        action,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
      if (navigator.vibrate) navigator.vibrate(8)
    } catch {
      const errorMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        text: 'Sorry, something went wrong. Try again.',
        timestamp: Date.now(),
      }
      addMessage(errorMsg)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function executeAction(msg: ChatMessage) {
    if (!msg.action || msg.actionDone) return
    const { type, data } = msg.action

    try {
      switch (type) {
        case 'log_food': {
          const meal = (data.meal as string) || 'Snack'
          const desc = (data.description as string) || meal
          const kcal = (data.kcal as number) || 0
          const protein = (data.protein_g as number) || 0
          await api.addFood({ meal, description: desc, kcal, protein_g: protein })
          showToast(`Logged ${meal} (${kcal} kcal)`, 'ok')
          break
        }
        case 'log_weight': {
          const kg = data.weight_kg as number
          if (kg) {
            await api.addWeightEntry(kg)
            showToast(`Weight logged: ${kg} kg`, 'ok')
          }
          break
        }
        case 'log_sleep': {
          const bedtime = data.bedtime as string
          const wake = data.wake_time as string
          const quality = (data.quality as number) || 3
          if (bedtime && wake) {
            await api.logSleep({ bedtime, wake_time: wake, quality })
            showToast('Sleep logged', 'ok')
          }
          break
        }
        case 'add_list_item': {
          const list = (data.list as string) || 'groceries'
          const text = data.text as string
          if (text) {
            await api.addListItem(list, text)
            showToast(`Added to ${list}`, 'ok')
          }
          break
        }
        case 'log_workout': {
          const title = (data.title as string) || 'Workout'
          const duration = (data.duration_min as number) || 30
          const now = new Date()
          const start = now.toISOString()
          const end = new Date(now.getTime() + duration * 60000).toISOString()
          await api.saveWorkout({
            title,
            start_time: start,
            end_time: end,
            exercises: [],
          })
          showToast(`Logged ${title}`, 'ok')
          break
        }
        default:
          showToast('Action not supported yet', 'info')
          return
      }

      // Mark action as done
      setMessages(prev =>
        prev.map(m => m.id === msg.id ? { ...m, actionDone: true } : m)
      )
      if (navigator.vibrate) navigator.vibrate(8)
    } catch {
      showToast('Failed to execute action', 'err')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  function handleVoiceTranscript(text: string) {
    setInterimTranscript('')
    sendMessage(text)
  }

  function clearHistory() {
    setMessages([])
    localStorage.removeItem(STORAGE_KEY)
  }

  const isEmpty = messages.length === 0

  return (
    <div className="page" style={{
      display: 'flex',
      flexDirection: 'column',
      padding: 0,
      background: 'linear-gradient(180deg, var(--c-bg) 0%, rgba(59,130,246,0.03) 100%)',
    }}>
      {/* Header */}
      <div
        style={{
          padding: '0 16px',
          paddingTop: 'max(60px, calc(env(safe-area-inset-top, 0px) + 20px))',
          paddingBottom: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--c-label)' }}>
            Health Coach
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-label-faint)', marginTop: 2 }}>
            Voice-first health assistant
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            style={{
              background: 'var(--c-card)',
              border: '1px solid var(--c-border)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--c-label-faint)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages / Empty State */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* ── Empty State: Voice-first coach greeting ── */}
        {isEmpty && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            gap: 20,
            padding: '20px 16px 40px',
          }}>
            {/* Large mic button — the hero of the empty state */}
            <div style={{
              marginTop: 20,
              marginBottom: 8,
            }}>
              <VoiceInput
                onTranscript={handleVoiceTranscript}
                disabled={sending}
              />
            </div>

            {/* Interim transcript while speaking */}
            {interimTranscript && (
              <div style={{
                fontSize: 15,
                color: 'var(--c-label-dim)',
                textAlign: 'center',
                maxWidth: 280,
                lineHeight: 1.5,
                fontStyle: 'italic',
                animation: 'slideUpSubtle 0.15s ease-out',
              }}>
                {interimTranscript}
              </div>
            )}

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-label)', marginBottom: 6 }}>
                Hey! I'm your health coach
              </div>
              <div style={{ fontSize: 14, color: 'var(--c-label-dim)', lineHeight: 1.6, maxWidth: 300 }}>
                Tap the mic and tell me what you ate, how you trained, or ask me anything about your health.
              </div>
            </div>

            {/* Example prompt cards — tappable, colorful, with icons */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              width: '100%',
              maxWidth: 340,
            }}>
              {EXAMPLE_PROMPTS.map(prompt => (
                <button
                  key={prompt.text}
                  onClick={() => sendMessage(prompt.text)}
                  style={{
                    background: 'var(--c-card)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 14,
                    padding: '14px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 8,
                    cursor: 'pointer',
                    transition: 'transform 0.1s, border-color 0.15s',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    fontSize: 22,
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: `${prompt.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {prompt.icon}
                  </span>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--c-label)',
                    lineHeight: 1.3,
                  }}>
                    {prompt.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Chat messages ── */}
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              animation: 'slideUpSubtle 0.15s ease-out',
            }}
          >
            <div
              style={{
                maxWidth: '82%',
                padding: msg.role === 'assistant' ? '12px 16px' : '10px 14px',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: msg.role === 'user'
                  ? 'var(--c-accent)'
                  : 'var(--c-card)',
                color: msg.role === 'user' ? '#fff' : 'var(--c-label)',
                fontSize: 14,
                lineHeight: 1.6,
                border: msg.role === 'assistant' ? '1px solid var(--c-border)' : 'none',
                boxShadow: msg.role === 'assistant' ? '0 2px 8px rgba(0,0,0,0.04)' : 'none',
              }}
            >
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>

              {/* Action button — pill-shaped and colorful */}
              {msg.action && !msg.actionDone && (
                <button
                  onClick={() => executeAction(msg)}
                  style={{
                    marginTop: 10,
                    background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 20,
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'transform 0.1s',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                  {msg.action.label}
                </button>
              )}
              {msg.actionDone && <ActionDoneCheck />}

              {/* Timestamp */}
              <div style={{
                fontSize: 10,
                color: msg.role === 'user' ? 'rgba(255,255,255,0.6)' : 'var(--c-label-faint)',
                marginTop: 6,
                textAlign: msg.role === 'user' ? 'right' : 'left',
              }}>
                {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                padding: '14px 20px',
                borderRadius: '18px 18px 18px 4px',
                background: 'var(--c-card)',
                border: '1px solid var(--c-border)',
                display: 'flex',
                gap: 5,
                alignItems: 'center',
              }}
            >
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--c-label-faint)',
                    animation: `typingDot 1.2s ease-in-out ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input area — visible when there are messages */}
      {!isEmpty && (
        <div
          style={{
            flexShrink: 0,
            padding: '12px 16px',
            paddingBottom: 'calc(12px + var(--safe-bottom))',
            background: 'var(--c-card)',
            borderTop: '1px solid var(--c-border)',
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <input
              ref={inputRef}
              className="flex-1 min-w-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-xl px-3 py-2.5 text-[14px] text-[var(--c-label)] placeholder:text-[var(--c-label-faint)] focus:outline-none focus:border-[var(--c-accent)] transition-colors disabled:opacity-50"
              placeholder="Type or tap mic..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={sending}
              autoComplete="on"
              autoCorrect="on"
              spellCheck={true}
            />
            <VoiceInput
              onTranscript={handleVoiceTranscript}
              compact
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              aria-label="Send message"
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                background: !input.trim() || sending ? 'var(--c-border)' : 'var(--c-accent)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: !input.trim() || sending ? 0.4 : 1,
                transition: 'opacity 0.15s, background 0.15s',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4z" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* Inline animation styles */}
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-4px); }
        }
        @keyframes checkPop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
