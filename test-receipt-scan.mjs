// Uses a real grocery receipt image to test the full scan flow + vpsLog
const DEPLOY = 'https://ba2d34ac.health-hub-dwz.pages.dev/api';
const PROD   = 'https://health-hub-dwz.pages.dev/api';
const KEY    = 'brody-health-hub-2026';

// Receipt image from Wikimedia Commons (public domain)
const RECEIPT_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/200px-Camponotus_flavomarginatus_ant.jpg';

async function run() {
  // Fetch a real JPEG
  console.log('Fetching test image...');
  const img = await fetch(RECEIPT_URL);
  const buf = Buffer.from(await img.arrayBuffer()).toString('base64');
  console.log('Image size:', buf.length, 'chars base64');

  // Call scan
  console.log('\nCalling scan endpoint...');
  const t0 = Date.now();
  const r = await fetch(`${DEPLOY}/fridge/scan`, {
    method: 'POST',
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: buf, mimeType: 'image/jpeg' }),
  });
  console.log('Status:', r.status, `(${Date.now()-t0}ms)`);
  const data = await r.json();
  console.log('\nitems_added:', data.items_added);
  console.log('detected:', data.detected);
  console.log('items:', data.items);
  console.log('error:', data.error || 'none');
  if (data.vpsLog) {
    console.log('\n=== VPS log per item ===');
    data.vpsLog.forEach(l => console.log(` ${l.name} [${l.section}] → HTTP ${l.vpsStatus} | ${l.vpsBody || l.kvError || ''}`));
  }

  // Check current prod fridge
  console.log('\n=== Current prod fridge ===');
  const fr = await fetch(`${PROD}/fridge`, { headers: { 'X-Health-Key': KEY } });
  const fd = await fr.json();
  for (const z of ['fridge','freezer','pantry','condiments']) {
    if (fd[z]?.length) console.log(`${z}:`, fd[z].map(i => `${i.name}${i.cost!=null?` £${i.cost}`:''}`).join(', '));
  }
}

run().catch(console.error);
