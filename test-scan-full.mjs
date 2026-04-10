import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const DEPLOY = 'https://ba2d34ac.health-hub-dwz.pages.dev/api';
const PROD   = 'https://health-hub-dwz.pages.dev/api';
const KEY    = 'brody-health-hub-2026';

// Download a real 1x1 red pixel PNG (universally valid)
async function getRealImage() {
  const url = 'https://httpbin.org/image/jpeg'
  const r = await fetch(url)
  if (!r.ok) throw new Error('Could not fetch test image: ' + r.status)
  const buf = await r.arrayBuffer()
  return Buffer.from(buf).toString('base64')
}

async function scan(base, imageB64, mimeType, label) {
  console.log(`\n=== ${label} ===`)
  const t0 = Date.now()
  const res = await fetch(`${base}/fridge/scan`, {
    method: 'POST',
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageB64, mimeType }),
  })
  console.log(`Status: ${res.status}  (${Date.now()-t0}ms)`)
  const data = await res.json()
  console.log('Response:', JSON.stringify(data, null, 2))
  if (data.error) console.log('❌ Error:', data.error)
  else console.log('✅ Model reached — items detected:', data.detected ?? 0, '(blank image, 0 expected)')
  return data
}

async function checkFridge() {
  console.log('\n=== GET /fridge (prod) ===')
  const r = await fetch(`${PROD}/fridge`, { headers: { 'X-Health-Key': KEY } })
  const d = await r.json()
  for (const z of ['fridge','freezer','pantry','condiments']) {
    if (d[z]?.length) {
      console.log(`${z}:`, d[z].map(i =>
        `${i.name}${i.cost != null ? ` £${i.cost}` : ''}${i.size ? ` (${i.size})` : ''}`
      ).join(', '))
    }
  }
}

;(async () => {
  console.log('Fetching real JPEG from httpbin...')
  const imageB64 = await getRealImage()
  console.log(`Got ${imageB64.length} chars of base64`)
  await scan(DEPLOY, imageB64, 'image/jpeg', 'Gemini-2.0-flash — real JPEG (blank image, 0 items expected)')
  await checkFridge()
})().catch(console.error)
