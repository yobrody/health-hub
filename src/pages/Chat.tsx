// ── Chat — AI Health Assistant ────────────────────────────────────────
// Chat-style interface for natural language health logging and queries.
// User can type or voice-input; AI parses intent and returns structured
// actions (log food, log weight, add to list, etc.) with confirm buttons.

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

// ── Component ────────────────────────────────────────────────────────
export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
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
          meal_suggestion: 'View suggestions',
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
    } catch {
      showToast('Failed to execute action', 'err')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  function handleVoiceTranscript(text: string) {
    sendMessage(text)
  }

  function clearHistory() {
    setMessages([])
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
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
            Health Chat
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-label-faint)', marginTop: 2 }}>
            Talk naturally about food, workouts, and health
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

      {/* Messages */}
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
        {messages.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            gap: 16,
            padding: '40px 20px',
          }}>
            <div style={{ fontSize: 40 }}>{'\uD83D\uDCAC'}</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-label)', marginBottom: 8 }}>
                Your health assistant
              </div>
              <div style={{ fontSize: 14, color: 'var(--c-label-dim)', lineHeight: 1.5, maxWidth: 300 }}>
                Try saying things like:
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 }}>
              {[
                'had 2 eggs and toast for breakfast',
                'did 30 min chest workout',
                'weigh 79.5',
                'add milk to groceries',
                'what should I eat for dinner?',
                'how is my week going?',
              ].map(example => (
                <button
                  key={example}
                  onClick={() => sendMessage(example)}
                  style={{
                    background: 'var(--c-card)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 12,
                    padding: '10px 14px',
                    fontSize: 13,
                    color: 'var(--c-label-dim)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  "{example}"
                </button>
              ))}
            </div>
          </div>
        )}

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
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? 'var(--c-accent)' : 'var(--c-card)',
                color: msg.role === 'user' ? '#fff' : 'var(--c-label)',
                fontSize: 14,
                lineHeight: 1.5,
                border: msg.role === 'assistant' ? '1px solid var(--c-border)' : 'none',
              }}
            >
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>

              {/* Action button */}
              {msg.action && !msg.actionDone && (
                <button
                  onClick={() => executeAction(msg)}
                  style={{
                    marginTop: 8,
                    background: 'var(--c-accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '7px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    width: '100%',
                    transition: 'opacity 0.15s',
                  }}
                >
                  {msg.action.label}
                </button>
              )}
              {msg.actionDone && (
                <div style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: 'var(--c-green)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" />
                  </svg>
                  Done
                </div>
              )}

              {/* Timestamp */}
              <div style={{
                fontSize: 10,
                color: msg.role === 'user' ? 'rgba(255,255,255,0.6)' : 'var(--c-label-faint)',
                marginTop: 4,
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
                padding: '12px 18px',
                borderRadius: '16px 16px 16px 4px',
                background: 'var(--c-card)',
                border: '1px solid var(--c-border)',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
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

      {/* Input area */}
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
            className="flex-1 min-w-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-3 py-2.5 text-[14px] text-[var(--c-label)] placeholder:text-[var(--c-label-faint)] focus:outline-none focus:border-[var(--c-accent)] transition-colors disabled:opacity-50"
            placeholder="Type anything health-related..."
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={sending}
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
              borderRadius: 10,
              background: 'var(--c-accent)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !input.trim() || sending ? 0.3 : 1,
              transition: 'opacity 0.15s',
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4z" />
            </svg>
          </button>
        </form>
      </div>

      {/* Inline animation styles */}
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-4px); }
        }
      `}</style>
    </div>
  )
}
