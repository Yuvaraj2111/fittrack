"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { QuickMealForm } from "@/components/forms";
import { EmptyState, PageHeader } from "@/components/page";
import { api, today } from "@/lib/api";

type FoodLog = { id: number; name: string; meal_category: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number };

function Nutrition() {
  const client = useQueryClient(); const date = today();
  const logs = useQuery({ queryKey: ["food-logs", date], queryFn: () => api<FoodLog[]>(`/food-logs?local_date=${date}`) });
  const remove = useMutation({ mutationFn: (id: number) => api<void>(`/food-logs/${id}`, { method: "DELETE" }), onSuccess: () => { client.invalidateQueries({ queryKey: ["food-logs"] }); client.invalidateQueries({ queryKey: ["summary"] }); toast.success("Food entry removed"); }, onError: (e: Error) => toast.error(e.message) });
  const groups = ["breakfast", "morning snack", "lunch", "evening snack", "dinner"];
  return <main className="content"><PageHeader eyebrow="Food diary" title="Today’s nutrition" description="Log what you ate with values you know. Nutrition entries are user-entered or clearly attributable to a data source."/>
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><section className="card h-fit p-5"><h2 className="font-semibold">Add a meal</h2><p className="mb-4 mt-1 text-sm text-slate-500">All fields are validated before saving.</p><QuickMealForm compact/></section><section className="space-y-4">{logs.isLoading ? <div className="h-48 animate-pulse rounded-xl bg-slate-200"/> : !logs.data?.length ? <EmptyState title="Your diary is clear" detail="Add your first meal to build a reliable daily picture."/> : groups.map((group) => { const items = logs.data?.filter((log) => log.meal_category === group) ?? []; if (!items.length) return null; return <section className="card overflow-hidden" key={group}><div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="font-semibold capitalize">{group}</h2><span className="text-sm text-slate-500">{items.reduce((sum, item) => sum + Number(item.calories), 0).toFixed(0)} kcal</span></div><div>{items.map((item) => <div className="flex items-center justify-between gap-3 px-5 py-3" key={item.id}><div><p className="font-medium text-slate-800">{item.name}</p><p className="text-xs text-slate-500">P {item.protein_g}g · C {item.carbs_g}g · F {item.fat_g}g · Fiber {item.fiber_g}g</p></div><div className="flex items-center gap-2"><span className="text-sm font-semibold">{item.calories} kcal</span><button title={`Delete ${item.name}`} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove.mutate(item.id)}><Trash2 size={16}/></button></div></div>)}</div></section>; })}</section></div>
  </main>;
}
export default function NutritionPage() { return <AppShell><Nutrition/></AppShell>; }
