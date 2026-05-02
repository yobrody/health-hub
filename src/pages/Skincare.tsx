import { useEffect, useMemo, useState } from 'react'
import { getStreak, type DayLog } from '../lib/streaks'
import {
  daysRemaining,
  decrementProduct,
  generateProductId,
  getActiveProduct,
  isLowStock,
  loadProducts,
  lowStockProducts,
  reorderUrl,
  saveProducts,
  type Product,
  type StepId,
} from '../lib/skincare-products'

type RoutineStep = { id: StepId; label: string; icon: string }

const MORNING_STEPS: RoutineStep[] = [
  { id: 'cleanse', label: 'Cleanse', icon: '🫧' },
  { id: 'moisturize', label: 'Moisturize', icon: '🧴' },
  { id: 'spf', label: 'SPF', icon: '☀️' },
]

const EVENING_STEPS: RoutineStep[] = [
  { id: 'cleanse', label: 'Cleanse', icon: '🫧' },
  { id: 'treat', label: 'Treat', icon: '✨' },
  { id: 'moisturize', label: 'Moisturize', icon: '🧴' },
]

const STEP_OPTIONS: Array<{ id: StepId; label: string }> = [
  { id: 'cleanse', label: 'Cleanse' },
  { id: 'moisturize', label: 'Moisturize' },
  { id: 'spf', label: 'SPF' },
  { id: 'treat', label: 'Treat' },
]

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function getLog(): DayLog[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('skincare_log') || '[]')
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore corrupt JSON */ }
  return []
}

function setLog(next: DayLog[]) {
  try { localStorage.setItem('skincare_log', JSON.stringify(next)) } catch { /* ignore quota errors */ }
}

type ProductFormState = {
  id?: string  // present when editing
  step_id: StepId
  name: string
  bottle_size_ml: string  // string while editing, parsed on save
  daily_usage_ml: string
  amazon_url: string
}

function emptyForm(): ProductFormState {
  return { step_id: 'moisturize', name: '', bottle_size_ml: '', daily_usage_ml: '', amazon_url: '' }
}

export default function Skincare() {
  const [log, setLocalLog] = useState<DayLog[]>(() => getLog())
  const [period, setPeriod] = useState<'morning' | 'evening'>(() => new Date().getHours() < 14 ? 'morning' : 'evening')
  const [showCelebrate, setShowCelebrate] = useState(false)
  const [products, setProducts] = useState<Product[]>(() => loadProducts(localStorage))
  const [showManager, setShowManager] = useState(false)
  const [form, setForm] = useState<ProductFormState>(emptyForm)
  const today = todayISO()

  const todayRow = useMemo(
    () => log.find(r => r.date === today) ?? { date: today, morning: [], evening: [] },
    [log, today],
  )
  const doneIds = period === 'morning' ? todayRow.morning : todayRow.evening
  const steps = period === 'morning' ? MORNING_STEPS : EVENING_STEPS

  const streak = getStreak(log, new Date(), MORNING_STEPS.length, EVENING_STEPS.length)
  const totalDoneToday = todayRow.morning.length + todayRow.evening.length

  const lowStock = lowStockProducts(products)

  useEffect(() => {
    if (totalDoneToday < 6) return
    const key = `skin_celebrate_${today}`
    if (localStorage.getItem(key) === '1') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot celebration when today's checklist hits 6
    setShowCelebrate(true)
    localStorage.setItem(key, '1')
    const t = window.setTimeout(() => setShowCelebrate(false), 1800)
    if (navigator.vibrate) navigator.vibrate([20, 40, 20])
    return () => window.clearTimeout(t)
  }, [totalDoneToday, today])

  function persistProducts(next: Product[]) {
    setProducts(next)
    saveProducts(localStorage, next)
  }

  function toggle(stepId: StepId) {
    const has = doneIds.includes(stepId)
    const updated = log.filter(r => r.date !== today)
    const nextRow: DayLog = {
      ...todayRow,
      [period]: has ? doneIds.filter(s => s !== stepId) : [...doneIds, stepId],
    }
    const next = [...updated, nextRow].sort((a, b) => a.date.localeCompare(b.date)).slice(-60)
    setLocalLog(next)
    setLog(next)
    if (navigator.vibrate) navigator.vibrate(8)

    // Mark-as-done decrements the active product for the step. Mark-as-undone
    // is intentionally not symmetric — re-incrementing on un-toggle would
    // amplify any timing mistakes. Treat the log toggle as a soft "did I do
    // this morning's step?" not as a high-fidelity inventory event.
    if (!has) {
      const active = getActiveProduct(products, stepId)
      if (active && active.daily_usage_ml > 0) {
        persistProducts(decrementProduct(products, active.id, active.daily_usage_ml))
      }
    }
  }

  function openAdd() {
    setForm(emptyForm())
    setShowManager(true)
  }

  function openEdit(p: Product) {
    setForm({
      id: p.id,
      step_id: p.step_id,
      name: p.name,
      bottle_size_ml: String(p.bottle_size_ml),
      daily_usage_ml: String(p.daily_usage_ml),
      amazon_url: p.amazon_url ?? '',
    })
    setShowManager(true)
  }

  function saveForm() {
    const bottleSize = parseFloat(form.bottle_size_ml)
    const dailyUsage = parseFloat(form.daily_usage_ml)
    if (!form.name.trim() || !Number.isFinite(bottleSize) || bottleSize <= 0 || !Number.isFinite(dailyUsage) || dailyUsage <= 0) return

    if (form.id) {
      // Edit existing — preserve remaining_ml unless the bottle size changed
      // upward (user probably bought a bigger pack), in which case top up.
      const next = products.map(p => {
        if (p.id !== form.id) return p
        const newRemaining = bottleSize > p.bottle_size_ml
          ? p.remaining_ml + (bottleSize - p.bottle_size_ml)
          : Math.min(p.remaining_ml, bottleSize)
        return {
          ...p,
          step_id: form.step_id,
          name: form.name.trim(),
          bottle_size_ml: bottleSize,
          daily_usage_ml: dailyUsage,
          remaining_ml: newRemaining,
          amazon_url: form.amazon_url.trim() || undefined,
        }
      })
      persistProducts(next)
    } else {
      // Add new — start full
      const newProduct: Product = {
        id: generateProductId(),
        step_id: form.step_id,
        name: form.name.trim(),
        bottle_size_ml: bottleSize,
        daily_usage_ml: dailyUsage,
        remaining_ml: bottleSize,
        amazon_url: form.amazon_url.trim() || undefined,
        added: new Date().toISOString(),
      }
      persistProducts([...products, newProduct])
    }
    setForm(emptyForm())
    setShowManager(false)
  }

  function deleteProduct(id: string) {
    persistProducts(products.filter(p => p.id !== id))
  }

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 6 }}>Skincare</div>
          <button
            onClick={openAdd}
            style={{ background: 'var(--gray6)', border: 'none', borderRadius: 14, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: 'var(--label)', cursor: 'pointer' }}
          >Products</button>
        </div>
        <div style={{ fontSize: 14, color: 'var(--label2)', marginBottom: 14 }}>
          Super simple. Tap each step when done.
        </div>

        {/* Low-stock banner. Multiple low-stock products collapse into a single banner;
            tapping the banner opens the manager so the user picks which to reorder. */}
        {lowStock.length > 0 && (
          <button
            onClick={() => setShowManager(true)}
            style={{
              width: '100%',
              background: 'rgba(255,149,0,0.12)',
              border: '1px solid rgba(255,149,0,0.35)',
              borderRadius: 14,
              padding: '10px 14px',
              marginBottom: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{ fontSize: 20 }}>📦</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>
                {lowStock.length === 1 ? `${lowStock[0].name} running low` : `${lowStock.length} products running low`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                Tap to manage / reorder
              </div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--label3)' }}>❯</span>
          </button>
        )}

        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600 }}>TODAY</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{totalDoneToday}/6</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600 }}>STREAK</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--orange)' }}>🔥 {streak}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['morning', 'evening'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1,
                background: period === p ? 'var(--blue)' : 'var(--card)',
                color: period === p ? '#fff' : 'var(--label2)',
                border: period === p ? 'none' : '1px solid var(--separator)',
                borderRadius: 14,
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {p === 'morning' ? '☀️ Morning' : '🌙 Evening'}
            </button>
          ))}
        </div>

        <div className="card">
          {steps.map((step) => {
            const done = doneIds.includes(step.id)
            const active = getActiveProduct(products, step.id)
            const days = active ? Math.floor(daysRemaining(active)) : null
            const low = active ? isLowStock(active) : false
            return (
              <button
                key={step.id}
                onClick={() => toggle(step.id)}
                className="list-row"
                style={{ width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 10 }}
              >
                <span style={{ fontSize: 20 }}>{step.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{step.label}</div>
                  {active && (
                    <div style={{ fontSize: 12, color: low ? 'var(--orange)' : 'var(--label3)', marginTop: 1 }}>
                      {active.name} · {days === Infinity || days === null ? '—' : `~${days} days left`}
                    </div>
                  )}
                </div>
                <span className={done ? 'badge badge-green' : 'badge'} style={!done ? { background: 'var(--gray6)', color: 'var(--label2)' } : undefined}>
                  {done ? 'Done' : 'Tap'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {showCelebrate && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="celebrate-pop" style={{ background: 'var(--card)', borderRadius: 16, padding: '10px 14px', border: '1px solid var(--separator)' }}>
            <div style={{ fontSize: 20, textAlign: 'center' }}>✨ 🧴 ✨</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Skincare complete today!</div>
          </div>
        </div>
      )}

      {/* Products manager sheet */}
      {showManager && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 410, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowManager(false); setForm(emptyForm()) } }}
        >
          <div style={{
            background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%',
            padding: '16px 20px calc(32px + var(--safe-bottom))',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Products</div>
              <button
                onClick={() => { setShowManager(false); setForm(emptyForm()) }}
                className="sheet-close"
              >×</button>
            </div>

            {/* Existing products */}
            {products.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                {products.map((p, i) => {
                  const days = Math.floor(daysRemaining(p))
                  const low = isLowStock(p)
                  return (
                    <div
                      key={p.id}
                      className="list-row"
                      style={{ borderBottom: i < products.length - 1 ? '0.5px solid var(--separator)' : 'none', gap: 10 }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                          {p.step_id} · {p.remaining_ml.toFixed(1)} / {p.bottle_size_ml} mL · {days === Infinity ? '—' : `~${days}d left`}
                          {low && <span style={{ color: 'var(--orange)', fontWeight: 700 }}> · LOW</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {low && (
                          <a
                            href={reorderUrl(p)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              background: 'var(--orange)', color: '#fff', textDecoration: 'none',
                              borderRadius: 10, padding: '6px 10px', fontSize: 12, fontWeight: 700,
                            }}
                          >Reorder</a>
                        )}
                        <button
                          onClick={() => openEdit(p)}
                          style={{ background: 'var(--gray6)', border: 'none', borderRadius: 10, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >Edit</button>
                        <button
                          onClick={() => deleteProduct(p.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 4px' }}
                        >Delete</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Add / edit form */}
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label2)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              {form.id ? 'Edit' : 'Add product'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {STEP_OPTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setForm(f => ({ ...f, step_id: s.id }))}
                  style={{
                    background: form.step_id === s.id ? 'var(--blue)' : 'var(--gray6)',
                    color: form.step_id === s.id ? '#fff' : 'var(--label)',
                    border: 'none', borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >{s.label}</button>
              ))}
            </div>
            <input
              className="input-field"
              placeholder="Product name (e.g. CeraVe AM)"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={{ marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                className="input-field"
                type="number"
                inputMode="decimal"
                placeholder="Bottle (mL)"
                value={form.bottle_size_ml}
                onChange={e => setForm(f => ({ ...f, bottle_size_ml: e.target.value }))}
              />
              <input
                className="input-field"
                type="number"
                inputMode="decimal"
                placeholder="Daily use (mL)"
                value={form.daily_usage_ml}
                onChange={e => setForm(f => ({ ...f, daily_usage_ml: e.target.value }))}
              />
            </div>
            <input
              className="input-field"
              placeholder="Amazon URL (optional — paste product page)"
              value={form.amazon_url}
              onChange={e => setForm(f => ({ ...f, amazon_url: e.target.value }))}
              style={{ marginBottom: 12 }}
            />
            <button
              onClick={saveForm}
              disabled={!form.name.trim() || !parseFloat(form.bottle_size_ml) || !parseFloat(form.daily_usage_ml)}
              className="btn-primary"
              style={{ width: '100%' }}
            >{form.id ? 'Save changes' : 'Add product'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
