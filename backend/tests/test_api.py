import os
os.environ["FITTRACK_DATABASE_URL"] = "sqlite:///./test_fittrack.db"
os.environ["FITTRACK_SECRET_KEY"] = "test-secret-at-least-thirty-two-characters-long"

from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine


def setup_function():
    Base.metadata.drop_all(bind=engine)


def test_owner_setup_and_food_log():
    with TestClient(app) as client:
        response = client.post("/api/v1/auth/register", json={"name": "Test User", "email": "test@example.com", "password": "long-enough-password"})
        assert response.status_code == 201
        csrf = response.cookies.get("csrf_token")
        headers = {"X-CSRF-Token": csrf}
        created = client.post("/api/v1/food-logs", headers=headers, json={"name": "Idli", "meal_category": "breakfast", "local_date": "2026-10-03", "calories": 58, "protein_g": 2, "carbs_g": 12, "fat_g": 0.4, "fiber_g": 1, "serving_g": 40, "quantity": 1})
        assert created.status_code == 201
        summary = client.get("/api/v1/dashboard/summary?local_date=2026-10-03")
        assert summary.status_code == 200
        assert summary.json()["nutrition"]["calories"] == 58


def _owner(client):
    response = client.post("/api/v1/auth/register", json={"name": "Chart User", "email": "chart@example.com", "password": "long-enough-password"})
    return {"X-CSRF-Token": response.cookies.get("csrf_token")}


def test_diet_chart_lifecycle():
    with TestClient(app) as client:
        headers = _owner(client)
        chart = client.post("/api/v1/diet-charts", headers=headers, json={"name": "Lean week", "target_calories": 2000})
        assert chart.status_code == 201 and chart.json()["is_active"] is True
        chart_id = chart.json()["id"]
        item = client.post(f"/api/v1/diet-charts/{chart_id}/items", headers=headers, json={"day": "mon", "meal_slot": "breakfast", "food_name": "Oats", "portion": "60 g", "calories": 230, "protein_g": 8, "carbs_g": 40, "fat_g": 4})
        assert item.status_code == 201
        bad = client.post(f"/api/v1/diet-charts/{chart_id}/items", headers=headers, json={"day": "xyz", "meal_slot": "lunch", "food_name": "Rice"})
        assert bad.status_code == 422
        listed = client.get("/api/v1/diet-charts").json()
        assert listed[0]["items"][0]["food_name"] == "Oats"
        second = client.post("/api/v1/diet-charts", headers=headers, json={"name": "Bulk"}).json()
        assert second["is_active"] is False
        client.post(f"/api/v1/diet-charts/{second['id']}/activate", headers=headers)
        states = {c["name"]: c["is_active"] for c in client.get("/api/v1/diet-charts").json()}
        assert states == {"Lean week": False, "Bulk": True}
        assert client.delete(f"/api/v1/diet-chart-items/{item.json()['id']}", headers=headers).status_code == 204


def test_workout_chart_and_finish_duration():
    with TestClient(app) as client:
        headers = _owner(client)
        chart = client.post("/api/v1/workout-charts", headers=headers, json={"name": "PPL", "day_focus": {"mon": "Push"}}).json()
        item = client.post(f"/api/v1/workout-charts/{chart['id']}/items", headers=headers, json={"day": "mon", "exercise": "Bench press", "muscle_group": "chest", "sets": 4, "reps": "6-8", "weight_kg": 60})
        assert item.status_code == 201
        assert client.get("/api/v1/workout-charts").json()[0]["day_focus"] == {"mon": "Push"}
        session = client.post("/api/v1/workout-sessions", headers=headers, json={"name": "Push", "local_date": "2026-10-03"}).json()
        finished = client.post(f"/api/v1/workout-sessions/{session['id']}/finish", headers=headers, json={"total_volume_kg": 1200})
        assert finished.status_code == 200 and finished.json()["duration_minutes"] == 0
