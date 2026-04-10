const BASE = 'https://health-hub-dwz.pages.dev/api'
const KEY = 'brody-health-hub-2026'
const H = { 'X-Health-Key': KEY }

// Check food history for IDs
const r = await fetch(BASE + '/food/history?days=1', { headers: H })
const d = await r.json()
const arr = Array.isArray(d) ? d : d.value
console.log('History:', JSON.stringify(arr?.slice(0,3), null, 2))

// Also try /food endpoint
const r2 = await fetch(BASE + '/food', { headers: H })
console.log('/food status:', r2.status)
const d2 = await r2.json().catch(() => ({}))
console.log('/food:', JSON.stringify(d2).slice(0, 300))
