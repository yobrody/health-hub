import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// repo-root/dist, derived from this file's location (scripts/e2e-smoke/)
const DIST = process.env.DIST_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.ico':'image/x-icon' }
const SCAN = process.env.MOCK_SCAN || 'food'   // food | barcode | receipt

function get(p) {
  if (p === '/today') return { date:'2026-08-04', entries:[], total_kcal:0, goals:{calories:2800,protein:140,gym_days:4} }
  if (p.startsWith('/workouts/prs')) return {}
  if (p.startsWith('/workouts')) return { value:[], Count:0 }
  if (p.startsWith('/food/history')) return []
  if (p.startsWith('/food/log')) return { days:14, count:0, entries:[] }
  if (p.startsWith('/weight')) return { entries:[] }
  if (p.startsWith('/goals')) return { content:'', parsed:{calories:2800,protein:140,gym_days:4} }
  if (p.startsWith('/stats/week')) return { food_by_day:[], logged_days:0, avg_kcal:0, goal_kcal:2800, workout_count:0, goal_gym_days:4 }
  if (p.startsWith('/report/weekly')) return { period:{start:'2026-07-29',end:'2026-08-04'}, calories:{total:14000,goal:19600,pct:71,logged_days:5,avg_daily:2800}, protein:{avg_daily:135,goal:140}, workouts:{count:3,goal:4}, weight:{start:82.5,end:82.0,change:-0.5}, sleep:{avg_quality:4,avg_duration_hrs:7.2,entries:6}, routines:{meditate:5,vitamins:7}, top_foods:[{name:'Oats',count:5},{name:'Chicken',count:4}], hydration_avg:null, summary:'Solid week — protein on point, one workout short of goal.' }
  if (p.startsWith('/users/profile')) return { name:'Brody', calories:2800, protein:140, height_cm:183, age:23, sex:'male', activity_level:'active' }
  if (p.startsWith('/water')) return { date:'2026-08-04', entries:[], total_ml:2100, goal_ml:2000 }
  if (p.startsWith('/fridge/slots')) return {}
  if (p.startsWith('/fridge')) return { fridge:[{name:'Milk', added:null, photo_url:null}], pantry:[], condiments:[{name:'Paprika', added:null, photo_url:null},{name:'Soy Sauce', added:null, photo_url:null}], freezer:[] }
  if (p.startsWith('/agenda')) return { items:[] }
  if (p.startsWith('/lists')) return { items:[] }
  if (p.startsWith('/routines')) return { name:'', log:[], streak:0 }
  if (p.startsWith('/sleep')) return { avg_duration:null }
  if (p.startsWith('/metrics')) return { metrics:[], metric:null }
  if (p.startsWith('/tdee')) return { estimated_tdee:2600, adaptive_tdee:null, source:'estimated' }
  if (p.startsWith('/barcode/')) return { code:'123', name:'Test Cola 330ml', brand:'TestBrand', serving_size:'330 ml', source:'open_food_facts', per_100g:{kcal:42,protein_g:0,carbs_g:10.6,fat_g:0,fiber_g:0,sugar_g:10.6,salt_g:0,sodium_mg:4}, nutrients_per_100g:{sugar_g:10.6,sodium_mg:4}, image_url:'' }
  return { ok:true }
}
function post(p) {
  if (p === '/scan/smart') {
    if (SCAN === 'barcode') return { type:'barcode', code:'5000112637922' }
    if (SCAN === 'receipt') return { type:'receipt', items:[{name:'Chicken Breast', section:'fridge'},{name:'Greek Yogurt', section:'fridge'},{name:'Bananas', section:'pantry'}], store:{name:'Tesco', location:null} }
    return { type:'food', foods:[{name:'Chicken and rice', kcal:520, protein_g:42, carbs_g:60, fat_g:10, grams:400}], confidence:'medium' }
  }
  if (p === '/ai/analyze-food') return { foods:[{name:'Paprika', kcal:6, protein_g:0, carbs_g:1, fat_g:0}], confidence:'medium', source:'estimate', needs_label:false }
  if (p === '/fridge/scan') return { items:[{name:'Chicken Breast', section:'fridge'}] }
  if (p === '/food/smart') return { meal:'Lunch', matched_product:'Oats', kcal:197, protein_g:7, carbs_g:35, fat_g:3, fiber_g:5, sugar_g:1, sodium_mg:5, nutrients:{saturated_fat_g:0.5, calcium_mg:40}, confidence:'medium', description:'52g oats' }
  if (p === '/food') return { ok:true, total_kcal:500 }
  if (p === '/fridge/item') return { ok:true }
  if (p.startsWith('/fridge/item/')) return { ok:true }
  if (p === '/food/search') return { results:[{ name:'Test Cola', brand:'TestBrand', per_100g:{kcal:42,protein_g:0,carbs_g:10.6,fat_g:0,fiber_g:0,sugar_g:10.6,sodium_mg:4,salt_g:0} }] }
  return { ok:true }
}
http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost')
  if (url.pathname.startsWith('/api')) {
    const p = url.pathname.replace(/^\/api/,'')
    const body = req.method==='POST' ? post(p) : get(p)
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(body)); return
  }
  let fp = path.join(DIST, url.pathname==='/'?'index.html':url.pathname)
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(DIST,'index.html')
  try { res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'}); res.end(fs.readFileSync(fp)) }
  catch { res.writeHead(404); res.end('nf') }
}).listen(4599, ()=>console.log('mock2 :4599 SCAN='+SCAN))
