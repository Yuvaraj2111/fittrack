"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Copy, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Modal } from "@/components/modal";
import { EmptyState, PageHeader, Stat } from "@/components/page";
import { api, today } from "@/lib/api";
import { prescription, type WorkoutChart, type WorkoutItem } from "@/lib/charts";
import { DAYS, DAY_LABEL, DAY_SHORT, MUSCLE_COLOR, MUSCLE_GROUPS, fmt, n, todayKey, type Day } from "@/lib/week";

type ItemForm = { day: Day; exercise: string; muscle_group: string; sets: string; reps: string; weight_kg: string; duration_minutes: string; rest_seconds: string; notes: string };
const blankItem = (day: Day): ItemForm => ({ day, exercise: "", muscle_group: "chest", sets: "3", reps: "8-12", weight_kg: "", duration_minutes: "", rest_seconds: "90", notes: "" });
const FOCUS_SUGGESTIONS = ["Push", "Pull", "Legs", "Upper body", "Lower body", "Full body", "Cardio", "Mobility", "Rest"];

function ChartForm({ initial, onSubmit, pending, submitLabel }: { initial?: { name: string; notes: string | null }; onSubmit: (values: { name: string; notes: string | null }) => void; pending: boolean; submitLabel: string }) {
  const [name, setName] = useState(initial?.name ?? ""); const [notes, setNotes] = useState(initial?.notes ?? "");
  return <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ name: name.trim(), notes: notes.trim() || null }); }}>
    <label><span className="field-label">Chart name</span><input className="input" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Push / pull / legs"/></label>
    <label><span className="field-label">Notes (optional)</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Progression rules, warm-up, deload weeks…"/></label>
    <button className="btn btn-primary mt-1" disabled={pending || !name.trim()}>{pending ? "Saving…" : submitLabel}</button>
  </form>;
}

function WorkoutChartContent() {
  const client = useQueryClient();
  const charts = useQuery({ queryKey: ["workout-charts"], queryFn: () => api<WorkoutChart[]>("/workout-charts") });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false); const [editingChart, setEditingChart] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm | null>(null); const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [focusDay, setFocusDay] = useState<Day | null>(null); const [focusText, setFocusText] = useState("");
  const [copyFrom, setCopyFrom] = useState<Day | null>(null); const [copyTo, setCopyTo] = useState<Day[]>([]);
  const todayDay = todayKey();
  const cancelFocus = useRef(false);

  const list = charts.data ?? [];
  const chart = list.find((c) => c.id === selectedId) ?? list.find((c) => c.is_active) ?? list[0];
  const items = chart?.items ?? [];
  const refresh = () => client.invalidateQueries({ queryKey: ["workout-charts"] });
  const onError = (error: Error) => toast.error(error.message);

  const createChart = useMutation({ mutationFn: (body: object) => api<WorkoutChart>("/workout-charts", { method: "POST", body: JSON.stringify(body) }), onSuccess: (created) => { toast.success("Workout chart created"); setCreating(false); setSelectedId(created.id); refresh(); }, onError });
  const updateChart = useMutation({ mutationFn: (body: object) => api<WorkoutChart>(`/workout-charts/${chart!.id}`, { method: "PUT", body: JSON.stringify(body) }), onSuccess: () => { setEditingChart(false); setFocusDay(null); refresh(); }, onError });
  const activate = useMutation({ mutationFn: (id: number) => api(`/workout-charts/${id}/activate`, { method: "POST" }), onSuccess: () => { toast.success("Now following this chart"); refresh(); }, onError });
  const removeChart = useMutation({ mutationFn: (id: number) => api<void>(`/workout-charts/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Chart deleted"); setSelectedId(null); setEditingChart(false); refresh(); }, onError });
  const saveItem = useMutation({
    mutationFn: (form: ItemForm) => {
      const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));
      const body = JSON.stringify({ day: form.day, exercise: form.exercise.trim(), muscle_group: form.muscle_group, sets: Number(form.sets || 0), reps: form.reps.trim() || null, weight_kg: optionalNumber(form.weight_kg), duration_minutes: optionalNumber(form.duration_minutes), rest_seconds: optionalNumber(form.rest_seconds), notes: form.notes.trim() || null });
      return editingItemId ? api(`/workout-chart-items/${editingItemId}`, { method: "PUT", body }) : api(`/workout-charts/${chart!.id}/items`, { method: "POST", body });
    },
    onSuccess: () => { toast.success(editingItemId ? "Exercise updated" : "Exercise added"); setItemForm(null); setEditingItemId(null); refresh(); }, onError,
  });
  const removeItem = useMutation({ mutationFn: (id: number) => api<void>(`/workout-chart-items/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Exercise removed"); refresh(); }, onError });
  const copyDay = useMutation({
    mutationFn: async () => {
      const source = items.filter((i) => i.day === copyFrom);
      for (const target of copyTo) for (const i of source) await api(`/workout-charts/${chart!.id}/items`, { method: "POST", body: JSON.stringify({ day: target, exercise: i.exercise, muscle_group: i.muscle_group, sets: i.sets, reps: i.reps, weight_kg: i.weight_kg === null ? null : n(i.weight_kg), duration_minutes: i.duration_minutes, rest_seconds: i.rest_seconds, notes: i.notes }) });
      const focus = chart!.day_focus[copyFrom!];
      if (focus) await api(`/workout-charts/${chart!.id}`, { method: "PUT", body: JSON.stringify({ name: chart!.name, notes: chart!.notes, day_focus: { ...chart!.day_focus, ...Object.fromEntries(copyTo.map((d) => [d, focus])) } }) });
    },
    onSuccess: () => { toast.success(`Copied ${DAY_LABEL[copyFrom!]} to ${copyTo.length} day${copyTo.length > 1 ? "s" : ""}`); setCopyFrom(null); setCopyTo([]); refresh(); }, onError,
  });
  const startToday = useMutation({
    mutationFn: () => api("/workout-sessions", { method: "POST", body: JSON.stringify({ name: chart!.day_focus[todayDay] || `${chart!.name} — ${DAY_LABEL[todayDay]}`, local_date: today() }) }),
    onSuccess: () => { toast.success("Workout started. Finish it on the Workouts page when you’re done."); client.invalidateQueries({ queryKey: ["workouts"] }); client.invalidateQueries({ queryKey: ["summary"] }); }, onError,
  });

  function saveFocus(day: Day, value: string) {
    setFocusDay(null);
    if (cancelFocus.current) { cancelFocus.current = false; return; }
    if (!chart || value.trim() === (chart.day_focus[day] ?? "")) return;
    const next = { ...chart.day_focus }; if (value.trim()) next[day] = value.trim(); else delete next[day];
    updateChart.mutate({ name: chart.name, notes: chart.notes, day_focus: next });
  }
  function openAdd(day: Day) { setEditingItemId(null); setItemForm(blankItem(day)); }
  function openEdit(i: WorkoutItem) { setEditingItemId(i.id); setItemForm({ day: i.day, exercise: i.exercise, muscle_group: i.muscle_group, sets: String(i.sets ?? ""), reps: i.reps ?? "", weight_kg: i.weight_kg === null ? "" : String(n(i.weight_kg)), duration_minutes: i.duration_minutes === null ? "" : String(i.duration_minutes), rest_seconds: i.rest_seconds === null ? "" : String(i.rest_seconds), notes: i.notes ?? "" }); }

  const groupsInUse = useMemo(() => MUSCLE_GROUPS.filter((g) => items.some((i) => i.muscle_group === g)), [items]);
  const setsByDay = useMemo(() => DAYS.map((day) => { const row: Record<string, number | string> = { label: DAY_SHORT[day] }; for (const g of groupsInUse) row[g] = items.filter((i) => i.day === day && i.muscle_group === g).reduce((s, i) => s + (i.sets || 0), 0); return row; }), [items, groupsInUse]);
  const balance = useMemo(() => groupsInUse.map((g) => ({ group: g, sets: items.filter((i) => i.muscle_group === g).reduce((s, i) => s + (i.sets || 0), 0) })).filter((b) => b.sets > 0).sort((a, b) => b.sets - a.sets), [items, groupsInUse]);
  const trainingDays = DAYS.filter((d) => items.some((i) => i.day === d)).length;
  const weeklySets = items.reduce((s, i) => s + (i.sets || 0), 0);
  const cardioMinutes = items.reduce((s, i) => s + (i.duration_minutes || 0), 0);

  if (charts.isLoading) return <main className="content"><div className="h-80 animate-pulse rounded-2xl bg-slate-200"/></main>;
  if (!chart) return <main className="content">
    <PageHeader title="Workout chart" description="Lay out your training split across the week: what you train each day, the exercises, sets, reps and load."/>
    <section className="card max-w-lg p-6"><h2 className="font-display text-2xl font-bold">Create your first workout chart</h2><p className="mb-5 mt-1 text-sm text-slate-500">Name your split. You’ll set each day’s focus and exercises next.</p><ChartForm onSubmit={(v) => createChart.mutate({ ...v, day_focus: {} })} pending={createChart.isPending} submitLabel="Create workout chart"/></section>
  </main>;

  const todayItems = items.filter((i) => i.day === todayDay);
  return <main className="content">
    <PageHeader title="Workout chart" description="Your weekly training split. Select a day’s focus to rename it, and edit or remove any exercise from its card."
      action={<>
        {list.length > 1 && <select className="input w-auto min-w-[12rem]" value={chart.id} onChange={(e) => setSelectedId(Number(e.target.value))} aria-label="Choose a workout chart">{list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? " (following)" : ""}</option>)}</select>}
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16}/>New chart</button>
      </>}/>

    <section className="card mb-5 grid grid-cols-3 gap-x-4 gap-y-5 p-5 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:gap-6">
      <div className="col-span-3 min-w-0 lg:col-span-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-[1.7rem] font-bold leading-tight">{chart.name}</h2>{chart.is_active ? <span className="chip bg-teal-50 text-teal-700"><span className="dot bg-teal-600"/>Following</span> : <button className="btn btn-soft px-2.5 py-1 text-xs" onClick={() => activate.mutate(chart.id)}>Follow this chart</button>}</div>
        {chart.notes && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{chart.notes}</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditingChart(true)}><Pencil size={13}/>Edit details</button><button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setCopyFrom(todayDay); setCopyTo([]); }}><Copy size={13}/>Copy a day</button></div>
      </div>
      <Stat label="Training days" value={String(trainingDays)} unit="/ 7" hint={`${7 - trainingDays} rest day${7 - trainingDays === 1 ? "" : "s"}`}/>
      <Stat label="Weekly sets" value={fmt(weeklySets)} unit="sets" hint={`${items.length} exercises planned`}/>
      <Stat label="Timed work" value={fmt(cardioMinutes)} unit="min" hint="Cardio and timed exercises"/>
    </section>

    <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 min-[1360px]:grid-cols-7">{DAYS.map((day) => {
      const dayItems = items.filter((i) => i.day === day); const focus = chart.day_focus[day]; const isToday = day === todayDay;
      return <article key={day} className={`day-col ${isToday ? "is-today" : ""}`}>
        <header className="border-b border-slate-100 px-3.5 pb-2.5 pt-3">
          <div className="flex items-baseline justify-between"><p className="font-display text-xl font-bold">{DAY_SHORT[day]}</p>{isToday && <span className="text-xs font-semibold text-teal-700">Today</span>}</div>
          {focusDay === day ? <form onSubmit={(e) => { e.preventDefault(); e.currentTarget.querySelector("input")?.blur(); }}><input className="input mt-1 py-1 text-sm" autoFocus list="focus-suggestions" value={focusText} onChange={(e) => setFocusText(e.target.value)} onBlur={() => saveFocus(day, focusText)} onKeyDown={(e) => { if (e.key === "Escape") { cancelFocus.current = true; e.currentTarget.blur(); } }} placeholder="e.g. Push" aria-label={`${DAY_LABEL[day]} focus`}/></form>
            : <button className="mt-0.5 text-left text-sm font-semibold text-slate-600 hover:text-teal-700" onClick={() => { setFocusDay(day); setFocusText(focus ?? ""); }}>{focus || (dayItems.length ? "Set focus" : "Rest day")}<Pencil size={11} className="ml-1 inline opacity-50"/></button>}
        </header>
        <div className="flex-1 p-2">
          {dayItems.map((i) => <div className="plan-item" key={i.id}>
            <p className="flex items-center gap-1.5 text-[.86rem] font-semibold leading-snug"><span className="dot" style={{ background: MUSCLE_COLOR[i.muscle_group] ?? "#8fa3b8" }} title={i.muscle_group}/>{i.exercise}</p>
            <p className="num pl-[1.05rem] text-[.82rem] text-slate-600">{prescription(i) || i.muscle_group}</p>
            {i.notes && <p className="pl-[1.05rem] text-xs text-slate-500">{i.notes}</p>}
            <div className="item-actions"><button className="icon-btn" aria-label={`Edit ${i.exercise}`} onClick={() => openEdit(i)}><Pencil size={13}/></button><button className="icon-btn danger" aria-label={`Remove ${i.exercise}`} onClick={() => removeItem.mutate(i.id)}><Trash2 size={13}/></button></div>
          </div>)}
          <button className="add-cell" onClick={() => openAdd(day)}><Plus size={13}/>Add exercise</button>
        </div>
        {isToday && todayItems.length > 0 && <div className="border-t border-slate-100 p-2"><button className="btn btn-primary w-full" disabled={startToday.isPending} onClick={() => startToday.mutate()}><Play size={14}/>Start today’s workout</button></div>}
      </article>;
    })}</section>
    <datalist id="focus-suggestions">{FOCUS_SUGGESTIONS.map((f) => <option key={f} value={f}/>)}</datalist>

    <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <div className="card p-5"><h2 className="font-display text-2xl font-bold">Sets by day</h2><p className="mb-4 text-sm text-slate-500">Planned working sets each day, coloured by muscle group.</p>
        {weeklySets ? <div className="h-72"><ResponsiveContainer><BarChart data={setsByDay} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e8ee"/><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={13}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12}/>
          <Tooltip cursor={{ fill: "#eef1f4" }} formatter={(value: number, name: string) => [`${value} sets`, name]}/>
          <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} formatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)}/>
          {groupsInUse.map((g, index) => <Bar key={g} dataKey={g} stackId="s" fill={MUSCLE_COLOR[g]} radius={index === groupsInUse.length - 1 ? [5, 5, 0, 0] : 0}/>)}
        </BarChart></ResponsiveContainer></div> : <EmptyState title="No sets planned yet" detail="Add exercises with sets to see how your training load is spread across the week." action={<button className="btn btn-soft" onClick={() => openAdd(todayDay)}><Plus size={15}/>Add an exercise for today</button>}/>}
      </div>
      <div className="card p-5"><h2 className="font-display text-2xl font-bold">Muscle group balance</h2><p className="mb-4 text-sm text-slate-500">Total weekly sets per muscle group.</p>
        {balance.some((b) => b.sets) ? <div style={{ height: Math.max(180, balance.length * 38) }}><ResponsiveContainer><BarChart data={balance} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
          <XAxis type="number" allowDecimals={false} hide/><YAxis type="category" dataKey="group" tickLine={false} axisLine={false} width={84} fontSize={13} tickFormatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)}/>
          <Tooltip cursor={{ fill: "#eef1f4" }} formatter={(value: number) => [`${value} sets`, "Weekly"]}/>
          <Bar dataKey="sets" radius={[0, 5, 5, 0]} barSize={18} label={{ position: "right", fontSize: 12, fill: "#3c4859" }}>{balance.map((b) => <Cell key={b.group} fill={MUSCLE_COLOR[b.group]}/>)}</Bar>
        </BarChart></ResponsiveContainer></div> : <EmptyState title="Nothing to compare yet" detail="Once exercises have sets, you’ll see which muscle groups get the most work."/>}
      </div>
    </section>

    <Modal open={creating} title="New workout chart" onClose={() => setCreating(false)}><ChartForm onSubmit={(v) => createChart.mutate({ ...v, day_focus: {} })} pending={createChart.isPending} submitLabel="Create workout chart"/></Modal>
    <Modal open={editingChart} title="Edit workout chart" onClose={() => setEditingChart(false)}>
      <ChartForm initial={chart} onSubmit={(v) => updateChart.mutate({ ...v, day_focus: chart.day_focus })} pending={updateChart.isPending} submitLabel="Save changes"/>
      <button className="btn btn-danger mt-3 w-full" onClick={() => { if (confirm(`Delete “${chart.name}” and all its exercises?`)) removeChart.mutate(chart.id); }}><Trash2 size={15}/>Delete chart</button>
    </Modal>
    <Modal open={!!itemForm} title={editingItemId ? "Edit exercise" : "Add exercise"} onClose={() => { setItemForm(null); setEditingItemId(null); }}>
      {itemForm && <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); saveItem.mutate(itemForm); }}>
        <label className="col-span-2"><span className="field-label">Exercise</span><input className="input" required maxLength={160} value={itemForm.exercise} onChange={(e) => setItemForm({ ...itemForm, exercise: e.target.value })} placeholder="e.g. Barbell bench press"/></label>
        <label><span className="field-label">Day</span><select className="input" value={itemForm.day} onChange={(e) => setItemForm({ ...itemForm, day: e.target.value as Day })}>{DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select></label>
        <label><span className="field-label">Muscle group</span><select className="input capitalize" value={itemForm.muscle_group} onChange={(e) => setItemForm({ ...itemForm, muscle_group: e.target.value })}>{MUSCLE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
        <label><span className="field-label">Sets</span><input className="input num" type="number" min={0} max={50} value={itemForm.sets} onChange={(e) => setItemForm({ ...itemForm, sets: e.target.value })}/></label>
        <label><span className="field-label">Reps</span><input className="input num" maxLength={20} value={itemForm.reps} onChange={(e) => setItemForm({ ...itemForm, reps: e.target.value })} placeholder="e.g. 8-12"/></label>
        <label><span className="field-label">Weight (kg)</span><input className="input num" type="number" min={0} step="0.5" value={itemForm.weight_kg} onChange={(e) => setItemForm({ ...itemForm, weight_kg: e.target.value })} placeholder="Optional"/></label>
        <label><span className="field-label">Duration (min)</span><input className="input num" type="number" min={0} max={600} value={itemForm.duration_minutes} onChange={(e) => setItemForm({ ...itemForm, duration_minutes: e.target.value })} placeholder="For cardio"/></label>
        <label><span className="field-label">Rest (seconds)</span><input className="input num" type="number" min={0} max={1800} value={itemForm.rest_seconds} onChange={(e) => setItemForm({ ...itemForm, rest_seconds: e.target.value })}/></label>
        <label><span className="field-label">Notes</span><input className="input" maxLength={240} value={itemForm.notes} onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} placeholder="Tempo, cues…"/></label>
        <button className="btn btn-primary col-span-2 mt-1" disabled={saveItem.isPending || !itemForm.exercise.trim()}>{saveItem.isPending ? "Saving…" : editingItemId ? "Save exercise" : "Add to chart"}</button>
      </form>}
    </Modal>
    <Modal open={!!copyFrom} title="Copy a day" onClose={() => setCopyFrom(null)}>
      {copyFrom && <div className="grid gap-4">
        <label><span className="field-label">Copy exercises from</span><select className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value as Day)}>{DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}{chart.day_focus[d] ? ` — ${chart.day_focus[d]}` : ""} ({items.filter((i) => i.day === d).length})</option>)}</select></label>
        <fieldset><legend className="field-label">Add them to</legend><div className="flex flex-wrap gap-2">{DAYS.filter((d) => d !== copyFrom).map((d) => { const on = copyTo.includes(d); return <button type="button" key={d} aria-pressed={on} onClick={() => setCopyTo(on ? copyTo.filter((x) => x !== d) : [...copyTo, d])} className={`btn px-3 py-1.5 ${on ? "btn-primary" : "btn-ghost"}`}>{DAY_SHORT[d]}</button>; })}</div></fieldset>
        <p className="text-xs text-slate-500">The day’s focus is copied too. Exercises are added alongside anything already planned.</p>
        <button className="btn btn-primary" disabled={!copyTo.length || copyDay.isPending || !items.some((i) => i.day === copyFrom)} onClick={() => copyDay.mutate()}>{copyDay.isPending ? "Copying…" : "Copy exercises"}</button>
      </div>}
    </Modal>
  </main>;
}

export default function WorkoutChartPage() { return <AppShell><WorkoutChartContent/></AppShell>; }
