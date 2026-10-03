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
  chest: "#2f4bd8", back: "#1fa37a", shoulders: "#8a5cf6", arms: "#f0a202", legs: "#e0445a",
  core: "#0e9bb5", "full body": "#3c4859", cardio: "#f2709c", mobility: "#8fa3b8",
};

export const MACRO_COLOR = { protein: "#2f4bd8", carbs: "#f0a202", fat: "#e0445a", fiber: "#1fa37a" };

export const n = (value: number | string | null | undefined) => Number(value ?? 0);
export const fmt = (value: number) => new Intl.NumberFormat("en-IN").format(Math.round(value));
