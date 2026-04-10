// Tests the scan endpoint with a minimal image to verify it processes correctly
const BASE = 'https://health-hub-dwz.pages.dev/api';
const KEY = 'brody-health-hub-2026';

// 1x1 white JPEG
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB/8QAIhAAAQMEAgMAAAAAAAAAAAAAAQIDBBEhBRIxUf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwvXuihtMFyZMeaYYbGWuOKCUj6k1zjfXVqveo7tDt8OI4+6XFjAWEjJPc4AA/SiigD//Z';

async function run() {
  console.log('Testing POST /fridge/scan...');
  const res = await fetch(`${BASE}/fridge/scan`, {
    method: 'POST',
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: TINY_JPEG, mimeType: 'image/jpeg' }),
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));

  if (res.status === 200) {
    if (data.error && data.error.includes('Could not process')) {
      console.log('⚠️  Claude ran but could not parse image (expected for 1x1 pixel)');
    } else {
      console.log('✅ Scan endpoint working — items_added:', data.items_added);
      if (data.store) console.log('   Store detected:', data.store.name, data.store.location || '');
    }
  } else {
    console.log('❌ Unexpected status');
  }
}

run().catch(console.error);
