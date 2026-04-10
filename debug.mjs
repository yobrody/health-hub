const KEY = 'brody-health-hub-2026';
const LATEST = 'https://ba2d34ac.health-hub-dwz.pages.dev/api';
const PROD = 'https://health-hub-dwz.pages.dev/api';
const VPS = 'http://128-140-33-150.nip.io:8080';

async function get(url, label) {
  try {
    const r = await fetch(url, { headers: { 'X-Health-Key': KEY } });
    const t = await r.text();
    console.log(`\n[${label}] status=${r.status}`);
    try { const d = JSON.parse(t); console.log(JSON.stringify(d)); }
    catch { console.log(t.slice(0,200)); }
  } catch(e) { console.log(`\n[${label}] ERROR:`, e.message); }
}

(async () => {
  await get(`${VPS}/fridge`,        'VPS direct');
  await get(`${LATEST}/fridge`,     'Latest CF deploy');
  await get(`${PROD}/fridge`,       'Prod CF URL');
})();
