"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardList, Pencil, Plus, RefreshCw, Repeat, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LogoMark } from "@/components/logo";
import { Modal } from "@/components/modal";
import { ProgressBar } from "@/components/page";
import { api } from "@/lib/api";
import type { WorkoutChart } from "@/lib/charts";
import { DAYS, DAY_LABEL, DAY_SHORT, MEAL_SLOTS, fmt, n, todayKey, type Day, type MealSlot } from "@/lib/week";

// ----------------------------------------------------------------- types
type Intake = {
  age: number; sex: "male" | "female" | "other"; height_cm: number; weight_kg: number;
  daily_activity: "desk" | "on_feet" | "physical"; workout_days: number; workout_types: string[];
  workout_time: "morning" | "afternoon" | "evening" | "varies"; workout_notes: string;
  goal: "lose" | "maintain" | "gain"; pace: "gentle" | "steady";
  diet_type: "vegan" | "veg" | "egg" | "nonveg"; region: string; meals_per_day: 3 | 4 | 5;
  usual_foods: string; likes: string; avoid: string; notes: string;
};
type Targets = { bmi: number; bmi_band: string; bmr: number; tdee: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; slots: Record<string, number>; notes: string[] };
type Food = { food_name: string; portion: string | null; calories: number; protein_g: number; carbs_g: number; fat_g: number };
type Planned = Food & { key: string; day: Day; meal_slot: MealSlot; alternatives: Food[] };
type Plan = { source: "ai" | "builtin" | "mixed"; targets: Targets; items: Omit<Planned, "key">[]; warnings: string[] };
type Draft = { name: string; source: Plan["source"]; targets: Targets; items: Planned[]; warnings: string[]; intake: Intake };
type IntakeResponse = { intake: Partial<Intake> | null; ai_enabled: boolean; known: { weight_kg: number | null; height_cm: number | null } };

const DRAFT_KEY = "fittrack-diet-draft";
const blankIntake: Intake = { age: 28, sex: "male", height_cm: 170, weight_kg: 70, daily_activity: "desk", workout_days: 3, workout_types: [], workout_time: "evening", workout_notes: "", goal: "maintain", pace: "gentle", diet_type: "veg", region: "tamil", meals_per_day: 5, usual_foods: "", likes: "", avoid: "", notes: "" };

const REGIONS: [string, string][] = [["tamil", "Tamil Nadu"], ["kerala", "Kerala"], ["karnataka", "Karnataka"], ["andhra", "Andhra Pradesh / Telangana"], ["north", "North India"], ["punjab", "Punjab"], ["east", "East India / Bengal"], ["west", "Gujarat / Maharashtra"], ["pan", "Mix of Indian cuisines"], ["intl", "Continental / international"]];
const REGION_FOODS: Record<string, string[]> = {
  tamil: ["Idli", "Dosa", "Pongal", "Sambar rice", "Curd rice", "Ragi koozh", "Sundal", "Kootu", "Rasam", "Chapati", "Kambu (millet)", "Keerai"],
  kerala: ["Puttu", "Appam", "Idiyappam", "Kerala red rice", "Avial", "Thoran", "Kadala curry", "Fish curry", "Kappa", "Moru (buttermilk)"],
  karnataka: ["Ragi mudde", "Bisi bele bath", "Neer dosa", "Akki roti", "Upma", "Saaru", "Palya", "Jolada rotti"],
  andhra: ["Pesarattu", "Pappu", "Gongura", "Upma", "Jonna rotte", "Rasam", "Curd rice", "Egg curry"],
  north: ["Roti", "Dal", "Rajma", "Chole", "Paneer", "Poha", "Paratha", "Khichdi", "Daliya", "Curd"],
  punjab: ["Makki roti", "Sarson saag", "Rajma", "Paneer", "Lassi", "Chole", "Dal makhani", "Paratha"],
  east: ["Rice", "Dal", "Macher jhol", "Shukto", "Chira", "Sattu", "Luchi (occasional)", "Mixed veg"],
  west: ["Poha", "Thepla", "Dhokla", "Bhakri", "Pithla", "Dal", "Khichdi", "Upma"],
  pan: ["Roti", "Rice", "Dal", "Idli", "Poha", "Paneer", "Curd", "Sprouts"],
  intl: ["Oats", "Eggs", "Greek yogurt", "Salad", "Quinoa", "Grilled chicken", "Tofu", "Wraps"],
};
const WORKOUTS = ["Gym / weights", "Walking", "Running", "Yoga", "Cricket / sports", "Cycling", "Swimming", "Home workout / HIIT", "Dance"];
const AVOID_CHIPS = ["Peanuts", "Dairy", "Gluten", "Eggs", "Seafood", "Mushroom", "Brinjal", "Deep-fried food", "Sugar"];
const STEPS = ["You", "Activity", "Goal", "Food", "Review"];
const uid = () => Math.random().toString(36).slice(2, 10);
const clean = (i: Intake) => ({ ...i, workout_notes: i.workout_notes || null, usual_foods: i.usual_foods || null, likes: i.likes || null, avoid: i.avoid || null, notes: i.notes || null });
const readDraft = (): Draft | null => { try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) as Draft : null; } catch { return null; } };
const writeDraft = (d: Draft | null) => { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ } };
const sum = (items: Food[], k: keyof Omit<Food, "food_name" | "portion">) => items.reduce((s, i) => s + n(i[k]), 0);

// ------------------------------------------------------------ small parts
function Choice<T extends string | number>({ value, current, onPick, title, detail }: { value: T; current: T; onPick: (v: T) => void; title: string; detail?: string }) {
  const on = value === current;
  return <button type="button" aria-pressed={on} onClick={() => onPick(value)} className={`rounded-xl border p-3.5 text-left transition-colors ${on ? "border-teal-600 bg-teal-50 shadow-[inset_0_0_0_1px_#2f4bd8]" : "border-slate-300 bg-white hover:border-teal-400"}`}>
    <span className="flex items-center justify-between gap-2 font-semibold">{title}{on && <Check size={16} className="text-teal-700"/>}</span>
    {detail && <span className="mt-0.5 block text-xs text-slate-500">{detail}</span>}
  </button>;
}
function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-teal-400"}`}>{label}</button>;
}
function Coach({ children }: { children: React.ReactNode }) {
  return <div className="mb-5 flex items-start gap-3"><LogoMark size={34}/><div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-[.97rem] shadow-sm ring-1 ring-slate-200">{children}</div></div>;
}
const addTerm = (text: string, term: string) => { const parts = text.split(",").map((p) => p.trim()).filter(Boolean); return parts.some((p) => p.toLowerCase() === term.toLowerCase()) ? parts.filter((p) => p.toLowerCase() !== term.toLowerCase()).join(", ") : [...parts, term].join(", "); };
const hasTerm = (text: string, term: string) => text.split(",").some((p) => p.trim().toLowerCase() === term.toLowerCase());

// ------------------------------------------------------------- the page
function Planner() {
  const router = useRouter(); const client = useQueryClient();
  const meta = useQuery({ queryKey: ["diet-intake"], queryFn: () => api<IntakeResponse>("/diet-planner/intake") });
  const [intake, setIntake] = useState<Intake>(blankIntake);
  const [step, setStep] = useState(0);
  const [heightUnit, setHeightUnit] = useState<"cm" | "ft">("cm");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resumable, setResumable] = useState<Draft | null>(null);
  const set = <K extends keyof Intake>(key: K, value: Intake[K]) => setIntake((i) => ({ ...i, [key]: value }));

  useEffect(() => { setResumable(readDraft()); }, []);
  useEffect(() => {
    if (!meta.data) return;
    const { intake: saved, known } = meta.data;
    setIntake((i) => ({ ...i, ...(saved ?? {}), ...(known.weight_kg ? { weight_kg: known.weight_kg } : {}), ...(!saved?.height_cm && known.height_cm ? { height_cm: known.height_cm } : {}) } as Intake));
  }, [meta.data]);
  useEffect(() => { writeDraft(draft); }, [draft]);

  const targets = useQuery({ queryKey: ["diet-targets", intake], queryFn: () => api<Targets>("/diet-planner/targets", { method: "POST", body: JSON.stringify(clean(intake)) }), enabled: step === 4 });
  const workoutCharts = useQuery({ queryKey: ["workout-charts"], queryFn: () => api<WorkoutChart[]>("/workout-charts"), enabled: step === 1 });
  const generate = useMutation({
    mutationFn: () => api<Plan>("/diet-planner/generate", { method: "POST", body: JSON.stringify(clean(intake)) }),
    onSuccess: (plan) => { setDraft({ name: `My ${intake.goal === "lose" ? "fat-loss" : intake.goal === "gain" ? "muscle-gain" : "balanced"} plan`, source: plan.source, targets: plan.targets, warnings: plan.warnings, intake, items: plan.items.map((i) => ({ ...i, key: uid() })) }); window.scrollTo({ top: 0 }); },
    onError: (e: Error) => toast.error(e.message),
  });

  function fillFromWorkoutChart() {
    const chart = workoutCharts.data?.find((c) => c.is_active) ?? workoutCharts.data?.[0];
    if (!chart) return;
    const days = DAYS.filter((d) => chart.items.some((i) => i.day === d));
    const summary = days.map((d) => `${DAY_SHORT[d]}: ${chart.day_focus[d] || chart.items.filter((i) => i.day === d).map((i) => i.muscle_group).filter((v, k, a) => a.indexOf(v) === k).join("/")}`).join(", ");
    setIntake((i) => ({ ...i, workout_days: days.length, workout_types: i.workout_types.includes("Gym / weights") ? i.workout_types : [...i.workout_types, "Gym / weights"], workout_notes: `From my workout chart “${chart.name}”: ${summary}` }));
    toast.success("Filled in from your workout chart");
  }

  const ft = Math.floor(intake.height_cm / 30.48), inch = Math.round((intake.height_cm / 2.54) % 12);
  const canNext = [intake.age >= 13 && intake.height_cm >= 100 && intake.weight_kg >= 25, true, true, !!intake.region, true][step];

  if (draft) return <DraftEditor draft={draft} setDraft={setDraft} onBack={() => setDraft(null)} onSaved={(id) => { writeDraft(null); client.invalidateQueries({ queryKey: ["diet-charts"] }); client.invalidateQueries({ queryKey: ["profile"] }); client.invalidateQueries({ queryKey: ["summary"] }); router.push(`/diet-chart?chart=${id}`); }}/>;

  if (generate.isPending) return <main className="content"><div className="mx-auto mt-16 max-w-md text-center">
    <div className="mx-auto mb-5 grid h-16 w-16 animate-pulse place-items-center rounded-2xl bg-teal-600 text-white"><Sparkles size={30}/></div>
    <h1 className="text-4xl font-bold">Building your week…</h1>
    <p className="mt-3 text-slate-600">Planning 7 days of {REGIONS.find(([k]) => k === intake.region)?.[1]} meals around your targets, with two alternatives for each. This usually takes 10–30 seconds.</p>
  </div></main>;

  return <main className="content">
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><Link href="/diet-chart" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={15}/>Diet charts</Link><h1 className="mt-1 text-[2.6rem] font-bold leading-none">Diet planner</h1></div>
        {meta.data && <span className="chip">{meta.data.ai_enabled ? <><Sparkles size={13} className="text-teal-700"/>AI planning on</> : "Built-in regional planner"}</span>}
      </div>

      {resumable && <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 p-4" style={{ borderColor: "#bcc7f6" }}>
        <p className="text-sm"><b>You have an unsaved plan</b> — “{resumable.name}”.</p>
        <div className="flex gap-2"><button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => { writeDraft(null); setResumable(null); }}>Discard</button><button className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => { setIntake(resumable.intake); setDraft(resumable); }}>Continue editing</button></div>
      </div>}

      <ol className="mb-6 grid grid-cols-5 gap-1.5" aria-label="Progress">{STEPS.map((label, i) => <li key={label}><button type="button" disabled={i > step} onClick={() => setStep(i)} className="w-full text-left disabled:cursor-default"><span className={`block h-1.5 rounded-full ${i <= step ? "bg-teal-600" : "bg-slate-300"}`}/><span className={`mt-1.5 block text-xs font-semibold ${i === step ? "text-ink" : "text-slate-500"}`}>{label}</span></button></li>)}</ol>

      {step === 0 && <section>
        <Coach>Hi! I’ll ask a few quick questions and build a week of meals that suits you. <b>First, a little about you.</b></Coach>
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <label><span className="field-label">Age</span><input className="input num" type="number" min={13} max={100} value={intake.age} onChange={(e) => set("age", Number(e.target.value))}/></label>
          <div><span className="field-label">Sex</span><div className="grid grid-cols-3 gap-2">{(["male", "female", "other"] as const).map((s) => <Chip key={s} on={intake.sex === s} label={s === "other" ? "Prefer not to say" : s[0].toUpperCase() + s.slice(1)} onClick={() => set("sex", s)}/>)}</div></div>
          <div><div className="flex items-center justify-between"><span className="field-label">Height</span><button type="button" className="text-xs font-semibold text-teal-700" onClick={() => setHeightUnit(heightUnit === "cm" ? "ft" : "cm")}>Use {heightUnit === "cm" ? "feet / inches" : "cm"}</button></div>
            {heightUnit === "cm" ? <input className="input num" type="number" min={100} max={250} value={Math.round(intake.height_cm)} onChange={(e) => set("height_cm", Number(e.target.value))}/>
              : <div className="grid grid-cols-2 gap-2"><input className="input num" type="number" min={3} max={8} value={ft} aria-label="Feet" onChange={(e) => set("height_cm", Math.round((Number(e.target.value) * 12 + inch) * 2.54))}/><input className="input num" type="number" min={0} max={11} value={inch} aria-label="Inches" onChange={(e) => set("height_cm", Math.round((ft * 12 + Number(e.target.value)) * 2.54))}/></div>}</div>
          <label><span className="field-label">Weight (kg)</span><input className="input num" type="number" min={25} max={300} step="0.1" value={intake.weight_kg} onChange={(e) => set("weight_kg", Number(e.target.value))}/>{meta.data?.known.weight_kg && <span className="mt-1 block text-xs text-slate-500">From your latest weight entry</span>}</label>
        </div>
      </section>}

      {step === 1 && <section>
        <Coach><b>How active are you?</b> Your job and your workouts both change how much energy you need.</Coach>
        <div className="card grid gap-5 p-5">
          <div><span className="field-label">During a normal day you are…</span><div className="grid gap-2 sm:grid-cols-3">
            <Choice value="desk" current={intake.daily_activity} onPick={(v) => set("daily_activity", v)} title="Mostly sitting" detail="Desk job, studying, driving"/>
            <Choice value="on_feet" current={intake.daily_activity} onPick={(v) => set("daily_activity", v)} title="On my feet" detail="Teaching, retail, shooting on location"/>
            <Choice value="physical" current={intake.daily_activity} onPick={(v) => set("daily_activity", v)} title="Physical work" detail="Labour, farming, delivery"/>
          </div></div>
          <div><span className="field-label">Workout days per week</span><div className="flex flex-wrap gap-2">{[0, 1, 2, 3, 4, 5, 6, 7].map((d) => <Chip key={d} on={intake.workout_days === d} label={String(d)} onClick={() => set("workout_days", d)}/>)}</div></div>
          <div><span className="field-label">What do you do?</span><div className="flex flex-wrap gap-2">{WORKOUTS.map((w) => <Chip key={w} on={intake.workout_types.includes(w)} label={w} onClick={() => set("workout_types", intake.workout_types.includes(w) ? intake.workout_types.filter((x) => x !== w) : [...intake.workout_types, w])}/>)}</div></div>
          <div><span className="field-label">Usually when?</span><div className="flex flex-wrap gap-2">{(["morning", "afternoon", "evening", "varies"] as const).map((t) => <Chip key={t} on={intake.workout_time === t} label={t[0].toUpperCase() + t.slice(1)} onClick={() => set("workout_time", t)}/>)}</div></div>
          <label><div className="flex items-center justify-between"><span className="field-label">Describe your routine (optional)</span>{!!workoutCharts.data?.length && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700" onClick={fillFromWorkoutChart}><ClipboardList size={13}/>Use my workout chart</button>}</div>
            <textarea className="input" rows={2} maxLength={1000} value={intake.workout_notes} onChange={(e) => set("workout_notes", e.target.value)} placeholder="e.g. Push/pull/legs, 1 hour at 7 pm; 30 min walk every morning"/></label>
        </div>
      </section>}

      {step === 2 && <section>
        <Coach><b>What would you like this plan to do?</b></Coach>
        <div className="card grid gap-5 p-5">
          <div className="grid gap-2 sm:grid-cols-3">
            <Choice value="lose" current={intake.goal} onPick={(v) => set("goal", v)} title="Lose fat" detail="Eat a little less than you burn"/>
            <Choice value="maintain" current={intake.goal} onPick={(v) => set("goal", v)} title="Stay as I am" detail="Eat well at maintenance"/>
            <Choice value="gain" current={intake.goal} onPick={(v) => set("goal", v)} title="Gain muscle" detail="A small surplus with training"/>
          </div>
          {intake.goal !== "maintain" && <div><span className="field-label">Pace</span><div className="grid gap-2 sm:grid-cols-2">
            <Choice value="gentle" current={intake.pace} onPick={(v) => set("pace", v)} title="Gentle" detail={intake.goal === "lose" ? "About 0.25 kg a week. Easiest to stick with." : "About +250 kcal a day"}/>
            <Choice value="steady" current={intake.pace} onPick={(v) => set("pace", v)} title="Steady" detail={intake.goal === "lose" ? "About 0.5 kg a week" : "About +400 kcal a day"}/>
          </div></div>}
          <label><span className="field-label">Anything else to know? (optional)</span><input className="input" maxLength={500} value={intake.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. I skip breakfast on weekdays, I fast on Mondays, night shifts"/></label>
        </div>
      </section>}

      {step === 3 && <section>
        <Coach><b>Now, food.</b> Tell me what you normally eat, and I’ll plan around it with dishes that are easy to get where you live.</Coach>
        <div className="card grid gap-5 p-5">
          <div><span className="field-label">Diet</span><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Choice value="vegan" current={intake.diet_type} onPick={(v) => set("diet_type", v)} title="Vegan"/>
            <Choice value="veg" current={intake.diet_type} onPick={(v) => set("diet_type", v)} title="Vegetarian"/>
            <Choice value="egg" current={intake.diet_type} onPick={(v) => set("diet_type", v)} title="Eggetarian"/>
            <Choice value="nonveg" current={intake.diet_type} onPick={(v) => set("diet_type", v)} title="Non-veg"/>
          </div></div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <label><span className="field-label">Region / cuisine</span><select className="input" value={intake.region} onChange={(e) => set("region", e.target.value)}>{REGIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
            <div><span className="field-label">Meals a day</span><div className="flex gap-2">{([3, 4, 5] as const).map((m) => <Chip key={m} on={intake.meals_per_day === m} label={String(m)} onClick={() => set("meals_per_day", m)}/>)}</div></div>
          </div>
          <label><span className="field-label">What do you usually eat in a day?</span><textarea className="input" rows={3} maxLength={1500} value={intake.usual_foods} onChange={(e) => set("usual_foods", e.target.value)} placeholder="e.g. Morning: 3 idlis with sambar and coffee. Lunch: rice, sambar, poriyal, curd. Evening: tea and biscuits. Night: 2 chapatis with kurma."/></label>
          <div><span className="field-label">Foods you enjoy (tap to add)</span>
            <div className="mb-2 flex flex-wrap gap-2">{(REGION_FOODS[intake.region] ?? []).map((f) => <Chip key={f} on={hasTerm(intake.likes, f)} label={f} onClick={() => set("likes", addTerm(intake.likes, f))}/>)}</div>
            <input className="input" maxLength={500} value={intake.likes} onChange={(e) => set("likes", e.target.value)} placeholder="Or type your own, separated by commas"/></div>
          <div><span className="field-label">Allergies or foods to avoid</span>
            <div className="mb-2 flex flex-wrap gap-2">{AVOID_CHIPS.map((f) => <Chip key={f} on={hasTerm(intake.avoid, f)} label={f} onClick={() => set("avoid", addTerm(intake.avoid, f))}/>)}</div>
            <input className="input" maxLength={500} value={intake.avoid} onChange={(e) => set("avoid", e.target.value)} placeholder="e.g. peanuts, mushroom"/></div>
        </div>
      </section>}

      {step === 4 && <section>
        <Coach><b>Here’s what I worked out.</b> Check it over, then I’ll plan your week.</Coach>
        <div className="card p-5">
          {targets.isLoading || !targets.data ? <div className="h-40 animate-pulse rounded-xl bg-slate-100"/> : <>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <div><p className="text-sm text-slate-500">Daily target</p><p className="stat-value text-teal-700">{fmt(targets.data.calories)}<span className="stat-unit">kcal</span></p></div>
              <div><p className="text-sm text-slate-500">Maintenance</p><p className="stat-value">{fmt(targets.data.tdee)}<span className="stat-unit">kcal</span></p></div>
              <div><p className="text-sm text-slate-500">Protein</p><p className="stat-value">{targets.data.protein_g}<span className="stat-unit">g</span></p></div>
              <div><p className="text-sm text-slate-500">BMI</p><p className="stat-value">{targets.data.bmi}</p><p className="text-xs capitalize text-slate-500">{targets.data.bmi_band}</p></div>
            </div>
            <p className="mt-4 text-sm text-slate-600">Carbs {targets.data.carbs_g} g · Fat {targets.data.fat_g} g · Fibre {targets.data.fiber_g} g</p>
            <div className="mt-3 flex flex-wrap gap-2">{Object.entries(targets.data.slots).map(([slot, kcal]) => <span key={slot} className="chip capitalize">{slot} <b className="num">{kcal}</b></span>)}</div>
            {targets.data.notes.map((note) => <p key={note} className="mt-3 text-sm text-slate-600">{note}</p>)}
          </>}
          <table className="mt-5 w-full text-sm"><tbody className="divide-y divide-slate-100">{[
            ["You", `${intake.age} y · ${Math.round(intake.height_cm)} cm · ${intake.weight_kg} kg`],
            ["Activity", `${intake.workout_days} workout day${intake.workout_days === 1 ? "" : "s"}${intake.workout_types.length ? ` (${intake.workout_types.join(", ")})` : ""}, ${intake.workout_time}`],
            ["Goal", intake.goal === "maintain" ? "Stay as I am" : `${intake.goal === "lose" ? "Lose fat" : "Gain muscle"}, ${intake.pace}`],
            ["Food", `${({ vegan: "Vegan", veg: "Vegetarian", egg: "Eggetarian", nonveg: "Non-veg" })[intake.diet_type]} · ${REGIONS.find(([k]) => k === intake.region)?.[1]} · ${intake.meals_per_day} meals`],
            ["Avoid", intake.avoid || "Nothing"],
          ].map(([k, v]) => <tr key={k}><th className="w-28 py-2 text-left font-medium text-slate-500">{k}</th><td className="py-2">{v}</td></tr>)}</tbody></table>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">This is general guidance, not medical advice. If you have diabetes, thyroid, kidney or heart conditions, are pregnant, or take regular medication, check the plan with your doctor or a dietitian.</p>
        </div>
      </section>}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16}/>Back</button>
        {step < 4 ? <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next<ArrowRight size={16}/></button>
          : <button className="btn btn-primary px-5" disabled={!targets.data} onClick={() => generate.mutate()}><Sparkles size={16}/>Create my diet plan</button>}
      </div>
    </div>
  </main>;
}

// ---------------------------------------------------------- draft editor
type EditState = { key: string | null; day: Day; meal_slot: MealSlot; food_name: string; portion: string; calories: string; protein_g: string; carbs_g: string; fat_g: string };

function DraftEditor({ draft, setDraft, onBack, onSaved }: { draft: Draft; setDraft: (d: Draft | null) => void; onBack: () => void; onSaved: (id: number) => void }) {
  const firstDay = (DAYS.includes(todayKey()) ? todayKey() : "mon") as Day;
  const [day, setDay] = useState<Day>(firstDay);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [follow, setFollow] = useState(true);
  const [applyGoals, setApplyGoals] = useState(true);
  const t = draft.targets;
  const slots = MEAL_SLOTS.filter((s) => s in t.slots || draft.items.some((i) => i.meal_slot === s));
  const dayItems = draft.items.filter((i) => i.day === day);
  const update = (items: Planned[]) => setDraft({ ...draft, items });
  const dayTotals = useMemo(() => Object.fromEntries(DAYS.map((d) => [d, sum(draft.items.filter((i) => i.day === d), "calories")])), [draft.items]);
  const planned = DAYS.filter((d) => dayTotals[d] > 0);
  const avg = planned.length ? planned.reduce((s, d) => s + dayTotals[d], 0) / planned.length : 0;
  const avgProtein = planned.length ? sum(draft.items, "protein_g") / planned.length : 0;

  const regen = useMutation({
    mutationFn: () => api<Plan>("/diet-planner/generate-day", { method: "POST", body: JSON.stringify({ intake: clean(draft.intake), day }) }),
    onSuccess: (plan) => { setDraft({ ...draft, items: [...draft.items.filter((i) => i.day !== day), ...plan.items.map((i) => ({ ...i, key: uid() }))] }); toast.success(`New ideas for ${DAY_LABEL[day]}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => api<{ id: number }>("/diet-charts/full", { method: "POST", body: JSON.stringify({
      name: draft.name.trim() || "My diet plan", target_calories: t.calories, activate: follow, apply_goals: applyGoals ? t : null,
      notes: `${draft.source === "builtin" ? "Built-in planner" : "AI plan"} · ${fmt(t.calories)} kcal · protein ${t.protein_g} g · ${({ lose: "fat loss", maintain: "maintenance", gain: "muscle gain" })[draft.intake.goal]}`,
      items: draft.items.map(({ key: _key, ...rest }) => rest),
    }) }),
    onSuccess: (chart) => { toast.success("Diet chart saved"); onSaved(chart.id); },
    onError: (e: Error) => toast.error(e.message),
  });

  function swap(item: Planned, alt: Food) {
    update(draft.items.map((i) => i.key !== item.key ? i : { ...i, ...alt, alternatives: [{ food_name: item.food_name, portion: item.portion, calories: item.calories, protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g }, ...item.alternatives.filter((a) => a !== alt)] }));
  }
  function saveEdit(e: EditState) {
    const food = { food_name: e.food_name.trim(), portion: e.portion.trim() || null, calories: Number(e.calories || 0), protein_g: Number(e.protein_g || 0), carbs_g: Number(e.carbs_g || 0), fat_g: Number(e.fat_g || 0) };
    if (e.key) update(draft.items.map((i) => i.key === e.key ? { ...i, ...food, day: e.day, meal_slot: e.meal_slot } : i));
    else update([...draft.items, { ...food, key: uid(), day: e.day, meal_slot: e.meal_slot, alternatives: [] }]);
    setEdit(null);
  }

  return <main className="content pb-28">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1"><button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={15}/>Change my answers</button>
        <label className="mt-1 block"><span className="sr-only">Plan name</span><input className="w-full max-w-xl border-0 border-b-2 border-transparent bg-transparent font-display text-[2.4rem] font-bold leading-tight outline-none hover:border-slate-300 focus:border-teal-600" value={draft.name} maxLength={160} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
        <p className="text-sm text-slate-500">Review and edit your plan. Nothing is saved until you press <b>Save diet chart</b>.</p></div>
      <span className="chip">{draft.source === "builtin" ? "Built-in regional planner" : <><Sparkles size={13} className="text-teal-700"/>Generated with AI</>}</span>
    </div>

    {draft.warnings.map((w) => <p key={w} className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{w}</p>)}

    <section className="card mb-5 grid grid-cols-3 gap-4 p-5">
      <div><p className="text-sm text-slate-500">Daily target</p><p className="stat-value">{fmt(t.calories)}<span className="stat-unit">kcal</span></p></div>
      <div><p className="text-sm text-slate-500">Plan average</p><p className="stat-value">{fmt(avg)}<span className="stat-unit">kcal</span></p></div>
      <div><p className="text-sm text-slate-500">Avg protein</p><p className="stat-value">{fmt(avgProtein)}<span className="stat-unit">/ {t.protein_g} g</span></p></div>
    </section>

    <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist">{DAYS.map((d) => <button key={d} role="tab" aria-selected={day === d} onClick={() => setDay(d)} className={`shrink-0 rounded-xl border px-3.5 py-2 text-left ${day === d ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white hover:border-teal-400"}`}>
      <span className="block font-display text-lg font-bold leading-none">{DAY_SHORT[d]}</span><span className={`num text-xs ${day === d ? "text-white/80" : "text-slate-500"}`}>{fmt(dayTotals[d])} kcal</span></button>)}</div>

    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-2xl font-bold">{DAY_LABEL[day]}</h2><p className="text-sm text-slate-500"><b className="num text-ink">{fmt(dayTotals[day])}</b> of {fmt(t.calories)} kcal · P {fmt(sum(dayItems, "protein_g"))} · C {fmt(sum(dayItems, "carbs_g"))} · F {fmt(sum(dayItems, "fat_g"))} g</p></div>
        <button className="btn btn-ghost" disabled={regen.isPending} onClick={() => regen.mutate()}><RefreshCw size={15} className={regen.isPending ? "animate-spin" : ""}/>{regen.isPending ? "Planning…" : `New ideas for ${DAY_SHORT[day]}`}</button>
      </div>
      <div className="mb-5"><ProgressBar value={dayTotals[day]} max={t.calories} color={dayTotals[day] > t.calories * 1.08 ? "bg-roseline" : "bg-teal-600"}/></div>
      <div className="grid gap-4">{slots.map((slot) => {
        const list = dayItems.filter((i) => i.meal_slot === slot);
        return <div key={slot} className="grid gap-2 sm:grid-cols-[9rem_1fr]">
          <div className="pt-1"><p className="font-semibold capitalize">{slot}</p>{t.slots[slot] && <p className="num text-xs text-slate-500">target {t.slots[slot]} kcal</p>}</div>
          <div className="grid gap-2">
            {list.map((item) => <article key={item.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-semibold leading-snug">{item.food_name}</p><p className="text-xs text-slate-500">{item.portion ? `${item.portion} · ` : ""}P {fmt(item.protein_g)} · C {fmt(item.carbs_g)} · F {fmt(item.fat_g)} g</p></div>
                <div className="flex shrink-0 items-center gap-1"><span className="num mr-1 font-bold">{fmt(item.calories)}<span className="ml-0.5 font-sans text-xs font-medium text-slate-500">kcal</span></span>
                  <button className="icon-btn" aria-label={`Edit ${item.food_name}`} onClick={() => setEdit({ key: item.key, day: item.day, meal_slot: item.meal_slot, food_name: item.food_name, portion: item.portion ?? "", calories: String(item.calories), protein_g: String(item.protein_g), carbs_g: String(item.carbs_g), fat_g: String(item.fat_g) })}><Pencil size={14}/></button>
                  <button className="icon-btn danger" aria-label={`Remove ${item.food_name}`} onClick={() => update(draft.items.filter((i) => i.key !== item.key))}><Trash2 size={14}/></button></div>
              </div>
              {item.alternatives.length > 0 && <div className="mt-2.5 flex flex-wrap items-center gap-1.5"><span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Repeat size={12}/>Or try</span>
                {item.alternatives.map((alt) => <button key={alt.food_name} onClick={() => swap(item, alt)} title={`${alt.portion ?? ""} · ${fmt(alt.calories)} kcal`} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:border-teal-500 hover:text-teal-700">{alt.food_name} <span className="num text-slate-500">{fmt(alt.calories)}</span></button>)}</div>}
            </article>)}
            <button className="add-cell" onClick={() => setEdit({ key: null, day, meal_slot: slot, food_name: "", portion: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" })}><Plus size={13}/>Add food</button>
          </div>
        </div>;
      })}</div>
    </section>

    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur min-[881px]:left-[15.5rem] max-[880px]:bottom-[3.9rem]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)}/>Follow this chart</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={applyGoals} onChange={(e) => setApplyGoals(e.target.checked)}/>Use these targets as my daily goals</label>
        </div>
        <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => { if (confirm("Discard this plan?")) { setDraft(null); onBack(); } }}>Discard</button>
          <button className="btn btn-primary px-5" disabled={save.isPending || !draft.items.length} onClick={() => save.mutate()}><Save size={16}/>{save.isPending ? "Saving…" : "Save diet chart"}</button></div>
      </div>
    </div>

    <Modal open={!!edit} title={edit?.key ? "Edit meal" : "Add food"} onClose={() => setEdit(null)}>
      {edit && <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); saveEdit(edit); }}>
        <label><span className="field-label">Day</span><select className="input" value={edit.day} onChange={(e) => setEdit({ ...edit, day: e.target.value as Day })}>{DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select></label>
        <label><span className="field-label">Meal</span><select className="input capitalize" value={edit.meal_slot} onChange={(e) => setEdit({ ...edit, meal_slot: e.target.value as MealSlot })}>{MEAL_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="col-span-2"><span className="field-label">Food</span><input className="input" required maxLength={180} value={edit.food_name} onChange={(e) => setEdit({ ...edit, food_name: e.target.value })} placeholder="e.g. Kambu koozh with onion"/></label>
        <label className="col-span-2"><span className="field-label">Portion</span><input className="input" maxLength={80} value={edit.portion} onChange={(e) => setEdit({ ...edit, portion: e.target.value })} placeholder="e.g. 1 glass"/></label>
        {([["calories", "Calories (kcal)"], ["protein_g", "Protein (g)"], ["carbs_g", "Carbs (g)"], ["fat_g", "Fat (g)"]] as const).map(([k, label]) => <label key={k}><span className="field-label">{label}</span><input className="input num" type="number" min={0} step="0.1" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}/></label>)}
        <button className="btn btn-primary col-span-2 mt-1" disabled={!edit.food_name.trim()}>{edit.key ? "Save meal" : "Add to plan"}</button>
      </form>}
    </Modal>
  </main>;
}

export default function DietPlannerPage() { return <AppShell><Planner/></AppShell>; }
