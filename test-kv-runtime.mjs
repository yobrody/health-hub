// Writes a test KV entry then confirms GET /fridge merges it
const ACCOUNT_ID = '1b41f11c87339617385ae853f5313e83';
const KV_ID = '38dfa4fbc0a84e178e0dc688093be7a4';
const TOKEN = 'lhxgKqWpMJKA6yKzbpJG0AsXBCy3DOsKiwhX6zV5Bik.Ewb9l73x9hq_lxQ2fW6PCOTVfAxJPH1OSR2lE7kpzAs';
const BASE = 'https://462ca913.health-hub-dwz.pages.dev/api';
const HEALTH_KEY = 'brody-health-hub-2026';

async function run() {
  // 1. Write test metadata for "peanut butter" directly to KV via CF API
  console.log('Writing test metadata to KV via CF API...');
  const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}/values/peanut%20butter`;
  const meta = JSON.stringify({ size: '340g', cost: 1.09, section: 'pantry', store: 'Aldi, Edgware Road', added: new Date().toISOString() });
  const putRes = await fetch(kvUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'text/plain' },
    body: meta,
  });
  const putData = await putRes.json();
  console.log('KV write result:', putData.success ? '✅ success' : '❌ failed', putData.errors || '');

  // 2. Call GET /fridge and check if "peanut butter" now has metadata
  console.log('\nCalling GET /fridge to check KV merge...');
  const fridgeRes = await fetch(`${BASE}/fridge`, { headers: { 'X-Health-Key': HEALTH_KEY } });
  console.log('Status:', fridgeRes.status);
  const fridge = await fridgeRes.json();

  const pb = fridge.pantry?.find(i => i.name === 'peanut butter');
  if (pb) {
    console.log('\npeanut butter item:', JSON.stringify(pb, null, 2));
    if (pb.size === '340g' && pb.cost === 1.09) {
      console.log('✅ KV metadata is being merged correctly!');
    } else {
      console.log('❌ KV metadata NOT merged — size/cost missing from response');
      console.log('   (KV binding may not be applied to this deployment)');
    }
  } else {
    console.log('❌ peanut butter not found in pantry');
    console.log('Pantry items:', fridge.pantry);
  }
}

run().catch(console.error);
