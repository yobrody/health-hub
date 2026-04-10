const H = { 'Content-Type': 'application/json', 'X-Health-Key': 'brody-health-hub-2026' }
// Test VPS directly via nip.io (same as the Worker uses)
const VPS = 'http://128-140-33-150.nip.io:8080'
const CF = 'https://health-hub-dwz.pages.dev/api'

const sw_vps = await fetch(VPS + '/stats/week', { headers: H }).then(r => r.text()).catch(e => 'VPS ERR: ' + e.message)
const sw_cf = await fetch(CF + '/stats/week', { headers: H }).then(r => r.text()).catch(e => 'CF ERR: ' + e.message)
const meals_vps = await fetch(VPS + '/ai/meals', { method: 'POST', headers: H }).then(r => r.text()).catch(e => 'VPS ERR: ' + e.message)

console.log('stats/week (VPS):', sw_vps.slice(0, 500))
console.log('stats/week (CF):', sw_cf.slice(0, 500))
console.log('ai/meals (VPS):', meals_vps.slice(0, 500))
