from __future__ import annotations
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    profile: Mapped["UserProfile"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)


class UserProfile(Base):
    __tablename__ = "user_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    units: Mapped[str] = mapped_column(String(12), default="metric")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    height_cm: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 2), nullable=True)
    calorie_goal: Mapped[int] = mapped_column(Integer, default=2200)
    protein_goal_g: Mapped[int] = mapped_column(Integer, default=120)
    carb_goal_g: Mapped[int] = mapped_column(Integer, default=250)
    fat_goal_g: Mapped[int] = mapped_column(Integer, default=70)
    fiber_goal_g: Mapped[int] = mapped_column(Integer, default=30)
    step_goal: Mapped[int] = mapped_column(Integer, default=8000)
    hydration_goal_ml: Mapped[int] = mapped_column(Integer, default=2500)
    user: Mapped[User] = relationship(back_populates="profile")


class OwnedTimestamped:
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Food(Base, OwnedTimestamped):
    __tablename__ = "foods"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    brand: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    serving_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=100)
    calories: Mapped[Decimal] = mapped_column(Numeric(9, 2))
    protein_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    carbs_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    fat_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    fiber_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    source: Mapped[str] = mapped_column(String(32), default="custom")
    __table_args__ = (Index("ix_food_owner_name", "user_id", "name"),)


class FoodLog(Base, OwnedTimestamped):
    __tablename__ = "food_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    food_id: Mapped[Optional[int]] = mapped_column(ForeignKey("foods.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(180))
    meal_category: Mapped[str] = mapped_column(String(40), default="breakfast")
    local_date: Mapped[date] = mapped_column(Date, index=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    serving_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=100)
    quantity: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=1)
    calories: Mapped[Decimal] = mapped_column(Numeric(9, 2))
    protein_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    carbs_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    fat_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    fiber_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    __table_args__ = (Index("ix_food_log_owner_date", "user_id", "local_date"),)


class HydrationLog(Base, OwnedTimestamped):
    __tablename__ = "hydration_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    local_date: Mapped[date] = mapped_column(Date, index=True)
    amount_ml: Mapped[int] = mapped_column(Integer)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    __table_args__ = (Index("ix_hydration_owner_date", "user_id", "local_date"),)


class StepLog(Base, OwnedTimestamped):
    __tablename__ = "step_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    local_date: Mapped[date] = mapped_column(Date, index=True)
    steps: Mapped[int] = mapped_column(Integer)
    distance_km: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 2), nullable=True)
    active_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    __table_args__ = (UniqueConstraint("user_id", "local_date", name="uq_step_log_owner_date"),)


class WeightLog(Base, OwnedTimestamped):
    __tablename__ = "weight_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    local_date: Mapped[date] = mapped_column(Date, index=True)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    __table_args__ = (Index("ix_weight_owner_date", "user_id", "local_date"),)


class BodyMeasurement(Base, OwnedTimestamped):
    __tablename__ = "body_measurements"
    id: Mapped[int] = mapped_column(primary_key=True)
    local_date: Mapped[date] = mapped_column(Date, index=True)
    measurement_type: Mapped[str] = mapped_column(String(50))
    value_cm: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    __table_args__ = (Index("ix_measurement_owner_type_date", "user_id", "measurement_type", "local_date"),)


class Exercise(Base, OwnedTimestamped):
    __tablename__ = "exercises"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    muscle_group: Mapped[str] = mapped_column(String(60), default="other")
    equipment: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class WorkoutPlan(Base, OwnedTimestamped):
    __tablename__ = "workout_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    scheduled_day: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class WorkoutSession(Base, OwnedTimestamped):
    __tablename__ = "workout_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workout_plans.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(160))
    local_date: Mapped[date] = mapped_column(Date, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_volume_kg: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    __table_args__ = (Index("ix_workout_owner_date", "user_id", "local_date"),)


class Supplement(Base, OwnedTimestamped):
    __tablename__ = "supplements"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(140))
    brand: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    category: Mapped[str] = mapped_column(String(70), default="other")
    stock_units: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 2), nullable=True)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)


class Medication(Base, OwnedTimestamped):
    __tablename__ = "medications"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(140))
    medication_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    dosage_text: Mapped[str] = mapped_column(String(180))
    schedule_times: Mapped[list] = mapped_column(JSON, default=list)
    start_date: Mapped[date] = mapped_column(Date, default=date.today)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)


class UserGoal(Base, OwnedTimestamped):
    __tablename__ = "user_goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    goal_type: Mapped[str] = mapped_column(String(50), default="habit")
    target: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    current: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    unit: Mapped[str] = mapped_column(String(24), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Reminder(Base, OwnedTimestamped):
    __tablename__ = "reminders"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    reminder_type: Mapped[str] = mapped_column(String(40), default="custom")
    scheduled_time: Mapped[Time] = mapped_column(Time)
    recurrence: Mapped[str] = mapped_column(String(40), default="daily")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class DietChart(Base, OwnedTimestamped):
    """A reusable weekly diet chart: meals planned per weekday and meal slot."""
    __tablename__ = "diet_charts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    target_calories: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    items: Mapped[list["DietChartItem"]] = relationship(back_populates="chart", cascade="all, delete-orphan", order_by="DietChartItem.position")


class DietChartItem(Base):
    __tablename__ = "diet_chart_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    chart_id: Mapped[int] = mapped_column(ForeignKey("diet_charts.id", ondelete="CASCADE"), index=True)
    day: Mapped[str] = mapped_column(String(3))  # mon..sun
    meal_slot: Mapped[str] = mapped_column(String(40))
    food_name: Mapped[str] = mapped_column(String(180))
    portion: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    calories: Mapped[Decimal] = mapped_column(Numeric(9, 2), default=0)
    protein_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    carbs_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    fat_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)
    chart: Mapped[DietChart] = relationship(back_populates="items")
    __table_args__ = (Index("ix_diet_item_chart_day", "chart_id", "day"),)


class WorkoutChart(Base, OwnedTimestamped):
    """A reusable weekly training split: exercises planned per weekday."""
    __tablename__ = "workout_charts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    day_focus: Mapped[dict] = mapped_column(JSON, default=dict)  # {"mon": "Push", ...}
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    items: Mapped[list["WorkoutChartItem"]] = relationship(back_populates="chart", cascade="all, delete-orphan", order_by="WorkoutChartItem.position")


class WorkoutChartItem(Base):
    __tablename__ = "workout_chart_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    chart_id: Mapped[int] = mapped_column(ForeignKey("workout_charts.id", ondelete="CASCADE"), index=True)
    day: Mapped[str] = mapped_column(String(3))
    exercise: Mapped[str] = mapped_column(String(160))
    muscle_group: Mapped[str] = mapped_column(String(40), default="full body")
    sets: Mapped[int] = mapped_column(Integer, default=0)
    reps: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # "8-12" allowed
    weight_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 2), nullable=True)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rest_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(240), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    chart: Mapped[WorkoutChart] = relationship(back_populates="items")
    __table_args__ = (Index("ix_workout_item_chart_day", "chart_id", "day"),)


# Additional normalized entities are deliberately retained as named models in the roadmap
# migrations: Recipe, RecipeIngredient, MealPlan, MealPlanItem, WorkoutPlanExercise,
# WorkoutExerciseLog, WorkoutSet, SupplementSchedule, SupplementLog, MedicationSchedule,
# MedicationLog, ActivitySession, Habit, HabitLog, NotificationLog and UserPreferences.
