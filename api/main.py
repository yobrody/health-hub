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
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
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

def read_fridge() -> dict:
    p = WORKSPACE / "fridge.md"
    if not p.exists():
        return {"fridge": [], "pantry": [], "condiments": [], "freezer": []}
    content = p.read_text()
    result = {"fridge": [], "pantry": [], "condiments": [], "freezer": []}
    section_map = {"Fridge": "fridge", "Pantry": "pantry", "Condiments": "condiments", "Freezer": "freezer"}
    current = None
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
            result[current].append({"name": name, "added": added})
    return result

def write_fridge(data: dict):
    p = WORKSPACE / "fridge.md"
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"# Fridge & Pantry", f"_Last updated: {now}_", ""]
    section_labels = [
        ("fridge", "Fridge"),
        ("pantry", "Pantry"),
        ("condiments", "Condiments & Sauces"),
        ("freezer", "Freezer")
    ]
    for key, label in section_labels:
        lines.append(f"## {label}")
        items = data.get(key, [])
        if items:
            for item in items:
                added = item.get("added", "")
                lines.append(f"- {item['name']}" + (f" (added {added})" if added else ""))
        else:
            lines.append("_(empty)_")
        lines.append("")
    p.write_text("\n".join(lines))

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
@app.get("/fridge")
def get_fridge(key=Depends(require_key)):
    return read_fridge()

class FridgeItem(BaseModel):
    name: str
    section: str = "fridge"

@app.post("/fridge/item")
def add_fridge_item(item: FridgeItem, key=Depends(require_key)):
    data = read_fridge()
    added = date.today().strftime("%d %b")
    data.setdefault(item.section, []).append({"name": item.name, "added": added})
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
    return {"ok": True}

@app.post("/fridge/scan")
async def scan_receipt(file: UploadFile = File(...), key=Depends(require_key)):
    if not ANTHROPIC_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    import anthropic as ac
    img_bytes = await file.read()
    b64 = base64.standard_b64encode(img_bytes).decode()
    media_type = file.content_type or "image/jpeg"
    client = ac.Anthropic(api_key=ANTHROPIC_KEY)
    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
            {"type": "text", "text": (
                "This is a grocery receipt. Extract all food/drink items purchased. "
                "For each item, output a JSON array like: "
                '[{"name": "Chicken breast", "section": "fridge"}, {"name": "Oats", "section": "pantry"}]. '
                "section must be one of: fridge, pantry, condiments, freezer. "
                "Skip non-food items. Return ONLY the JSON array, nothing else."
            )}
        ]}]
    )
    raw = resp.content[0].text.strip()
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    if not m:
        raise HTTPException(status_code=422, detail="Could not parse receipt items")
    items = json.loads(m.group())
    data = read_fridge()
    added_date = date.today().strftime("%d %b")
    for item in items:
        section = item.get("section", "fridge")
        if section not in data:
            section = "fridge"
        data[section].append({"name": item["name"], "added": added_date})
    write_fridge(data)
    return {"ok": True, "items_added": len(items), "items": items}

# ── MEALS AI ──────────────────────────────────────────────────────────
@app.post("/ai/meals")
def suggest_meals(key=Depends(require_key)):
    if not ANTHROPIC_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    import anthropic as ac
    fridge = read_fridge()
    goals = read_goals()
    all_items = [i["name"] for sec in fridge.values() for i in sec]
    if not all_items:
        return {"meals": [{"name": "Fridge is empty", "ingredients": [], "kcal_estimate": 0}]}
    client = ac.Anthropic(api_key=ANTHROPIC_KEY)
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": (
            f"Fridge contents: {', '.join(all_items)}. "
            f"Daily calorie goal: ~{goals.get('calories', 2200)} kcal, protein: ~{goals.get('protein', 160)}g. "
            "Suggest exactly 3 practical meals using these ingredients. "
            'Return JSON array: [{"name": "Meal Name", "ingredients": ["item1"], "kcal_estimate": 600}]'
        )}]
    )
    raw = resp.content[0].text.strip()
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    meals = json.loads(m.group()) if m else []
    return {"meals": meals}

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
    avg_kcal = sum(d["kcal"] for d in food_data if d["logged"]) // max(logged_days, 1)
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


# ── BODY METRICS (weight, body fat, measurements) ────────────────────
METRICS_FILE = DATA_DIR / "body_metrics.json"

def load_metrics() -> list:
    if METRICS_FILE.exists():
        return json.loads(METRICS_FILE.read_text())
    return []

def save_metrics(data: list):
    METRICS_FILE.write_text(json.dumps(data, indent=2))

class BodyMetricIn(BaseModel):
    weight_kg: Optional[float] = None
    body_fat_pct: Optional[float] = None
    waist_cm: Optional[float] = None
    chest_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    notes: Optional[str] = None
    date: Optional[str] = None

@app.get("/metrics")
def get_metrics(days: int = 90, key=Depends(require_key)):
    metrics = load_metrics()
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    recent = [m for m in metrics if m.get("date", "") >= cutoff]
    return {"metrics": recent}

@app.post("/metrics")
def add_metric(entry: BodyMetricIn, key=Depends(require_key)):
    metrics = load_metrics()
    d = entry.date or date.today().isoformat()
    record = {
        "id": f"{int(datetime.now().timestamp()*1000)}",
        "date": d,
        "logged_at": datetime.now().isoformat(),
    }
    if entry.weight_kg is not None: record["weight_kg"] = entry.weight_kg
    if entry.body_fat_pct is not None: record["body_fat_pct"] = entry.body_fat_pct
    if entry.waist_cm is not None: record["waist_cm"] = entry.waist_cm
    if entry.chest_cm is not None: record["chest_cm"] = entry.chest_cm
    if entry.arm_cm is not None: record["arm_cm"] = entry.arm_cm
    if entry.notes: record["notes"] = entry.notes
    metrics.append(record)
    save_metrics(metrics)
    return {"ok": True, "metric": record}

@app.get("/metrics/latest")
def get_latest_metric(key=Depends(require_key)):
    metrics = load_metrics()
    if not metrics:
        return {"metric": None}
    return {"metric": metrics[-1]}


# ── TDEE CALCULATOR ──────────────────────────────────────────────────
import math

@app.get("/tdee")
def calculate_tdee(key=Depends(require_key)):
    """Calculate TDEE from profile + activity level + adaptive adjustment from food log."""
    profile_data = {}
    if PROFILE_FILE.exists():
        try:
            profile_data = json.loads(PROFILE_FILE.read_text())
        except Exception:
            pass

    weight_kg = profile_data.get("weight_kg", 80.0)
    height_cm = profile_data.get("height_cm", 180.0)
    age = profile_data.get("age", 25)
    sex = profile_data.get("sex", "male")
    activity_level = profile_data.get("activity_level", "moderate")

    # Latest weight from body metrics if available
    metrics = load_metrics()
    if metrics:
        for m in reversed(metrics):
            if "weight_kg" in m:
                weight_kg = m["weight_kg"]
                break

    # Mifflin-St Jeor BMR
    if sex == "female":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5

    multipliers = {
        "sedentary": 1.2,
        "light": 1.375,
        "moderate": 1.55,
        "active": 1.725,
        "very_active": 1.9,
    }
    mult = multipliers.get(activity_level, 1.55)
    tdee = round(bmr * mult)

    # Adaptive: compare avg intake over last 14 days vs TDEE
    avg_intake = 0
    logged_days = 0
    for i in range(14):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        day_kcal = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
        if day_kcal > 0:
            avg_intake += day_kcal
            logged_days += 1
    if logged_days >= 3:
        avg_intake = round(avg_intake / logged_days)
    else:
        avg_intake = None

    # Weight trend (last 30 days)
    weight_trend = None
    recent_weights = [(m["date"], m["weight_kg"]) for m in metrics if "weight_kg" in m][-30:]
    if len(recent_weights) >= 2:
        first_w = recent_weights[0][1]
        last_w = recent_weights[-1][1]
        days_span = max((date.fromisoformat(recent_weights[-1][0]) - date.fromisoformat(recent_weights[0][0])).days, 1)
        weekly_change = (last_w - first_w) / days_span * 7
        weight_trend = {"weekly_change_kg": round(weekly_change, 2), "direction": "gaining" if weekly_change > 0.1 else "losing" if weekly_change < -0.1 else "maintaining"}

    return {
        "bmr": round(bmr),
        "tdee": tdee,
        "activity_level": activity_level,
        "weight_kg": weight_kg,
        "avg_intake_14d": avg_intake,
        "logged_days_14d": logged_days,
        "weight_trend": weight_trend,
        "recommendation": _tdee_recommendation(tdee, avg_intake, weight_trend),
    }

def _tdee_recommendation(tdee: int, avg_intake: Optional[int], weight_trend: Optional[dict]) -> str:
    if avg_intake is None:
        return "Log food for 3+ days to get adaptive recommendations."
    diff = avg_intake - tdee
    if weight_trend and weight_trend["direction"] == "gaining" and diff > 200:
        return f"Eating ~{diff} kcal above TDEE. Weight trending up. Consider reducing to {tdee} kcal for maintenance."
    elif weight_trend and weight_trend["direction"] == "losing" and diff < -200:
        return f"Eating ~{abs(diff)} kcal below TDEE. Weight trending down — on track if cutting."
    elif abs(diff) <= 200:
        return "Intake aligns well with TDEE. Weight should be stable."
    else:
        return f"Avg intake: {avg_intake} kcal vs TDEE: {tdee} kcal. Delta: {diff:+d} kcal/day."

@app.put("/tdee/profile")
def update_tdee_profile(key=Depends(require_key),
                        weight_kg: Optional[float] = None,
                        height_cm: Optional[float] = None,
                        age: Optional[int] = None,
                        sex: Optional[str] = None,
                        activity_level: Optional[str] = None):
    """Update TDEE profile fields (stored in profile.json)."""
    existing = {}
    if PROFILE_FILE.exists():
        try:
            existing = json.loads(PROFILE_FILE.read_text())
        except Exception:
            pass
    if weight_kg is not None: existing["weight_kg"] = weight_kg
    if height_cm is not None: existing["height_cm"] = height_cm
    if age is not None: existing["age"] = age
    if sex is not None: existing["sex"] = sex
    if activity_level is not None: existing["activity_level"] = activity_level
    PROFILE_FILE.write_text(json.dumps(existing, indent=2))
    return {"ok": True, "profile": existing}


# ── HRV + SLEEP TRACKING ────────────────────────────────────────────
SLEEP_FILE = DATA_DIR / "sleep.json"

def load_sleep() -> list:
    if SLEEP_FILE.exists():
        return json.loads(SLEEP_FILE.read_text())
    return []

def save_sleep(data: list):
    SLEEP_FILE.write_text(json.dumps(data, indent=2))

class SleepEntryIn(BaseModel):
    bedtime: str          # HH:MM
    wake_time: str        # HH:MM
    quality: int = 3      # 1-5 scale
    hrv_ms: Optional[int] = None
    resting_hr: Optional[int] = None
    notes: Optional[str] = None
    date: Optional[str] = None

@app.get("/sleep")
def get_sleep(days: int = 30, key=Depends(require_key)):
    entries = load_sleep()
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    recent = [e for e in entries if e.get("date", "") >= cutoff]
    return {"entries": recent}

@app.post("/sleep")
def log_sleep(entry: SleepEntryIn, key=Depends(require_key)):
    entries = load_sleep()
    d = entry.date or date.today().isoformat()
    # Calculate duration
    bed_h, bed_m = map(int, entry.bedtime.split(":"))
    wake_h, wake_m = map(int, entry.wake_time.split(":"))
    bed_mins = bed_h * 60 + bed_m
    wake_mins = wake_h * 60 + wake_m
    if wake_mins <= bed_mins:
        wake_mins += 24 * 60  # crossed midnight
    duration_hrs = round((wake_mins - bed_mins) / 60, 1)

    record = {
        "id": f"{int(datetime.now().timestamp()*1000)}",
        "date": d,
        "bedtime": entry.bedtime,
        "wake_time": entry.wake_time,
        "duration_hrs": duration_hrs,
        "quality": min(max(entry.quality, 1), 5),
        "logged_at": datetime.now().isoformat(),
    }
    if entry.hrv_ms is not None: record["hrv_ms"] = entry.hrv_ms
    if entry.resting_hr is not None: record["resting_hr"] = entry.resting_hr
    if entry.notes: record["notes"] = entry.notes
    entries.append(record)
    save_sleep(entries)
    return {"ok": True, "sleep": record}

@app.get("/sleep/stats")
def sleep_stats(days: int = 7, key=Depends(require_key)):
    entries = load_sleep()
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    recent = [e for e in entries if e.get("date", "") >= cutoff]
    if not recent:
        return {"avg_duration": None, "avg_quality": None, "avg_hrv": None, "entries": 0}
    avg_dur = round(sum(e["duration_hrs"] for e in recent) / len(recent), 1)
    avg_qual = round(sum(e["quality"] for e in recent) / len(recent), 1)
    hrv_entries = [e["hrv_ms"] for e in recent if "hrv_ms" in e]
    avg_hrv = round(sum(hrv_entries) / len(hrv_entries)) if hrv_entries else None
    return {"avg_duration": avg_dur, "avg_quality": avg_qual, "avg_hrv": avg_hrv, "entries": len(recent)}


# ── HEALTH TIMELINE ──────────────────────────────────────────────────
@app.get("/timeline")
def get_timeline(days: int = 7, key=Depends(require_key)):
    """Unified chronological view across food, workouts, sleep, metrics, routines."""
    events = []
    for i in range(days):
        d = (date.today() - timedelta(days=i)).isoformat()

        # Food
        content = read_food_file(d)
        day_kcal = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
        if day_kcal > 0:
            entries = parse_entries(content)
            events.append({"date": d, "type": "food", "summary": f"{day_kcal} kcal logged", "detail": f"{len(entries)} meals", "value": day_kcal})

        # Workouts
        workouts = load_workouts()
        day_workouts = [w for w in workouts if w.get("start_time", "").startswith(d)]
        for w in day_workouts:
            events.append({"date": d, "type": "workout", "summary": w["title"], "detail": f"{len(w.get('exercises', []))} exercises"})

        # Sleep
        sleep_entries = load_sleep()
        day_sleep = [s for s in sleep_entries if s.get("date") == d]
        for s in day_sleep:
            qual_label = ["", "Poor", "Fair", "OK", "Good", "Great"][s.get("quality", 3)]
            events.append({"date": d, "type": "sleep", "summary": f"{s['duration_hrs']}h sleep ({qual_label})", "detail": f"HRV: {s.get('hrv_ms', '?')} ms" if s.get("hrv_ms") else None})

        # Body metrics
        metrics = load_metrics()
        day_metrics = [m for m in metrics if m.get("date") == d]
        for m in day_metrics:
            parts = []
            if "weight_kg" in m: parts.append(f"{m['weight_kg']}kg")
            if "body_fat_pct" in m: parts.append(f"{m['body_fat_pct']}% BF")
            if parts:
                events.append({"date": d, "type": "metric", "summary": " · ".join(parts)})

        # Routines
        routines_data = load_routines()
        for rname, rdata in routines_data.items():
            for entry in rdata.get("log", []):
                if entry.get("date") == d:
                    events.append({"date": d, "type": "routine", "summary": rname.replace("-", " ").title()})

    events.sort(key=lambda e: e["date"], reverse=True)
    return {"events": events, "days": days}


# ── BARCODE SCANNER (nutrition lookup) ────────────────────────────────
@app.get("/barcode/{code}")
def barcode_lookup(code: str, key=Depends(require_key)):
    """Look up a barcode via Open Food Facts (free, no API key needed)."""
    import urllib.request
    url = f"https://world.openfoodfacts.org/api/v2/product/{code}.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HealthHub/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Open Food Facts lookup failed: {e}")

    if data.get("status") != 1:
        raise HTTPException(status_code=404, detail="Product not found")

    product = data.get("product", {})
    nutrients = product.get("nutriments", {})
    return {
        "code": code,
        "name": product.get("product_name", "Unknown"),
        "brand": product.get("brands", ""),
        "serving_size": product.get("serving_size", ""),
        "per_100g": {
            "kcal": nutrients.get("energy-kcal_100g", 0),
            "protein_g": nutrients.get("proteins_100g", 0),
            "carbs_g": nutrients.get("carbohydrates_100g", 0),
            "fat_g": nutrients.get("fat_100g", 0),
            "fiber_g": nutrients.get("fiber_100g", 0),
            "sugar_g": nutrients.get("sugars_100g", 0),
            "salt_g": nutrients.get("salt_100g", 0),
        },
        "image_url": product.get("image_front_url", ""),
    }


# ── WITHINGS OAUTH STUB ─────────────────────────────────────────────
# Placeholder for Withings integration. Requires:
# 1. Withings Body Smart scale (~£90 purchase)
# 2. Withings developer account + OAuth2 credentials
# The scaffold below handles the OAuth flow; actual data sync
# will activate once credentials + scale are available.

WITHINGS_FILE = DATA_DIR / "withings_config.json"

@app.get("/withings/status")
def withings_status(key=Depends(require_key)):
    if WITHINGS_FILE.exists():
        try:
            config = json.loads(WITHINGS_FILE.read_text())
            return {"connected": bool(config.get("access_token")), "last_sync": config.get("last_sync")}
        except Exception:
            pass
    return {"connected": False, "last_sync": None, "message": "Withings integration not configured. Requires Withings Body Smart scale + OAuth setup."}

@app.get("/withings/auth-url")
def withings_auth_url(key=Depends(require_key)):
    """Generate OAuth2 authorization URL for Withings. Needs client_id in config."""
    if WITHINGS_FILE.exists():
        try:
            config = json.loads(WITHINGS_FILE.read_text())
            client_id = config.get("client_id")
            if client_id:
                redirect_uri = config.get("redirect_uri", "https://health-hub-dwz.pages.dev/withings-callback")
                return {"url": f"https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id={client_id}&scope=user.metrics&redirect_uri={redirect_uri}&state=healthhub"}
        except Exception:
            pass
    return {"url": None, "message": "Configure Withings client_id first. Purchase scale + register at developer.withings.com."}
