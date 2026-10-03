from datetime import date, datetime, time
from decimal import Decimal
from typing import Optional
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORMModel):
    id: int
    email: EmailStr
    name: str


class ProfileIn(BaseModel):
    units: str = Field(default="metric", pattern="^(metric|imperial)$")
    timezone: str = Field(default="Asia/Kolkata", max_length=64)
    height_cm: Optional[Decimal] = Field(default=None, ge=50, le=300)
    calorie_goal: int = Field(default=2200, ge=500, le=10000)
    protein_goal_g: int = Field(default=120, ge=0, le=1000)
    carb_goal_g: int = Field(default=250, ge=0, le=2000)
    fat_goal_g: int = Field(default=70, ge=0, le=1000)
    fiber_goal_g: int = Field(default=30, ge=0, le=500)
    step_goal: int = Field(default=8000, ge=0, le=100000)
    hydration_goal_ml: int = Field(default=2500, ge=0, le=20000)


class ProfileOut(ProfileIn, ORMModel):
    id: int
    user_id: int


class FoodIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    brand: Optional[str] = Field(default=None, max_length=120)
    serving_g: Decimal = Field(default=100, gt=0, le=5000)
    calories: Decimal = Field(ge=0, le=10000)
    protein_g: Decimal = Field(default=0, ge=0, le=1000)
    carbs_g: Decimal = Field(default=0, ge=0, le=1000)
    fat_g: Decimal = Field(default=0, ge=0, le=1000)
    fiber_g: Decimal = Field(default=0, ge=0, le=1000)


class FoodOut(FoodIn, ORMModel):
    id: int
    source: str


class FoodLogIn(BaseModel):
    food_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=180)
    meal_category: str = Field(default="breakfast", max_length=40)
    local_date: date
    serving_g: Decimal = Field(default=100, gt=0, le=5000)
    quantity: Decimal = Field(default=1, gt=0, le=50)
    calories: Decimal = Field(ge=0, le=10000)
    protein_g: Decimal = Field(default=0, ge=0, le=1000)
    carbs_g: Decimal = Field(default=0, ge=0, le=1000)
    fat_g: Decimal = Field(default=0, ge=0, le=1000)
    fiber_g: Decimal = Field(default=0, ge=0, le=1000)
    source: str = Field(default="manual", max_length=32)
    notes: Optional[str] = Field(default=None, max_length=1000)


class FoodLogOut(FoodLogIn, ORMModel):
    id: int
    logged_at: datetime


class ExternalFoodOut(BaseModel):
    barcode: Optional[str] = None
    name: str
    brand: Optional[str] = None
    serving_g: Decimal = Field(default=100, gt=0)
    calories: Decimal = Field(ge=0)
    protein_g: Decimal = Field(ge=0)
    carbs_g: Decimal = Field(ge=0)
    fat_g: Decimal = Field(ge=0)
    fiber_g: Decimal = Field(ge=0)
    source: str = "open_food_facts"


class HydrationIn(BaseModel):
    amount_ml: int = Field(gt=0, le=5000)
    local_date: date


class HydrationOut(HydrationIn, ORMModel):
    id: int
    logged_at: datetime


class StepIn(BaseModel):
    local_date: date
    steps: int = Field(ge=0, le=200000)
    distance_km: Optional[Decimal] = Field(default=None, ge=0, le=1000)
    active_minutes: Optional[int] = Field(default=None, ge=0, le=1440)


class StepOut(StepIn, ORMModel):
    id: int


class WeightIn(BaseModel):
    local_date: date
    weight_kg: Decimal = Field(gt=10, le=500)
    notes: Optional[str] = Field(default=None, max_length=1000)


class WeightOut(WeightIn, ORMModel):
    id: int


class WorkoutIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    local_date: date


class WorkoutFinishIn(BaseModel):
    # When omitted, the API derives duration from the persisted start timestamp.
    duration_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    total_volume_kg: Decimal = Field(default=0, ge=0, le=10000000)


class WorkoutOut(ORMModel):
    id: int
    name: str
    local_date: date
    started_at: datetime
    completed_at: Optional[datetime]
    duration_minutes: Optional[int]
    total_volume_kg: Decimal
    status: str


class SupplementIn(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    brand: Optional[str] = Field(default=None, max_length=120)
    category: str = Field(default="other", max_length=70)
    stock_units: Optional[Decimal] = Field(default=None, ge=0)
    expiry_date: Optional[date] = None


class SupplementOut(SupplementIn, ORMModel):
    id: int


class MedicationIn(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    medication_type: Optional[str] = Field(default=None, max_length=80)
    dosage_text: str = Field(min_length=1, max_length=180)
    schedule_times: list[str] = Field(default_factory=list)
    start_date: date
    end_date: Optional[date] = None


class MedicationOut(MedicationIn, ORMModel):
    id: int


class GoalIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    goal_type: str = Field(default="habit", max_length=50)
    target: Decimal = Field(gt=0)
    current: Decimal = Field(default=0, ge=0)
    unit: str = Field(default="", max_length=24)
    active: bool = True


class GoalOut(GoalIn, ORMModel):
    id: int


class ReminderIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    reminder_type: str = Field(default="custom", max_length=40)
    scheduled_time: time
    recurrence: str = Field(default="daily", max_length=40)
    enabled: bool = True


class ReminderOut(ReminderIn, ORMModel):
    id: int


Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MealSlot = Literal["breakfast", "morning snack", "lunch", "evening snack", "dinner"]


class DietChartIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    target_calories: Optional[int] = Field(default=None, ge=500, le=10000)
    notes: Optional[str] = Field(default=None, max_length=1000)


class DietChartItemIn(BaseModel):
    day: Weekday
    meal_slot: MealSlot
    food_name: str = Field(min_length=1, max_length=180)
    portion: Optional[str] = Field(default=None, max_length=80)
    calories: Decimal = Field(default=0, ge=0, le=10000)
    protein_g: Decimal = Field(default=0, ge=0, le=1000)
    carbs_g: Decimal = Field(default=0, ge=0, le=1000)
    fat_g: Decimal = Field(default=0, ge=0, le=1000)


class DietChartItemOut(DietChartItemIn, ORMModel):
    id: int
    chart_id: int
    position: int


class DietChartOut(DietChartIn, ORMModel):
    id: int
    is_active: bool
    created_at: datetime
    items: list[DietChartItemOut] = []


class WorkoutChartIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=1000)
    day_focus: dict[Weekday, str] = Field(default_factory=dict)


class WorkoutChartItemIn(BaseModel):
    day: Weekday
    exercise: str = Field(min_length=1, max_length=160)
    muscle_group: str = Field(default="full body", max_length=40)
    sets: int = Field(default=0, ge=0, le=50)
    reps: Optional[str] = Field(default=None, max_length=20)
    weight_kg: Optional[Decimal] = Field(default=None, ge=0, le=1000)
    duration_minutes: Optional[int] = Field(default=None, ge=0, le=600)
    rest_seconds: Optional[int] = Field(default=None, ge=0, le=1800)
    notes: Optional[str] = Field(default=None, max_length=240)


class WorkoutChartItemOut(WorkoutChartItemIn, ORMModel):
    id: int
    chart_id: int
    position: int


class WorkoutChartOut(WorkoutChartIn, ORMModel):
    id: int
    is_active: bool
    created_at: datetime
    items: list[WorkoutChartItemOut] = []
