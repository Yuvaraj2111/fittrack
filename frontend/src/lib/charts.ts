import type { Day, MealSlot } from "./week";

export type Nutrition = { food_name: string; portion: string | null; calories: number | string; protein_g: number | string; carbs_g: number | string; fat_g: number | string };
export type DietAlternative = Nutrition & { id: number };
export type DietItem = Nutrition & { id: number; chart_id: number; day: Day; meal_slot: MealSlot; position: number; alternatives?: DietAlternative[] };
export type DietChart = { id: number; name: string; target_calories: number | null; notes: string | null; is_active: boolean; created_at: string; items: DietItem[] };

export type Exercise = { exercise: string; muscle_group: string; sets: number; reps: string | null; weight_kg?: number | string | null; duration_minutes: number | null; rest_seconds: number | null; notes: string | null };
export type WorkoutAlternative = Exercise & { id: number };
export type WorkoutItem = Exercise & { id: number; chart_id: number; day: Day; position: number; alternatives?: WorkoutAlternative[] };
export type WorkoutChart = { id: number; name: string; notes: string | null; day_focus: Partial<Record<Day, string>>; is_active: boolean; created_at: string; items: WorkoutItem[] };

/** "4 × 8-10 · 60 kg" or "20 min" — a compact prescription line for a planned exercise. */
export function prescription(item: Exercise) {
  const parts: string[] = [];
  if (item.sets) parts.push(item.reps ? `${item.sets} × ${item.reps}` : `${item.sets} sets`);
  if (item.weight_kg !== null && item.weight_kg !== undefined && Number(item.weight_kg) > 0) parts.push(`${Number(item.weight_kg)} kg`);
  if (item.duration_minutes) parts.push(`${item.duration_minutes} min`);
  if (item.rest_seconds) parts.push(`rest ${item.rest_seconds}s`);
  return parts.join(" · ");
}
