from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import secrets
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ...core.config import get_settings
from ...core.security import create_access_token, hash_password, verify_password
from ...database import get_db
from ...deps import CurrentUser, DbSession, MutationUser
from ...models import DietChart, DietChartItem, DietIntake, DietItemAlternative, WorkoutIntake, WorkoutItemAlternative, WorkoutChart, WorkoutChartItem, Food, FoodLog, HydrationLog, Medication, Reminder, StepLog, Supplement, User, UserGoal, UserProfile, WeightLog, WorkoutSession
from ...schemas import (ExternalFoodOut, FoodIn, FoodLogIn, FoodLogOut, FoodOut, GoalIn, GoalOut, HydrationIn,
    HydrationOut, LoginIn, MedicationIn, MedicationOut, ProfileIn, ProfileOut, RegisterIn,
    ReminderIn, ReminderOut, StepIn, StepOut, SupplementIn, SupplementOut, UserOut,
    WeightIn, WeightOut, WorkoutFinishIn, WorkoutIn, WorkoutOut,
    DietChartIn, DietChartItemIn, DietChartItemOut, DietChartOut,
    DietChartFullIn, DietDayIn, DietIntakeIn, DietPlanOut, DietTargetsOut, SwapIn,
    WorkoutChartFullIn, WorkoutDayIn, WorkoutIntakeIn, WorkoutPlanOut,
    WorkoutChartIn, WorkoutChartItemIn, WorkoutChartItemOut, WorkoutChartOut)
from ...services.open_food_facts import food_by_barcode, search_foods
from ...services import diet_planner, workout_planner

router = APIRouter()

# set
def set_session(response: Response, user: User) -> str:
    token = create_access_token(user.id)
    csrf = secrets.token_urlsafe(32)
    settings = get_settings()
    cookie_options = {"samesite": settings.cookie_samesite, "secure": settings.cookie_secure, "domain": settings.session_cookie_domain, "max_age": 60 * 60 * 24}
    response.set_cookie("fittrack_access", token, httponly=True, **cookie_options)
    response.set_cookie("csrf_token", csrf, httponly=False, **cookie_options)
    return csrf


def get_owned_or_404(db: Session, model, user_id: int, record_id: int):
    result = db.scalar(select(model).where(model.id == record_id, model.user_id == user_id))
    if not result:
        raise HTTPException(status_code=404, detail="Record not found")
    return result


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, response: Response, db: DbSession):
    # A personal install intentionally exposes setup only until its initial owner exists.
    if db.scalar(select(func.count()).select_from(User)):
        raise HTTPException(status_code=403, detail="Initial owner already configured; sign in instead")
    user = User(email=str(payload.email).lower(), name=payload.name.strip(), password_hash=hash_password(payload.password))
    user.profile = UserProfile()
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"user": UserOut.model_validate(user), "csrf_token": set_session(response, user)}


@router.post("/auth/login")
def login(payload: LoginIn, response: Response, db: DbSession):
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return {"user": UserOut.model_validate(user), "csrf_token": set_session(response, user)}


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, _user: MutationUser):
    settings = get_settings()
    options = {"samesite": settings.cookie_samesite, "secure": settings.cookie_secure, "domain": settings.session_cookie_domain}
    response.delete_cookie("fittrack_access", **options)
    response.delete_cookie("csrf_token", **options)


@router.get("/auth/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.get("/profile", response_model=ProfileOut)
def get_profile(user: CurrentUser):
    return user.profile


@router.put("/profile", response_model=ProfileOut)
def update_profile(payload: ProfileIn, db: DbSession, user: MutationUser):
    for field, value in payload.model_dump().items():
        setattr(user.profile, field, value)
    db.commit()
    db.refresh(user.profile)
    return user.profile


@router.get("/dashboard/summary")
def dashboard_summary(user: CurrentUser, db: DbSession, local_date: date = Query(default_factory=date.today)):
    food = db.execute(select(
        func.coalesce(func.sum(FoodLog.calories), 0), func.coalesce(func.sum(FoodLog.protein_g), 0),
        func.coalesce(func.sum(FoodLog.carbs_g), 0), func.coalesce(func.sum(FoodLog.fat_g), 0),
        func.coalesce(func.sum(FoodLog.fiber_g), 0),
    ).where(FoodLog.user_id == user.id, FoodLog.local_date == local_date)).one()
    water = db.scalar(select(func.coalesce(func.sum(HydrationLog.amount_ml), 0)).where(HydrationLog.user_id == user.id, HydrationLog.local_date == local_date))
    steps = db.scalar(select(StepLog.steps).where(StepLog.user_id == user.id, StepLog.local_date == local_date)) or 0
    workouts = db.scalars(select(WorkoutSession).where(WorkoutSession.user_id == user.id, WorkoutSession.local_date == local_date).order_by(WorkoutSession.started_at.desc())).all()
    latest_weight = db.scalar(select(WeightLog).where(WeightLog.user_id == user.id).order_by(WeightLog.local_date.desc(), WeightLog.id.desc()).limit(1))
    goals = user.profile
    return {
        "date": local_date, "goals": {"calories": goals.calorie_goal, "protein_g": goals.protein_goal_g, "carbs_g": goals.carb_goal_g, "fat_g": goals.fat_goal_g, "fiber_g": goals.fiber_goal_g, "steps": goals.step_goal, "hydration_ml": goals.hydration_goal_ml},
        "nutrition": {"calories": float(food[0]), "protein_g": float(food[1]), "carbs_g": float(food[2]), "fat_g": float(food[3]), "fiber_g": float(food[4])},
        "hydration_ml": int(water or 0), "steps": steps,
        "workouts": [WorkoutOut.model_validate(workout).model_dump(mode="json") for workout in workouts],
        "latest_weight_kg": float(latest_weight.weight_kg) if latest_weight else None,
    }


@router.get("/foods", response_model=list[FoodOut])
def list_foods(user: CurrentUser, db: DbSession, q: str | None = None, limit: int = Query(50, ge=1, le=100)):
    stmt = select(Food).where(Food.user_id == user.id)
    if q:
        stmt = stmt.where(Food.name.ilike(f"%{q.strip()}%"))
    return db.scalars(stmt.order_by(Food.name).limit(limit)).all()


@router.get("/foods/search", response_model=list[ExternalFoodOut])
async def search_external_foods(q: str = Query(min_length=2, max_length=100), _user: CurrentUser = ...):
    try:
        return await search_foods(q)
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=503, detail="Food lookup is temporarily unavailable. You can still add a food manually.")


@router.get("/foods/barcode/{barcode}", response_model=ExternalFoodOut)
async def lookup_barcode(barcode: str, _user: CurrentUser = ...):
    if not barcode.isdigit() or not 8 <= len(barcode) <= 18:
        raise HTTPException(status_code=422, detail="Enter a valid product barcode")
    try:
        product = await food_by_barcode(barcode)
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=503, detail="Food lookup is temporarily unavailable. You can still add a food manually.")
    if not product:
        raise HTTPException(status_code=404, detail="No food was found for that barcode")
    return product


@router.post("/foods", response_model=FoodOut, status_code=201)
def create_food(payload: FoodIn, db: DbSession, user: MutationUser):
    food = Food(user_id=user.id, **payload.model_dump())
    db.add(food); db.commit(); db.refresh(food)
    return food


@router.get("/food-logs", response_model=list[FoodLogOut])
def list_food_logs(user: CurrentUser, db: DbSession, local_date: date = Query(default_factory=date.today)):
    return db.scalars(select(FoodLog).where(FoodLog.user_id == user.id, FoodLog.local_date == local_date).order_by(FoodLog.logged_at.desc())).all()


@router.post("/food-logs", response_model=FoodLogOut, status_code=201)
def create_food_log(payload: FoodLogIn, db: DbSession, user: MutationUser):
    if payload.food_id:
        get_owned_or_404(db, Food, user.id, payload.food_id)
    record = FoodLog(user_id=user.id, **payload.model_dump())
    db.add(record); db.commit(); db.refresh(record)
    return record


@router.delete("/food-logs/{record_id}", status_code=204)
def delete_food_log(record_id: int, db: DbSession, user: MutationUser):
    db.delete(get_owned_or_404(db, FoodLog, user.id, record_id)); db.commit()


@router.get("/hydration", response_model=list[HydrationOut])
def list_hydration(user: CurrentUser, db: DbSession, local_date: date = Query(default_factory=date.today)):
    return db.scalars(select(HydrationLog).where(HydrationLog.user_id == user.id, HydrationLog.local_date == local_date).order_by(HydrationLog.logged_at.desc())).all()


@router.post("/hydration", response_model=HydrationOut, status_code=201)
def add_hydration(payload: HydrationIn, db: DbSession, user: MutationUser):
    record = HydrationLog(user_id=user.id, **payload.model_dump())
    db.add(record); db.commit(); db.refresh(record)
    return record


@router.get("/activity/steps", response_model=list[StepOut])
def list_steps(user: CurrentUser, db: DbSession, days: int = Query(14, ge=1, le=366)):
    since = date.today() - timedelta(days=days - 1)
    return db.scalars(select(StepLog).where(StepLog.user_id == user.id, StepLog.local_date >= since).order_by(StepLog.local_date.desc())).all()


@router.post("/activity/steps", response_model=StepOut)
def upsert_steps(payload: StepIn, db: DbSession, user: MutationUser):
    record = db.scalar(select(StepLog).where(StepLog.user_id == user.id, StepLog.local_date == payload.local_date))
    if not record:
        record = StepLog(user_id=user.id, **payload.model_dump()); db.add(record)
    else:
        for field, value in payload.model_dump().items(): setattr(record, field, value)
    db.commit(); db.refresh(record); return record


@router.get("/body/weight", response_model=list[WeightOut])
def list_weights(user: CurrentUser, db: DbSession, limit: int = Query(30, ge=1, le=366)):
    return db.scalars(select(WeightLog).where(WeightLog.user_id == user.id).order_by(WeightLog.local_date.desc()).limit(limit)).all()


@router.post("/body/weight", response_model=WeightOut, status_code=201)
def create_weight(payload: WeightIn, db: DbSession, user: MutationUser):
    record = WeightLog(user_id=user.id, **payload.model_dump())
    db.add(record); db.commit(); db.refresh(record); return record


@router.get("/workout-sessions", response_model=list[WorkoutOut])
def list_workouts(user: CurrentUser, db: DbSession, limit: int = Query(30, ge=1, le=100)):
    return db.scalars(select(WorkoutSession).where(WorkoutSession.user_id == user.id).order_by(WorkoutSession.started_at.desc()).limit(limit)).all()


@router.post("/workout-sessions", response_model=WorkoutOut, status_code=201)
def start_workout(payload: WorkoutIn, db: DbSession, user: MutationUser):
    record = WorkoutSession(user_id=user.id, **payload.model_dump())
    db.add(record); db.commit(); db.refresh(record); return record


@router.post("/workout-sessions/{record_id}/finish", response_model=WorkoutOut)
def finish_workout(record_id: int, payload: WorkoutFinishIn, db: DbSession, user: MutationUser):
    record = get_owned_or_404(db, WorkoutSession, user.id, record_id)
    now = datetime.now(timezone.utc)
    if payload.duration_minutes is not None:
        record.duration_minutes = payload.duration_minutes
    else:
        started = record.started_at if record.started_at.tzinfo else record.started_at.replace(tzinfo=timezone.utc)
        record.duration_minutes = max(0, min(1440, round((now - started).total_seconds() / 60)))
    record.total_volume_kg = payload.total_volume_kg
    record.completed_at = now
    record.status = "completed"
    db.commit(); db.refresh(record); return record


def crud_router(path: str, model, in_schema, out_schema):
    # Explicit route declarations below keep OpenAPI types accurate while sharing semantics.
    return None


@router.get("/supplements", response_model=list[SupplementOut])
def list_supplements(user: CurrentUser, db: DbSession):
    return db.scalars(select(Supplement).where(Supplement.user_id == user.id).order_by(Supplement.name)).all()


@router.post("/supplements", response_model=SupplementOut, status_code=201)
def create_supplement(payload: SupplementIn, db: DbSession, user: MutationUser):
    record = Supplement(user_id=user.id, **payload.model_dump()); db.add(record); db.commit(); db.refresh(record); return record


@router.get("/medications", response_model=list[MedicationOut])
def list_medications(user: CurrentUser, db: DbSession):
    return db.scalars(select(Medication).where(Medication.user_id == user.id).order_by(Medication.name)).all()


@router.post("/medications", response_model=MedicationOut, status_code=201)
def create_medication(payload: MedicationIn, db: DbSession, user: MutationUser):
    record = Medication(user_id=user.id, **payload.model_dump()); db.add(record); db.commit(); db.refresh(record); return record


@router.get("/goals", response_model=list[GoalOut])
def list_goals(user: CurrentUser, db: DbSession):
    return db.scalars(select(UserGoal).where(UserGoal.user_id == user.id, UserGoal.active.is_(True)).order_by(UserGoal.created_at.desc())).all()


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(payload: GoalIn, db: DbSession, user: MutationUser):
    record = UserGoal(user_id=user.id, **payload.model_dump()); db.add(record); db.commit(); db.refresh(record); return record


@router.get("/schedule", response_model=list[ReminderOut])
def list_schedule(user: CurrentUser, db: DbSession):
    return db.scalars(select(Reminder).where(Reminder.user_id == user.id, Reminder.enabled.is_(True)).order_by(Reminder.scheduled_time)).all()


@router.post("/schedule", response_model=ReminderOut, status_code=201)
def create_reminder(payload: ReminderIn, db: DbSession, user: MutationUser):
    record = Reminder(user_id=user.id, **payload.model_dump()); db.add(record); db.commit(); db.refresh(record); return record


@router.get("/analytics/nutrition")
def nutrition_analytics(user: CurrentUser, db: DbSession, days: int = Query(7, ge=1, le=90)):
    since = date.today() - timedelta(days=days - 1)
    rows = db.execute(select(FoodLog.local_date, func.sum(FoodLog.calories).label("calories"), func.sum(FoodLog.protein_g).label("protein_g"))
        .where(FoodLog.user_id == user.id, FoodLog.local_date >= since).group_by(FoodLog.local_date).order_by(FoodLog.local_date)).all()
    return [{"date": row.local_date, "calories": float(row.calories), "protein_g": float(row.protein_g)} for row in rows]


@router.get("/analytics/activity")
def activity_analytics(user: CurrentUser, db: DbSession, days: int = Query(7, ge=1, le=90)):
    since = date.today() - timedelta(days=days - 1)
    rows = db.scalars(select(StepLog).where(StepLog.user_id == user.id, StepLog.local_date >= since).order_by(StepLog.local_date)).all()
    return [{"date": row.local_date, "steps": row.steps, "distance_km": float(row.distance_km or 0)} for row in rows]


@router.get("/analytics/workouts")
def workout_analytics(user: CurrentUser, db: DbSession, days: int = Query(14, ge=1, le=90)):
    since = date.today() - timedelta(days=days - 1)
    rows = db.execute(select(WorkoutSession.local_date, func.count(WorkoutSession.id).label("sessions"),
            func.coalesce(func.sum(WorkoutSession.duration_minutes), 0).label("minutes"),
            func.coalesce(func.sum(WorkoutSession.total_volume_kg), 0).label("volume_kg"))
        .where(WorkoutSession.user_id == user.id, WorkoutSession.local_date >= since, WorkoutSession.status == "completed")
        .group_by(WorkoutSession.local_date).order_by(WorkoutSession.local_date)).all()
    return [{"date": row.local_date, "sessions": row.sessions, "minutes": int(row.minutes), "volume_kg": float(row.volume_kg)} for row in rows]


# ---------------------------------------------------------------------------
# Weekly diet and workout charts. Both share the same shape: a chart owned by
# the user, with items keyed by weekday. One chart of each kind can be active;
# the dashboard reads the active chart to show "today's plan".
# ---------------------------------------------------------------------------

def _activate(db: Session, model, user_id: int, chart) -> None:
    for other in db.scalars(select(model).where(model.user_id == user_id, model.is_active.is_(True))).all():
        other.is_active = False
    chart.is_active = True


def _owned_item(db: Session, item_model, chart_model, user_id: int, item_id: int):
    item = db.scalar(select(item_model).join(chart_model).where(item_model.id == item_id, chart_model.user_id == user_id))
    if not item:
        raise HTTPException(status_code=404, detail="Record not found")
    return item


def _next_position(db: Session, item_model, chart_id: int, day: str) -> int:
    current = db.scalar(select(func.max(item_model.position)).where(item_model.chart_id == chart_id, item_model.day == day))
    return (current or 0) + 1


@router.get("/diet-charts", response_model=list[DietChartOut])
def list_diet_charts(user: CurrentUser, db: DbSession):
    return db.scalars(select(DietChart).where(DietChart.user_id == user.id).order_by(DietChart.is_active.desc(), DietChart.created_at.desc())).all()


@router.post("/diet-charts", response_model=DietChartOut, status_code=201)
def create_diet_chart(payload: DietChartIn, db: DbSession, user: MutationUser):
    chart = DietChart(user_id=user.id, **payload.model_dump())
    if not db.scalar(select(func.count()).select_from(DietChart).where(DietChart.user_id == user.id, DietChart.is_active.is_(True))):
        chart.is_active = True
    db.add(chart); db.commit(); db.refresh(chart); return chart


@router.put("/diet-charts/{chart_id}", response_model=DietChartOut)
def update_diet_chart(chart_id: int, payload: DietChartIn, db: DbSession, user: MutationUser):
    chart = get_owned_or_404(db, DietChart, user.id, chart_id)
    for field, value in payload.model_dump().items(): setattr(chart, field, value)
    db.commit(); db.refresh(chart); return chart


@router.post("/diet-charts/{chart_id}/activate", response_model=DietChartOut)
def activate_diet_chart(chart_id: int, db: DbSession, user: MutationUser):
    chart = get_owned_or_404(db, DietChart, user.id, chart_id)
    _activate(db, DietChart, user.id, chart); db.commit(); db.refresh(chart); return chart


@router.delete("/diet-charts/{chart_id}", status_code=204)
def delete_diet_chart(chart_id: int, db: DbSession, user: MutationUser):
    db.delete(get_owned_or_404(db, DietChart, user.id, chart_id)); db.commit()


@router.post("/diet-charts/{chart_id}/items", response_model=DietChartItemOut, status_code=201)
def add_diet_item(chart_id: int, payload: DietChartItemIn, db: DbSession, user: MutationUser):
    get_owned_or_404(db, DietChart, user.id, chart_id)
    item = DietChartItem(chart_id=chart_id, position=_next_position(db, DietChartItem, chart_id, payload.day), **payload.model_dump())
    db.add(item); db.commit(); db.refresh(item); return item


@router.put("/diet-chart-items/{item_id}", response_model=DietChartItemOut)
def update_diet_item(item_id: int, payload: DietChartItemIn, db: DbSession, user: MutationUser):
    item = _owned_item(db, DietChartItem, DietChart, user.id, item_id)
    for field, value in payload.model_dump().items(): setattr(item, field, value)
    db.commit(); db.refresh(item); return item


@router.delete("/diet-chart-items/{item_id}", status_code=204)
def delete_diet_item(item_id: int, db: DbSession, user: MutationUser):
    db.delete(_owned_item(db, DietChartItem, DietChart, user.id, item_id)); db.commit()


@router.get("/workout-charts", response_model=list[WorkoutChartOut])
def list_workout_charts(user: CurrentUser, db: DbSession):
    return db.scalars(select(WorkoutChart).where(WorkoutChart.user_id == user.id).order_by(WorkoutChart.is_active.desc(), WorkoutChart.created_at.desc())).all()


@router.post("/workout-charts", response_model=WorkoutChartOut, status_code=201)
def create_workout_chart(payload: WorkoutChartIn, db: DbSession, user: MutationUser):
    chart = WorkoutChart(user_id=user.id, **payload.model_dump())
    if not db.scalar(select(func.count()).select_from(WorkoutChart).where(WorkoutChart.user_id == user.id, WorkoutChart.is_active.is_(True))):
        chart.is_active = True
    db.add(chart); db.commit(); db.refresh(chart); return chart


@router.put("/workout-charts/{chart_id}", response_model=WorkoutChartOut)
def update_workout_chart(chart_id: int, payload: WorkoutChartIn, db: DbSession, user: MutationUser):
    chart = get_owned_or_404(db, WorkoutChart, user.id, chart_id)
    for field, value in payload.model_dump().items(): setattr(chart, field, value)
    db.commit(); db.refresh(chart); return chart


@router.post("/workout-charts/{chart_id}/activate", response_model=WorkoutChartOut)
def activate_workout_chart(chart_id: int, db: DbSession, user: MutationUser):
    chart = get_owned_or_404(db, WorkoutChart, user.id, chart_id)
    _activate(db, WorkoutChart, user.id, chart); db.commit(); db.refresh(chart); return chart


@router.delete("/workout-charts/{chart_id}", status_code=204)
def delete_workout_chart(chart_id: int, db: DbSession, user: MutationUser):
    db.delete(get_owned_or_404(db, WorkoutChart, user.id, chart_id)); db.commit()


@router.post("/workout-charts/{chart_id}/items", response_model=WorkoutChartItemOut, status_code=201)
def add_workout_item(chart_id: int, payload: WorkoutChartItemIn, db: DbSession, user: MutationUser):
    get_owned_or_404(db, WorkoutChart, user.id, chart_id)
    item = WorkoutChartItem(chart_id=chart_id, position=_next_position(db, WorkoutChartItem, chart_id, payload.day), **payload.model_dump())
    db.add(item); db.commit(); db.refresh(item); return item


@router.put("/workout-chart-items/{item_id}", response_model=WorkoutChartItemOut)
def update_workout_item(item_id: int, payload: WorkoutChartItemIn, db: DbSession, user: MutationUser):
    item = _owned_item(db, WorkoutChartItem, WorkoutChart, user.id, item_id)
    for field, value in payload.model_dump().items(): setattr(item, field, value)
    db.commit(); db.refresh(item); return item


@router.delete("/workout-chart-items/{item_id}", status_code=204)
def delete_workout_item(item_id: int, db: DbSession, user: MutationUser):
    db.delete(_owned_item(db, WorkoutChartItem, WorkoutChart, user.id, item_id)); db.commit()


# ---------------------------------------------------------------------------
# Diet planner: questions -> targets -> AI (or built-in) weekly plan -> saved chart.
# Generation never writes a chart; the person reviews and edits the draft first.
# ---------------------------------------------------------------------------

@router.get("/diet-planner/intake")
def get_diet_intake(user: CurrentUser, db: DbSession):
    saved = db.scalar(select(DietIntake).where(DietIntake.user_id == user.id))
    latest_weight = db.scalar(select(WeightLog.weight_kg).where(WeightLog.user_id == user.id).order_by(WeightLog.local_date.desc(), WeightLog.id.desc()).limit(1))
    height = user.profile.height_cm if user.profile else None
    return {"intake": saved.data if saved else None, "ai_enabled": diet_planner.ai_enabled(),
            "known": {"weight_kg": float(latest_weight) if latest_weight is not None else None, "height_cm": float(height) if height is not None else None}}


@router.post("/diet-planner/targets", response_model=DietTargetsOut)
def diet_targets(payload: DietIntakeIn, _user: CurrentUser):
    return diet_planner.targets(payload)


@router.post("/diet-planner/generate", response_model=DietPlanOut)
async def generate_diet_plan(payload: DietIntakeIn, db: DbSession, user: MutationUser):
    saved = db.scalar(select(DietIntake).where(DietIntake.user_id == user.id))
    if saved:
        saved.data = payload.model_dump()
    else:
        db.add(DietIntake(user_id=user.id, data=payload.model_dump()))
    if user.profile and not user.profile.height_cm:
        user.profile.height_cm = Decimal(str(payload.height_cm))
    db.commit()
    return await diet_planner.plan_days(payload, diet_planner.DAYS)


@router.post("/diet-planner/generate-day", response_model=DietPlanOut)
async def regenerate_diet_day(payload: DietDayIn, _user: MutationUser):
    return await diet_planner.plan_days(payload.intake, [payload.day])


@router.post("/diet-charts/full", response_model=DietChartOut, status_code=201)
def create_full_diet_chart(payload: DietChartFullIn, db: DbSession, user: MutationUser):
    chart = DietChart(user_id=user.id, name=payload.name, target_calories=payload.target_calories, notes=payload.notes)
    positions: dict[str, int] = {}
    for planned in payload.items:
        key = planned.day
        positions[key] = positions.get(key, 0) + 1
        data = planned.model_dump(exclude={"alternatives"})
        item = DietChartItem(position=positions[key], **data)
        item.alternatives = [DietItemAlternative(**alt.model_dump()) for alt in planned.alternatives]
        chart.items.append(item)
    has_active = db.scalar(select(func.count()).select_from(DietChart).where(DietChart.user_id == user.id, DietChart.is_active.is_(True)))
    db.add(chart)
    db.flush()
    if payload.activate or not has_active:
        _activate(db, DietChart, user.id, chart)
    if payload.apply_goals and user.profile:
        g = payload.apply_goals
        user.profile.calorie_goal, user.profile.protein_goal_g = g.calories, g.protein_g
        user.profile.carb_goal_g, user.profile.fat_goal_g, user.profile.fiber_goal_g = g.carbs_g, g.fat_g, g.fiber_g
    db.commit(); db.refresh(chart); return chart


@router.post("/diet-chart-items/{item_id}/swap", response_model=DietChartItemOut)
def swap_diet_item(item_id: int, payload: SwapIn, db: DbSession, user: MutationUser):
    item = _owned_item(db, DietChartItem, DietChart, user.id, item_id)
    alt = next((a for a in item.alternatives if a.id == payload.alternative_id), None)
    if not alt:
        raise HTTPException(status_code=404, detail="Alternative not found")
    fields = ("food_name", "portion", "calories", "protein_g", "carbs_g", "fat_g")
    current = {f: getattr(item, f) for f in fields}
    for f in fields:
        setattr(item, f, getattr(alt, f))
        setattr(alt, f, current[f])  # the old meal becomes an alternative, so the swap can be undone
    db.commit(); db.refresh(item); return item


# ---------------------------------------------------------------------------
# Workout planner: questions -> split -> AI (or built-in) exercises -> saved chart.
# ---------------------------------------------------------------------------

@router.get("/workout-planner/intake")
def get_workout_intake(user: CurrentUser, db: DbSession):
    saved = db.scalar(select(WorkoutIntake).where(WorkoutIntake.user_id == user.id))
    diet = db.scalar(select(DietIntake).where(DietIntake.user_id == user.id))
    latest_weight = db.scalar(select(WeightLog.weight_kg).where(WeightLog.user_id == user.id).order_by(WeightLog.local_date.desc(), WeightLog.id.desc()).limit(1))
    body = {k: v for k, v in (diet.data if diet else {}).items() if k in ("age", "sex", "height_cm", "weight_kg")}
    if user.profile and user.profile.height_cm and "height_cm" not in body:
        body["height_cm"] = float(user.profile.height_cm)
    if latest_weight is not None:
        body["weight_kg"] = float(latest_weight)
    return {"intake": saved.data if saved else None, "ai_enabled": diet_planner.ai_enabled(), "known": body,
            "focus_options": workout_planner.FOCUS_OPTIONS}


@router.post("/workout-planner/generate", response_model=WorkoutPlanOut)
async def generate_workout_plan(payload: WorkoutIntakeIn, db: DbSession, user: MutationUser):
    saved = db.scalar(select(WorkoutIntake).where(WorkoutIntake.user_id == user.id))
    if saved:
        saved.data = payload.model_dump()
    else:
        db.add(WorkoutIntake(user_id=user.id, data=payload.model_dump()))
    db.commit()
    return await workout_planner.plan_week(payload)


@router.post("/workout-planner/generate-day", response_model=WorkoutPlanOut)
async def regenerate_workout_day(payload: WorkoutDayIn, _user: MutationUser):
    return await workout_planner.plan_day(payload.intake, payload.day, payload.focus)


@router.post("/workout-charts/full", response_model=WorkoutChartOut, status_code=201)
def create_full_workout_chart(payload: WorkoutChartFullIn, db: DbSession, user: MutationUser):
    chart = WorkoutChart(user_id=user.id, name=payload.name, notes=payload.notes, day_focus=payload.day_focus)
    positions: dict[str, int] = {}
    for planned in payload.items:
        positions[planned.day] = positions.get(planned.day, 0) + 1
        item = WorkoutChartItem(position=positions[planned.day], **planned.model_dump(exclude={"alternatives"}))
        item.alternatives = [WorkoutItemAlternative(**alt.model_dump()) for alt in planned.alternatives]
        chart.items.append(item)
    has_active = db.scalar(select(func.count()).select_from(WorkoutChart).where(WorkoutChart.user_id == user.id, WorkoutChart.is_active.is_(True)))
    db.add(chart)
    db.flush()
    if payload.activate or not has_active:
        _activate(db, WorkoutChart, user.id, chart)
    db.commit(); db.refresh(chart); return chart


@router.post("/workout-chart-items/{item_id}/swap", response_model=WorkoutChartItemOut)
def swap_workout_item(item_id: int, payload: SwapIn, db: DbSession, user: MutationUser):
    item = _owned_item(db, WorkoutChartItem, WorkoutChart, user.id, item_id)
    alt = next((a for a in item.alternatives if a.id == payload.alternative_id), None)
    if not alt:
        raise HTTPException(status_code=404, detail="Alternative not found")
    fields = ("exercise", "muscle_group", "sets", "reps", "duration_minutes", "rest_seconds", "notes")
    current = {f: getattr(item, f) for f in fields}
    for f in fields:
        setattr(item, f, getattr(alt, f))
        setattr(alt, f, current[f])
    db.commit(); db.refresh(item); return item
