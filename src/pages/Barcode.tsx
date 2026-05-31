import { useState, useRef } from 'react'
import type { BarcodeLookupResult as BarcodeResult } from '../api/client'

export default function Barcode({ onAddFood }: { onAddFood?: (name: string, kcal: number, protein: number) => void }) {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<BarcodeResult | null>(null)
  const [source, setSource] = useState<string>('open_food_facts')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [servings, setServings] = useState('1')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    setSource('open_food_facts')
    try {
      // Use server-side barcode endpoint (includes AI fallback for UK products)
      const BASE = import.meta.env.VITE_API_BASE || '/api'
      const KEY = import.meta.env.VITE_API_KEY || undefined
      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (KEY) headers.set('X-Health-Key', KEY as string)
      const res = await fetch(`${BASE}/barcode/${encodeURIComponent(code.trim())}`, { headers })
      if (!res.ok) throw new Error('Product not found')
      const serverData = await res.json()
      setSource(serverData.source || 'open_food_facts')
      setResult({
        name: serverData.name,
        brand: serverData.brand,
        serving_size: serverData.serving_size,
        image_url: serverData.image_url,
        per_100g: serverData.per_100g,
      } as BarcodeResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Product not found')
    } finally {
      setLoading(false)
    }
  }

  function handleAddToLog() {
    if (!result || !onAddFood) return
    const mult = parseFloat(servings) || 1
    const kcal = Math.round((result.per_100g?.kcal ?? 0) * mult)
    const protein = Math.round((result.per_100g?.protein_g ?? 0) * mult)
    onAddFood(result.name, kcal, protein)
  }

  return (
    <div style={{ padding: 16 }}>
      <form onSubmit={handleLookup} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          ref={inputRef}
          className="input-field"
          style={{ flex: 1, padding: '12px 14px', fontSize: 16 }}
          placeholder="Enter barcode number"
          value={code}
          onChange={e => setCode(e.target.value)}
          inputMode="numeric"
          autoFocus
        />
        <button type="submit" disabled={loading || !code.trim()} style={{
          background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10,
          padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
          opacity: (!code.trim() || loading) ? 0.5 : 1,
        }}>
          {loading ? '...' : 'Look up'}
        </button>
      </form>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--red-bg, #fff0f0)', color: 'var(--red)', borderRadius: 10, marginBottom: 12, fontSize: 14 }}>
          {error}
        </div>
      )}

      {result && (
        <div className="card" style={{ padding: 18 }}>
          {source === 'ai_estimate' && (
            <div style={{
              background: 'rgba(255,159,10,0.12)', color: 'var(--orange, #ff9f0a)',
              borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600,
              marginBottom: 12, textAlign: 'center',
            }}>
              AI estimate -- not in Open Food Facts database
            </div>
          )}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
            {result.image_url && (
              <img src={result.image_url} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', background: 'var(--gray5)' }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{result.name}</div>
              {result.brand && <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>{result.brand}</div>}
              {result.serving_size && <div style={{ fontSize: 12, color: 'var(--label3)', marginTop: 2 }}>Serving: {result.serving_size}</div>}
            </div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)', marginBottom: 8 }}>Per 100g</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            <NutrientBox label="Calories" value={result.per_100g?.kcal ?? 0} unit="kcal" color="var(--orange)" />
            <NutrientBox label="Protein" value={result.per_100g?.protein_g ?? 0} unit="g" color="var(--blue)" />
            <NutrientBox label="Carbs" value={result.per_100g?.carbs_g ?? 0} unit="g" color="var(--green)" />
            <NutrientBox label="Fat" value={result.per_100g?.fat_g ?? 0} unit="g" color="var(--purple)" />
          </div>

          {onAddFood && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 13, color: 'var(--label2)' }}>Servings:</label>
              <input className="input-field" type="number" step="0.5" min="0.5" value={servings} onChange={e => setServings(e.target.value)}
                style={{ width: 60, padding: '8px 10px', fontSize: 15, textAlign: 'center' }} />
              <button onClick={handleAddToLog} style={{
                flex: 1, background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 10,
                padding: '10px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}>
                Add to food log ({Math.round((result.per_100g?.kcal ?? 0) * (parseFloat(servings) || 1))} kcal)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NutrientBox({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--label2)' }}>{unit}</div>
      <div style={{ fontSize: 10, color: 'var(--label3)' }}>{label}</div>
    </div>
  )
}
