"""Workout planner: choose a weekly split, then fill each training day with exercises.

The split and each day's focus always come from the rules below (so the week is
balanced and recovery is respected). With an API key, Claude picks the exercises
for each training day in parallel; otherwise, or if a day fails, the built-in
exercise library fills it. Nothing here writes to the database.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx

from ..core.config import get_settings
from ..schemas import WorkoutIntakeIn
from .diet_planner import DAY_NAME, DAYS

log = logging.getLogger("fittrack.workout")
GROUPS = ["chest", "back", "shoulders", "arms", "legs", "core", "full body", "cardio", "mobility"]

# --------------------------------------------------------------- library
# (name, muscle group, pattern, equipment, level 1-3, joints it loads, coaching cue, timed)
# equipment: base "bw" | "db" | "gym" + optional extras "pullup" "bands" "bench" "cardio".
X = [
    # squat
    ("Barbell back squat", "legs", "squat", "gym", 2, "knee lower_back", "Brace hard, sit between the hips, knees track over toes.", False),
    ("Goblet squat", "legs", "squat", "db", 1, "knee", "Hold the dumbbell at your chest; keep the torso tall.", False),
    ("Leg press", "legs", "squat", "gym", 1, "knee", "Lower until hips start to tuck, then press through the heels.", False),
    ("Bodyweight squat", "legs", "squat", "bw", 1, "knee", "Arms forward for balance; full control on the way down.", False),
    ("Box squat to a chair", "legs", "squat", "bw", 1, "", "Sit back to touch the chair lightly, then stand. Knee-friendly depth.", False),
    # hinge
    ("Romanian deadlift", "legs", "hinge", "db", 1, "lower_back", "Soft knees, push hips back, keep the weights close to your legs.", False),
    ("Barbell deadlift", "back", "hinge", "gym", 2, "lower_back", "Bar over mid-foot, flat back, push the floor away.", False),
    ("Hip thrust", "legs", "hinge", "db bench", 1, "", "Chin tucked, ribs down, squeeze glutes hard at the top.", False),
    ("Glute bridge", "legs", "hinge", "bw", 1, "", "Drive through the heels; pause one second at the top.", False),
    ("Single-leg Romanian deadlift", "legs", "hinge", "bw", 2, "ankle", "Hips square, reach the free leg back; hold a wall if needed.", False),
    ("Kettlebell / dumbbell swing", "full body", "hinge", "db", 2, "lower_back", "Snap the hips; the arms just guide the weight.", False),
    # lunge
    ("Walking lunge", "legs", "lunge", "db", 1, "knee", "Long steps, back knee kisses the floor.", False),
    ("Bulgarian split squat", "legs", "lunge", "bw", 2, "knee", "Rear foot on a chair; most weight on the front leg.", False),
    ("Reverse lunge", "legs", "lunge", "bw", 1, "knee", "Step back softly; front shin stays fairly upright.", False),
    ("Step-up", "legs", "lunge", "bw", 1, "knee", "Use a sturdy step; drive through the whole front foot.", False),
    ("Lateral lunge", "legs", "lunge", "bw", 1, "knee", "Sit into one hip, other leg straight; chest up.", False),
    # hamstrings / calves
    ("Lying leg curl", "legs", "ham", "gym", 1, "", "Control the lowering for 3 seconds.", False),
    ("Slider / towel leg curl", "legs", "ham", "bw", 2, "", "Hips up in a bridge, slide heels in and out on a towel.", False),
    ("Standing calf raise", "legs", "calf", "bw", 1, "ankle", "Full stretch at the bottom, pause at the top.", False),
    ("Seated calf raise", "legs", "calf", "gym", 1, "", "Slow and full range.", False),
    # horizontal push
    ("Barbell bench press", "chest", "push_h", "gym", 1, "shoulder", "Shoulder blades pinched, feet planted, bar to mid-chest.", False),
    ("Dumbbell bench press", "chest", "push_h", "db bench", 1, "shoulder", "Elbows about 45° from the body.", False),
    ("Dumbbell floor press", "chest", "push_h", "db", 1, "", "Pause the elbows on the floor. Easy on the shoulders.", False),
    ("Machine chest press", "chest", "push_h", "gym", 1, "", "Handles at chest height; full control.", False),
    ("Push-up", "chest", "push_h", "bw", 1, "wrist shoulder", "Body in one straight line; lower the chest to a fist's height.", False),
    ("Incline push-up", "chest", "push_h", "bw", 1, "wrist", "Hands on a bench or wall; easier than floor push-ups.", False),
    ("Incline dumbbell press", "chest", "push_h", "db bench", 1, "shoulder", "Bench at 30°; lower to the upper chest.", False),
    # vertical push
    ("Seated dumbbell shoulder press", "shoulders", "push_v", "db", 1, "shoulder", "Ribs down; press up and slightly in.", False),
    ("Barbell overhead press", "shoulders", "push_v", "gym", 2, "shoulder lower_back", "Squeeze glutes; bar travels close to the face.", False),
    ("Landmine press", "shoulders", "push_v", "gym", 2, "", "Press up and forward; shoulder-friendly angle.", False),
    ("Pike push-up", "shoulders", "push_v", "bw", 2, "shoulder wrist", "Hips high; lower the head between the hands.", False),
    ("Band overhead press", "shoulders", "push_v", "bw bands", 1, "shoulder", "Stand on the band; press without arching.", False),
    # shoulders accessory
    ("Lateral raise", "shoulders", "delt", "db", 1, "", "Lead with the elbows; stop at shoulder height.", False),
    ("Face pull", "shoulders", "delt", "gym", 1, "", "Pull to the forehead, elbows high, squeeze the upper back.", False),
    ("Band face pull", "shoulders", "delt", "bw bands", 1, "", "Pull to the forehead, elbows high.", False),
    ("Rear-delt fly", "shoulders", "delt", "db", 1, "", "Hinge forward; open the arms wide with soft elbows.", False),
    # vertical pull
    ("Lat pulldown", "back", "pull_v", "gym", 1, "", "Pull the bar to the upper chest; elbows to the ribs.", False),
    ("Pull-up", "back", "pull_v", "bw pullup", 2, "shoulder", "Dead hang to chin over bar; no swinging.", False),
    ("Band-assisted pull-up", "back", "pull_v", "bw pullup bands", 1, "shoulder", "Loop a band under the knee for help.", False),
    ("Negative pull-up", "back", "pull_v", "bw pullup", 1, "shoulder", "Jump to the top, lower yourself over 4–5 seconds.", False),
    ("Band lat pulldown", "back", "pull_v", "bw bands", 1, "", "Anchor the band high; pull elbows down to the ribs.", False),
    # horizontal pull
    ("Seated cable row", "back", "pull_h", "gym", 1, "", "Chest tall; squeeze shoulder blades together.", False),
    ("One-arm dumbbell row", "back", "pull_h", "db", 1, "", "Support on a bench or chair; pull to the hip.", False),
    ("Chest-supported dumbbell row", "back", "pull_h", "db bench", 1, "", "Lie face-down on an incline bench; easy on the lower back.", False),
    ("Barbell row", "back", "pull_h", "gym", 2, "lower_back", "Hinge to 45°; pull to the lower ribs.", False),
    ("Inverted row under a table", "back", "pull_h", "bw", 1, "", "Lie under a sturdy table, grip the edge, pull chest up.", False),
    ("Band row", "back", "pull_h", "bw bands", 1, "", "Anchor at chest height; elbows close to the body.", False),
    # arms
    ("Dumbbell biceps curl", "arms", "biceps", "db", 1, "", "Elbows pinned; no swinging.", False),
    ("Hammer curl", "arms", "biceps", "db", 1, "", "Palms facing each other.", False),
    ("Cable curl", "arms", "biceps", "gym", 1, "", "Constant tension; slow lowering.", False),
    ("Band curl", "arms", "biceps", "bw bands", 1, "", "Stand on the band; full range.", False),
    ("Triceps pushdown", "arms", "triceps", "gym", 1, "", "Elbows fixed at your sides.", False),
    ("Overhead dumbbell triceps extension", "arms", "triceps", "db", 1, "shoulder", "Elbows point forward; deep stretch.", False),
    ("Bench dip", "arms", "triceps", "bw", 1, "shoulder wrist", "Shoulders down; lower only to 90°.", False),
    ("Close-grip push-up", "arms", "triceps", "bw", 1, "wrist", "Hands under the shoulders; elbows brush the ribs.", False),
    ("Band triceps pushdown", "arms", "triceps", "bw bands", 1, "", "Anchor high; lock elbows at your sides.", False),
    # core / carry
    ("Plank", "core", "core", "bw", 1, "", "Squeeze glutes, ribs down; breathe.", True),
    ("Dead bug", "core", "core", "bw", 1, "", "Lower back pressed into the floor the whole time.", False),
    ("Side plank", "core", "core", "bw", 1, "shoulder", "Hips high; stack the feet or stagger them.", True),
    ("Bird dog", "core", "core", "bw", 1, "", "Reach long; keep the hips level. Back-friendly.", False),
    ("Hanging knee raise", "core", "core", "bw pullup", 2, "shoulder", "Curl the pelvis up; no swinging.", False),
    ("Farmer's carry", "full body", "carry", "db", 1, "", "Heavy weights, tall posture, short steps.", True),
    # power / rotation (sport)
    ("Box jump", "legs", "power", "bw", 2, "knee ankle", "Land softly; step down, don't jump down.", False),
    ("Broad jump", "legs", "power", "bw", 2, "knee ankle", "Swing the arms, land quietly, reset each rep.", False),
    ("Medicine-ball rotational throw", "core", "rotation", "gym", 2, "lower_back", "Turn from the hips; throw against a wall.", False),
    ("Band woodchop", "core", "rotation", "bw bands", 1, "", "Rotate through the hips, arms long.", False),
    ("Lateral shuffle and sprint", "full body", "power", "bw", 1, "ankle knee", "Low stance; 10 m shuffle then 10 m sprint.", False),
    # cardio / conditioning / mobility (timed, minutes)
    ("Brisk or incline walk", "cardio", "cardio", "bw", 1, "", "Pace where you can talk but not sing.", True),
    ("Easy jog", "cardio", "cardio", "bw", 1, "knee ankle", "Conversational pace.", True),
    ("Stationary bike", "cardio", "cardio", "bw cardio", 1, "", "Steady pace; light resistance. Joint-friendly.", True),
    ("Cycling outdoors", "cardio", "cardio", "bw", 1, "", "Steady, comfortable pace.", True),
    ("Swimming", "cardio", "cardio", "bw", 1, "", "Easy laps; rest at the wall as needed.", True),
    ("Rowing machine", "cardio", "cardio", "gym", 1, "lower_back", "Legs, then body, then arms.", True),
    ("Elliptical", "cardio", "cardio", "gym", 1, "", "Low-impact steady effort.", True),
    ("Skipping rope", "cardio", "cardio", "bw", 2, "ankle knee", "Small hops on the balls of the feet.", True),
    ("Circuit: jumping jacks, mountain climbers, squats", "full body", "conditioning", "bw", 1, "wrist knee", "40 s work, 20 s rest, repeat the round.", True),
    ("Circuit: shadow boxing and step-back lunges", "full body", "conditioning", "bw", 1, "", "Low-impact. 40 s work, 20 s rest.", True),
    ("Circuit: swings, push-ups, rows", "full body", "conditioning", "db", 2, "lower_back wrist", "Move steadily; 45 s each, 15 s rest.", True),
    ("Burpee intervals", "full body", "conditioning", "bw", 2, "wrist knee", "20 s fast, 40 s easy.", True),
    ("Hip and upper-back mobility flow", "mobility", "mobility", "bw", 1, "", "Slow, controlled breathing through each position.", True),
    ("Yoga flow (sun salutations and stretches)", "mobility", "mobility", "bw", 1, "wrist", "Move with the breath.", True),
]
WARMUP = {"exercise": "Warm-up: easy cardio + dynamic stretches", "muscle_group": "mobility", "sets": 0, "reps": None,
          "duration_minutes": 6, "rest_seconds": None, "notes": "Arm circles, leg swings, hip openers, then 2 light sets of the first exercise."}

TEMPLATES: dict[str, list[str]] = {
    "Full body A": ["squat", "push_h", "pull_h", "hinge", "core", "delt", "biceps", "calf"],
    "Full body B": ["hinge", "push_v", "pull_v", "lunge", "core", "triceps", "ham", "carry"],
    "Full body C": ["lunge", "push_h", "pull_v", "hinge", "carry", "core", "delt", "triceps"],
    "Upper body A": ["push_h", "pull_h", "push_v", "pull_v", "triceps", "biceps", "delt", "core"],
    "Upper body B": ["push_v", "pull_v", "push_h", "pull_h", "delt", "biceps", "triceps", "core"],
    "Lower body A": ["squat", "hinge", "lunge", "ham", "calf", "core", "carry", "core"],
    "Lower body B": ["hinge", "squat", "lunge", "calf", "core", "ham", "core", "carry"],
    "Push": ["push_h", "push_v", "push_h", "delt", "triceps", "triceps", "core", "delt"],
    "Pull": ["pull_v", "pull_h", "hinge", "pull_h", "biceps", "delt", "biceps", "core"],
    "Legs": ["squat", "hinge", "lunge", "ham", "calf", "core", "lunge", "core"],
    "Chest and triceps": ["push_h", "push_h", "push_v", "triceps", "triceps", "core", "delt", "push_h"],
    "Back and biceps": ["pull_v", "pull_h", "pull_h", "biceps", "biceps", "delt", "core", "hinge"],
    "Shoulders and core": ["push_v", "delt", "delt", "core", "core", "carry", "push_v", "core"],
    "Arms and conditioning": ["biceps", "triceps", "biceps", "triceps", "conditioning", "core", "biceps", "triceps"],
    "Conditioning": ["conditioning", "conditioning", "core", "carry", "core", "cardio", "core", "conditioning"],
    "Cardio and mobility": ["cardio", "mobility", "core", "cardio", "mobility", "core", "core", "mobility"],
    "Athletic": ["power", "squat", "pull_h", "rotation", "lunge", "core", "push_h", "power"],
    "Active recovery": ["cardio", "mobility", "core", "mobility", "cardio", "core", "core", "mobility"],
}
FALLBACK = {"squat": "hinge", "lunge": "hinge", "power": "hinge", "push_v": "push_h", "push_h": "push_v", "pull_v": "pull_h",
            "pull_h": "pull_v", "hinge": "core", "calf": "core", "ham": "hinge", "delt": "pull_h", "rotation": "core",
            "biceps": "pull_h", "triceps": "push_h", "carry": "core", "conditioning": "cardio", "cardio": "mobility"}
STRENGTH_PATTERNS = {"squat", "hinge", "push_h", "push_v", "pull_h", "pull_v", "lunge"}
SPLIT_LABEL = {"full_body": "Full body", "upper_lower": "Upper / lower", "ppl": "Push / pull / legs", "body_part": "Body-part split"}
INJURY_LABEL = {"knee": "knee", "lower_back": "lower back", "shoulder": "shoulder", "wrist": "wrist", "neck": "neck", "ankle": "ankle"}


def _allowed(ex: tuple, i: WorkoutIntakeIn) -> bool:
    parts = ex[3].split()
    bases = {"gym": {"bw", "db", "gym"}, "dumbbells": {"bw", "db"}, "bodyweight": {"bw"}}[i.equipment]
    if parts[0] not in bases:
        return False
    have = {"pullup", "bands", "bench", "cardio"} if i.equipment == "gym" else {
        {"pullup_bar": "pullup", "cardio_machine": "cardio"}.get(e, e) for e in i.extras}
    if any(extra not in have for extra in parts[1:]):
        return False
    level = {"beginner": 1, "intermediate": 2, "advanced": 3}[i.experience]
    return ex[4] <= level and not (set(ex[5].split()) & set(i.injuries))


# ---------------------------------------------------------------- split
def split_plan(i: WorkoutIntakeIn) -> tuple[str, dict[str, str], list[str]]:
    days = [d for d in DAYS if d in i.days]
    n = len(days)
    notes: list[str] = []
    split = i.split
    if split == "auto":
        if i.goal == "sport":
            split = "athletic"
        elif i.goal == "endurance":
            split = "endurance"
        elif n <= 3:
            split = "full_body"
        elif n == 4:
            split = "upper_lower"
        elif n == 5:
            split = "ppl_ul" if i.goal in ("muscle", "strength") else "upper_lower_cond"
        else:
            split = "ppl"
    cycles = {
        "full_body": ["Full body A", "Full body B", "Full body C"],
        "upper_lower": ["Upper body A", "Lower body A", "Upper body B", "Lower body B"],
        "upper_lower_cond": ["Upper body A", "Lower body A", "Conditioning", "Upper body B", "Lower body B"],
        "ppl": ["Push", "Pull", "Legs"],
        "ppl_ul": ["Push", "Pull", "Legs", "Upper body B", "Lower body B"],
        "body_part": ["Chest and triceps", "Back and biceps", "Legs", "Shoulders and core", "Arms and conditioning"],
        "athletic": ["Athletic", "Full body A", "Conditioning", "Full body B"],
        "endurance": ["Cardio and mobility", "Full body A", "Cardio and mobility", "Full body B"],
    }[split]
    label = {"upper_lower_cond": "Upper / lower + conditioning", "ppl_ul": "Push / pull / legs + upper / lower",
             "athletic": "Athletic performance", "endurance": "Endurance + strength"}.get(split, SPLIT_LABEL.get(split, split))
    focus = {d: cycles[k % len(cycles)] for k, d in enumerate(days)}
    if n == 7:
        focus[days[-1]] = "Active recovery"
        notes.append("Seven training days: the last one is an easy active-recovery day so you can recover.")
    if i.experience == "beginner" and n >= 6:
        notes.append("As a beginner, 3–4 hard days a week is usually enough. Treat extra days as easy sessions if you feel tired.")
    if i.goal == "fat_loss":
        notes.append("Fat loss comes mostly from your diet; training keeps muscle. Short cardio finishers are added.")
    for d in DAYS:
        focus.setdefault(d, "Rest")
    return label, focus, notes


def _preference(ex: tuple, i: WorkoutIntakeIn) -> float:
    """Prefer the best tools the person has: barbells and machines in a gym, dumbbells at home."""
    parts = ex[3].split()
    base, extras = parts[0], parts[1:]
    if i.equipment == "gym":
        score = {"gym": 2.0, "db": 2.0, "bw": 0.5}[base] - (1.5 if "bands" in extras else 0) + (0.5 if "pullup" in extras else 0)
    elif i.equipment == "dumbbells":
        score = {"db": 2.0, "bw": 0.5, "gym": 0.0}[base] + (0.5 if extras and "bands" not in extras else 0)
    else:
        score = 1.0
    level = {"beginner": 1, "intermediate": 2, "advanced": 3}[i.experience]
    return score + (0.3 if ex[4] == min(level, 2) else 0)


def _prescription(i: WorkoutIntakeIn, pattern: str, main: bool, timed: bool) -> dict[str, Any]:
    if pattern in ("cardio", "mobility", "conditioning"):
        minutes = {"cardio": 25 if i.goal in ("endurance", "fat_loss") else 15, "mobility": 10, "conditioning": 12}[pattern]
        return {"sets": 0, "reps": None, "duration_minutes": minutes, "rest_seconds": None}
    if timed:
        return {"sets": 3, "reps": "30-45s" if i.experience != "advanced" else "45-60s", "duration_minutes": None, "rest_seconds": 45}
    if pattern == "power":
        return {"sets": 4, "reps": "4-6", "duration_minutes": None, "rest_seconds": 90}
    table = {"strength": ((5, "3-5", 180), (3, "6-10", 120)), "muscle": ((4, "6-10", 120), (3, "10-15", 75)),
             "fat_loss": ((3, "8-12", 75), (3, "12-15", 45)), "fitness": ((3, "8-12", 90), (3, "10-15", 60)),
             "endurance": ((3, "12-15", 60), (2, "15-20", 45)), "sport": ((4, "5-8", 120), (3, "8-12", 75))}
    sets, reps, rest = table[i.goal][0 if main else 1]
    if i.experience == "beginner":
        sets = max(2, sets - 1)
        if i.goal == "strength" and main:
            reps = "6-8"
    if pattern == "core":
        reps = "10-12"
    return {"sets": sets, "reps": reps, "duration_minutes": None, "rest_seconds": rest}


def _as_item(i: WorkoutIntakeIn, ex: tuple, pattern: str, main: bool) -> dict[str, Any]:
    return {"exercise": ex[0], "muscle_group": ex[1], "notes": ex[6], **_prescription(i, ex[2], main, ex[7])}


def _count(i: WorkoutIntakeIn) -> int:
    return {30: 4, 45: 5, 60: 6, 75: 7, 90: 8}[i.minutes]


def builtin_day(i: WorkoutIntakeIn, day: str, focus: str, variant: int = 0) -> list[dict[str, Any]]:
    if focus == "Rest":
        return []
    patterns = TEMPLATES.get(focus) or TEMPLATES["Full body A"]
    count = _count(i)
    if i.goal in ("fat_loss", "endurance") and focus not in ("Conditioning", "Cardio and mobility", "Active recovery") and i.minutes >= 45:
        patterns = patterns[: count - 1] + ["cardio"]
    else:
        patterns = patterns[:count]
    likes = {w for w in re.findall(r"[a-z]+", " ".join(i.cardio_likes).lower())}
    offset = DAYS.index(day) + variant  # repeats of the same session get different picks
    items, used = [{"day": day, **WARMUP, "alternatives": []}], set()
    for k, pattern in enumerate(patterns):
        p, pool = pattern, []
        for _ in range(3):  # walk the fallback chain if nothing fits (equipment / injury)
            pool = [x for x in X if x[2] == p and _allowed(x, i) and x[0] not in used]
            if k >= 2 and p in ("squat", "hinge"):  # heavy barbell lifts only as main lifts, never high-rep accessories
                pool = [x for x in pool if not x[0].startswith("Barbell")] or pool
            if pool:
                break
            p = FALLBACK.get(p, "core")
        if not pool:
            continue
        if p == "cardio" and likes:
            pool.sort(key=lambda x: -len(set(re.findall(r"[a-z]+", x[0].lower())) & likes))
            pick = pool[0]
        else:
            pool.sort(key=lambda x: -_preference(x, i))
            top = pool[: min(3, len(pool))]
            pick = top[(offset + k) % len(top)]
        used.add(pick[0])
        alts = [x for x in pool if x is not pick][:2]
        if len(alts) < 2:  # e.g. a knee injury leaves one squat: offer safe options from a related movement
            related = FALLBACK.get(p, "core")
            alts += [x for x in X if x[2] == related and _allowed(x, i) and x[0] not in used and x is not pick and x not in alts][: 2 - len(alts)]
        main = k < 2 and p in STRENGTH_PATTERNS
        items.append({"day": day, **_as_item(i, pick, p, main), "alternatives": [_as_item(i, a, p, main) for a in alts]})
    return items


def summary(i: WorkoutIntakeIn, label: str, focus: dict[str, str], items: list[dict[str, Any]], notes: list[str]) -> dict[str, Any]:
    training = [d for d in DAYS if focus[d] != "Rest"]
    if i.injuries:
        notes = notes + [f"Exercises that load your {', '.join(INJURY_LABEL[x] for x in i.injuries)} are left out. Stop anything that causes sharp pain, and see a physiotherapist if it persists."]
    if i.age >= 50 or i.health_notes:
        notes = notes + ["Given your age or health notes, check with your doctor before starting, and begin with lighter weights."]
    notes = notes + ["Pick a weight you could lift 2–3 more times at the end of each set. Add a little weight or a rep when every set feels that way."]
    return {"split": label, "training_days": len(training), "minutes_per_week": len(training) * i.minutes,
            "sets_per_week": sum(x["sets"] for x in items), "notes": notes}


# --------------------------------------------------------------------- AI
EX_PROPS = {"exercise": {"type": "string"}, "muscle_group": {"type": "string", "enum": GROUPS}, "sets": {"type": "integer"},
            "reps": {"type": "string"}, "duration_minutes": {"type": "integer"}, "rest_seconds": {"type": "integer"}, "notes": {"type": "string"}}
WORKOUT_TOOL = {
    "name": "submit_workout",
    "description": "Return the exercises for one training session, in order.",
    "input_schema": {"type": "object", "required": ["exercises"], "properties": {"exercises": {"type": "array", "items": {
        "type": "object", "required": ["exercise", "muscle_group", "sets", "notes", "alternatives"],
        "properties": {**EX_PROPS, "alternatives": {"type": "array", "maxItems": 2, "items": {
            "type": "object", "required": ["exercise", "muscle_group", "sets", "notes"], "properties": EX_PROPS}}}}}}},
}
SYSTEM_PROMPT = """You are a careful strength and conditioning coach writing one training session.
Only use exercises possible with the stated equipment. Never include movements that load an injured area; pick joint-friendly options instead.
Match volume to the experience level and session length. Start with a short warm-up (muscle_group "mobility", sets 0, duration_minutes 5-8).
For strength exercises give sets, reps as a range (e.g. "8-12") and rest_seconds. For cardio, mobility or circuits use sets 0 and duration_minutes.
Each exercise gets exactly 2 alternatives that train the same movement with the available equipment. notes = one short coaching cue (under 120 characters)."""
GOAL_LABEL = {"fat_loss": "fat loss while keeping muscle", "muscle": "building muscle", "strength": "getting stronger",
              "fitness": "general fitness and health", "endurance": "endurance and stamina", "sport": "sport performance"}
EQUIP_LABEL = {"gym": "a full gym", "dumbbells": "home with dumbbells", "bodyweight": "bodyweight only, at home"}


def _session_prompt(i: WorkoutIntakeIn, day: str, focus: str) -> str:
    extras = ", ".join(e.replace("_", " ") for e in i.extras) or "none"
    patterns = ", ".join((TEMPLATES.get(focus) or TEMPLATES["Full body A"])[: _count(i)])
    return f"""Write {DAY_NAME[day]}'s session. Focus: {focus}. Suggested movement order: {patterns}.
Person: {i.age} y, {i.sex}, {i.height_cm:.0f} cm, {i.weight_kg:.1f} kg, {i.experience}.
Goal: {GOAL_LABEL[i.goal]}{(' (' + i.sport + ')') if i.sport else ''}.
Session length: {i.minutes} minutes including warm-up. Training days this week: {len(i.days)}.
Equipment: {EQUIP_LABEL[i.equipment]}; extras: {extras}.
Enjoys: {', '.join(i.cardio_likes) or 'not given'}.
Injuries / limits: {', '.join(INJURY_LABEL[x] for x in i.injuries) or 'none'}. Health notes: {i.health_notes or 'none'}.
Other notes: {i.notes or 'none'}
About {_count(i)} exercises after the warm-up. Call submit_workout."""


# Movements to keep out for each injury, even if the AI suggests them.
INJURY_WORDS = {
    "knee": ("squat", "lunge", "jump", "step-up", "leg press", "leg extension", "burpee", "skipping", "jog", "sprint", "pistol"),
    "lower_back": ("deadlift", "barbell row", "bent-over row", "good morning", "swing", "back squat", "back extension", "sit-up"),
    "shoulder": ("overhead press", "military press", "dip", "pull-up", "chin-up", "upright row", "pike push", "behind-the-neck", "handstand"),
    "wrist": ("push-up", "burpee", "dip", "handstand", "mountain climber", "front squat"),
    "neck": ("shrug", "behind-the-neck", "headstand", "neck"),
    "ankle": ("jump", "skipping", "jog", "sprint", "calf raise", "hop", "run"),
}
_SAFE_PREFIX = ("warm-up",)


def _risky(name: str, i: WorkoutIntakeIn) -> bool:
    lower = name.lower()
    if lower.startswith(_SAFE_PREFIX):
        return False
    known = next((x for x in X if x[0].lower() == lower), None)
    if known and set(known[5].split()) & set(i.injuries):
        return True
    return any(word in lower for inj in i.injuries for word in INJURY_WORDS[inj])


def _int(v: Any, hi: int) -> int | None:
    try:
        return max(0, min(int(float(v)), hi))
    except (TypeError, ValueError):
        return None


def _clean(x: dict[str, Any]) -> dict[str, Any]:
    group = x.get("muscle_group") if x.get("muscle_group") in GROUPS else "full body"
    return {"exercise": str(x.get("exercise", "")).strip()[:160], "muscle_group": group, "sets": _int(x.get("sets"), 10) or 0,
            "reps": (str(x["reps"]).strip()[:20] or None) if x.get("reps") else None, "duration_minutes": _int(x.get("duration_minutes"), 120) or None,
            "rest_seconds": _int(x.get("rest_seconds"), 600) or None, "notes": (str(x.get("notes") or "").strip()[:240] or None)}


async def ai_day(client: httpx.AsyncClient, i: WorkoutIntakeIn, day: str, focus: str) -> list[dict[str, Any]]:
    settings = get_settings()
    response = await client.post("https://api.anthropic.com/v1/messages", json={
        "model": settings.ai_model, "max_tokens": 3000, "system": SYSTEM_PROMPT,
        "tools": [WORKOUT_TOOL], "tool_choice": {"type": "tool", "name": "submit_workout"},
        "messages": [{"role": "user", "content": _session_prompt(i, day, focus)}],
    }, headers={"x-api-key": settings.anthropic_api_key or "", "anthropic-version": "2023-06-01"})
    response.raise_for_status()
    block = next(b for b in response.json()["content"] if b.get("type") == "tool_use")
    items = []
    for raw in block["input"].get("exercises", [])[:12]:
        options = [o for o in [_clean(raw), *(_clean(x) for x in (raw.get("alternatives") or [])[:2])]
                   if o["exercise"] and not _risky(o["exercise"], i)]
        if not options:
            continue
        main, alts = options[0], options[1:]  # a safe alternative is promoted if the main pick loads an injury
        items.append({"day": day, **main, "alternatives": alts})
    if len(items) < 2:
        raise ValueError("AI returned too few exercises")
    return items


def _variant(focus: dict[str, str], day: str) -> int:
    return sum(1 for d in DAYS[: DAYS.index(day)] if focus[d] == focus[day])


async def plan_week(i: WorkoutIntakeIn) -> dict[str, Any]:
    label, focus, notes = split_plan(i)
    training = [d for d in DAYS if focus[d] != "Rest"]
    warnings: list[str] = []
    source = "builtin"
    if get_settings().anthropic_api_key:
        async with httpx.AsyncClient(timeout=httpx.Timeout(55.0, connect=10.0)) as client:
            results = await asyncio.gather(*(ai_day(client, i, d, focus[d]) for d in training), return_exceptions=True)
        items, failed = [], []
        for d, result in zip(training, results):
            if isinstance(result, Exception):
                log.warning("AI workout failed for %s: %r", d, result)
                failed.append(DAY_NAME[d])
                items.extend(builtin_day(i, d, focus[d], _variant(focus, d)))
            else:
                items.extend(result)
        if failed:
            warnings.append(f"The AI couldn't plan {', '.join(failed)}, so those days use the built-in planner. Try regenerating them.")
        source = "ai" if not failed else ("builtin" if len(failed) == len(training) else "mixed")
    else:
        items = [x for d in training for x in builtin_day(i, d, focus[d], _variant(focus, d))]
    return {"source": source, "summary": summary(i, label, focus, items, notes), "day_focus": focus, "items": items, "warnings": warnings}


async def plan_day(i: WorkoutIntakeIn, day: str, focus: str) -> dict[str, Any]:
    label, week_focus, notes = split_plan(i)
    week_focus = {**week_focus, day: focus}
    source, warnings = "builtin", []
    if get_settings().anthropic_api_key and focus != "Rest":
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(55.0, connect=10.0)) as client:
                items = await ai_day(client, i, day, focus)
            source = "ai"
        except Exception as exc:  # noqa: BLE001 - fall back to the library, but tell the person
            log.warning("AI workout day failed: %r", exc)
            items = builtin_day(i, day, focus)
            warnings.append("The AI couldn't plan this day, so the built-in planner was used.")
    else:
        items = builtin_day(i, day, focus)
    return {"source": source, "summary": summary(i, label, week_focus, items, notes), "day_focus": {day: focus}, "items": items, "warnings": warnings}


FOCUS_OPTIONS = list(TEMPLATES)
