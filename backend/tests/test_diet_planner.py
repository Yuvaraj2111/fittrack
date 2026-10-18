import os
os.environ.setdefault("FITTRACK_DATABASE_URL", "sqlite:///./test_fittrack.db")
os.environ.setdefault("FITTRACK_SECRET_KEY", "test-secret-at-least-thirty-two-characters-long")
os.environ.pop("ANTHROPIC_API_KEY", None)

import asyncio
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine
from app.schemas import DietIntakeIn
from app.services import diet_planner

INTAKE = {"age": 29, "sex": "male", "height_cm": 172, "weight_kg": 78, "daily_activity": "desk", "workout_days": 4,
          "workout_types": ["Gym / weights"], "workout_time": "evening", "goal": "lose", "pace": "gentle",
          "diet_type": "veg", "region": "tamil", "meals_per_day": 5, "usual_foods": "idli, dosa, rice with sambar, curd",
          "likes": "ragi, paneer", "avoid": "peanuts"}


def setup_function():
    Base.metadata.drop_all(bind=engine)


def test_targets_are_safe():
    t = diet_planner.targets(DietIntakeIn(**INTAKE))
    assert 1500 <= t["calories"] < t["tdee"]
    assert sum(t["slots"].values()) in range(t["calories"] - 30, t["calories"] + 30)
    tiny = diet_planner.targets(DietIntakeIn(**{**INTAKE, "sex": "female", "height_cm": 165, "weight_kg": 45, "goal": "lose", "pace": "steady"}))
    assert tiny["calories"] >= 1200 and any("underweight" in n for n in tiny["notes"])


def test_builtin_plan_respects_diet_and_avoid():
    plan = asyncio.run(diet_planner.plan_days(DietIntakeIn(**INTAKE), diet_planner.DAYS))
    assert plan["source"] == "builtin" and len(plan["items"]) == 35
    names = [i["food_name"].lower() for i in plan["items"]] + [a["food_name"].lower() for i in plan["items"] for a in i["alternatives"]]
    assert not any(w in n for n in names for w in ("chicken", "fish", "egg", "peanut"))
    assert all(len(i["alternatives"]) == 2 for i in plan["items"])
    assert len({i["food_name"] for i in plan["items"] if i["meal_slot"] == "breakfast"}) >= 3  # variety across the week
    three = asyncio.run(diet_planner.plan_days(DietIntakeIn(**{**INTAKE, "meals_per_day": 3}), ["mon"]))
    assert [i["meal_slot"] for i in three["items"]] == ["breakfast", "lunch", "dinner"]


def test_ai_path_is_sanitised(monkeypatch):
    async def fake(client, i, t, day):
        if day == "tue":
            raise RuntimeError("timeout")
        return [{"day": day, "meal_slot": s, "food_name": f"AI {s}", "portion": "1 bowl", "calories": k, "protein_g": 10, "carbs_g": 20, "fat_g": 5, "alternatives": []} for s, k in t["slots"].items()]
    monkeypatch.setattr(diet_planner, "ai_enabled", lambda: True)
    monkeypatch.setattr(diet_planner, "ai_day", fake)
    plan = asyncio.run(diet_planner.plan_days(DietIntakeIn(**INTAKE), ["mon", "tue"]))
    assert plan["source"] == "mixed" and "Tuesday" in plan["warnings"][0]
    assert {i["day"] for i in plan["items"]} == {"mon", "tue"}


def test_generate_save_and_swap():
    with TestClient(app) as client:
        r = client.post("/api/v1/auth/register", json={"name": "Planner", "email": "p@example.com", "password": "long-enough-password"})
        h = {"X-CSRF-Token": r.cookies.get("csrf_token")}
        assert client.get("/api/v1/diet-planner/intake").json()["intake"] is None
        plan = client.post("/api/v1/diet-planner/generate", headers=h, json=INTAKE)
        assert plan.status_code == 200, plan.text
        body = plan.json()
        assert client.get("/api/v1/diet-planner/intake").json()["intake"]["region"] == "tamil"
        day = client.post("/api/v1/diet-planner/generate-day", headers=h, json={"intake": INTAKE, "day": "wed"}).json()
        assert {i["day"] for i in day["items"]} == {"wed"}
        saved = client.post("/api/v1/diet-charts/full", headers=h, json={"name": "AI plan", "target_calories": body["targets"]["calories"], "items": body["items"], "apply_goals": body["targets"]})
        assert saved.status_code == 201, saved.text
        chart = saved.json()
        assert chart["is_active"] and len(chart["items"]) == 35
        item = chart["items"][0]; alt = item["alternatives"][0]
        swapped = client.post(f"/api/v1/diet-chart-items/{item['id']}/swap", headers=h, json={"alternative_id": alt["id"]}).json()
        assert swapped["food_name"] == alt["food_name"] and item["food_name"] in [a["food_name"] for a in swapped["alternatives"]]
        assert client.get("/api/v1/profile").json()["calorie_goal"] == body["targets"]["calories"]
        second = client.post("/api/v1/diet-charts/full", headers=h, json={"name": "Second", "items": [], "activate": False}).json()
        assert not second["is_active"] and len(client.get("/api/v1/diet-charts").json()) == 2


def test_ai_day_parses_tool_response(monkeypatch):
    import httpx
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")
    captured = {}
    def handler(request):
        captured["body"] = request.read().decode()
        captured["key"] = request.headers["x-api-key"]
        meals = [{"meal_slot": "breakfast", "food_name": "Ragi dosa", "portion": "2 dosas", "calories": 400, "protein_g": 12, "carbs_g": 60, "fat_g": 10,
                  "alternatives": [{"food_name": "Idli", "portion": "4", "calories": 390, "protein_g": 12, "carbs_g": 70, "fat_g": 3},
                                   {"food_name": "Peanut chutney dosa", "portion": "2", "calories": 420, "protein_g": 12, "carbs_g": 60, "fat_g": 14}]},
                 {"meal_slot": "lunch", "food_name": "Peanut rice", "portion": "1 plate", "calories": 500, "protein_g": 1, "carbs_g": 1, "fat_g": 1, "alternatives": []},
                 {"meal_slot": "brunch", "food_name": "Bad slot", "portion": "x", "calories": 1, "protein_g": 1, "carbs_g": 1, "fat_g": 1, "alternatives": []}]
        return httpx.Response(200, json={"content": [{"type": "tool_use", "name": "submit_day_plan", "input": {"meals": meals}}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            i = DietIntakeIn(**INTAKE)
            return await diet_planner.ai_day(client, i, diet_planner.targets(i), "mon")
    items = asyncio.run(run())
    assert captured["key"] == "test-key" and "submit_day_plan" in captured["body"]
    by_slot = {i["meal_slot"]: i for i in items}
    assert by_slot["breakfast"]["food_name"] == "Ragi dosa" and [a["food_name"] for a in by_slot["breakfast"]["alternatives"]] == ["Idli"]  # peanut alt dropped
    assert "Peanut" not in by_slot["lunch"]["food_name"]  # blocked dish replaced by built-in
    assert set(by_slot) == {"breakfast", "morning snack", "lunch", "evening snack", "dinner"}
