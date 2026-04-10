const PROD = 'https://health-hub-dwz.pages.dev/api';
const KEY  = 'brody-health-hub-2026';
// Items accidentally added by the test run
const REMOVE = ['yogurt', 'cereal', 'milk', 'banana'];

async function run() {
  for (const name of REMOVE) {
    const r = await fetch(`${PROD}/fridge/item/${encodeURIComponent(name)}`, {
      method: 'DELETE', headers: { 'X-Health-Key': KEY }
    });
    console.log(`DELETE ${name}: ${r.status}`);
  }
  // Verify prod scan endpoint also works on main URL
  console.log('\nVerifying main URL scan endpoint...');
  const r = await fetch(`${PROD}/fridge/scan`, {
    method: 'POST',
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'dGVzdA==', mimeType: 'image/jpeg' }), // "test" in base64
  });
  const d = await r.json();
  console.log('Scan status:', r.status, '| error field:', d.error || 'none');

  console.log('\nFinal fridge state:');
  const fr = await fetch(`${PROD}/fridge`, { headers: { 'X-Health-Key': KEY } });
  const fd = await fr.json();
  for (const z of ['fridge','freezer','pantry','condiments']) {
    if (fd[z]?.length) console.log(`${z}:`, fd[z].map(i => i.name).join(', '));
  }
}
run().catch(console.error);
