import type { Day, MealSlot } from "./week";

export type DietItem = { id: number; chart_id: number; day: Day; meal_slot: MealSlot; food_name: string; portion: string | null; calories: number | string; protein_g: number | string; carbs_g: number | string; fat_g: number | string; position: number };
export type DietChart = { id: number; name: string; target_calories: number | null; notes: string | null; is_active: boolean; created_at: string; items: DietItem[] };

export type WorkoutItem = { id: number; chart_id: number; day: Day; exercise: string; muscle_group: string; sets: number; reps: string | null; weight_kg: number | string | null; duration_minutes: number | null; rest_seconds: number | null; notes: string | null; position: number };
export type WorkoutChart = { id: number; name: string; notes: string | null; day_focus: Partial<Record<Day, string>>; is_active: boolean; created_at: string; items: WorkoutItem[] };

/** "4 × 8-10 · 60 kg" or "20 min" — a compact prescription line for a planned exercise. */
export function prescription(item: WorkoutItem) {
  const parts: string[] = [];
  if (item.sets) parts.push(item.reps ? `${item.sets} × ${item.reps}` : `${item.sets} sets`);
  if (item.weight_kg !== null && item.weight_kg !== undefined && Number(item.weight_kg) > 0) parts.push(`${Number(item.weight_kg)} kg`);
  if (item.duration_minutes) parts.push(`${item.duration_minutes} min`);
  if (item.rest_seconds) parts.push(`rest ${item.rest_seconds}s`);
  return parts.join(" · ");
}
