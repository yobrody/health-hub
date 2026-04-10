const BASE = 'https://health-hub-dwz.pages.dev/api';
const KEY = 'brody-health-hub-2026';

async function test() {
  console.log('=== Testing GET /fridge ===');
  const r = await fetch(BASE + '/fridge', { headers: { 'X-Health-Key': KEY } });
  console.log('Status:', r.status);
  const text = await r.text();
  console.log('Response (first 500 chars):', text.slice(0, 500));

  try {
    const data = JSON.parse(text);
    for (const zone of ['fridge', 'freezer', 'pantry', 'condiments']) {
      if (data[zone]?.length) {
        console.log(`\n${zone} (${data[zone].length} items):`);
        data[zone].slice(0, 5).forEach(item => {
          const meta = [item.size, item.cost != null ? `£${item.cost}` : null, item.store]
            .filter(Boolean).join(' | ');
          console.log(`  - ${item.name}  ${meta ? '[' + meta + ']' : '(no metadata)'}`);
        });
      }
    }
  } catch {}
}

test().catch(console.error);
