import { useRef, useState } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { FridgeData, FoodAnalysisV2, FridgeItem } from '../api/client'

type Stage = 'idle' | 'analyzing' | 'result'

interface Props {
  open: boolean
  onClose: () => void
  fridgeData: FridgeData | null
  onFridgeUpdated: () => void
}

// Compress image to ~200px wide thumbnail for diary storage (~20-30KB)
async function compressThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 220 / img.width)
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.65))
      } catch { resolve('') }
      finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve('') }
    img.src = url
  })
}

function saveDiaryEntry(thumbnail: string, foods: FoodAnalysisV2['foods']) {
  try {
    const existing: unknown[] = JSON.parse(localStorage.getItem('photo_diary') || '[]')
    const entry = { datetime: new Date().toISOString(), thumbnail, foods }
    localStorage.setItem('photo_diary', JSON.stringify([entry, ...existing].slice(0, 90)))
  } catch {}
}

export default function CameraSheet({ open, onClose, fridgeData, onFridgeUpdated }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const [analysis, setAnalysis] = useState<FoodAnalysisV2 | null>(null)
  const [checkedMatches, setCheckedMatches] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const foodInputRef = useRef<HTMLInputElement>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStage('idle')
    setAnalysis(null)
    setCheckedMatches(new Set())
    setSaving(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleFoodPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (foodInputRef.current) foodInputRef.current.value = ''
    setStage('analyzing')
    try {
      const [result, thumbnail] = await Promise.all([
        api.analyzeFoodV2(file, fridgeData),
        compressThumbnail(file),
      ])
      setAnalysis(result)
      setCheckedMatches(new Set(result.fridge_matches.map((m: FridgeItem & { zone: string }) => m.name)))
      if (thumbnail && result.foods.length > 0) saveDiaryEntry(thumbnail, result.foods)
      setStage('result')
    } catch {
      showToast('Analysis failed — try again', 'err')
      setStage('idle')
    }
  }

  async function handleReceiptPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (receiptInputRef.current) receiptInputRef.current.value = ''
    setStage('analyzing')
    try {
      const result = await api.scanReceipt(file)
      if (result.items?.length) {
        await Promise.all(result.items.map(item =>
          api.addFridgeItem(item.name, item.section, { size: item.size, cost: item.cost })
        ))
        onFridgeUpdated()
        showToast(`Added ${result.items.length} items from receipt`)
      } else {
        showToast('No items found on receipt', 'info')
      }
      handleClose()
    } catch {
      showToast('Receipt scan failed', 'err')
      setStage('idle')
    }
  }

  async function confirmLog() {
    if (!analysis || analysis.foods.length === 0) return
    setSaving(true)
    try {
      const totalKcal = analysis.foods.reduce((a, f) => a + f.kcal, 0)
      const totalProtein = Math.round(analysis.foods.reduce((a, f) => a + f.protein_g, 0))
      const description = analysis.foods.map(f => f.name).join(', ')
      const h = new Date().getHours()
      const meal = h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner'

      await api.addFood({ meal, description, kcal: totalKcal, protein_g: totalProtein })

      // Log usage + remove checked fridge items
      const matched = analysis.fridge_matches.filter(m => checkedMatches.has(m.name))
      if (matched.length) {
        await Promise.all([
          ...matched.map(m =>
            api.logFridgeUsage({ item_name: m.name, zone: m.zone || 'fridge', date_added: m.added ?? null }).catch(() => {})
          ),
          ...matched.map(m => api.removeFridgeItem(m.name).catch(() => {})),
        ])
        onFridgeUpdated()
      }

      showToast(`Logged ${totalKcal} kcal${matched.length ? ` · removed ${matched.length} from fridge` : ''}`)
      handleClose()
    } catch {
      showToast('Failed to save — try again', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const totalKcal = analysis?.foods.reduce((a, f) => a + f.kcal, 0) ?? 0
  const totalProtein = Math.round(analysis?.foods.reduce((a, f) => a + f.protein_g, 0) ?? 0)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%',
        padding: '16px 20px calc(32px + var(--safe-bottom))',
        animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Handle + header */}
        <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {stage === 'result' ? 'Food identified' : 'Camera'}
          </div>
          <button className="sheet-close" onClick={handleClose}>×</button>
        </div>

        {/* Hidden file inputs */}
        <input ref={foodInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFoodPhoto} />
        <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleReceiptPhoto} />

        {/* Idle — mode picker */}
        {stage === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => foodInputRef.current?.click()}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px', fontSize: 17, fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                <path d="M3 2l1.5 7H19.5L21 2"/><path d="M4.5 9l1 11h13l1-11"/>
              </svg>
              <div>
                <div>Log Food</div>
                <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.82, marginTop: 2 }}>Photo → AI identifies items + macros</div>
              </div>
            </button>

            <button
              onClick={() => receiptInputRef.current?.click()}
              style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px', fontSize: 17, fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                <rect x="4" y="2" width="16" height="20" rx="2"/>
                <line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="13" y2="14"/>
              </svg>
              <div>
                <div>Scan Receipt</div>
                <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.82, marginTop: 2 }}>Add items directly to fridge</div>
              </div>
            </button>
          </div>
        )}

        {/* Analyzing spinner */}
        {stage === 'analyzing' && (
          <div style={{ textAlign: 'center', padding: '36px 0' }}>
            <div style={{ width: 44, height: 44, border: '3px solid var(--gray4)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spinnerRot 0.65s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600 }}>Analysing photo…</div>
            <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 6 }}>AI is identifying food and checking your fridge</div>
          </div>
        )}

        {/* Result */}
        {stage === 'result' && analysis && (
          <>
            {/* Foods list */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Identified</div>
              <div className="card" style={{ padding: '0 16px' }}>
                {analysis.foods.length === 0 ? (
                  <div style={{ padding: '16px 0', fontSize: 14, color: 'var(--label2)' }}>No food detected — try another angle</div>
                ) : (
                  analysis.foods.map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i < analysis.foods.length - 1 ? '0.5px solid var(--separator)' : 'none' }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{f.name}</div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--blue)' }}>{f.kcal} kcal</div>
                        <div style={{ fontSize: 12, color: 'var(--label2)' }}>{f.protein_g}g protein</div>
                      </div>
                    </div>
                  ))
                )}
                {analysis.foods.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '0.5px solid var(--separator)' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Total</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue)' }}>{totalKcal} kcal · {totalProtein}g protein</div>
                  </div>
                )}
              </div>
            </div>

            {/* Fridge cross-ref */}
            {analysis.fridge_matches.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Used from fridge?</div>
                <div style={{ fontSize: 12, color: 'var(--label3)', marginBottom: 8 }}>Tick to remove and log how long it lasted</div>
                <div className="card" style={{ padding: '0 16px' }}>
                  {analysis.fridge_matches.map((m, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: i < analysis.fridge_matches.length - 1 ? '0.5px solid var(--separator)' : 'none', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checkedMatches.has(m.name)}
                        onChange={e => {
                          const next = new Set(checkedMatches)
                          e.target.checked ? next.add(m.name) : next.delete(m.name)
                          setCheckedMatches(next)
                        }}
                        style={{ width: 20, height: 20, accentColor: 'var(--blue)', flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--label3)' }}>
                          {m.zone}{m.added ? ` · added ${m.added}` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={confirmLog}
              disabled={saving || analysis.foods.length === 0}
              className="btn-primary"
              style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: analysis.foods.length === 0 ? 0.45 : 1 }}
            >
              {saving ? <><span className="btn-spinner" /> Saving…</> : `Log ${totalKcal} kcal`}
            </button>
            <button
              onClick={() => { setStage('idle'); setAnalysis(null) }}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 16, fontWeight: 500, cursor: 'pointer', padding: '10px 0' }}
            >
              Retake photo
            </button>
          </>
        )}
      </div>
    </div>
  )
}
