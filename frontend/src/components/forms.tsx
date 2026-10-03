"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { useState } from "react";
import { api, today } from "@/lib/api";

const mealSchema = z.object({ name: z.string().min(1, "Enter a food name"), serving_g: z.coerce.number().positive("Serving must be above zero"), calories: z.coerce.number().min(0), protein_g: z.coerce.number().min(0), carbs_g: z.coerce.number().min(0), fat_g: z.coerce.number().min(0), fiber_g: z.coerce.number().min(0), meal_category: z.string(), source: z.string() });
type MealValues = z.infer<typeof mealSchema>;
type ExternalFood = { barcode?: string | null; name: string; brand?: string | null; serving_g: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; source: "open_food_facts" };

function scaleNutrition(food: ExternalFood, grams: number) {
  const factor = grams / 100;
  return { calories: Number((food.calories * factor).toFixed(1)), protein_g: Number((food.protein_g * factor).toFixed(1)), carbs_g: Number((food.carbs_g * factor).toFixed(1)), fat_g: Number((food.fat_g * factor).toFixed(1)), fiber_g: Number((food.fiber_g * factor).toFixed(1)) };
}

export function QuickMealForm({ compact = false }: { compact?: boolean }) {
  const client = useQueryClient();
  const form = useForm<MealValues>({ resolver: zodResolver(mealSchema), defaultValues: { name: "", serving_g: 100, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, meal_category: "breakfast", source: "manual" } });
  const [searchTerm, setSearchTerm] = useState(""); const [results, setResults] = useState<ExternalFood[]>([]); const [selected, setSelected] = useState<ExternalFood | null>(null);
  const mutation = useMutation({ mutationFn: (values: MealValues) => api("/food-logs", { method: "POST", body: JSON.stringify({ ...values, local_date: today(), quantity: 1 }) }), onSuccess: () => { toast.success("Meal added to your diary"); form.reset(); setSelected(null); client.invalidateQueries({ queryKey: ["summary"] }); client.invalidateQueries({ queryKey: ["food-logs"] }); }, onError: (error: Error) => toast.error(error.message) });
  const search = useMutation({ mutationFn: async () => {
    const term = searchTerm.trim();
    if (term.length < 2) throw new Error("Enter at least 2 characters to search");
    const path = /^\d{8,18}$/.test(term) ? `/foods/barcode/${term}` : `/foods/search?q=${encodeURIComponent(term)}`;
    const data = await api<ExternalFood[] | ExternalFood>(path);
    return Array.isArray(data) ? data : [data];
  }, onSuccess: (items) => { setResults(items); if (!items.length) toast.message("No matching food was found. You can enter values manually."); }, onError: (error: Error) => toast.error(error.message) });
  function choose(food: ExternalFood) { const grams = food.serving_g || 100; setSelected(food); form.setValue("name", food.name); form.setValue("serving_g", grams); form.setValue("source", food.source); Object.entries(scaleNutrition(food, grams)).forEach(([field, value]) => form.setValue(field as keyof MealValues, value)); setResults([]); }
  function updateServing(value: number) { form.setValue("serving_g", value); if (selected) Object.entries(scaleNutrition(selected, value || 0)).forEach(([field, nutrient]) => form.setValue(field as keyof MealValues, nutrient)); }
  return <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2"}>
    <div className={compact ? "" : "sm:col-span-2"}><span className="mb-1 block text-xs font-medium text-slate-600">Find nutrition automatically</span><div className="flex gap-2"><input className="input" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search a packaged food or scan/type barcode"/><button type="button" className="btn btn-soft flex shrink-0 items-center gap-1" onClick={() => search.mutate()} disabled={search.isPending}><Search size={15}/>{search.isPending ? "Searching" : "Search"}</button></div>{results.length > 0 && <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-teal-100 bg-teal-50 p-1">{results.map((food) => <button type="button" onClick={() => choose(food)} key={`${food.barcode}-${food.name}`} className="block w-full rounded-md px-3 py-2 text-left hover:bg-white"><span className="block text-sm font-semibold">{food.name}</span><span className="text-xs text-slate-600">{food.brand ? `${food.brand} · ` : ""}{food.calories} kcal / 100 g</span></button>)}</div>}<p className="mt-1 text-xs text-slate-500">Open Food Facts values are community-supplied estimates. Check the package and adjust the serving if needed.</p></div>
    <label className={compact ? "" : "sm:col-span-2"}><span className="mb-1 block text-xs font-medium text-slate-600">Food</span><input className="input" placeholder="e.g. Paneer bhurji" {...form.register("name")}/>{form.formState.errors.name && <span className="text-xs text-red-600">{form.formState.errors.name.message}</span>}</label>
    <label><span className="mb-1 block text-xs font-medium text-slate-600">Meal</span><select className="input" {...form.register("meal_category")}><option>breakfast</option><option>morning snack</option><option>lunch</option><option>evening snack</option><option>dinner</option></select></label>
    <label><span className="mb-1 block text-xs font-medium text-slate-600">Serving (g)</span><input className="input" type="number" min="1" step="1" {...form.register("serving_g", { onChange: (event) => updateServing(Number(event.target.value)) })}/></label>
    {(["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const).map((field) => <label key={field}><span className="mb-1 block text-xs font-medium capitalize text-slate-600">{field.replace("_g", " (g)")}</span><input className="input" type="number" min="0" step="0.1" {...form.register(field)}/></label>)}
    <input type="hidden" {...form.register("source")}/>
    <button className="btn btn-primary sm:col-span-2 disabled:opacity-60" disabled={mutation.isPending}>{mutation.isPending ? "Adding…" : "Add to diary"}</button>
  </form>;
}
