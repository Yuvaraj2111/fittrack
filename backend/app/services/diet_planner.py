"""Diet planner: nutrition targets, a built-in regional planner, and an optional AI planner.

Flow: answers (DietIntakeIn) -> targets() -> plan_week().
plan_week() asks Claude for each day in parallel when an API key is configured and
falls back to the built-in regional food library per day if the AI is unavailable,
so a plan is always produced. Nothing here writes to the database.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx

from ..core.config import get_settings
from ..schemas import DietIntakeIn

log = logging.getLogger("fittrack.diet")

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_NAME = dict(zip(DAYS, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]))
ALL_SLOTS = ["breakfast", "morning snack", "lunch", "evening snack", "dinner"]
SLOT_SHARE = {
    5: {"breakfast": .25, "morning snack": .10, "lunch": .30, "evening snack": .10, "dinner": .25},
    4: {"breakfast": .25, "lunch": .35, "evening snack": .10, "dinner": .30},
    3: {"breakfast": .30, "lunch": .40, "dinner": .30},
}
DIET_RANK = {"vegan": 0, "veg": 1, "egg": 2, "nonveg": 3}
REGIONS = {
    "tamil": ("south", "Tamil Nadu"), "kerala": ("south", "Kerala"), "karnataka": ("south", "Karnataka"),
    "andhra": ("south", "Andhra Pradesh / Telangana"), "south": ("south", "South India"),
    "north": ("north", "North India"), "punjab": ("north", "Punjab"), "east": ("east", "East India / Bengal"),
    "west": ("west", "Gujarat / Maharashtra"), "pan": ("all", "pan-Indian"), "intl": ("intl", "continental"),
}


# ------------------------------------------------------------------ targets
def targets(i: DietIntakeIn) -> dict[str, Any]:
    notes: list[str] = []
    h_m = i.height_cm / 100
    bmi = i.weight_kg / (h_m * h_m)
    band = "underweight" if bmi < 18.5 else "healthy" if bmi < 23 else "overweight" if bmi < 27.5 else "obese"  # Asian cut-offs
    sex_term = {"male": 5, "female": -161, "other": -78}[i.sex]
    bmr = 10 * i.weight_kg + 6.25 * i.height_cm - 5 * i.age + sex_term  # Mifflin-St Jeor
    base = {"desk": 1.2, "on_feet": 1.3, "physical": 1.45}[i.daily_activity]
    factor = min(base + 0.05 * i.workout_days, 1.9)
    tdee = bmr * factor

    goal = i.goal
    if goal == "lose" and bmi < 18.5:
        goal = "maintain"
        notes.append("Your BMI is in the underweight range, so the plan maintains weight instead of creating a deficit.")
    if goal == "lose":
        cut = {"gentle": .12, "steady": .20}[i.pace]
        calories = tdee * (1 - cut)
        notes.append(f"About {int(cut * 100)}% below maintenance for steady, sustainable fat loss.")
    elif goal == "gain":
        calories = tdee + {"gentle": 250, "steady": 400}[i.pace]
        notes.append("A small surplus, paired with strength training, favours muscle over fat.")
    else:
        calories = tdee
    floor = {"male": 1500, "female": 1200, "other": 1350}[i.sex]
    if calories < floor:
        calories = floor
        notes.append(f"Raised to a safe minimum of {floor} kcal per day.")
    calories = int(round(calories / 10) * 10)

    # Protein on a reference weight (BMI 23) when weight is high, so targets stay realistic.
    ref_weight = min(i.weight_kg, 23 * h_m * h_m) if bmi > 27.5 else i.weight_kg
    per_kg = 1.6 if (i.goal != "maintain" or i.workout_days >= 3) else 1.2
    protein = round(ref_weight * per_kg)
    fat = round(calories * .27 / 9)
    carbs = max(round((calories - protein * 4 - fat * 9) / 4), 50)
    fiber = round(calories / 1000 * 14)
    shares = SLOT_SHARE[i.meals_per_day]
    return {
        "bmi": round(bmi, 1), "bmi_band": band, "bmr": int(bmr), "tdee": int(tdee), "calories": calories,
        "protein_g": protein, "carbs_g": carbs, "fat_g": fat, "fiber_g": fiber,
        "slots": {slot: int(round(calories * share / 10) * 10) for slot, share in shares.items()},
        "notes": notes,
    }


# ------------------------------------------------------------- food library
# (name, portion, kcal, protein, carbs, fat, slots, diet, regions, contains)
# slots: B breakfast, S snack, L lunch, D dinner. diet: vegan < veg < egg < nonveg.
F = [
    # South breakfast
    ("Idli with sambar", "3 idlis + 1 cup sambar", 320, 11, 58, 4, "B", "vegan", "south", ""),
    ("Ragi dosa with coconut chutney", "2 dosas + 2 tbsp chutney", 300, 8, 48, 8, "BD", "vegan", "south", "coconut"),
    ("Ven pongal with sambar", "1 bowl + 1 cup sambar", 380, 11, 52, 13, "B", "veg", "south", "ghee"),
    ("Pesarattu with ginger chutney", "2 pesarattu", 320, 16, 44, 8, "B", "vegan", "south", ""),
    ("Vegetable rava upma", "1 bowl", 300, 8, 45, 9, "B", "vegan", "south west", "gluten"),
    ("Appam with vegetable stew", "2 appams + 1 cup stew", 340, 7, 55, 10, "BD", "vegan", "south", "coconut"),
    ("Puttu with kadala curry", "1 puttu + 1 cup curry", 420, 15, 70, 8, "B", "vegan", "south", "coconut"),
    ("Egg dosa with chutney", "2 egg dosas", 380, 18, 44, 14, "B", "egg", "south", "egg"),
    ("Oats idli with tomato chutney", "4 idlis", 260, 10, 42, 5, "B", "veg", "south", "gluten"),
    ("Adai with avial", "2 adai + 1/2 cup avial", 400, 17, 56, 12, "B", "veg", "south", "coconut milk"),
    ("Paneer dosa with sambar", "2 dosas + 1 cup sambar", 450, 22, 54, 16, "B", "veg", "south", "milk"),
    ("Moong dal idli with sambar", "4 idlis + 1 cup sambar", 340, 18, 52, 5, "B", "vegan", "south", ""),
    # North / West / East breakfast
    ("Vegetable poha with peanuts", "1 plate", 300, 7, 48, 9, "B", "vegan", "west north east", "peanut"),
    ("Besan chilla with mint chutney", "2 chillas", 300, 14, 34, 11, "B", "vegan", "north west", ""),
    ("Moong dal chilla with paneer", "2 chillas", 340, 20, 36, 12, "B", "veg", "north west", "milk"),
    ("Paneer paratha with curd", "1 paratha + 1/2 cup curd", 420, 17, 48, 17, "B", "veg", "north", "milk gluten"),
    ("Egg bhurji with rotis", "2 eggs + 2 rotis", 400, 20, 42, 16, "B", "egg", "north west all", "egg gluten"),
    ("Daliya porridge with milk", "1 bowl", 290, 11, 48, 6, "B", "veg", "north all", "milk gluten"),
    ("Methi thepla with curd", "2 theplas + 1/2 cup curd", 360, 11, 46, 14, "B", "veg", "west", "milk gluten"),
    ("Sattu paratha with curd", "1 paratha + 1/2 cup curd", 390, 15, 52, 12, "B", "veg", "east north", "milk gluten"),
    ("Chira (flattened rice) with curd and banana", "1 bowl", 330, 9, 62, 5, "B", "veg", "east", "milk"),
    # International breakfast
    ("Oats with milk, banana and nuts", "1 bowl", 340, 13, 52, 9, "B", "veg", "intl all", "milk nuts gluten"),
    ("Masala omelette with toast", "3 eggs + 2 slices", 420, 24, 30, 22, "B", "egg", "intl all", "egg gluten"),
    ("Greek yogurt bowl with fruit and seeds", "1 bowl", 300, 18, 32, 11, "B", "veg", "intl", "milk"),
    ("Peanut butter toast with banana", "2 slices + 1 banana", 400, 13, 55, 15, "B", "vegan", "intl", "peanut gluten"),
    # Snacks
    ("Roasted chana", "40 g", 150, 8, 22, 2, "S", "vegan", "all", ""),
    ("Sprouts chaat", "1 cup", 160, 10, 24, 2, "S", "vegan", "all", ""),
    ("Chana sundal", "1 cup", 180, 9, 27, 4, "S", "vegan", "south", "coconut"),
    ("Masala buttermilk", "1 glass", 60, 3, 5, 3, "S", "veg", "all", "milk"),
    ("Seasonal fruit bowl", "1 bowl", 120, 2, 28, 1, "S", "vegan", "all", ""),
    ("Banana with almonds", "1 banana + 10 almonds", 170, 4, 28, 6, "S", "vegan", "all", "nuts"),
    ("Roasted makhana", "30 g", 120, 3, 20, 3, "S", "veg", "north east all", "ghee"),
    ("Curd with fruit", "1 cup", 160, 7, 22, 4, "S", "veg", "all", "milk"),
    ("Boiled eggs", "2 eggs", 140, 12, 1, 10, "S", "egg", "all", "egg"),
    ("Roasted peanuts", "30 g", 170, 8, 5, 14, "S", "vegan", "all", "peanut"),
    ("Paneer tikka", "100 g", 260, 18, 6, 18, "S", "veg", "north all", "milk"),
    ("Chicken tikka", "120 g", 210, 30, 4, 8, "S", "nonveg", "north all", ""),
    ("Khaman dhokla", "4 pieces", 160, 6, 26, 4, "S", "vegan", "west", ""),
    ("Ragi malt", "1 glass", 180, 6, 30, 4, "S", "veg", "south", "milk"),
    ("Sattu drink", "1 glass", 160, 9, 26, 2, "S", "vegan", "east north", ""),
    ("Tender coconut water", "1 coconut", 50, 1, 11, 0, "S", "vegan", "south", "coconut"),
    ("Steamed sweet corn", "1 cup", 130, 4, 27, 2, "S", "vegan", "all", ""),
    ("Milk with a pinch of turmeric", "1 glass", 150, 8, 12, 8, "S", "veg", "all", "milk"),
    ("Soya chunk sundal", "1 cup", 190, 18, 16, 5, "S", "vegan", "south all", "soy"),
    ("Hung curd with fruit and seeds", "1 cup", 190, 15, 18, 6, "S", "veg", "all", "milk"),
    ("Paneer and sprouts salad", "1 bowl", 230, 17, 14, 12, "S", "veg", "all", "milk"),
    ("Egg white bhurji", "4 egg whites + vegetables", 130, 15, 5, 5, "S", "egg", "all", "egg"),
    # South lunch
    ("Rice, sambar, poriyal and curd", "1 plate", 600, 18, 100, 13, "L", "veg", "south", "milk"),
    ("Rice, rasam, kootu and buttermilk", "1 plate", 550, 16, 96, 10, "L", "veg", "south", "milk"),
    ("Kerala red rice, fish curry and thoran", "1 plate", 620, 32, 82, 17, "L", "nonveg", "south", "fish coconut"),
    ("Chicken curry with brown rice", "1 cup curry + 1 cup rice", 620, 36, 70, 20, "LD", "nonveg", "south all", ""),
    ("Bisi bele bath with raita", "1 bowl + 1/2 cup raita", 520, 16, 82, 14, "L", "veg", "south", "milk"),
    ("Thinai (foxtail millet) rice with sambar and keerai", "1 plate", 520, 18, 88, 10, "L", "vegan", "south", ""),
    ("Pappu, rice and vegetable fry", "1 plate", 580, 20, 96, 12, "L", "vegan", "south", ""),
    ("Egg curry with rice", "2 eggs + 1 cup rice", 600, 22, 82, 19, "L", "egg", "south all", "egg"),
    ("Lemon rice with vegetable kootu", "1.5 cups + 1 cup kootu", 560, 15, 92, 14, "L", "vegan", "south", ""),
    ("Sambar rice with beans poriyal", "1.5 cups + 1/2 cup poriyal", 560, 17, 94, 11, "L", "vegan", "south", ""),
    ("Kerala red rice with kadala curry and cabbage thoran", "1 plate", 580, 20, 96, 12, "L", "vegan", "south", "coconut"),
    ("Chicken biryani (home-style) with raita", "1.5 cups + 1/2 cup raita", 640, 32, 78, 20, "L", "nonveg", "south north", "milk"),
    # North / West / East lunch
    ("Rotis, dal, sabzi and salad", "3 rotis + 1 bowl dal", 560, 20, 86, 14, "L", "vegan", "north west", "gluten"),
    ("Rajma chawal with salad", "1 cup rajma + 1 cup rice", 580, 22, 96, 10, "L", "vegan", "north", ""),
    ("Chole with rotis", "1 cup chole + 2 rotis", 560, 20, 82, 16, "L", "vegan", "north", "gluten"),
    ("Paneer bhurji with rotis and salad", "150 g paneer + 2 rotis", 580, 28, 52, 28, "LD", "veg", "north", "milk gluten"),
    ("Kadhi chawal", "1 cup kadhi + 1 cup rice", 520, 15, 84, 13, "L", "veg", "north west", "milk"),
    ("Chicken curry with rotis", "1 cup curry + 2 rotis", 600, 40, 52, 24, "LD", "nonveg", "north", "gluten"),
    ("Vegetable pulao with raita", "1.5 cups + 1/2 cup raita", 500, 13, 80, 13, "L", "veg", "north all", "milk"),
    ("Gujarati thali (rotli, dal, shaak, rice)", "1 plate", 600, 19, 98, 14, "L", "veg", "west", "gluten ghee"),
    ("Jowar bhakri with pithla and salad", "2 bhakri + 1 bowl pithla", 520, 18, 80, 13, "L", "vegan", "west", ""),
    ("Rice, dal and macher jhol", "1 plate", 600, 34, 82, 14, "L", "nonveg", "east", "fish"),
    ("Rice, dal and mixed vegetable shukto", "1 plate", 540, 16, 96, 9, "L", "vegan", "east", ""),
    # International lunch
    ("Grilled chicken salad with whole-wheat wrap", "1 wrap + 1 bowl salad", 520, 38, 44, 20, "LD", "nonveg", "intl", "gluten"),
    ("Quinoa bowl with chickpeas and vegetables", "1 large bowl", 520, 20, 78, 14, "LD", "vegan", "intl", ""),
    # Dinner
    ("Chapatis with vegetable kurma", "2 chapatis + 1 cup kurma", 420, 11, 58, 16, "D", "veg", "south", "gluten coconut"),
    ("Ragi mudde with sambar", "2 balls + 1 cup sambar", 420, 13, 76, 6, "D", "vegan", "south", ""),
    ("Chapatis with paneer kurma", "2 chapatis + 1 cup kurma", 470, 24, 50, 19, "D", "veg", "south north", "milk gluten"),
    ("Kambu dosa with soya keema", "2 dosas + 1/2 cup keema", 430, 26, 56, 10, "D", "vegan", "south", "soy"),
    ("Idiyappam with vegetable stew", "3 idiyappam + 1 cup stew", 380, 7, 70, 8, "D", "vegan", "south", "coconut"),
    ("Dosa with sambar", "2 dosas + 1 cup sambar", 400, 11, 62, 11, "D", "vegan", "south", ""),
    ("Grilled fish with sautéed vegetables and rice", "150 g fish + 1/2 cup rice", 450, 34, 42, 14, "D", "nonveg", "south east all", "fish"),
    ("Kappa with fish curry", "1 cup kappa + 1 cup curry", 520, 26, 74, 13, "D", "nonveg", "south", "fish coconut"),
    ("Millet vegetable upma", "1 bowl", 360, 10, 58, 9, "D", "vegan", "south all", ""),
    ("Egg curry with chapatis", "2 eggs + 2 chapatis", 450, 20, 46, 20, "D", "egg", "all", "egg gluten"),
    ("Paneer and vegetable stir-fry with a chapati", "120 g paneer + 1 chapati", 420, 22, 30, 22, "D", "veg", "all", "milk gluten"),
    ("Moong dal khichdi with curd", "1.5 cups + 1/2 cup curd", 450, 17, 72, 10, "D", "veg", "north west east all", "milk"),
    ("Palak paneer with rotis", "1 cup + 2 rotis", 480, 22, 48, 22, "D", "veg", "north", "milk gluten"),
    ("Dal tadka with rotis and salad", "1 bowl dal + 2 rotis", 430, 17, 66, 10, "D", "vegan", "north west", "gluten"),
    ("Soya chunk curry with rotis", "1 cup + 2 rotis", 430, 30, 56, 8, "D", "vegan", "north all", "gluten soy"),
    ("Tandoori chicken with salad and a roti", "200 g + 1 roti", 450, 48, 22, 16, "D", "nonveg", "north", "gluten"),
    ("Vegetable dalia khichdi", "1.5 cups", 380, 12, 66, 7, "D", "vegan", "north west", "gluten"),
    ("Grilled chicken with roasted vegetables", "150 g + 1 bowl", 430, 42, 22, 18, "D", "nonveg", "intl", ""),
    ("Tofu stir-fry with brown rice", "150 g tofu + 3/4 cup rice", 450, 22, 58, 14, "D", "vegan", "intl", "soy"),
    ("Lentil soup with toast", "1 large bowl + 2 slices", 400, 20, 58, 9, "D", "vegan", "intl", "gluten"),
]
SLOT_CODE = {"breakfast": "B", "morning snack": "S", "evening snack": "S", "lunch": "L", "dinner": "D"}
ALLERGEN_WORDS = {"dairy": "milk", "lactose": "milk", "paneer": "milk", "curd": "milk", "peanuts": "peanut",
                  "eggs": "egg", "wheat": "gluten", "nut": "nuts", "seafood": "fish", "prawn": "fish"}


def _words(text: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", (text or "").lower()) if len(w) > 2}


def _avoid_terms(i: DietIntakeIn) -> set[str]:
    terms = _words(i.avoid)
    return terms | {ALLERGEN_WORDS[t] for t in terms if t in ALLERGEN_WORDS}


def _blocked(name: str, contains: str, avoid: set[str]) -> bool:
    haystack = _words(name) | set(contains.split())
    return bool(haystack & avoid) or any(a in name.lower() for a in avoid if len(a) > 3)


_FRACTION = {0.25: "¼", 0.5: "½", 0.75: "¾"}


def _fmt_qty(x: float) -> str:
    x = float(int(x + 0.5)) if x >= 3 else round(x * 4) / 4
    whole, frac = int(x), round(x - int(x), 2)
    return (str(whole) if whole else "") + _FRACTION.get(frac, "") or "¼"


def _scale_portion(portion: str, m: float) -> str:
    """'2 dosas + 1/2 cup sambar' x1.5 -> '3 dosas + ¾ cup sambar'."""
    if m == 1.0:
        return portion
    def repl(match: re.Match) -> str:
        a, b = match.group(1), match.group(2)
        value = float(a) / float(b) if b else float(a)
        return _fmt_qty(value * m)
    return re.sub(r"(\d+(?:\.\d+)?)(?:/(\d+))?", repl, portion)


def _scaled(food: tuple, target: int) -> dict[str, Any]:
    name, portion, kcal, p, c, f = food[:6]
    m = min((0.75, 1.0, 1.25, 1.5, 2.0), key=lambda x: abs(kcal * x - target)) if target else 1.0
    return {"food_name": name, "portion": _scale_portion(portion, m)[:80], "calories": round(kcal * m),
            "protein_g": round(p * m, 1), "carbs_g": round(c * m, 1), "fat_g": round(f * m, 1)}


def builtin_day(i: DietIntakeIn, t: dict[str, Any], day: str) -> list[dict[str, Any]]:
    region = REGIONS.get(i.region, ("all", ""))[0]
    rank, avoid, likes = DIET_RANK[i.diet_type], _avoid_terms(i), _words(i.likes) | _words(i.usual_foods)
    offset = DAYS.index(day)
    protein_weight = max(0.0, t["protein_g"] * 4 / t["calories"] - 0.12) * 8
    items, used = [], set()
    for slot_i, (slot, kcal) in enumerate(t["slots"].items()):
        pool = [f for f in F if SLOT_CODE[slot] in f[6] and DIET_RANK[f[7]] <= rank and not _blocked(f[0], f[9], avoid)]
        local = [f for f in pool if region in f[8].split() or "all" in f[8].split()]
        if len(local) >= 2:  # stay within the person's cuisine whenever it has enough options
            pool = local
        sized = [f for f in pool if abs(_scaled(f, kcal)["calories"] - kcal) <= kcal * .3]
        if len(sized) >= 2:  # skip items that can't reasonably fill this slot
            pool = sized
        def score(f):
            regions = f[8].split()
            s = 4 if region in regions else 2 if "all" in regions else 0
            s += 3 * len(_words(f[0]) & likes)
            s -= abs(_scaled(f, kcal)["calories"] - kcal) / 60  # how close it can get to the slot target
            s += protein_weight * (f[3] / f[2] * 100)  # protein per 100 kcal, weighted by how protein-heavy the target is
            return s
        pool.sort(key=score, reverse=True)
        pool = [f for f in pool if f[0] not in used] or pool
        if not pool:
            continue
        top = pool[: min(len(pool), 5)]
        pick = top[(offset + slot_i * 2) % len(top)]
        used.add(pick[0])
        alts = [f for f in top if f is not pick][:2]
        items.append({"day": day, "meal_slot": slot, **_scaled(pick, kcal), "alternatives": [_scaled(a, kcal) for a in alts]})
    return items


# --------------------------------------------------------------------- AI
DAY_PLAN_TOOL = {
    "name": "submit_day_plan",
    "description": "Return the meals for one day of the diet plan.",
    "input_schema": {
        "type": "object",
        "properties": {"meals": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "meal_slot": {"type": "string", "enum": ALL_SLOTS},
                "food_name": {"type": "string"}, "portion": {"type": "string"},
                "calories": {"type": "number"}, "protein_g": {"type": "number"},
                "carbs_g": {"type": "number"}, "fat_g": {"type": "number"},
                "alternatives": {"type": "array", "maxItems": 2, "items": {
                    "type": "object",
                    "properties": {"food_name": {"type": "string"}, "portion": {"type": "string"},
                                   "calories": {"type": "number"}, "protein_g": {"type": "number"},
                                   "carbs_g": {"type": "number"}, "fat_g": {"type": "number"}},
                    "required": ["food_name", "portion", "calories", "protein_g", "carbs_g", "fat_g"]}},
            },
            "required": ["meal_slot", "food_name", "portion", "calories", "protein_g", "carbs_g", "fat_g", "alternatives"],
        }}},
        "required": ["meals"],
    },
}
ROTATION = ["a classic everyday menu", "millets or whole grains", "a pulse- and legume-rich menu",
            "a light, easy-to-digest menu", "a high-protein menu", "a weekend special, still balanced", "a simple home-style menu"]
DIET_LABEL = {"vegan": "vegan (no dairy, egg, meat or fish)", "veg": "vegetarian (dairy allowed; no egg, meat or fish)",
              "egg": "eggetarian (vegetarian plus eggs; no meat or fish)", "nonveg": "non-vegetarian (any)"}

SYSTEM_PROMPT = """You plan practical, home-style meals for people in India, in the way a careful dietitian would.
Use dishes that are common, affordable and easy to find or cook in the person's region, with household portions (pieces, cups, katori, rotis).
Follow the diet type strictly and never include anything the person wants to avoid.
Keep each meal close to its calorie target (within about 10%) and estimate nutrition realistically.
Each meal gets exactly 2 alternatives for the same slot with similar calories, so the person can swap.
Prefer foods the person already eats or likes when they fit. Use plain English dish names (regional names are fine, e.g. "Ragi dosa")."""


def _day_prompt(i: DietIntakeIn, t: dict[str, Any], day: str) -> str:
    region = REGIONS.get(i.region, ("all", i.region))[1]
    slots = "\n".join(f"- {s}: about {k} kcal" for s, k in t["slots"].items())
    workout = f"{i.workout_days} days/week" + (f" ({', '.join(i.workout_types)})" if i.workout_types else "") + f", usually {i.workout_time}"
    return f"""Plan {DAY_NAME[day]} (day {DAYS.index(day) + 1} of 7). Theme for variety: {ROTATION[DAYS.index(day)]}.

Person: {i.age} y, {i.sex}, {i.height_cm:.0f} cm, {i.weight_kg:.1f} kg. Goal: {i.goal} weight.
Training: {workout}. {('Routine: ' + i.workout_notes) if i.workout_notes else ''}
Region / cuisine: {region}. Diet: {DIET_LABEL[i.diet_type]}.
Usually eats: {i.usual_foods or 'not given'}
Likes: {i.likes or 'not given'}
Must avoid: {i.avoid or 'nothing specific'}
Other notes: {i.notes or 'none'}

Daily target {t['calories']} kcal, protein {t['protein_g']} g, carbs {t['carbs_g']} g, fat {t['fat_g']} g.
One dish per slot, these slots only:
{slots}
If they train in the {i.workout_time}, make the meal or snack around that time suitable for training.
Call submit_day_plan with the meals."""


def _num(v: Any, hi: float) -> float:
    try:
        return max(0.0, min(float(v), hi))
    except (TypeError, ValueError):
        return 0.0


def _clean(meal: dict[str, Any]) -> dict[str, Any]:
    return {"food_name": str(meal.get("food_name", "")).strip()[:180], "portion": (str(meal.get("portion") or "").strip()[:80] or None),
            "calories": round(_num(meal.get("calories"), 5000)), "protein_g": round(_num(meal.get("protein_g"), 500), 1),
            "carbs_g": round(_num(meal.get("carbs_g"), 900), 1), "fat_g": round(_num(meal.get("fat_g"), 400), 1)}


async def ai_day(client: httpx.AsyncClient, i: DietIntakeIn, t: dict[str, Any], day: str) -> list[dict[str, Any]]:
    settings = get_settings()
    response = await client.post("https://api.anthropic.com/v1/messages", json={
        "model": settings.ai_model, "max_tokens": 3000, "system": SYSTEM_PROMPT,
        "tools": [DAY_PLAN_TOOL], "tool_choice": {"type": "tool", "name": "submit_day_plan"},
        "messages": [{"role": "user", "content": _day_prompt(i, t, day)}],
    }, headers={"x-api-key": settings.anthropic_api_key or "", "anthropic-version": "2023-06-01"})
    response.raise_for_status()
    block = next(b for b in response.json()["content"] if b.get("type") == "tool_use")
    avoid, allowed = _avoid_terms(i), set(t["slots"])
    items, seen = [], set()
    for meal in block["input"].get("meals", []):
        slot = meal.get("meal_slot")
        if slot not in allowed or slot in seen:
            continue
        main = _clean(meal)
        if not main["food_name"] or _blocked(main["food_name"], "", avoid):
            continue
        alts = [a for a in (_clean(x) for x in (meal.get("alternatives") or [])[:2]) if a["food_name"] and not _blocked(a["food_name"], "", avoid)]
        seen.add(slot)
        items.append({"day": day, "meal_slot": slot, **main, "alternatives": alts})
    if len(seen) < len(allowed):  # fill any slot the model skipped
        for extra in builtin_day(i, t, day):
            if extra["meal_slot"] not in seen:
                items.append(extra)
    items.sort(key=lambda x: ALL_SLOTS.index(x["meal_slot"]))
    return items


def ai_enabled() -> bool:
    return bool(get_settings().anthropic_api_key)


def _protein_check(items: list[dict[str, Any]], days: list[str], t: dict[str, Any], warnings: list[str]) -> None:
    avg = sum(x["protein_g"] for x in items) / max(len(days), 1)
    if avg < t["protein_g"] * .8:
        warnings.append(f"This plan averages about {round(avg)} g protein a day against a {t['protein_g']} g target. "
                        "Swap in higher-protein options (paneer, curd, sprouts, soya, eggs or dal) or add a protein snack.")


async def plan_days(i: DietIntakeIn, days: list[str]) -> dict[str, Any]:
    t = targets(i)
    warnings: list[str] = []
    if not ai_enabled():
        items = [x for d in days for x in builtin_day(i, t, d)]
        _protein_check(items, days, t, warnings)
        return {"source": "builtin", "targets": t, "items": items, "warnings": warnings}
    async with httpx.AsyncClient(timeout=httpx.Timeout(55.0, connect=10.0)) as client:
        results = await asyncio.gather(*(ai_day(client, i, t, d) for d in days), return_exceptions=True)
    items, failed = [], []
    for day, result in zip(days, results):
        if isinstance(result, Exception):
            log.warning("AI planning failed for %s: %r", day, result)
            failed.append(DAY_NAME[day])
            items.extend(builtin_day(i, t, day))
        else:
            items.extend(result)
    if failed:
        warnings.append(f"The AI couldn't plan {', '.join(failed)}, so those days use the built-in planner. Try regenerating them.")
    _protein_check(items, days, t, warnings)
    source = "ai" if not failed else ("builtin" if len(failed) == len(days) else "mixed")
    return {"source": source, "targets": t, "items": items, "warnings": warnings}
