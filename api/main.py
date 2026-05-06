"""
Health Hub API — FastAPI backend for Brody's PWA
Reads/writes shared markdown files that Lucky also uses.
"""
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
import os, json, re, base64
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

API_KEY = os.getenv("HEALTH_API_KEY", "change-me")
GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
WORKSPACE = Path("/home/lucky/.openclaw/workspace/health")
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Health Hub", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

api_key_header = APIKeyHeader(name="X-Health-Key", auto_error=False)

def require_key(key: str = Depends(api_key_header)):
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return key

def today() -> str:
    return date.today().isoformat()

# ── GEMINI HELPER ─────────────────────────────────────────────────────
# Direct Google AI Studio (free tier). gemini-2.0-flash got moved to paid
# in 2026-05; gemini-2.5-flash is the current free-tier flagship.
_GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash-lite:generateContent"
)

def gemini_call(prompt: str, image_b64: str = None, mime_type: str = "image/jpeg",
                max_tokens: int = 800, temperature: float = 0.4) -> dict:
    """Call Gemini Flash with optional vision. Returns parsed JSON dict.
    Raises HTTPException on failure so callers don't need to error-handle."""
    if not GEMINI_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    import urllib.request, urllib.error
    parts = []
    if image_b64:
        parts.append({"inline_data": {"mime_type": mime_type, "data": image_b64}})
    parts.append({"text": prompt})
    body = json.dumps({
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            # Disable 2.5-flash hidden thinking — these are structured
            # extractions, not reasoning. Without this, thinking eats the
            # token budget before any output is emitted.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }).encode()
    req = urllib.request.Request(
        f"{_GEMINI_ENDPOINT}?key={GEMINI_KEY}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()[:300]
        raise HTTPException(status_code=502, detail=f"Gemini error {e.code}: {body_txt}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini fetch failed: {e}")
    text = (data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", ""))
    if not text:
        raise HTTPException(status_code=502, detail="empty response from Gemini")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON from model: {e}")

def food_file(d: str = None) -> Path:
    d = d or today()
    p = WORKSPACE / "food" / f"{d}.md"
    return p

def read_food_file(d: str = None) -> str:
    p = food_file(d)
    return p.read_text() if p.exists() else ""

def parse_entries(content: str) -> list:
    entries = []
    for block in re.findall(r"### (\d{2}:\d{2}) — (.+?)\n((?:- .+\n)+)", content):
        time, meal, items = block
        kcal_match = re.search(r"~(\d+) kcal", items)
        protein_match = re.search(r"~(\d+) g protein", items)
        entries.append({
            "time": time,
            "meal": meal,
            "items": items.strip(),
            "kcal": int(kcal_match.group(1)) if kcal_match else 0,
            "protein_g": int(protein_match.group(1)) if protein_match else 0
        })
    return entries

def read_goals() -> dict:
    p = WORKSPACE / "goals.md"
    if not p.exists():
        return {"calories": 2200, "protein": 160, "gym_days": 4}
    content = p.read_text()
    goals = {}
    m = re.search(r"Daily calories: ~?(\d+)", content)
    goals["calories"] = int(m.group(1)) if m else 2200
    m = re.search(r"Protein.*?: ~?(\d+)g", content)
    goals["protein"] = int(m.group(1)) if m else 160
    m = re.search(r"Gym.*?: (\d+)x", content)
    goals["gym_days"] = int(m.group(1)) if m else 4
    return goals

def _fridge_meta_path() -> Path:
    """Sidecar JSON keyed by lowercase item name carrying structured metadata
    (unit_size_g, quantity_g, unit_count, quantity_count) that doesn't fit the
    human-editable fridge.md format. Lives alongside fridge.md so Lucky's
    markdown view stays unchanged."""
    return WORKSPACE / "fridge_meta.json"

def _read_fridge_meta() -> dict:
    p = _fridge_meta_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return {}

def _write_fridge_meta(meta: dict):
    _fridge_meta_path().write_text(json.dumps(meta, indent=2))

def _meta_key(name: str) -> str:
    return name.strip().lower()

def read_fridge() -> dict:
    p = WORKSPACE / "fridge.md"
    if not p.exists():
        return {"fridge": [], "pantry": [], "condiments": [], "freezer": []}
    content = p.read_text()
    result = {"fridge": [], "pantry": [], "condiments": [], "freezer": []}
    section_map = {"Fridge": "fridge", "Pantry": "pantry", "Condiments": "condiments", "Freezer": "freezer"}
    current = None
    meta = _read_fridge_meta()
    for line in content.splitlines():
        for sec, key in section_map.items():
            if line.startswith(f"## {sec}"):
                current = key
                break
        if current and line.startswith("- ") and "empty" not in line.lower():
            item_text = line[2:].strip()
            name_match = re.match(r"^(.*?)(?:\s*\(added (.+?)\))?$", item_text)
            name = name_match.group(1).strip() if name_match else item_text
            added = name_match.group(2) if name_match and name_match.group(2) else None
            entry = {"name": name, "added": added}
            extra = meta.get(_meta_key(name))
            if extra:
                for field in ("unit_size_g", "quantity_g", "unit_count", "quantity_count"):
                    if field in extra and extra[field] is not None:
                        entry[field] = extra[field]
            result[current].append(entry)
    return result

def write_fridge(data: dict):
    """Write the human-readable fridge.md AND the sidecar fridge_meta.json.
    The markdown is the canonical inventory list (so Lucky can still edit it).
    The JSON sidecar carries quantity_g / unit_size_g / etc. keyed by name."""
    p = WORKSPACE / "fridge.md"
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"# Fridge & Pantry", f"_Last updated: {now}_", ""]
    section_labels = [
        ("fridge", "Fridge"),
        ("pantry", "Pantry"),
        ("condiments", "Condiments & Sauces"),
        ("freezer", "Freezer")
    ]
    new_meta: dict = {}
    for key, label in section_labels:
        lines.append(f"## {label}")
        items = data.get(key, [])
        if items:
            for item in items:
                added = item.get("added", "")
                lines.append(f"- {item['name']}" + (f" (added {added})" if added else ""))
                # Capture structured fields for the sidecar
                fields = {
                    f: item[f]
                    for f in ("unit_size_g", "quantity_g", "unit_count", "quantity_count")
                    if f in item and item[f] is not None
                }
                if fields:
                    new_meta[_meta_key(item["name"])] = fields
        else:
            lines.append("_(empty)_")
        lines.append("")
    p.write_text("\n".join(lines))
    if new_meta:
        _write_fridge_meta(new_meta)
    elif _fridge_meta_path().exists():
        # All structured fields removed (or all items deleted) — empty out the sidecar
        # so the file doesn't drift away from reality.
        _write_fridge_meta({})

# ── FOOD ──────────────────────────────────────────────────────────────
class FoodEntry(BaseModel):
    meal: str
    description: str
    kcal: int
    time: Optional[str] = None
    protein_g: Optional[int] = None

@app.get("/today")
def get_today(key=Depends(require_key)):
    content = read_food_file()
    entries = parse_entries(content)
    total = sum(e["kcal"] for e in entries)
    goals = read_goals()
    return {"date": today(), "entries": entries, "total_kcal": total, "goals": goals}

@app.post("/food")
def add_food(entry: FoodEntry, key=Depends(require_key)):
    t = entry.time or datetime.now().strftime("%H:%M")
    p = food_file()
    if not p.exists():
        p.write_text(f"# Food Log — {today()}\n\n")
    content = p.read_text()
    protein_str = f", ~{entry.protein_g} g protein" if entry.protein_g else ""
    block = "\n### " + t + " — " + entry.meal + "\n- " + entry.description + " (~" + str(entry.kcal) + " kcal" + protein_str + ")\n**Subtotal: ~" + str(entry.kcal) + " kcal**\n"
    content = re.sub(r"\n---\n\*\*Daily Total.*", "", content)
    content += block
    total = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
    content += "\n---\n**Daily Total: ~" + str(total) + " kcal**\n"
    p.write_text(content)
    return {"ok": True, "total_kcal": total, "entry": {"time": t, "meal": entry.meal, "description": entry.description, "kcal": entry.kcal, "protein_g": entry.protein_g or 0}}

@app.get("/food/history")
def food_history(days: int = 7, key=Depends(require_key)):
    result = []
    for i in range(days):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        total = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
        result.append({"date": d, "total_kcal": total, "logged": bool(content.strip())})
    return result

# ── FRIDGE ────────────────────────────────────────────────────────────
SLOT_FILE = DATA_DIR / "slot_memory.json"

def read_slots() -> dict:
    if not SLOT_FILE.exists():
        return {}
    try:
        return json.loads(SLOT_FILE.read_text() or "{}")
    except json.JSONDecodeError:
        return {}

def write_slots(slots: dict):
    # Atomic write: tmp file then rename, so a crash mid-write can't corrupt.
    tmp = SLOT_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(slots, indent=2, sort_keys=True))
    tmp.replace(SLOT_FILE)

def drop_slot_for(name: str):
    slots = read_slots()
    name_lower = name.lower()
    changed = [k for k in slots if name_lower in k.lower()]
    if changed:
        for k in changed:
            del slots[k]
        write_slots(slots)

@app.get("/fridge")
def get_fridge(key=Depends(require_key)):
    return read_fridge()

@app.get("/fridge/slots")
def get_slots(key=Depends(require_key)):
    return read_slots()

@app.put("/fridge/slots")
def put_slots(slots: dict, key=Depends(require_key)):
    valid_zones = {"fridge", "pantry", "freezer", "condiments"}
    cleaned: dict = {}
    for name, pos in slots.items():
        if not isinstance(pos, dict):
            continue
        zone = pos.get("zone")
        shelf = pos.get("shelf")
        col = pos.get("col")
        if zone not in valid_zones:
            continue
        if not (isinstance(shelf, int) and 0 <= shelf <= 2):
            continue
        if not (isinstance(col, int) and 0 <= col <= 2):
            continue
        cleaned[name] = {"zone": zone, "shelf": shelf, "col": col}
    write_slots(cleaned)
    return {"ok": True, "count": len(cleaned)}

class FridgeItem(BaseModel):
    name: str
    section: str = "fridge"
    # Optional pack size in grams when the item is added (e.g. "1kg chicken" → 1000).
    # When set with quantity_g unset, quantity_g defaults to unit_size_g.
    unit_size_g: Optional[float] = None
    # Current remaining grams. Decremented by /fridge/item/{name}/consume when meals
    # are logged via the camera Home flow.
    quantity_g: Optional[float] = None
    # Discrete-unit support for things like eggs/apples (eggs: 12 → eat 2 → 10).
    unit_count: Optional[int] = None
    quantity_count: Optional[int] = None

@app.post("/fridge/item")
def add_fridge_item(item: FridgeItem, key=Depends(require_key)):
    data = read_fridge()
    added = date.today().strftime("%d %b")
    record = {"name": item.name, "added": added}
    if item.unit_size_g is not None:
        record["unit_size_g"] = item.unit_size_g
        record["quantity_g"] = (
            item.quantity_g if item.quantity_g is not None else item.unit_size_g
        )
    elif item.quantity_g is not None:
        record["quantity_g"] = item.quantity_g
    if item.unit_count is not None:
        record["unit_count"] = item.unit_count
        record["quantity_count"] = (
            item.quantity_count if item.quantity_count is not None else item.unit_count
        )
    elif item.quantity_count is not None:
        record["quantity_count"] = item.quantity_count
    data.setdefault(item.section, []).append(record)
    write_fridge(data)
    return {"ok": True}

@app.delete("/fridge/item/{name}")
def remove_fridge_item(name: str, key=Depends(require_key)):
    data = read_fridge()
    name_lower = name.lower()
    removed = False
    for section in data:
        before = len(data[section])
        data[section] = [i for i in data[section] if name_lower not in i["name"].lower()]
        if len(data[section]) < before:
            removed = True
    if not removed:
        raise HTTPException(status_code=404, detail=f"Item not found")
    write_fridge(data)
    drop_slot_for(name)
    return {"ok": True}

class ConsumeInput(BaseModel):
    grams: Optional[float] = None
    count: Optional[int] = None

@app.post("/fridge/item/{name}/consume")
def consume_fridge_item(name: str, input: ConsumeInput, key=Depends(require_key)):
    """Decrement quantity_g and/or quantity_count for the named item.

    Match is case-insensitive substring across all sections. If multiple items match,
    the first one is consumed. When quantity hits 0 the item stays in the fridge
    (so the user sees it's empty and can either remove or restock); the next add
    of the same name resets quantity_g to unit_size_g.
    """
    if input.grams is None and input.count is None:
        raise HTTPException(status_code=400, detail="Provide grams or count")
    data = read_fridge()
    name_lower = name.lower()
    consumed = None
    for section in data:
        for item in data[section]:
            if name_lower in item["name"].lower():
                if input.grams is not None and "quantity_g" in item:
                    item["quantity_g"] = max(0.0, item["quantity_g"] - input.grams)
                if input.count is not None and "quantity_count" in item:
                    item["quantity_count"] = max(0, item["quantity_count"] - input.count)
                consumed = {
                    "name": item["name"],
                    "section": section,
                    "quantity_g": item.get("quantity_g"),
                    "quantity_count": item.get("quantity_count"),
                }
                break
        if consumed:
            break
    if not consumed:
        raise HTTPException(status_code=404, detail=f"Item not found")
    write_fridge(data)
    return {"ok": True, **consumed}

class ScanInput(BaseModel):
    image: str  # base64 (no data: prefix)
    mimeType: Optional[str] = "image/jpeg"

@app.post("/fridge/scan")
async def scan_receipt(input: ScanInput, key=Depends(require_key)):
    """Receipt scan — JSON contract matching the Cloudflare Pages Function shadow
    at functions/api/fridge/scan.js so dev/prod/fallback all behave the same.

    Returns {items: [...], store: {...}} — does NOT add to fridge automatically;
    the client iterates and calls /fridge/item per item so that user-side
    confirmation/edits can happen first.
    """
    media_type = input.mimeType or "image/jpeg"
    prompt = (
        "Look at this grocery store receipt. Extract the purchased food and drink items.\n\n"
        "Return ONLY valid JSON, no markdown or explanation:\n"
        '{"store":{"name":"store name","location":"address/area or null"},'
        '"items":[{"name":"readable name","unit_size_g":340,"unit_count":null,"cost":1.89,"section":"fridge"}]}\n\n'
        "Rules:\n"
        '- name: clean readable name (e.g. "greek yogurt" not "GREEK YOG 10%")\n'
        "- unit_size_g: pack size in grams if visible (parse '340g' → 340, '1kg' → 1000, '1.5L water' → 1500)\n"
        "  null if not shown or not weight-based\n"
        "- unit_count: discrete count if applicable (eggs: 6/12, apples: 4) — null otherwise\n"
        "- cost: item price as a number — null if not visible\n"
        '- section: "fridge"|"freezer"|"pantry"|"condiments"\n'
        "  fridge: dairy, fresh produce, eggs, meat/fish, yogurt, juice, deli\n"
        "  freezer: frozen meals, ice cream, frozen veg/meat\n"
        "  pantry: canned, dry goods, snacks, coffee, tea, bread, nuts, spreads, chocolate\n"
        "  condiments: sauces, oils, vinegar, dressings, spices\n"
        "- INCLUDE all food and drink items\n"
        "- SKIP non-food (foil, bags, cleaning, toiletries), totals, VAT, discounts, header rows\n"
        '- If a name contains "/" add both as separate items'
    )
    parsed = gemini_call(prompt, image_b64=input.image, mime_type=media_type, max_tokens=2000, temperature=0.2)
    raw_items = parsed.get("items") or []
    valid_sections = {"fridge", "freezer", "pantry", "condiments"}
    items = [
        {
            "name": (i.get("name") or "").strip().lower(),
            "section": i["section"] if i.get("section") in valid_sections else "fridge",
            "unit_size_g": i.get("unit_size_g") if isinstance(i.get("unit_size_g"), (int, float)) else None,
            "unit_count": i.get("unit_count") if isinstance(i.get("unit_count"), int) else None,
            "cost": i.get("cost") if isinstance(i.get("cost"), (int, float)) else None,
            # Legacy `size` string kept so the pre-units client path still works.
            "size": (
                f"{int(i['unit_size_g'])}g" if isinstance(i.get("unit_size_g"), (int, float))
                else None
            ),
        }
        for i in raw_items
        if isinstance(i, dict) and i.get("name")
    ]
    return {"items": items, "store": parsed.get("store")}

# ── MEALS AI ──────────────────────────────────────────────────────────
@app.post("/ai/meals")
def suggest_meals(key=Depends(require_key)):
    fridge = read_fridge()
    goals = read_goals()
    all_items = [i["name"] for sec in fridge.values() for i in sec]
    if not all_items:
        return {"meals": [{"name": "Fridge is empty", "ingredients": [], "kcal_estimate": 0}]}
    prompt = (
        f"Fridge contents: {', '.join(all_items)}. "
        f"Daily calorie goal: ~{goals.get('calories', 2200)} kcal, protein: ~{goals.get('protein', 160)}g. "
        "Suggest exactly 3 practical meals using these ingredients. "
        'Return ONLY this JSON (no markdown): {"meals":[{"name":"Meal Name","ingredients":["item1"],"kcal_estimate":600}]}'
    )
    parsed = gemini_call(prompt, max_tokens=600, temperature=0.6)
    meals = parsed.get("meals") if isinstance(parsed, dict) else parsed
    return {"meals": meals if isinstance(meals, list) else []}

class MealDetailInput(BaseModel):
    name: str
    ingredients: list[str] = []

@app.post("/ai/meal-detail")
def meal_detail(input: MealDetailInput, key=Depends(require_key)):
    """Recipe + full macros for a single meal idea. The frontend calls this on
    tap-to-expand so the cheap /ai/meals listing stays cheap (just names +
    kcal estimates) and the expensive recipe generation only fires when the
    user actually picks one."""
    prompt = (
        f"Recipe for: {input.name}\n"
        f"Ingredients available: {', '.join(input.ingredients) if input.ingredients else '(none specified)'}\n\n"
        "Return ONLY this JSON (no markdown, no commentary):\n"
        '{"prep_minutes": 15, "cook_minutes": 20, "servings": 1, '
        '"steps": ["Step 1...", "Step 2...", "..."], '
        '"kcal": 620, "protein_g": 42, "carbs_g": 60, "fat_g": 22}\n\n'
        "Rules:\n"
        "- 4-8 short cooking steps (one sentence each, action-first)\n"
        "- Macros are per serving\n"
        "- Be realistic about portions (one serving for an active adult)"
    )
    return gemini_call(prompt, max_tokens=800, temperature=0.5)

# ── WORKOUTS ──────────────────────────────────────────────────────────
WORKOUTS_FILE = DATA_DIR / "workouts.json"

def load_workouts() -> list:
    if WORKOUTS_FILE.exists():
        return json.loads(WORKOUTS_FILE.read_text())
    return []

def save_workouts(workouts: list):
    WORKOUTS_FILE.write_text(json.dumps(workouts, indent=2))

class ExerciseSet(BaseModel):
    weight_kg: Optional[float] = None
    reps: Optional[int] = None
    duration_seconds: Optional[int] = None

class Exercise(BaseModel):
    name: str
    sets: list[ExerciseSet]

class Workout(BaseModel):
    title: str
    start_time: str
    end_time: str
    exercises: list[Exercise]

@app.get("/workouts")
def get_workouts(limit: int = 30, key=Depends(require_key)):
    workouts = load_workouts()
    return workouts[-limit:]

@app.post("/workouts")
def save_workout(workout: Workout, key=Depends(require_key)):
    workouts = load_workouts()
    w = workout.dict()
    w["id"] = f"{today()}-{len(workouts)}"
    workouts.append(w)
    save_workouts(workouts)
    return {"ok": True, "id": w["id"]}

@app.patch("/workouts/{workout_id}")
def update_workout(workout_id: str, workout: Workout, key=Depends(require_key)):
    """Replace a finished workout in place. Used when the user opens a saved
    workout to fix sets, change weight, etc. — the id stays stable so PRs
    derived from the workout don't lose their lineage."""
    workouts = load_workouts()
    for i, w in enumerate(workouts):
        if w.get("id") == workout_id:
            updated = workout.dict()
            updated["id"] = workout_id
            workouts[i] = updated
            save_workouts(workouts)
            return {"ok": True, "id": workout_id}
    raise HTTPException(status_code=404, detail="Workout not found")

@app.delete("/workouts/{workout_id}")
def delete_workout(workout_id: str, key=Depends(require_key)):
    workouts = load_workouts()
    next_workouts = [w for w in workouts if w.get("id") != workout_id]
    if len(next_workouts) == len(workouts):
        raise HTTPException(status_code=404, detail="Workout not found")
    save_workouts(next_workouts)
    return {"ok": True}

@app.get("/workouts/prs")
def get_prs(key=Depends(require_key)):
    workouts = load_workouts()
    prs = {}
    for w in workouts:
        for ex in w.get("exercises", []):
            name = ex["name"]
            for s in ex.get("sets", []):
                if s.get("weight_kg") and s.get("reps"):
                    if name not in prs or s["weight_kg"] > prs[name]["weight_kg"]:
                        prs[name] = {"weight_kg": s["weight_kg"], "reps": s["reps"], "date": w["start_time"][:10]}
    return prs

# ── GOALS ─────────────────────────────────────────────────────────────
@app.get("/goals")
def get_goals(key=Depends(require_key)):
    p = WORKSPACE / "goals.md"
    return {"content": p.read_text() if p.exists() else "", "parsed": read_goals()}

class GoalsUpdate(BaseModel):
    calories: Optional[int] = None
    protein: Optional[int] = None
    gym_days: Optional[int] = None
    notes: Optional[str] = None

@app.put("/goals")
def update_goals(update: GoalsUpdate, key=Depends(require_key)):
    p = WORKSPACE / "goals.md"
    now = date.today().isoformat()
    goals = read_goals()
    if update.calories:
        goals["calories"] = update.calories
    if update.protein:
        goals["protein"] = update.protein
    if update.gym_days:
        goals["gym_days"] = update.gym_days
    content = f"""# Health Goals
_Last updated: {now}_

## Nutrition
- Daily calories: ~{goals["calories"]} kcal
- Protein: ~{goals["protein"]}g/day

## Fitness
- Gym: {goals["gym_days"]}x per week minimum

## Notes
{update.notes or "(not set)"}
"""
    p.write_text(content)
    return {"ok": True, "goals": goals}

# ── STATS ─────────────────────────────────────────────────────────────
@app.get("/stats/week")
def week_stats(key=Depends(require_key)):
    goals = read_goals()
    food_data = []
    for i in range(7):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        total = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
        food_data.append({"date": d, "total_kcal": total, "logged": bool(content.strip())})
    workouts = load_workouts()
    week_start = (date.today() - timedelta(days=6)).isoformat()
    week_workouts = [w for w in workouts if w.get("start_time", "") >= week_start]
    logged_days = sum(1 for d in food_data if d["logged"])
    avg_kcal = sum(d["total_kcal"] for d in food_data if d["logged"]) // max(logged_days, 1)
    return {
        "food_by_day": food_data,
        "logged_days": logged_days,
        "avg_kcal": avg_kcal,
        "goal_kcal": goals["calories"],
        "workout_count": len(week_workouts),
        "goal_gym_days": goals["gym_days"],
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=False)

# ── USER PROFILE ──────────────────────────────────────────────────────
PROFILE_FILE = DATA_DIR / "profile.json"

class UserProfileIn(BaseModel):
    name: str
    calories: Optional[int] = None
    protein: Optional[int] = None

@app.get("/users/profile")
def get_profile(key=Depends(require_key)):
    goals = read_goals()
    name = "Brody"
    if PROFILE_FILE.exists():
        try:
            data = json.loads(PROFILE_FILE.read_text())
            name = data.get("name", name)
        except Exception:
            pass
    return {"name": name, "calories": goals["calories"], "protein": goals["protein"]}

@app.post("/users/profile")
def save_profile(profile: UserProfileIn, key=Depends(require_key)):
    # Persist name
    existing = {}
    if PROFILE_FILE.exists():
        try:
            existing = json.loads(PROFILE_FILE.read_text())
        except Exception:
            pass
    existing["name"] = profile.name.strip() or "Brody"
    PROFILE_FILE.write_text(json.dumps(existing))

    # If calories/protein provided, also update goals.md
    if profile.calories or profile.protein:
        goals = read_goals()
        if profile.calories:
            goals["calories"] = profile.calories
        if profile.protein:
            goals["protein"] = profile.protein
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        p = WORKSPACE / "goals.md"
        p.write_text(f"""# Health Goals\n_Last updated: {now}_\n\n## Nutrition\n- Daily calories: ~{goals['calories']} kcal\n- Protein: ~{goals['protein']}g/day\n\n## Fitness\n- Gym: {goals['gym_days']}x per week minimum\n""")

    return {"ok": True, "name": existing["name"]}


# ── LISTS (groceries, todos, custom) ─────────────────────────────────
LISTS_FILE = DATA_DIR / "lists.json"

def load_lists() -> dict:
    if LISTS_FILE.exists():
        return json.loads(LISTS_FILE.read_text())
    return {}

def save_lists(data: dict):
    LISTS_FILE.write_text(json.dumps(data, indent=2))

class ListItem(BaseModel):
    text: str
    checked: Optional[bool] = False

@app.get("/lists/{name}")
def get_list(name: str, key=Depends(require_key)):
    data = load_lists()
    return {"name": name, "items": data.get(name, [])}

@app.post("/lists/{name}/items")
def add_list_item(name: str, item: ListItem, key=Depends(require_key)):
    data = load_lists()
    items = data.setdefault(name, [])
    new_item = {"id": f"{int(datetime.now().timestamp()*1000)}", "text": item.text, "checked": item.checked or False, "added": datetime.now().isoformat()}
    items.append(new_item)
    save_lists(data)
    return {"ok": True, "item": new_item}

@app.patch("/lists/{name}/items/{item_id}")
def toggle_list_item(name: str, item_id: str, key=Depends(require_key)):
    data = load_lists()
    items = data.get(name, [])
    for item in items:
        if item["id"] == item_id:
            item["checked"] = not item.get("checked", False)
            save_lists(data)
            return {"ok": True, "item": item}
    raise HTTPException(status_code=404, detail="Item not found")

@app.delete("/lists/{name}/items/{item_id}")
def delete_list_item(name: str, item_id: str, key=Depends(require_key)):
    data = load_lists()
    items = data.get(name, [])
    data[name] = [i for i in items if i["id"] != item_id]
    save_lists(data)
    return {"ok": True}

@app.delete("/lists/{name}")
def clear_list(name: str, key=Depends(require_key)):
    data = load_lists()
    data.pop(name, None)
    save_lists(data)
    return {"ok": True}


# ── ROUTINES (skincare, workouts, custom) ─────────────────────────────
ROUTINES_FILE = DATA_DIR / "routines.json"

def load_routines() -> dict:
    if ROUTINES_FILE.exists():
        return json.loads(ROUTINES_FILE.read_text())
    return {}

def save_routines(data: dict):
    ROUTINES_FILE.write_text(json.dumps(data, indent=2))

@app.get("/routines/{name}")
def get_routine(name: str, key=Depends(require_key)):
    data = load_routines()
    routine = data.get(name, {"name": name, "log": []})
    log = routine.get("log", [])
    today_str = date.today().isoformat()
    done_today = any(e["date"] == today_str for e in log)
    # streak: count consecutive days back from today
    streak = 0
    d = date.today()
    while True:
        ds = d.isoformat()
        if any(e["date"] == ds for e in log):
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return {"name": name, "done_today": done_today, "streak": streak, "log": log[-30:]}

@app.post("/routines/{name}/log")
def log_routine(name: str, key=Depends(require_key)):
    data = load_routines()
    routine = data.setdefault(name, {"name": name, "log": []})
    today_str = date.today().isoformat()
    if not any(e["date"] == today_str for e in routine["log"]):
        routine["log"].append({"date": today_str, "logged_at": datetime.now().isoformat()})
    save_routines(data)
    return {"ok": True, "date": today_str}

@app.get("/routines/{name}/streak")
def get_streak(name: str, key=Depends(require_key)):
    data = load_routines()
    routine = data.get(name, {"log": []})
    log = routine.get("log", [])
    streak = 0
    d = date.today()
    while True:
        if any(e["date"] == d.isoformat() for e in log):
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return {"name": name, "streak": streak}


# ── AGENDA (today's plan + queue) ─────────────────────────────────────
AGENDA_FILE = DATA_DIR / "agenda.json"

def load_agenda() -> list:
    if AGENDA_FILE.exists():
        return json.loads(AGENDA_FILE.read_text())
    return []

def save_agenda(items: list):
    AGENDA_FILE.write_text(json.dumps(items, indent=2))

class AgendaItem(BaseModel):
    title: str
    notes: Optional[str] = None
    scheduled_date: Optional[str] = None  # ISO date, defaults to today

@app.get("/agenda/today")
def get_agenda_today(key=Depends(require_key)):
    items = load_agenda()
    today_str = date.today().isoformat()
    today_items = [i for i in items if i.get("scheduled_date", today_str) == today_str and not i.get("done")]
    return {"date": today_str, "items": today_items}

@app.post("/agenda")
def add_agenda_item(item: AgendaItem, key=Depends(require_key)):
    items = load_agenda()
    new_item = {
        "id": f"{int(datetime.now().timestamp()*1000)}",
        "title": item.title,
        "notes": item.notes,
        "scheduled_date": item.scheduled_date or date.today().isoformat(),
        "done": False,
        "created_at": datetime.now().isoformat(),
    }
    items.append(new_item)
    save_agenda(items)
    return {"ok": True, "item": new_item}

@app.patch("/agenda/{item_id}")
def update_agenda_item(item_id: str, key=Depends(require_key)):
    items = load_agenda()
    for item in items:
        if item["id"] == item_id:
            item["done"] = not item.get("done", False)
            item["done_at"] = datetime.now().isoformat() if item["done"] else None
            save_agenda(items)
            return {"ok": True, "item": item}
    raise HTTPException(status_code=404, detail="Item not found")

@app.delete("/agenda/{item_id}")
def delete_agenda_item(item_id: str, key=Depends(require_key)):
    items = load_agenda()
    items = [i for i in items if i["id"] != item_id]
    save_agenda(items)
    return {"ok": True}

# ── HEALTHKIT SYNC ────────────────────────────────────────────────────
# Endpoints for an iOS Shortcut that pushes Apple Health data into Health Hub.
# Covers: body weight, active calories, workouts (incl. gym sessions). The
# Shortcut is the only thing that knows about HealthKit — this side is
# storage-agnostic and just appends to JSON files.
HEALTHKIT_FILE = DATA_DIR / "healthkit.json"

class HealthKitWorkout(BaseModel):
    """A single workout / activity row from HealthKit."""
    type: str  # e.g. "Functional Strength Training", "Walking"
    start: str  # ISO 8601 datetime
    duration_min: float
    active_calories: Optional[float] = None
    distance_km: Optional[float] = None

class HealthKitPayload(BaseModel):
    # Use any combination — the Shortcut may push partial syncs (e.g. just weight).
    weight_kg: Optional[float] = None
    weight_at: Optional[str] = None  # ISO datetime
    active_calories_today: Optional[float] = None
    resting_calories_today: Optional[float] = None
    steps_today: Optional[int] = None
    workouts: Optional[list[HealthKitWorkout]] = None

def _read_healthkit() -> dict:
    if not HEALTHKIT_FILE.exists():
        return {"weight_log": [], "daily": [], "workouts": []}
    try:
        return json.loads(HEALTHKIT_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {"weight_log": [], "daily": [], "workouts": []}

def _write_healthkit(data: dict):
    HEALTHKIT_FILE.write_text(json.dumps(data, indent=2))

@app.post("/healthkit/sync")
def healthkit_sync(payload: HealthKitPayload, key=Depends(require_key)):
    """Append HealthKit data to healthkit.json. Idempotent on workouts (dedupe
    by start+type) so the Shortcut can push the same window twice without
    duplicating entries. Returns counts so the Shortcut can show a toast."""
    store = _read_healthkit()

    added = {"weight": 0, "daily": 0, "workouts": 0}

    if payload.weight_kg is not None and payload.weight_at is not None:
        store["weight_log"].append({"kg": payload.weight_kg, "at": payload.weight_at})
        store["weight_log"] = store["weight_log"][-365:]  # cap at ~1yr
        added["weight"] = 1

    if any(v is not None for v in [payload.active_calories_today, payload.resting_calories_today, payload.steps_today]):
        today_str = date.today().isoformat()
        # Replace today's row if it exists (Shortcut may sync hourly); otherwise append.
        store["daily"] = [d for d in store["daily"] if d.get("date") != today_str]
        store["daily"].append({
            "date": today_str,
            "active_calories": payload.active_calories_today,
            "resting_calories": payload.resting_calories_today,
            "steps": payload.steps_today,
            "synced_at": datetime.now().isoformat(),
        })
        store["daily"] = store["daily"][-90:]  # 90-day window
        added["daily"] = 1

    if payload.workouts:
        existing_keys = {(w["start"], w["type"]) for w in store["workouts"]}
        for w in payload.workouts:
            key_pair = (w.start, w.type)
            if key_pair in existing_keys:
                continue
            store["workouts"].append({
                "type": w.type,
                "start": w.start,
                "duration_min": w.duration_min,
                "active_calories": w.active_calories,
                "distance_km": w.distance_km,
                "synced_at": datetime.now().isoformat(),
            })
            existing_keys.add(key_pair)
            added["workouts"] += 1
        store["workouts"] = store["workouts"][-365:]

    _write_healthkit(store)
    return {"ok": True, "added": added}

@app.get("/healthkit/latest")
def healthkit_latest(key=Depends(require_key)):
    """Returns latest synced summary so the frontend can show
    "Last HealthKit sync: 2 hours ago" + the most recent weight/active-cal totals."""
    store = _read_healthkit()
    last_weight = store["weight_log"][-1] if store["weight_log"] else None
    last_daily = store["daily"][-1] if store["daily"] else None
    last_workout = store["workouts"][-1] if store["workouts"] else None
    return {
        "last_weight": last_weight,
        "last_daily": last_daily,
        "last_workout": last_workout,
        "weight_count": len(store["weight_log"]),
        "workout_count": len(store["workouts"]),
    }
