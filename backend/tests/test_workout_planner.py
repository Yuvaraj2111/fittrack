import os
os.environ.setdefault("FITTRACK_DATABASE_URL", "sqlite:///./test_fittrack.db")
os.environ.setdefault("FITTRACK_SECRET_KEY", "test-secret-at-least-thirty-two-characters-long")
os.environ.pop("ANTHROPIC_API_KEY", None)

import asyncio
import httpx
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine
from app.schemas import WorkoutIntakeIn
from app.services import workout_planner as wp

BASE = {"age": 27, "sex": "male", "height_cm": 174, "weight_kg": 82, "experience": "beginner", "goal": "muscle",
        "days": ["mon", "tue", "thu", "fri"], "minutes": 60, "equipment": "gym"}


def setup_function():
    Base.metadata.drop_all(bind=engine)


def plan(**over):
    return asyncio.run(wp.plan_week(WorkoutIntakeIn(**{**BASE, **over})))


def names(p):
    return [x["exercise"] for x in p["items"]] + [a["exercise"] for x in p["items"] for a in x["alternatives"]]


def test_splits_follow_days():
    p = plan()
    assert p["source"] == "builtin" and p["summary"]["split"] == "Upper / lower"
    assert [p["day_focus"][d] for d in ("mon", "tue", "wed", "thu")] == ["Upper body A", "Lower body A", "Rest", "Upper body B"]
    assert plan(days=["mon", "wed", "fri"])["day_focus"]["wed"] == "Full body B"
    six = plan(days=["mon", "tue", "wed", "thu", "fri", "sat"], experience="intermediate")
    assert six["day_focus"]["thu"] == "Push"
    seven = plan(days=["mon", "tue", "wed", "thu", "fri", "sat", "sun"])
    assert seven["day_focus"]["sun"] == "Active recovery" and any("beginner" in n for n in seven["summary"]["notes"])


def test_equipment_injuries_and_volume():
    home = plan(equipment="bodyweight", injuries=["knee"])
    gym_only = {x[0] for x in wp.X if x[3].split()[0] != "bw" or len(x[3].split()) > 1}
    knee = {x[0] for x in wp.X if "knee" in x[5].split()}
    assert not set(names(home)) & (gym_only | knee)
    mon = [x for x in home["items"] if x["day"] == "mon"]
    assert mon[0]["exercise"].startswith("Warm-up") and len(mon) >= 4
    assert all(len(x["alternatives"]) <= 2 for x in home["items"])
    assert any("knee" in n for n in home["summary"]["notes"])
    short, long = plan(minutes=30), plan(minutes=90)
    assert len([x for x in short["items"] if x["day"] == "mon"]) < len([x for x in long["items"] if x["day"] == "mon"])
    fat = plan(goal="fat_loss")
    assert any(x["muscle_group"] == "cardio" for x in fat["items"] if x["day"] == "mon")


def test_ai_session_parsing(monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "k")
    def handler(request):
        ex = [{"exercise": "Warm-up", "muscle_group": "mobility", "sets": 0, "duration_minutes": 6, "notes": "easy", "alternatives": []},
              {"exercise": "Goblet squat", "muscle_group": "legs", "sets": 3, "reps": "8-12", "rest_seconds": 90, "notes": "tall", "alternatives": [
                  {"exercise": "Leg press", "muscle_group": "legs", "sets": 3, "reps": "10-12", "notes": "slow"}]},
              {"exercise": "Weird", "muscle_group": "elbows", "sets": 99, "rest_seconds": 9999, "notes": "x", "alternatives": []}]
        return httpx.Response(200, json={"content": [{"type": "tool_use", "input": {"exercises": ex}}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await wp.ai_day(c, WorkoutIntakeIn(**BASE), "mon", "Lower body A")
    items = asyncio.run(run())
    assert items[1]["alternatives"][0]["exercise"] == "Leg press"
    assert items[2]["muscle_group"] == "full body" and items[2]["sets"] == 10 and items[2]["rest_seconds"] == 600


def test_generate_save_swap_api():
    with TestClient(app) as client:
        r = client.post("/api/v1/auth/register", json={"name": "W", "email": "w@example.com", "password": "long-enough-password"})
        h = {"X-CSRF-Token": r.cookies.get("csrf_token")}
        assert client.get("/api/v1/workout-planner/intake").json()["intake"] is None
        body = client.post("/api/v1/workout-planner/generate", headers=h, json=BASE).json()
        assert client.get("/api/v1/workout-planner/intake").json()["intake"]["minutes"] == 60
        day = client.post("/api/v1/workout-planner/generate-day", headers=h, json={"intake": BASE, "day": "wed", "focus": "Conditioning"}).json()
        assert {x["day"] for x in day["items"]} == {"wed"} and day["day_focus"] == {"wed": "Conditioning"}
        saved = client.post("/api/v1/workout-charts/full", headers=h, json={"name": "AI split", "day_focus": body["day_focus"], "items": body["items"]})
        assert saved.status_code == 201, saved.text
        chart = saved.json()
        assert chart["is_active"] and chart["day_focus"]["mon"] == "Upper body A"
        item = next(x for x in chart["items"] if x["alternatives"])
        alt = item["alternatives"][0]
        swapped = client.post(f"/api/v1/workout-chart-items/{item['id']}/swap", headers=h, json={"alternative_id": alt["id"]}).json()
        assert swapped["exercise"] == alt["exercise"] and item["exercise"] in [a["exercise"] for a in swapped["alternatives"]]
        client.post("/api/v1/workout-charts/full", headers=h, json={"name": "Second", "activate": False})
        assert len(client.get("/api/v1/workout-charts").json()) == 2


def test_ai_output_respects_injuries(monkeypatch):
    import httpx
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "k")
    ex = lambda name, group="legs": {"exercise": name, "muscle_group": group, "sets": 3, "reps": "8-12", "rest_seconds": 90, "notes": "cue"}
    exercises = [
        {**ex("Warm-up: bike and leg swings", "mobility"), "sets": 0, "duration_minutes": 6, "alternatives": []},
        {**ex("Barbell back squat"), "alternatives": [ex("Walking lunge"), ex("Glute bridge")]},
        {**ex("Jump squats"), "alternatives": [ex("Box jump")]},
        {**ex("Lying leg curl"), "alternatives": [ex("Bulgarian split squat"), ex("Slider / towel leg curl")]},
    ]
    def handler(request):
        return httpx.Response(200, json={"content": [{"type": "tool_use", "input": {"exercises": exercises}}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await wp.ai_day(c, WorkoutIntakeIn(**{**BASE, "injuries": ["knee"]}), "mon", "Lower body A")
    names = [x["exercise"] for x in asyncio.run(run())]
    alts = [a["exercise"] for x in asyncio.run(run()) for a in x["alternatives"]]
    assert names == ["Warm-up: bike and leg swings", "Glute bridge", "Lying leg curl"]
    assert "Bulgarian split squat" not in alts and "Slider / towel leg curl" in alts
