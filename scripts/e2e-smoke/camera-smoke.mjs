import { chromium } from 'playwright-core'
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
// a tiny valid PNG (1x1) as the "photo"
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64')
const img = { name:'photo.png', mimeType:'image/png', buffer: PNG }
const findings = []
function F(sev, where, msg) { findings.push(`[${sev}] ${where}: ${msg}`) }

const browser = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] })
const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 })
await ctx.addInitScript(()=>{ localStorage.setItem('onboarding_done','1'); localStorage.setItem('changelog_last_seen','9.9.9'); localStorage.setItem('user_name','Brody') })
const page = await ctx.newPage()
const errors = []
page.on('console', m => { if (m.type()==='error' && !/ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(m.text()) })
page.on('pageerror', e => errors.push('PAGEERR: '+e.message))
const shot = n => page.screenshot({ path:`/tmp/cam-${n}.png` }).catch(()=>{})
const txt = async () => (await page.locator('body').innerText()).replace(/\n+/g,' | ')

await page.goto('http://localhost:4599/', { waitUntil:'load' }); await page.waitForTimeout(1400)

const MODE = process.env.MOCK_SCAN || 'food'
// ── SmartScanner via camera FAB ──
const fab = page.locator('button.camera-fab')
if (await fab.count() === 0) F('BUG','camera-fab','FAB not found')
await fab.first().click({ force:true }); await page.waitForTimeout(700)
await shot(`${MODE}-1-open`)
let t = await txt()
if (!/Scan|scan|camera|photo|Take/i.test(t.slice(-600))) F('WARN','SmartScanner-open',`sheet text unclear: ...${t.slice(-160)}`)
// set the hidden file input to trigger a scan
const fileInput = page.locator('input[type="file"]').first()
if (await fileInput.count() === 0) { F('BUG','SmartScanner','no file input') }
else {
  await fileInput.setInputFiles(img)
  await page.waitForTimeout(1500)
  await shot(`${MODE}-2-result`)
  t = await txt()
  if (MODE==='barcode' && !/Test Cola|Product|barcode/i.test(t)) F('BUG','barcode-result',`no product shown: ...${t.slice(-200)}`)
  if (MODE==='receipt' && !/Chicken|receipt|items|add/i.test(t)) F('BUG','receipt-result',`no items shown: ...${t.slice(-200)}`)
  if (MODE==='food' && !/Chicken and rice|kcal|Log/i.test(t)) F('BUG','food-result',`no food shown: ...${t.slice(-200)}`)
  // Home/Out toggle present on log stages?
  if ((MODE==='food'||MODE==='barcode')) {
    if (!/At home|Eating out/i.test(t)) F('IMPROVE',`${MODE}-result`,'no Home/Out toggle visible')
    else {
      const out = page.locator('button', { hasText:'Eating out' }).first()
      if (await out.count()) {
        await out.click({force:true}); await page.waitForTimeout(400)
        // the place field is an <input> — its prompt lives in the placeholder attr, which innerText never sees
        const placeInput = page.locator('input[placeholder*="Where" i], input[placeholder*="Pret" i]')
        if (await placeInput.count() === 0) F('IMPROVE',`${MODE}-out`,'no place field after choosing Eating out')
        await shot(`${MODE}-3-out`)
      }
    }
  }
  // try the primary log/add action
  const act = page.locator('button', { hasText: MODE==='receipt' ? /Add .*item|Add all|Add \d/i : /^Log/i }).first()
  if (await act.count()) { await act.click({force:true}); await page.waitForTimeout(900); await shot(`${MODE}-4-after`) }
  else F('IMPROVE',`${MODE}-result`,'no obvious primary action button')
}
// close scanner explicitly via its header X so the modal overlay can't swallow later clicks
const closeX = page.locator('button', { hasText: /^X$/ }).first()
if (await closeX.count()) await closeX.click({force:true}).catch(()=>{})
await page.keyboard.press('Escape').catch(()=>{})
await page.waitForTimeout(600)

// ── Nutrition: photo analysis + barcode button presence ──
if (MODE==='food') {
  await page.locator('button.tab-btn',{hasText:'Nutrition'}).first().click({force:true}); await page.waitForTimeout(900)
  // if the Nutrition view opens on the diary sub-tab, flip to Photos so "+ Add" shows
  const photosToggle = page.locator('button', { hasText: /^Photos$/ }).first()
  if (await photosToggle.count()) { await photosToggle.click({force:true}).catch(()=>{}); await page.waitForTimeout(400) }
  // open add sheet via the specific "+ Add" trigger
  const addBtn = page.locator('button', { hasText: /\+ Add/ }).first()
  await addBtn.click({force:true}).catch(()=>{}); await page.waitForTimeout(700)
  await shot('nutri-addsheet')
  t = await txt()
  const hasSnap = /Snap|Photo|camera|scan/i.test(t)
  if (!hasSnap) F('WARN','Nutrition-addsheet','no photo/snap affordance visible')
  // find a file input in the add sheet and feed a photo
  const nfile = page.locator('input[type="file"]')
  if (await nfile.count()) {
    await nfile.last().setInputFiles(img).catch(()=>{})
    await page.waitForTimeout(1500)
    await shot('nutri-photo-result')
    t = await txt()
    if (!/Paprika|Matched|estimate|kcal|label/i.test(t)) F('WARN','Nutrition-photo',`photo result unclear: ...${t.slice(-160)}`)
  } else F('IMPROVE','Nutrition-addsheet','no file input for photo in add sheet')
}

// ── Seasonings: add-via-photo ──
if (MODE==='food') {
  // start this section from a clean page so no leaked sheet/scroll state blocks nav
  await page.goto('http://localhost:4599/', { waitUntil:'load' }); await page.waitForTimeout(1200)
  const seas = page.locator('button', { hasText:'Seasonings' }).first()
  if (await seas.count()) {
    await seas.click({force:true}); await page.waitForTimeout(700)
    await shot('seasonings')
    t = await txt()
    if (!/Paprika|Soy Sauce/i.test(t)) F('BUG','Seasonings','condiments not listed')
    if (!/Add|type|snap|📷/i.test(t)) F('WARN','Seasonings','no add affordance')
    const sfile = page.locator('input[type="file"]').first()
    if (await sfile.count()) {
      await sfile.setInputFiles(img).catch(()=>{}); await page.waitForTimeout(1400)
      await shot('seasonings-photoadd')
      t = await txt()
      if (!/Name this|Paprika|Add seasoning/i.test(t)) F('WARN','Seasonings-photo',`photo-add sheet unclear: ...${t.slice(-160)}`)
    } else F('IMPROVE','Seasonings','no photo file input')
  } else F('BUG','Today','no Seasonings tile')
}

console.log('=== MODE', MODE, '===')
console.log('CONSOLE ERRORS:', errors.length); errors.slice(0,8).forEach(e=>console.log('  !', e.slice(0,140)))
console.log('FINDINGS:', findings.length); findings.forEach(f=>console.log('  ', f))
await browser.close()
