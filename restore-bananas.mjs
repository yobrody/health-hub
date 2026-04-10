const PROD = 'https://health-hub-dwz.pages.dev/api';
const KEY  = 'brody-health-hub-2026';
const ACCOUNT_ID = '1b41f11c87339617385ae853f5313e83';
const KV_ID = '38dfa4fbc0a84e178e0dc688093be7a4';
const CF_TOKEN = 'lhxgKqWpMJKA6yKzbpJG0AsXBCy3DOsKiwhX6zV5Bik.Ewb9l73x9hq_lxQ2fW6PCOTVfAxJPH1OSR2lE7kpzAs';

async function run() {
  // Re-add bananas to VPS
  const r = await fetch(`${PROD}/fridge/item`, {
    method: 'POST',
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'bananas', section: 'pantry' }),
  });
  console.log('Re-add bananas to VPS:', r.status);

  // Re-add KV metadata
  const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}/values/bananas`;
  const kv = await fetch(kvUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'text/plain' },
    body: JSON.stringify({ size: null, cost: 0.48, section: 'pantry', store: 'Aldi, Edgware Road, Little Venice', added: new Date().toISOString() }),
  });
  const kvd = await kv.json();
  console.log('KV metadata:', kvd.success ? '✅' : '❌');

  // Final fridge check
  const fr = await fetch(`${PROD}/fridge`, { headers: { 'X-Health-Key': KEY } });
  const fd = await fr.json();
  console.log('\nFinal fridge:');
  for (const z of ['fridge','freezer','pantry','condiments']) {
    if (fd[z]?.length) console.log(`  ${z}:`, fd[z].map(i =>
      `${i.name}${i.cost != null ? ` £${i.cost}` : ''}`).join(', '));
  }
  console.log('\n✅ Ready. Scan your Aldi receipt to repopulate the full fridge.');
}
run().catch(console.error);
