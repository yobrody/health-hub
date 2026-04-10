// Seeds KV metadata for existing Aldi receipt items already in the fridge
const ACCOUNT_ID = '1b41f11c87339617385ae853f5313e83';
const KV_ID = '38dfa4fbc0a84e178e0dc688093be7a4';
const TOKEN = 'lhxgKqWpMJKA6yKzbpJG0AsXBCy3DOsKiwhX6zV5Bik.Ewb9l73x9hq_lxQ2fW6PCOTVfAxJPH1OSR2lE7kpzAs';

const STORE = 'Aldi, Edgware Road, Little Venice';

const items = [
  { name: 'peanut butter',  size: '340g',  cost: 1.09, section: 'pantry'  },
  { name: 'ground coffee',  size: null,    cost: 3.69, section: 'pantry'  },
  { name: 'bananas',        size: null,    cost: 0.48, section: 'pantry'  },
];

async function put(name, meta) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}/values/${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...meta, store: STORE, added: new Date().toISOString() }),
  });
  const r = await res.json();
  console.log(`${r.success ? '✅' : '❌'} ${name}`, r.errors?.length ? r.errors : '');
}

async function run() {
  console.log('Seeding KV metadata for existing Aldi items...\n');
  for (const item of items) await put(item.name, item);
  console.log('\nDone. GET /fridge will now show size+cost for these items.');
}

run().catch(console.error);
