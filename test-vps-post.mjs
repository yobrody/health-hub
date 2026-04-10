// Tests VPS POST /fridge/item directly — same call scan.js makes
const VPS  = 'http://128-140-33-150.nip.io:8080';
const KEY  = 'brody-health-hub-2026';
const PROD = 'https://health-hub-dwz.pages.dev/api';

async function run() {
  // 1. Test VPS directly (bypassing CF)
  console.log('=== Direct VPS POST /fridge/item ===');
  try {
    const r = await fetch(`${VPS}/fridge/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Health-Key': KEY },
      body: JSON.stringify({ name: 'test-item-delete-me', section: 'pantry' }),
    });
    const t = await r.text();
    console.log('Status:', r.status, '| Body:', t.slice(0, 200));
  } catch (e) {
    console.log('FAILED:', e.message);
  }

  // 2. Test via CF proxy (what [[path]].js does)
  console.log('\n=== CF proxy POST /fridge/item ===');
  try {
    const r = await fetch(`${PROD}/fridge/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Health-Key': KEY },
      body: JSON.stringify({ name: 'test-item-delete-me', section: 'pantry' }),
    });
    const t = await r.text();
    console.log('Status:', r.status, '| Body:', t.slice(0, 200));
  } catch (e) {
    console.log('FAILED:', e.message);
  }

  // 3. Check fridge to see if test item appears
  console.log('\n=== GET /fridge ===');
  const fr = await fetch(`${PROD}/fridge`, { headers: { 'X-Health-Key': KEY } });
  const fd = await fr.json();
  for (const z of ['fridge','freezer','pantry','condiments']) {
    if (fd[z]?.length) console.log(`${z}:`, fd[z].map(i => i.name).join(', '));
  }

  // 4. Clean up test item
  console.log('\n=== Cleanup ===');
  const del = await fetch(`${PROD}/fridge/item/test-item-delete-me`, {
    method: 'DELETE', headers: { 'X-Health-Key': KEY }
  });
  console.log('DELETE test item:', del.status);
}

run().catch(console.error);
