// End-to-end test: scan → detect items → add via proxy → verify in fridge
const DEPLOY = 'https://4a7792e0.health-hub-dwz.pages.dev/api';
const PROD   = 'https://health-hub-dwz.pages.dev/api';
const KEY    = 'brody-health-hub-2026';

// Real JPEG from httpbin (returns a recognisable image with items Gemini can read)
async function getRealImage() {
  const r = await fetch('https://httpbin.org/image/jpeg');
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

async function run() {
  console.log('=== 1. Test POST /fridge/item with metadata (KV write) ===');
  const addRes = await fetch(`${DEPLOY}/fridge/item`, {
    method: 'POST',
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'test apple', section: 'fridge', size: '6 pack', cost: 1.50, store: 'Test Store' }),
  });
  console.log('Add status:', addRes.status, await addRes.text());

  console.log('\n=== 2. GET /fridge — check test apple has metadata ===');
  const fr1 = await fetch(`${DEPLOY}/fridge`, { headers: { 'X-Health-Key': KEY } });
  const fd1 = await fr1.json();
  const apple = fd1.fridge?.find(i => i.name === 'test apple');
  if (apple) {
    console.log('test apple:', JSON.stringify(apple));
    if (apple.size === '6 pack' && apple.cost === 1.50) console.log('✅ KV metadata round-trip works!');
    else console.log('❌ KV metadata missing from GET /fridge response');
  } else {
    console.log('❌ test apple not in fridge. Fridge:', JSON.stringify(fd1));
  }

  console.log('\n=== 3. Scan real JPEG via new scan.js ===');
  const img = await getRealImage();
  const scanRes = await fetch(`${DEPLOY}/fridge/scan`, {
    method: 'POST',
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: img, mimeType: 'image/jpeg' }),
  });
  console.log('Scan status:', scanRes.status);
  const scanData = await scanRes.json();
  console.log('items:', scanData.items?.length ?? 0, scanData.items?.slice(0,3).map(i=>i.name));
  console.log('store:', scanData.store);
  if (scanData.error) console.log('❌ Error:', scanData.error);
  else console.log('✅ Scan returns structured items for client-side adding');

  console.log('\n=== 4. Cleanup — remove test apple ===');
  const del = await fetch(`${DEPLOY}/fridge/item/test%20apple`, {
    method: 'DELETE', headers: { 'X-Health-Key': KEY }
  });
  console.log('Delete:', del.status);

  console.log('\n=== 5. Final prod fridge state ===');
  const fr2 = await fetch(`${PROD}/fridge`, { headers: { 'X-Health-Key': KEY } });
  const fd2 = await fr2.json();
  const total = Object.values(fd2).flat().length;
  console.log('Total items:', total, total === 0 ? '(empty — ready for receipt scan)' : '');
  for (const z of ['fridge','freezer','pantry','condiments']) {
    if (fd2[z]?.length) console.log(`${z}:`, fd2[z].map(i => `${i.name}${i.cost!=null?` £${i.cost}`:''}`).join(', '));
  }
}

run().catch(console.error);
