"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Moon, Pencil, Plus, RefreshCw, Repeat, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LogoMark } from "@/components/logo";
import { Modal } from "@/components/modal";
import { api } from "@/lib/api";
import { prescription, type Exercise } from "@/lib/charts";
import { DAYS, DAY_LABEL, DAY_SHORT, MUSCLE_COLOR, MUSCLE_GROUPS, fmt, todayKey, type Day } from "@/lib/week";

// ----------------------------------------------------------------- types
type Goal = "fat_loss" | "muscle" | "strength" | "fitness" | "endurance" | "sport";
type Intake = {
  age: number; sex: "male" | "female" | "other"; height_cm: number; weight_kg: number;
  experience: "beginner" | "intermediate" | "advanced"; goal: Goal; sport: string;
  days: Day[]; minutes: 30 | 45 | 60 | 75 | 90; equipment: "gym" | "dumbbells" | "bodyweight";
  extras: ("bands" | "pullup_bar" | "bench" | "cardio_machine")[]; split: "auto" | "full_body" | "upper_lower" | "ppl" | "body_part";
  cardio_likes: string[]; injuries: ("knee" | "lower_back" | "shoulder" | "wrist" | "neck" | "ankle")[]; health_notes: string; notes: string;
};
type Planned = Exercise & { key: string; day: Day; alternatives: Exercise[] };
type Summary = { split: string; training_days: number; minutes_per_week: number; sets_per_week: number; notes: string[] };
type Plan = { source: "ai" | "builtin" | "mixed"; summary: Summary; day_focus: Partial<Record<Day, string>>; items: Omit<Planned, "key">[]; warnings: string[] };
type Draft = { name: string; source: Plan["source"]; summary: Summary; dayFocus: Record<Day, string>; items: Planned[]; warnings: string[]; intake: Intake };
type IntakeResponse = { intake: Partial<Intake> | null; ai_enabled: boolean; known: Partial<Intake>; focus_options: string[] };

const DRAFT_KEY = "fittrack-workout-draft";
const blankIntake: Intake = { age: 28, sex: "male", height_cm: 170, weight_kg: 70, experience: "beginner", goal: "fitness", sport: "", days: ["mon", "wed", "fri"], minutes: 45, equipment: "gym", extras: [], split: "auto", cardio_likes: [], injuries: [], health_notes: "", notes: "" };
const GOALS: [Goal, string, string][] = [["fat_loss", "Lose fat", "Keep muscle while the diet does the work"], ["muscle", "Build muscle", "More size and shape"], ["strength", "Get stronger", "Lift heavier on the big lifts"], ["fitness", "Stay fit and healthy", "Balanced strength and cardio"], ["endurance", "Build stamina", "Run, cycle or play longer"], ["sport", "Train for a sport", "Power, speed and agility"]];
const EXTRAS: [Intake["extras"][number], string][] = [["bench", "Bench"], ["pullup_bar", "Pull-up bar"], ["bands", "Resistance bands"], ["cardio_machine", "Treadmill / bike"]];
const INJURIES: [Intake["injuries"][number], string][] = [["knee", "Knee"], ["lower_back", "Lower back"], ["shoulder", "Shoulder"], ["wrist", "Wrist"], ["neck", "Neck"], ["ankle", "Ankle"]];
const CARDIO = ["Walking", "Running", "Cycling", "Swimming", "Skipping", "Yoga", "Cricket", "Football", "Badminton", "Dance"];
const SPLITS: [Intake["split"], string][] = [["auto", "Choose for me"], ["full_body", "Full body"], ["upper_lower", "Upper / lower"], ["ppl", "Push / pull / legs"], ["body_part", "One body part a day"]];
const STEPS = ["You", "Goal", "Schedule", "Equipment", "Review"];
const uid = () => Math.random().toString(36).slice(2, 10);
const clean = (i: Intake) => ({ ...i, sport: i.goal === "sport" ? i.sport || null : null, health_notes: i.health_notes || null, notes: i.notes || null });
const readDraft = (): Draft | null => { try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) as Draft : null; } catch { return null; } };
const writeDraft = (d: Draft | null) => { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ } };
const toggle = <T,>(list: T[], v: T) => list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

function Choice<T extends string>({ value, current, onPick, title, detail }: { value: T; current: T; onPick: (v: T) => void; title: string; detail?: string }) {
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

// ------------------------------------------------------------- the page
function Planner() {
  const router = useRouter(); const client = useQueryClient();
  const meta = useQuery({ queryKey: ["workout-intake"], queryFn: () => api<IntakeResponse>("/workout-planner/intake") });
  const [intake, setIntake] = useState<Intake>(blankIntake);
  const [step, setStep] = useState(0);
  const [heightUnit, setHeightUnit] = useState<"cm" | "ft">("cm");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resumable, setResumable] = useState<Draft | null>(null);
  const set = <K extends keyof Intake>(key: K, value: Intake[K]) => setIntake((i) => ({ ...i, [key]: value }));

  useEffect(() => { setResumable(readDraft()); }, []);
  useEffect(() => { if (meta.data) setIntake((i) => ({ ...i, ...meta.data.known, ...(meta.data.intake ?? {}), ...(meta.data.known.weight_kg ? { weight_kg: meta.data.known.weight_kg } : {}) } as Intake)); }, [meta.data]);
  useEffect(() => { writeDraft(draft); }, [draft]);

  const generate = useMutation({
    mutationFn: () => api<Plan>("/workout-planner/generate", { method: "POST", body: JSON.stringify(clean(intake)) }),
    onSuccess: (plan) => {
      const goalName = GOALS.find(([g]) => g === intake.goal)?.[1] ?? "Training";
      setDraft({ name: `${goalName} — ${plan.summary.split}`, source: plan.source, summary: plan.summary, warnings: plan.warnings, intake,
        dayFocus: Object.fromEntries(DAYS.map((d) => [d, plan.day_focus[d] ?? "Rest"])) as Record<Day, string>,
        items: plan.items.map((x) => ({ ...x, key: uid() })) });
      window.scrollTo({ top: 0 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (draft) return <DraftEditor draft={draft} setDraft={setDraft} focusOptions={meta.data?.focus_options ?? []} onBack={() => setDraft(null)} onSaved={(id) => { writeDraft(null); client.invalidateQueries({ queryKey: ["workout-charts"] }); router.push(`/workout-chart?chart=${id}`); }}/>;

  if (generate.isPending) return <main className="content"><div className="mx-auto mt-16 max-w-md text-center">
    <div className="mx-auto mb-5 grid h-16 w-16 animate-pulse place-items-center rounded-2xl bg-teal-600 text-white"><Sparkles size={30}/></div>
    <h1 className="text-4xl font-bold">Building your training week…</h1>
    <p className="mt-3 text-slate-600">Planning {intake.days.length} sessions of about {intake.minutes} minutes for your equipment, with two alternatives for every exercise. This usually takes 10–30 seconds.</p>
  </div></main>;

  const ft = Math.floor(intake.height_cm / 30.48), inch = Math.round((intake.height_cm / 2.54) % 12);
  const canNext = [intake.age >= 13 && intake.height_cm >= 100 && intake.weight_kg >= 25, intake.goal !== "sport" || !!intake.sport.trim(), intake.days.length > 0, true, true][step];

  return <main className="content">
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><Link href="/workout-chart" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={15}/>Workout charts</Link><h1 className="mt-1 text-[2.6rem] font-bold leading-none">Workout planner</h1></div>
        {meta.data && <span className="chip">{meta.data.ai_enabled ? <><Sparkles size={13} className="text-teal-700"/>AI planning on</> : "Built-in exercise planner"}</span>}
      </div>

      {resumable && <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 p-4" style={{ borderColor: "#bcc7f6" }}>
        <p className="text-sm"><b>You have an unsaved plan</b> — “{resumable.name}”.</p>
        <div className="flex gap-2"><button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => { writeDraft(null); setResumable(null); }}>Discard</button><button className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => { setIntake(resumable.intake); setDraft(resumable); }}>Continue editing</button></div>
      </div>}

      <ol className="mb-6 grid grid-cols-5 gap-1.5" aria-label="Progress">{STEPS.map((label, i) => <li key={label}><button type="button" disabled={i > step} onClick={() => setStep(i)} className="w-full text-left disabled:cursor-default"><span className={`block h-1.5 rounded-full ${i <= step ? "bg-teal-600" : "bg-slate-300"}`}/><span className={`mt-1.5 block text-xs font-semibold ${i === step ? "text-ink" : "text-slate-500"}`}>{label}</span></button></li>)}</ol>

      {step === 0 && <section>
        <Coach>Let’s build a training week that fits your life. <b>First, a little about you.</b>{meta.data?.known.age ? " I’ve filled in what I already know." : ""}</Coach>
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <label><span className="field-label">Age</span><input className="input num" type="number" min={13} max={100} value={intake.age} onChange={(e) => set("age", Number(e.target.value))}/></label>
          <div><span className="field-label">Sex</span><div className="grid grid-cols-3 gap-2">{(["male", "female", "other"] as const).map((s) => <Chip key={s} on={intake.sex === s} label={s === "other" ? "Prefer not to say" : s[0].toUpperCase() + s.slice(1)} onClick={() => set("sex", s)}/>)}</div></div>
          <div><div className="flex items-center justify-between"><span className="field-label">Height</span><button type="button" className="text-xs font-semibold text-teal-700" onClick={() => setHeightUnit(heightUnit === "cm" ? "ft" : "cm")}>Use {heightUnit === "cm" ? "feet / inches" : "cm"}</button></div>
            {heightUnit === "cm" ? <input className="input num" type="number" min={100} max={250} value={Math.round(intake.height_cm)} onChange={(e) => set("height_cm", Number(e.target.value))}/>
              : <div className="grid grid-cols-2 gap-2"><input className="input num" type="number" min={3} max={8} value={ft} aria-label="Feet" onChange={(e) => set("height_cm", Math.round((Number(e.target.value) * 12 + inch) * 2.54))}/><input className="input num" type="number" min={0} max={11} value={inch} aria-label="Inches" onChange={(e) => set("height_cm", Math.round((ft * 12 + Number(e.target.value)) * 2.54))}/></div>}</div>
          <label><span className="field-label">Weight (kg)</span><input className="input num" type="number" min={25} max={300} step="0.1" value={intake.weight_kg} onChange={(e) => set("weight_kg", Number(e.target.value))}/></label>
        </div>
      </section>}

      {step === 1 && <section>
        <Coach><b>What are you training for,</b> and how long have you been lifting?</Coach>
        <div className="card grid gap-5 p-5">
          <div className="grid gap-2 sm:grid-cols-3">{GOALS.map(([g, title, detail]) => <Choice key={g} value={g} current={intake.goal} onPick={(v) => set("goal", v)} title={title} detail={detail}/>)}</div>
          {intake.goal === "sport" && <label><span className="field-label">Which sport?</span><input className="input" maxLength={60} value={intake.sport} onChange={(e) => set("sport", e.target.value)} placeholder="e.g. Cricket (fast bowler), football, kabaddi"/></label>}
          <div><span className="field-label">Experience</span><div className="grid gap-2 sm:grid-cols-3">
            <Choice value="beginner" current={intake.experience} onPick={(v) => set("experience", v)} title="Beginner" detail="New, or back after a long break"/>
            <Choice value="intermediate" current={intake.experience} onPick={(v) => set("experience", v)} title="Intermediate" detail="Training steadily for 6+ months"/>
            <Choice value="advanced" current={intake.experience} onPick={(v) => set("experience", v)} title="Advanced" detail="Years of consistent training"/>
          </div></div>
        </div>
      </section>}

      {step === 2 && <section>
        <Coach><b>When can you train?</b> Pick the days that really work, not the ideal ones. Consistency beats volume.</Coach>
        <div className="card grid gap-5 p-5">
          <div><span className="field-label">Training days ({intake.days.length} a week)</span><div className="flex flex-wrap gap-2">{DAYS.map((d) => <Chip key={d} on={intake.days.includes(d)} label={DAY_SHORT[d]} onClick={() => set("days", DAYS.filter((x) => x === d ? !intake.days.includes(d) : intake.days.includes(x)))}/>)}</div></div>
          <div><span className="field-label">Time per session</span><div className="flex flex-wrap gap-2">{([30, 45, 60, 75, 90] as const).map((m) => <Chip key={m} on={intake.minutes === m} label={`${m} min`} onClick={() => set("minutes", m)}/>)}</div></div>
          <label><span className="field-label">Preferred split</span><select className="input" value={intake.split} onChange={(e) => set("split", e.target.value as Intake["split"])}>{SPLITS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select><span className="mt-1 block text-xs text-slate-500">“Choose for me” picks the best split for your days and goal.</span></label>
        </div>
      </section>}

      {step === 3 && <section>
        <Coach><b>What can you train with,</b> and is there anything I should go easy on?</Coach>
        <div className="card grid gap-5 p-5">
          <div><span className="field-label">Where do you train?</span><div className="grid gap-2 sm:grid-cols-3">
            <Choice value="gym" current={intake.equipment} onPick={(v) => set("equipment", v)} title="Gym" detail="Barbells, machines, cables"/>
            <Choice value="dumbbells" current={intake.equipment} onPick={(v) => set("equipment", v)} title="Home with dumbbells" detail="A pair of dumbbells or a kettlebell"/>
            <Choice value="bodyweight" current={intake.equipment} onPick={(v) => set("equipment", v)} title="No equipment" detail="Bodyweight, a chair and a table"/>
          </div></div>
          {intake.equipment !== "gym" && <div><span className="field-label">Anything else at home?</span><div className="flex flex-wrap gap-2">{EXTRAS.map(([k, label]) => <Chip key={k} on={intake.extras.includes(k)} label={label} onClick={() => set("extras", toggle(intake.extras, k))}/>)}</div></div>}
          <div><span className="field-label">Injuries or areas to protect</span><div className="flex flex-wrap gap-2">{INJURIES.map(([k, label]) => <Chip key={k} on={intake.injuries.includes(k)} label={label} onClick={() => set("injuries", toggle(intake.injuries, k))}/>)}</div></div>
          <div><span className="field-label">Activities you enjoy</span><div className="flex flex-wrap gap-2">{CARDIO.map((c) => <Chip key={c} on={intake.cardio_likes.includes(c)} label={c} onClick={() => set("cardio_likes", toggle(intake.cardio_likes, c))}/>)}</div></div>
          <label><span className="field-label">Health notes (optional)</span><input className="input" maxLength={500} value={intake.health_notes} onChange={(e) => set("health_notes", e.target.value)} placeholder="e.g. high BP, recovering from surgery, asthma"/></label>
          <label><span className="field-label">Anything else? (optional)</span><input className="input" maxLength={500} value={intake.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. I want stronger legs, I hate running, I train early before work"/></label>
        </div>
      </section>}

      {step === 4 && <section>
        <Coach><b>Here’s what I’ll plan around.</b> Check it, then I’ll build your week.</Coach>
        <div className="card p-5">
          <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">{[
            ["You", `${intake.age} y · ${Math.round(intake.height_cm)} cm · ${intake.weight_kg} kg`],
            ["Goal", `${GOALS.find(([g]) => g === intake.goal)?.[1]}${intake.goal === "sport" && intake.sport ? ` (${intake.sport})` : ""} · ${intake.experience}`],
            ["Schedule", `${intake.days.map((d) => DAY_SHORT[d]).join(", ")} · ${intake.minutes} min · ${SPLITS.find(([k]) => k === intake.split)?.[1]}`],
            ["Equipment", `${({ gym: "Gym", dumbbells: "Home with dumbbells", bodyweight: "No equipment" })[intake.equipment]}${intake.equipment !== "gym" && intake.extras.length ? ` + ${intake.extras.map((e) => EXTRAS.find(([k]) => k === e)?.[1]).join(", ")}` : ""}`],
            ["Protect", intake.injuries.length ? intake.injuries.map((x) => INJURIES.find(([k]) => k === x)?.[1]).join(", ") : "Nothing"],
            ["Enjoys", intake.cardio_likes.join(", ") || "—"],
          ].map(([k, v]) => <tr key={k}><th className="w-28 py-2.5 text-left font-medium text-slate-500">{k}</th><td className="py-2.5">{v}</td></tr>)}</tbody></table>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">This is general guidance, not medical advice. If you have a heart condition, high blood pressure, a recent injury or surgery, or are pregnant, check with your doctor before starting. Stop any exercise that causes sharp pain.</p>
        </div>
      </section>}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16}/>Back</button>
        {step < 4 ? <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next<ArrowRight size={16}/></button>
          : <button className="btn btn-primary px-5" onClick={() => generate.mutate()}><Sparkles size={16}/>Create my workout plan</button>}
      </div>
    </div>
  </main>;
}

// ---------------------------------------------------------- draft editor
type EditState = { key: string | null; day: Day; exercise: string; muscle_group: string; sets: string; reps: string; duration_minutes: string; rest_seconds: string; notes: string };
const toEdit = (x: Planned): EditState => ({ key: x.key, day: x.day, exercise: x.exercise, muscle_group: x.muscle_group, sets: String(x.sets ?? 0), reps: x.reps ?? "", duration_minutes: x.duration_minutes == null ? "" : String(x.duration_minutes), rest_seconds: x.rest_seconds == null ? "" : String(x.rest_seconds), notes: x.notes ?? "" });

function DraftEditor({ draft, setDraft, focusOptions, onBack, onSaved }: { draft: Draft; setDraft: (d: Draft | null) => void; focusOptions: string[]; onBack: () => void; onSaved: (id: number) => void }) {
  const firstTraining = (DAYS.find((d) => draft.dayFocus[d] !== "Rest") ?? todayKey()) as Day;
  const [day, setDay] = useState<Day>(firstTraining);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [follow, setFollow] = useState(true);
  const [newFocus, setNewFocus] = useState(focusOptions[0] ?? "Full body A");
  const dayItems = draft.items.filter((x) => x.day === day);
  const focus = draft.dayFocus[day];
  const update = (items: Planned[]) => setDraft({ ...draft, items });
  const setFocus = (d: Day, f: string) => setDraft({ ...draft, dayFocus: { ...draft.dayFocus, [d]: f } });
  const stats = useMemo(() => {
    const training = DAYS.filter((d) => draft.items.some((x) => x.day === d));
    return { days: training.length, sets: draft.items.reduce((s, x) => s + (x.sets || 0), 0), minutes: draft.items.reduce((s, x) => s + (x.duration_minutes || 0), 0) };
  }, [draft.items]);

  const regen = useMutation({
    mutationFn: (f: string) => api<Plan>("/workout-planner/generate-day", { method: "POST", body: JSON.stringify({ intake: clean(draft.intake), day, focus: f }) }),
    onSuccess: (plan, f) => {
      setDraft({ ...draft, dayFocus: { ...draft.dayFocus, [day]: f }, items: [...draft.items.filter((x) => x.day !== day), ...plan.items.map((x) => ({ ...x, key: uid() }))], warnings: [...draft.warnings, ...plan.warnings] });
      toast.success(`New session for ${DAY_LABEL[day]}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => api<{ id: number }>("/workout-charts/full", { method: "POST", body: JSON.stringify({
      name: draft.name.trim() || "My training plan", activate: follow,
      notes: `${draft.source === "builtin" ? "Built-in planner" : "AI plan"} · ${draft.summary.split} · ${draft.intake.minutes} min sessions`,
      day_focus: Object.fromEntries(DAYS.filter((d) => draft.dayFocus[d] && draft.dayFocus[d] !== "Rest").map((d) => [d, draft.dayFocus[d]])),
      items: draft.items.map(({ key: _key, ...rest }) => rest),
    }) }),
    onSuccess: (chart) => { toast.success("Workout chart saved"); onSaved(chart.id); },
    onError: (e: Error) => toast.error(e.message),
  });

  function swap(item: Planned, alt: Exercise) {
    const { exercise, muscle_group, sets, reps, duration_minutes, rest_seconds, notes } = item;
    update(draft.items.map((x) => x.key !== item.key ? x : { ...x, ...alt, alternatives: [{ exercise, muscle_group, sets, reps, duration_minutes, rest_seconds, notes }, ...item.alternatives.filter((a) => a !== alt)] }));
  }
  function saveEdit(e: EditState) {
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const ex = { exercise: e.exercise.trim(), muscle_group: e.muscle_group, sets: Number(e.sets || 0), reps: e.reps.trim() || null, duration_minutes: num(e.duration_minutes), rest_seconds: num(e.rest_seconds), notes: e.notes.trim() || null };
    const items = e.key ? draft.items.map((x) => x.key === e.key ? { ...x, ...ex, day: e.day } : x) : [...draft.items, { ...ex, key: uid(), day: e.day, alternatives: [] }];
    const dayFocus = draft.dayFocus[e.day] === "Rest" ? { ...draft.dayFocus, [e.day]: "Custom" } : draft.dayFocus;
    setDraft({ ...draft, items, dayFocus });
    setEdit(null);
  }

  return <main className="content pb-28">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1"><button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={15}/>Change my answers</button>
        <label className="mt-1 block"><span className="sr-only">Plan name</span><input className="w-full max-w-2xl border-0 border-b-2 border-transparent bg-transparent font-display text-[2.4rem] font-bold leading-tight outline-none hover:border-slate-300 focus:border-teal-600" value={draft.name} maxLength={160} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
        <p className="text-sm text-slate-500">Review and edit your plan. Nothing is saved until you press <b>Save workout chart</b>.</p></div>
      <span className="chip">{draft.source === "builtin" ? "Built-in exercise planner" : <><Sparkles size={13} className="text-teal-700"/>Generated with AI</>}</span>
    </div>

    {draft.warnings.map((w) => <p key={w} className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{w}</p>)}

    <section className="card mb-5 p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div><p className="text-sm text-slate-500">Split</p><p className="font-display text-xl font-bold leading-tight">{draft.summary.split}</p></div>
        <div><p className="text-sm text-slate-500">Training days</p><p className="stat-value">{stats.days}<span className="stat-unit">/ 7</span></p></div>
        <div><p className="text-sm text-slate-500">Weekly sets</p><p className="stat-value">{fmt(stats.sets)}</p></div>
        <div><p className="text-sm text-slate-500">Session length</p><p className="stat-value">{draft.intake.minutes}<span className="stat-unit">min</span></p></div>
      </div>
      {!!draft.summary.notes.length && <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm text-slate-600">{draft.summary.notes.map((n) => <li key={n} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600"/>{n}</li>)}</ul>}
    </section>

    <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist">{DAYS.map((d) => { const rest = !draft.items.some((x) => x.day === d); return <button key={d} role="tab" aria-selected={day === d} onClick={() => setDay(d)} className={`min-w-[6.5rem] shrink-0 rounded-xl border px-3.5 py-2 text-left ${day === d ? "border-teal-600 bg-teal-600 text-white" : rest ? "border-dashed border-slate-300 bg-slate-50" : "border-slate-300 bg-white hover:border-teal-400"}`}>
      <span className="block font-display text-lg font-bold leading-none">{DAY_SHORT[d]}</span><span className={`block truncate text-xs ${day === d ? "text-white/80" : "text-slate-500"}`}>{rest ? "Rest" : draft.dayFocus[d]}</span></button>; })}</div>

    <section className="card p-5">
      {dayItems.length === 0 ? <div className="py-6 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500"><Moon size={20}/></span>
        <h2 className="mt-3 font-display text-2xl font-bold">{DAY_LABEL[day]} is a rest day</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Recovery is where you get stronger. A walk or light stretching is a good idea. Want to train instead?</p>
        <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
          <select className="input w-auto" value={newFocus} onChange={(e) => setNewFocus(e.target.value)} aria-label="Session type">{focusOptions.map((f) => <option key={f}>{f}</option>)}</select>
          <button className="btn btn-primary" disabled={regen.isPending} onClick={() => regen.mutate(newFocus)}><Sparkles size={15}/>{regen.isPending ? "Planning…" : "Plan this day"}</button>
        </div>
      </div> : <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><h2 className="font-display text-2xl font-bold">{DAY_LABEL[day]}</h2>
            <label className="mt-1 flex items-center gap-2 text-sm text-slate-500">Focus<input className="input w-56 py-1 text-sm font-semibold text-ink" list="focus-list" value={focus === "Rest" ? "" : focus} maxLength={60} onChange={(e) => setFocus(day, e.target.value)}/></label></div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" disabled={regen.isPending} onClick={() => regen.mutate(focus && focus !== "Rest" ? focus : "Full body A")}><RefreshCw size={15} className={regen.isPending ? "animate-spin" : ""}/>{regen.isPending ? "Planning…" : "New ideas"}</button>
            <button className="btn btn-ghost" onClick={() => setDraft({ ...draft, items: draft.items.filter((x) => x.day !== day), dayFocus: { ...draft.dayFocus, [day]: "Rest" } })}><Moon size={15}/>Make rest day</button>
          </div>
        </div>
        <ol className="grid gap-2">{dayItems.map((x, k) => <li key={x.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3"><span className="num mt-0.5 w-5 shrink-0 text-right text-sm font-bold text-slate-400">{k + 1}</span>
              <div className="min-w-0"><p className="flex items-center gap-1.5 font-semibold leading-snug"><span className="dot" style={{ background: MUSCLE_COLOR[x.muscle_group] ?? "#8fa3b8" }} title={x.muscle_group}/>{x.exercise}</p>
                <p className="num text-sm text-slate-700">{prescription(x) || x.muscle_group}</p>{x.notes && <p className="text-xs text-slate-500">{x.notes}</p>}</div></div>
            <div className="flex shrink-0 gap-1"><button className="icon-btn" aria-label={`Edit ${x.exercise}`} onClick={() => setEdit(toEdit(x))}><Pencil size={14}/></button><button className="icon-btn danger" aria-label={`Remove ${x.exercise}`} onClick={() => update(draft.items.filter((y) => y.key !== x.key))}><Trash2 size={14}/></button></div>
          </div>
          {x.alternatives.length > 0 && <div className="ml-8 mt-2.5 flex flex-wrap items-center gap-1.5"><span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Repeat size={12}/>Or try</span>
            {x.alternatives.map((alt) => <button key={alt.exercise} onClick={() => swap(x, alt)} title={alt.notes ?? ""} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:border-teal-500 hover:text-teal-700">{alt.exercise}</button>)}</div>}
        </li>)}</ol>
      </>}
      <button className="add-cell mt-3" onClick={() => setEdit({ key: null, day, exercise: "", muscle_group: "chest", sets: "3", reps: "8-12", duration_minutes: "", rest_seconds: "90", notes: "" })}><Plus size={13}/>Add exercise</button>
    </section>
    <datalist id="focus-list">{focusOptions.map((f) => <option key={f} value={f}/>)}</datalist>

    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur min-[881px]:left-[15.5rem] max-[880px]:bottom-[3.9rem]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)}/>Follow this chart</label>
        <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => { if (confirm("Discard this plan?")) { setDraft(null); onBack(); } }}>Discard</button>
          <button className="btn btn-primary px-5" disabled={save.isPending || !draft.items.length} onClick={() => save.mutate()}><Save size={16}/>{save.isPending ? "Saving…" : "Save workout chart"}</button></div>
      </div>
    </div>

    <Modal open={!!edit} title={edit?.key ? "Edit exercise" : "Add exercise"} onClose={() => setEdit(null)}>
      {edit && <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); saveEdit(edit); }}>
        <label className="col-span-2"><span className="field-label">Exercise</span><input className="input" required maxLength={160} value={edit.exercise} onChange={(e) => setEdit({ ...edit, exercise: e.target.value })} placeholder="e.g. Dumbbell bench press"/></label>
        <label><span className="field-label">Day</span><select className="input" value={edit.day} onChange={(e) => setEdit({ ...edit, day: e.target.value as Day })}>{DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select></label>
        <label><span className="field-label">Muscle group</span><select className="input capitalize" value={edit.muscle_group} onChange={(e) => setEdit({ ...edit, muscle_group: e.target.value })}>{MUSCLE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
        <label><span className="field-label">Sets</span><input className="input num" type="number" min={0} max={20} value={edit.sets} onChange={(e) => setEdit({ ...edit, sets: e.target.value })}/></label>
        <label><span className="field-label">Reps</span><input className="input num" maxLength={20} value={edit.reps} onChange={(e) => setEdit({ ...edit, reps: e.target.value })} placeholder="e.g. 8-12 or 30s"/></label>
        <label><span className="field-label">Duration (min)</span><input className="input num" type="number" min={0} max={600} value={edit.duration_minutes} onChange={(e) => setEdit({ ...edit, duration_minutes: e.target.value })} placeholder="For cardio"/></label>
        <label><span className="field-label">Rest (seconds)</span><input className="input num" type="number" min={0} max={1800} value={edit.rest_seconds} onChange={(e) => setEdit({ ...edit, rest_seconds: e.target.value })}/></label>
        <label className="col-span-2"><span className="field-label">Coaching note</span><input className="input" maxLength={240} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="e.g. Slow 3-second lowering"/></label>
        <button className="btn btn-primary col-span-2 mt-1" disabled={!edit.exercise.trim()}>{edit.key ? "Save exercise" : "Add to plan"}</button>
      </form>}
    </Modal>
  </main>;
}

export default function WorkoutPlannerPage() { return <AppShell><Planner/></AppShell>; }
