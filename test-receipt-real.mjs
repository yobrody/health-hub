/**
 * Real grocery receipt scan test
 * Uses publicly available grocery receipt images from GitHub
 */
const BASE = 'https://health-hub-dwz.pages.dev/api'
const KEY = 'brody-health-hub-2026'

const RECEIPT_IMAGES = [
  {
    name: 'receipt-ocr repo receipt.jpg',
    url: 'https://raw.githubusercontent.com/bhimrazy/receipt-ocr/main/images/receipt.jpg',
    mime: 'image/jpeg'
  },
  {
    name: 'receipt-ocr restaurant receipt',
    url: 'https://raw.githubusercontent.com/bhimrazy/receipt-ocr/main/images/main-street-restaurant-receipt.jpeg',
    mime: 'image/jpeg'
  },
  {
    name: 'Azure doc intelligence grocery receipt sample',
    url: 'https://raw.githubusercontent.com/Azure-Samples/cognitive-services-REST-api-samples/master/curl/form-recognizer/contoso-receipt.png',
    mime: 'image/png'
  },
  {
    name: 'Naver CORD receipt sample',
    url: 'https://raw.githubusercontent.com/clovaai/cord/master/sample/receipt_00042.png',
    mime: 'image/png'
  },
  {
    name: 'BoofCV receipt sample',
    url: 'https://github.com/lessthanoptimal/BoofCV/raw/main/data/example/recognition/english/receipt01.jpg',
    mime: 'image/jpeg'
  }
]

async function testScan(receipt) {
  console.log(`\n=== Testing: ${receipt.name} ===`)

  let buf
  try {
    const imgRes = await fetch(receipt.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthHub/1.0)' },
      redirect: 'follow'
    })
    if (!imgRes.ok) {
      console.log(`❌ Image fetch failed: HTTP ${imgRes.status}`)
      return null
    }
    const contentType = imgRes.headers.get('content-type') || ''
    if (!contentType.includes('image') && !contentType.includes('octet-stream')) {
      console.log(`❌ Not an image (content-type: ${contentType})`)
      return null
    }
    buf = Buffer.from(await imgRes.arrayBuffer()).toString('base64')
    console.log(`✅ Image: ${Math.round(buf.length / 1024)}KB base64`)
  } catch (e) {
    console.log(`❌ Fetch error: ${e.message}`)
    return null
  }

  console.log('Calling /api/fridge/scan...')
  const t0 = Date.now()
  try {
    const scanRes = await fetch(`${BASE}/fridge/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Health-Key': KEY },
      body: JSON.stringify({ image: buf, mimeType: receipt.mime })
    })
    const ms = Date.now() - t0
    console.log(`Status: HTTP ${scanRes.status} (${ms}ms)`)

    const data = await scanRes.json()
    if (data.items?.length) {
      console.log(`✅ Items found: ${data.items.map(i => i.name).join(', ')}`)
      if (data.store) console.log(`   Store: ${data.store}`)
      return data
    } else {
      console.log(`⚠️  No items: ${JSON.stringify(data).slice(0, 200)}`)
      return data
    }
  } catch (e) {
    console.log(`❌ Scan error: ${e.message}`)
    return null
  }
}

async function testFoodPhotoAnalysis() {
  console.log('\n\n=== Testing: Food Photo Analysis ===')

  // Use a free food photo (apple from Unsplash-compatible source)
  const FOOD_IMG_URL = 'https://raw.githubusercontent.com/marcusklasson/GroceryStoreDataset/master/sample_images/fresh/Apple/Apple_0001.jpg'

  let buf
  try {
    const imgRes = await fetch(FOOD_IMG_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow'
    })
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`)
    buf = Buffer.from(await imgRes.arrayBuffer()).toString('base64')
    console.log(`✅ Food image fetched: ${Math.round(buf.length / 1024)}KB`)
  } catch (e) {
    console.log(`❌ Could not fetch food image: ${e.message}`)
    // Try an alternative
    const alt = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/200px-Red_Apple.jpg'
    try {
      const imgRes2 = await fetch(alt)
      if (!imgRes2.ok) throw new Error(`HTTP ${imgRes2.status}`)
      buf = Buffer.from(await imgRes2.arrayBuffer()).toString('base64')
      console.log(`✅ Alt food image: ${Math.round(buf.length / 1024)}KB`)
    } catch (e2) {
      console.log(`❌ Alt also failed: ${e2.message}`)
      return
    }
  }

  const t0 = Date.now()
  try {
    const r = await fetch(`${BASE}/ai/analyze-food`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Health-Key': KEY },
      body: JSON.stringify({ image: buf, mimeType: 'image/jpeg' })
    })
    const ms = Date.now() - t0
    console.log(`Status: HTTP ${r.status} (${ms}ms)`)
    const d = await r.json()
    console.log(`Name: ${d.name}`)
    console.log(`Calories: ${d.kcal}`)
    console.log(`Protein: ${d.protein_g}g, Carbs: ${d.carbs_g}g, Fat: ${d.fat_g}g`)
    console.log(`Confidence: ${d.confidence}`)
    console.log(`Description: ${d.description}`)
    if (d.kcal > 0 && d.name) {
      console.log(`✅ Food analysis PASS`)
    } else {
      console.log(`⚠️  Low confidence result`)
    }
    return d
  } catch (e) {
    console.log(`❌ Food analysis error: ${e.message}`)
  }
}

// Run receipt scans
let bestResult = null
for (const receipt of RECEIPT_IMAGES) {
  const result = await testScan(receipt)
  if (result?.items?.length > 0) {
    bestResult = result
    console.log(`\n✅ Receipt scan PASS with ${result.items.length} items`)

    // Test adding items to fridge (simulate what the UI does)
    console.log('\nAdding first 3 items to fridge (simulating UI add flow)...')
    for (const item of result.items.slice(0, 3)) {
      const section = item.section || 'pantry'
      const r = await fetch(`${BASE}/fridge/item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Health-Key': KEY },
        body: JSON.stringify({ name: item.name, section, size: item.size || '', cost: item.cost || 0 })
      })
      console.log(` ${item.name} → ${r.ok ? '✅' : '❌'} HTTP ${r.status}`)
    }

    // Clean up test items
    console.log('\nCleaning up test items...')
    for (const item of result.items.slice(0, 3)) {
      await fetch(`${BASE}/fridge/item/${encodeURIComponent(item.name)}`, {
        method: 'DELETE',
        headers: { 'X-Health-Key': KEY }
      })
    }
    break
  }
}

// Run food photo analysis
await testFoodPhotoAnalysis()

// Final summary
console.log('\n\n=== FINAL SUMMARY ===')
console.log(`Receipt scan: ${bestResult?.items?.length > 0 ? '✅ PASS (' + bestResult.items.length + ' items)' : '❌ No items found across all test images'}`)
console.log('Food photo analysis: see above')
