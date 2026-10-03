"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Droplets, Dumbbell, Footprints, Plus, Salad, Scale, Utensils } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PageHeader, ProgressBar } from "@/components/page";
import { QuickMealForm } from "@/components/forms";
import { api, today } from "@/lib/api";
import { prescription, type DietChart, type WorkoutChart } from "@/lib/charts";
import { MEAL_SLOTS, MUSCLE_COLOR, fmt, n, todayKey } from "@/lib/week";

type Summary = { date: string; goals: Record<string, number>; nutrition: Record<string, number>; hydration_ml: number; steps: number; latest_weight_kg: number | null; workouts: { id: number; name: string; status: string; duration_minutes: number | null }[] };
type Trend = { date: string; calories: number; protein_g: number };

function MetricCard({ icon, label, value, target, unit, color, accent, decimals = 0 }: { icon: React.ReactNode; label: string; value: number; target?: number; unit: string; color: string; accent: string; decimals?: number }) {
  const pct = target ? Math.round((value / target) * 100) : null;
  return <section className="card p-5">
    <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{label}</p><span style={{ color: accent }}>{icon}</span></div>
    <p className="mt-2 stat-value">{value ? (decimals ? value.toFixed(decimals) : fmt(value)) : target ? "0" : "—"}<span className="stat-unit">{unit}</span></p>
    {target ? <div className="mt-4"><ProgressBar value={value} max={target} color={color}/><p className="mt-2 text-xs text-slate-500"><span className="num font-semibold text-slate-700">{pct}%</span> of {fmt(target)} {unit}</p></div>
      : <p className="mt-4 text-xs text-slate-500">Most recent entry</p>}
  </section>;
}

function TodaysPlan() {
  const day = todayKey();
  const diet = useQuery({ queryKey: ["diet-charts"], queryFn: () => api<DietChart[]>("/diet-charts") });
  const training = useQuery({ queryKey: ["workout-charts"], queryFn: () => api<WorkoutChart[]>("/workout-charts") });
  const dietChart = diet.data?.find((c) => c.is_active);
  const workoutChart = training.data?.find((c) => c.is_active);
  const meals = dietChart?.items.filter((i) => i.day === day) ?? [];
  const exercises = workoutChart?.items.filter((i) => i.day === day) ?? [];
  const planned = meals.reduce((s, i) => s + n(i.calories), 0);
  return <section className="mb-6 grid gap-4 lg:grid-cols-2">
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Salad size={19} className="text-amberline"/><h2 className="font-display text-xl font-bold">Today’s meals</h2></div><Link href="/diet-chart" className="text-sm font-semibold text-teal-700 hover:underline">Diet chart</Link></div>
      {!dietChart ? <EmptyState title="No diet chart yet" detail="Plan your week’s meals once and they’ll show up here every day." action={<Link className="btn btn-soft" href="/diet-chart">Create a diet chart</Link>}/>
        : !meals.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Nothing planned today in “{dietChart.name}”.</p>
        : <><ul className="divide-y divide-slate-100">{MEAL_SLOTS.map((slot) => { const list = meals.filter((m) => m.meal_slot === slot); if (!list.length) return null; return <li key={slot} className="flex gap-3 py-2.5"><span className="w-28 shrink-0 text-sm capitalize text-slate-500">{slot}</span><span className="min-w-0 flex-1 text-sm font-medium">{list.map((m) => m.food_name).join(", ")}</span><span className="num shrink-0 text-sm font-semibold">{fmt(list.reduce((s, m) => s + n(m.calories), 0))}</span></li>; })}</ul>
          <p className="mt-2 text-right text-sm text-slate-500">Planned <b className="num text-base text-ink">{fmt(planned)} kcal</b></p></>}
    </div>
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={19} className="text-teal-600"/><h2 className="font-display text-xl font-bold">Today’s training{workoutChart?.day_focus[day] ? `: ${workoutChart.day_focus[day]}` : ""}</h2></div><Link href="/workout-chart" className="text-sm font-semibold text-teal-700 hover:underline">Workout chart</Link></div>
      {!workoutChart ? <EmptyState title="No workout chart yet" detail="Set up your weekly split and today’s exercises will appear here." action={<Link className="btn btn-soft" href="/workout-chart">Create a workout chart</Link>}/>
        : !exercises.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Rest day in “{workoutChart.name}”. Recovery counts too.</p>
        : <ul className="divide-y divide-slate-100">{exercises.map((e) => <li key={e.id} className="flex items-center gap-3 py-2.5"><span className="dot" style={{ background: MUSCLE_COLOR[e.muscle_group] ?? "#8fa3b8" }}/><span className="min-w-0 flex-1 text-sm font-medium">{e.exercise}</span><span className="num shrink-0 text-sm text-slate-600">{prescription(e)}</span></li>)}</ul>}
    </div>
  </section>;
}

function DashboardContent() {
  const client = useQueryClient(); const date = today();
  const summary = useQuery({ queryKey: ["summary", date], queryFn: () => api<Summary>(`/dashboard/summary?local_date=${date}`) });
  const trend = useQuery({ queryKey: ["nutrition-trend"], queryFn: () => api<Trend[]>("/analytics/nutrition?days=7") });
  const water = useMutation({ mutationFn: (amount_ml: number) => api("/hydration", { method: "POST", body: JSON.stringify({ amount_ml, local_date: date }) }), onSuccess: () => { client.invalidateQueries({ queryKey: ["summary"] }); toast.success("Hydration logged"); }, onError: (e: Error) => toast.error(e.message) });
  const data = summary.data;
  if (summary.isLoading) return <div className="content"><div className="h-52 animate-pulse rounded-2xl bg-slate-200"/></div>;
  if (!data) return <div className="content"><EmptyState title="The dashboard couldn’t load" detail="Check that the API is running on port 8000, then refresh this page."/></div>;
  const nutrition = data.nutrition, goals = data.goals;
  const ratio = (v: number, t: number) => (t ? Math.min(v / t, 1) : 0);
  const completion = Math.round(((ratio(nutrition.calories, goals.calories) + ratio(data.steps, goals.steps) + ratio(data.hydration_ml, goals.hydration_ml)) / 3) * 100);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return <main className="content">
    <PageHeader title={greeting} description={`Today’s routine is ${completion}% complete across food, steps and water.`} action={<button className="btn btn-primary" onClick={() => document.getElementById("quick-meal")?.scrollIntoView({ behavior: "smooth" })}><Plus size={16}/>Log a meal</button>}/>
    <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={<Utensils size={19}/>} label="Energy" value={nutrition.calories} target={goals.calories} unit="kcal" color="bg-amberline" accent="#f0a202"/>
      <MetricCard icon={<Footprints size={19}/>} label="Steps" value={data.steps} target={goals.steps} unit="steps" color="bg-teal-600" accent="#2f4bd8"/>
      <MetricCard icon={<Droplets size={19}/>} label="Water" value={data.hydration_ml} target={goals.hydration_ml} unit="ml" color="bg-mintline" accent="#1fa37a"/>
      <MetricCard icon={<Scale size={19}/>} label="Weight" value={data.latest_weight_kg ?? 0} unit="kg" color="" accent="#3c4859" decimals={1}/>
    </section>
    <TodaysPlan/>
    <section className="mb-6 grid gap-4 xl:grid-cols-[1.45fr_.9fr]">
      <div className="card p-5"><h2 className="font-display text-xl font-bold">Macros today</h2><p className="mb-5 text-sm text-slate-500">Logged intake against your targets</p>
        <div className="space-y-4">{([["Protein", nutrition.protein_g, goals.protein_g, "bg-teal-600"], ["Carbohydrates", nutrition.carbs_g, goals.carbs_g, "bg-amberline"], ["Fat", nutrition.fat_g, goals.fat_g, "bg-roseline"], ["Fibre", nutrition.fiber_g, goals.fiber_g, "bg-mintline"]] as const).map(([label, value, target, color]) => <div key={label}><div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{label}</span><span className="num"><b className="text-[1.05rem]">{fmt(value)}</b><span className="text-slate-500"> / {fmt(target)} g</span></span></div><ProgressBar value={value} max={target} color={color}/></div>)}</div></div>
      <div className="card p-5"><h2 className="font-display text-xl font-bold">Water</h2><p className="text-sm text-slate-500">Tap what you just drank.</p>
        <p className="mt-4 stat-value text-mintline">{fmt(data.hydration_ml)}<span className="stat-unit">of {fmt(goals.hydration_ml)} ml</span></p>
        <div className="mt-3"><ProgressBar value={data.hydration_ml} max={goals.hydration_ml} color="bg-mintline"/></div>
        <div className="mt-5 grid grid-cols-3 gap-2">{[250, 350, 500].map((amount) => <button key={amount} className="btn btn-ghost" onClick={() => water.mutate(amount)} disabled={water.isPending}>+{amount} ml</button>)}</div></div>
    </section>
    <section className="mb-6 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
      <div className="card p-5"><h2 className="font-display text-xl font-bold">Calories this week</h2><p className="mb-4 text-sm text-slate-500">From your food diary; the dashed line is your daily target.</p>
        {trend.data?.length ? <div className="h-60"><ResponsiveContainer><BarChart data={trend.data} margin={{ left: -12, right: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e8ee"/><XAxis dataKey="date" tickFormatter={(v) => format(new Date(String(v) + "T00:00:00"), "EEE d")} tickLine={false} axisLine={false} fontSize={12}/><YAxis tickLine={false} axisLine={false} fontSize={12}/><Tooltip cursor={{ fill: "#eef1f4" }} formatter={(v: number) => [`${fmt(v)} kcal`, "Calories"]}/><ReferenceLine y={goals.calories} stroke="#18212e" strokeDasharray="5 4"/><Bar dataKey="calories" fill="#f0a202" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer></div> : <EmptyState title="No meal trend yet" detail="Log a meal to begin your weekly view."/>}</div>
      <div className="card p-5"><div className="flex items-center justify-between"><h2 className="font-display text-xl font-bold">Sessions today</h2><Dumbbell size={19} className="text-teal-600"/></div>
        {data.workouts.length ? <div className="mt-4 space-y-2">{data.workouts.map((w) => <div className="card-flat flex items-center justify-between p-3" key={w.id}><p className="font-medium">{w.name}</p><span className={`chip ${w.status === "completed" ? "bg-teal-50 text-teal-700" : ""}`}>{w.status === "completed" ? `${w.duration_minutes ?? 0} min` : "In progress"}</span></div>)}</div>
          : <div className="mt-4"><EmptyState title="No session logged" detail="Start one from your workout chart or the Workouts page." action={<Link href="/workouts" className="btn btn-soft">Open workouts</Link>}/></div>}</div>
    </section>
    <section id="quick-meal" className="card max-w-3xl scroll-mt-20 p-5"><h2 className="font-display text-xl font-bold">Quick meal entry</h2><p className="mb-4 text-sm text-slate-500">Search a packaged food or type values you know.</p><QuickMealForm/></section>
  </main>;
}

export default function DashboardPage() { return <AppShell><DashboardContent/></AppShell>; }
