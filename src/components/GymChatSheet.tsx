import { useState } from 'react'
import { api } from '../api/client'
import { addManualEquipment, SEED_PADDINGTON } from '../lib/gym-equipment'
import type { GymCoachMachineResponse } from '../api/client'

type SuggestedEquipment = NonNullable<GymCoachMachineResponse['suggestedEquipment']>
import { showToast } from '../toast'

interface ChatMessage {
  role: 'user' | 'coach'
  text: string
  /** Coach replies may include suggestion blocks the user can act on. */
  suggestion?: {
    equipment?: SuggestedEquipment | null
    schedule?: {
      addToDay: string
      afterExercise: string
      sets: number
      repRange: string
      rir: string
      restSeconds: number
      startingWeight_kg: number
      rationale: string
    } | null
  }
  offline?: boolean
}

/**
 * In-gym chat. User asks about a machine; coach answers and may suggest
 * adding it to the catalog + slotting it into the program. Confirm-button
 * wires through to addManualEquipment + showToast.
 */
export function GymChatSheet({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'coach', text: "Ask me about any machine at your gym. I'll check the catalog, tell you what it does, and suggest where it fits in your program." },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setBusy(true)
    try {
      const known = SEED_PADDINGTON.map(e => e.name)
      const res = await api.gymCoachMachine(q, known)
      setMessages(prev => [...prev, {
        role: 'coach',
        text: res.answer || '(no response)',
        suggestion: {
          equipment: res.suggestedEquipment ?? null,
          schedule: res.suggestedSchedule ?? null,
        },
        offline: res.offline,
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'coach',
        text: `Coach is offline (${String(e).slice(0, 80)}).`,
        offline: true,
      }])
    } finally {
      setBusy(false)
    }
  }

  function addEquipmentToCatalog(eq: NonNullable<ChatMessage['suggestion']>['equipment']) {
    if (!eq) return
    addManualEquipment({
      id: eq.id,
      name: eq.name,
      type: eq.type,
      stack: eq.stack,
      aliases: eq.aliases,
      notes: eq.notes,
    })
    showToast(`Added ${eq.name} to catalog`)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 450, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%',
        padding: '14px 16px calc(20px + var(--safe-bottom))',
        height: '88vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 10px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Coach</div>
          <button onClick={onClose} className="sheet-close">×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                background: m.role === 'user' ? 'var(--blue)' : 'var(--gray6)',
                color: m.role === 'user' ? '#fff' : 'var(--label)',
                borderRadius: 14,
                padding: '10px 14px',
                maxWidth: '88%',
                fontSize: 14, lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
              }}>{m.text}</div>

              {m.suggestion?.equipment && (
                <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 12, maxWidth: '88%', alignSelf: 'flex-start' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'var(--label3)', textTransform: 'uppercase', marginBottom: 4 }}>Suggested machine</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{m.suggestion.equipment.name}</div>
                  {m.suggestion.equipment.stack && (
                    <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 2 }}>
                      {m.suggestion.equipment.stack.min}–{m.suggestion.equipment.stack.max}kg in {m.suggestion.equipment.stack.step}kg jumps
                    </div>
                  )}
                  <button
                    onClick={() => addEquipmentToCatalog(m.suggestion!.equipment!)}
                    style={{ marginTop: 8, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >Add to my catalog</button>
                </div>
              )}

              {m.suggestion?.schedule && m.suggestion.schedule.addToDay !== 'none' && (
                <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 12, maxWidth: '88%', alignSelf: 'flex-start' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'var(--label3)', textTransform: 'uppercase', marginBottom: 4 }}>Suggested schedule</div>
                  <div style={{ fontSize: 13 }}>
                    Add to <strong>{m.suggestion.schedule.addToDay}</strong>{m.suggestion.schedule.afterExercise && <> after <strong>{m.suggestion.schedule.afterExercise}</strong></>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 4 }}>
                    {m.suggestion.schedule.sets} × {m.suggestion.schedule.repRange} · {m.suggestion.schedule.rir} RIR · {m.suggestion.schedule.restSeconds}s rest · start at {m.suggestion.schedule.startingWeight_kg}kg
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--label3)', marginTop: 6, fontStyle: 'italic' }}>
                    {m.suggestion.schedule.rationale}
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--gray6)', borderRadius: 14, padding: '10px 14px', fontSize: 13, color: 'var(--label2)' }}>
              Thinking…
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder="e.g. is there a hack squat here?"
            style={{ flex: 1, background: 'var(--gray6)', border: 'none', borderRadius: 14, padding: '12px 14px', fontSize: 14, color: 'var(--label)', outline: 'none' }}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 14, padding: '0 20px', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}
          >Send</button>
        </div>
      </div>
    </div>
  )
}
