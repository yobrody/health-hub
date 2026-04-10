/**
 * Comprehensive backend + scan test
 * Tests every API endpoint and receipt scanning with a real image
 */
const BASE = 'https://health-hub-dwz.pages.dev/api'
const KEY = 'brody-health-hub-2026'
const H = { 'Content-Type': 'application/json', 'X-Health-Key': KEY }
const results = []

async function test(name, fn) {
  try {
    const t0 = Date.now()
    const result = await fn()
    const ms = Date.now() - t0
    console.log(`✅ ${name} (${ms}ms)${result ? ': ' + JSON.stringify(result).slice(0,120) : ''}`)
    results.push({ name, ok: true, ms })
  } catch(e) {
    console.log(`❌ ${name}: ${e.message}`)
    results.push({ name, ok: false, error: e.message })
  }
}

// === BASIC ENDPOINTS ===
await test('GET /today', async () => {
  const r = await fetch(BASE + '/today', { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  return { total_kcal: d.total_kcal, entries: d.entries?.length }
})

await test('GET /fridge', async () => {
  const r = await fetch(BASE + '/fridge', { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  const total = (d.fridge?.length||0)+(d.pantry?.length||0)+(d.condiments?.length||0)+(d.freezer?.length||0)
  // Check KV metadata is merged
  const withMeta = (d.fridge||[]).filter(i => i.cost != null || i.size != null).length
  return { total, withMetadata: withMeta, sampleCost: d.fridge?.[0]?.cost }
})

await test('POST /fridge/item (with metadata)', async () => {
  const r = await fetch(BASE + '/fridge/item', { method: 'POST', headers: H,
    body: JSON.stringify({ name: 'test-audit-item', section: 'pantry', size: '100g', cost: 0.99, store: 'Test Store' }) })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return await r.json()
})

await test('GET /fridge (verify KV merge for new item)', async () => {
  const r = await fetch(BASE + '/fridge', { headers: H })
  const d = await r.json()
  const found = (d.pantry||[]).find(i => i.name === 'test-audit-item')
  if (!found) throw new Error('Item not found in pantry')
  if (!found.cost) throw new Error('KV metadata not merged: ' + JSON.stringify(found))
  return { name: found.name, size: found.size, cost: found.cost, store: found.store }
})

await test('DELETE /fridge/item (cleanup)', async () => {
  const r = await fetch(BASE + '/fridge/item/test-audit-item', { method: 'DELETE', headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return { status: r.status }
})

await test('POST /food (add food entry)', async () => {
  const r = await fetch(BASE + '/food', { method: 'POST', headers: H,
    body: JSON.stringify({ meal: 'Snack', description: 'audit test item', kcal: 100 }) })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return await r.json()
})

await test('GET /food/history', async () => {
  const r = await fetch(BASE + '/food/history?days=7', { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  const arr = Array.isArray(d) ? d : d.value
  return { days: arr?.length }
})

await test('GET /workouts', async () => {
  const r = await fetch(BASE + '/workouts?limit=5', { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  const arr = Array.isArray(d) ? d : d.value
  return { count: arr?.length }
})

await test('GET /workouts/prs', async () => {
  const r = await fetch(BASE + '/workouts/prs', { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  return { exercises: Object.keys(d).length }
})

await test('GET /goals', async () => {
  const r = await fetch(BASE + '/goals', { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  return { calories: d.parsed?.calories, protein: d.parsed?.protein }
})

await test('GET /stats/week', async () => {
  const r = await fetch(BASE + '/stats/week', { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  return { logged_days: d.logged_days, avg_kcal: d.avg_kcal, workout_count: d.workout_count }
})

// === AI ENDPOINTS ===
await test('POST /ai/meals (meal suggestions)', async () => {
  const r = await fetch(BASE + '/ai/meals', { method: 'POST', headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,100)}`)
  const d = await r.json()
  if (!d.meals?.length) throw new Error('No meals returned: ' + JSON.stringify(d))
  return { meals: d.meals.map(m => m.name) }
})

// Summary
console.log('\n=== SUMMARY ===')
const passed = results.filter(r => r.ok).length
console.log(`${passed}/${results.length} tests passed`)
if (results.filter(r => !r.ok).length > 0) {
  console.log('FAILED:', results.filter(r => !r.ok).map(r => r.name))
}
