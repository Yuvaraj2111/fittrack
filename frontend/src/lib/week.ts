export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABEL: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const DAY_SHORT: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const MEAL_SLOTS = ["breakfast", "morning snack", "lunch", "evening snack", "dinner"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Weekday key for the user's local date (JS getDay: 0 = Sunday). */
export function todayKey(date = new Date()): Day {
  return DAYS[(date.getDay() + 6) % 7];
}

export const MUSCLE_GROUPS = ["chest", "back", "shoulders", "arms", "legs", "core", "full body", "cardio", "mobility"] as const;
export const MUSCLE_COLOR: Record<string, string> = {
  chest: "#1a7770", back: "#3e9b4f", shoulders: "#7c5cc4", arms: "#f29f05", legs: "#d6456a",
  core: "#2e8bc0", "full body": "#364543", cardio: "#e77fa3", mobility: "#9aa9a5",
};

export const MACRO_COLOR = { protein: "#1a7770", carbs: "#f29f05", fat: "#d6456a", fiber: "#3e9b4f" };

export const n = (value: number | string | null | undefined) => Number(value ?? 0);
export const fmt = (value: number) => new Intl.NumberFormat("en-IN").format(Math.round(value));
