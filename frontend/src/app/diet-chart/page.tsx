"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Pencil, Plus, Trash2, Utensils } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Modal } from "@/components/modal";
import { EmptyState, PageHeader, Stat } from "@/components/page";
import { api, today } from "@/lib/api";
import type { DietChart, DietItem } from "@/lib/charts";
import { DAYS, DAY_LABEL, DAY_SHORT, MACRO_COLOR, MEAL_SLOTS, fmt, n, todayKey, type Day, type MealSlot } from "@/lib/week";

type ItemForm = { day: Day; meal_slot: MealSlot; food_name: string; portion: string; calories: string; protein_g: string; carbs_g: string; fat_g: string };
const blankItem = (day: Day, meal_slot: MealSlot): ItemForm => ({ day, meal_slot, food_name: "", portion: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" });

function dayTotals(items: DietItem[], day: Day) {
  return items.filter((item) => item.day === day).reduce((sum, item) => ({
    calories: sum.calories + n(item.calories), protein: sum.protein + n(item.protein_g), carbs: sum.carbs + n(item.carbs_g), fat: sum.fat + n(item.fat_g),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function ChartForm({ initial, onSubmit, pending, submitLabel }: { initial?: { name: string; target_calories: number | null; notes: string | null }; onSubmit: (values: { name: string; target_calories: number | null; notes: string | null }) => void; pending: boolean; submitLabel: string }) {
  const [name, setName] = useState(initial?.name ?? ""); const [target, setTarget] = useState(initial?.target_calories ? String(initial.target_calories) : ""); const [notes, setNotes] = useState(initial?.notes ?? "");
  return <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); onSubmit({ name: name.trim(), target_calories: target ? Number(target) : null, notes: notes.trim() || null }); }}>
    <label><span className="field-label">Chart name</span><input className="input" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekday high-protein"/></label>
    <label><span className="field-label">Daily calorie target (optional)</span><input className="input" type="number" min={500} max={10000} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 2000"/></label>
    <label><span className="field-label">Notes (optional)</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Guidance from your dietitian, swaps, timing…"/></label>
    <button className="btn btn-primary mt-1" disabled={pending || !name.trim()}>{pending ? "Saving…" : submitLabel}</button>
  </form>;
}

function DietChartContent() {
  const client = useQueryClient();
  const charts = useQuery({ queryKey: ["diet-charts"], queryFn: () => api<DietChart[]>("/diet-charts") });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false); const [editingChart, setEditingChart] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm | null>(null); const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [copyFrom, setCopyFrom] = useState<Day | null>(null); const [copyTo, setCopyTo] = useState<Day[]>([]);
  const [mobileDay, setMobileDay] = useState<Day>(todayKey());
  const todayDay = todayKey();
  const dayStrip = useRef<HTMLDivElement>(null);
  useEffect(() => { dayStrip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: "center", block: "nearest" }); }, [mobileDay, charts.data]);

  const list = charts.data ?? [];
  const chart = list.find((c) => c.id === selectedId) ?? list.find((c) => c.is_active) ?? list[0];
  const items = chart?.items ?? [];
  const refresh = () => client.invalidateQueries({ queryKey: ["diet-charts"] });
  const onError = (error: Error) => toast.error(error.message);

  const createChart = useMutation({ mutationFn: (body: object) => api<DietChart>("/diet-charts", { method: "POST", body: JSON.stringify(body) }), onSuccess: (created) => { toast.success("Diet chart created"); setCreating(false); setSelectedId(created.id); refresh(); }, onError });
  const updateChart = useMutation({ mutationFn: (body: object) => api<DietChart>(`/diet-charts/${chart!.id}`, { method: "PUT", body: JSON.stringify(body) }), onSuccess: () => { toast.success("Chart updated"); setEditingChart(false); refresh(); }, onError });
  const activate = useMutation({ mutationFn: (id: number) => api(`/diet-charts/${id}/activate`, { method: "POST" }), onSuccess: () => { toast.success("Now following this chart"); refresh(); client.invalidateQueries({ queryKey: ["today-plan"] }); }, onError });
  const removeChart = useMutation({ mutationFn: (id: number) => api<void>(`/diet-charts/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Chart deleted"); setSelectedId(null); setEditingChart(false); refresh(); }, onError });
  const saveItem = useMutation({
    mutationFn: (form: ItemForm) => {
      const body = JSON.stringify({ ...form, portion: form.portion.trim() || null, calories: Number(form.calories || 0), protein_g: Number(form.protein_g || 0), carbs_g: Number(form.carbs_g || 0), fat_g: Number(form.fat_g || 0) });
      return editingItemId ? api(`/diet-chart-items/${editingItemId}`, { method: "PUT", body }) : api(`/diet-charts/${chart!.id}/items`, { method: "POST", body });
    },
    onSuccess: () => { toast.success(editingItemId ? "Meal updated" : "Meal added to chart"); setItemForm(null); setEditingItemId(null); refresh(); }, onError,
  });
  const removeItem = useMutation({ mutationFn: (id: number) => api<void>(`/diet-chart-items/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Meal removed"); refresh(); }, onError });
  const copyDay = useMutation({
    mutationFn: async () => {
      const source = items.filter((item) => item.day === copyFrom);
      for (const target of copyTo) for (const item of source) {
        await api(`/diet-charts/${chart!.id}/items`, { method: "POST", body: JSON.stringify({ day: target, meal_slot: item.meal_slot, food_name: item.food_name, portion: item.portion, calories: n(item.calories), protein_g: n(item.protein_g), carbs_g: n(item.carbs_g), fat_g: n(item.fat_g) }) });
      }
    },
    onSuccess: () => { toast.success(`Copied ${DAY_LABEL[copyFrom!]} to ${copyTo.length} day${copyTo.length > 1 ? "s" : ""}`); setCopyFrom(null); setCopyTo([]); refresh(); }, onError,
  });
  const logToDiary = useMutation({
    mutationFn: (item: DietItem) => api("/food-logs", { method: "POST", body: JSON.stringify({ name: item.food_name, meal_category: item.meal_slot, local_date: today(), serving_g: 100, quantity: 1, calories: n(item.calories), protein_g: n(item.protein_g), carbs_g: n(item.carbs_g), fat_g: n(item.fat_g), fiber_g: 0, source: "diet_chart", notes: item.portion }) }),
    onSuccess: (_, item) => { toast.success(`${item.food_name} logged to today’s diary`); client.invalidateQueries({ queryKey: ["summary"] }); client.invalidateQueries({ queryKey: ["food-logs"] }); }, onError,
  });

  const totals = useMemo(() => DAYS.map((day) => ({ day, label: DAY_SHORT[day], ...dayTotals(items, day) })), [items]);
  const plannedDays = totals.filter((t) => t.calories > 0);
  const avg = (key: "calories" | "protein" | "carbs" | "fat") => plannedDays.length ? plannedDays.reduce((s, t) => s + t[key], 0) / plannedDays.length : 0;
  const macroKcal = totals.map((t) => ({ label: t.label, Protein: Math.round(t.protein * 4), Carbs: Math.round(t.carbs * 4), Fat: Math.round(t.fat * 9) }));
  const target = chart?.target_calories ?? null;

  function openAdd(day: Day, slot: MealSlot) { setEditingItemId(null); setItemForm(blankItem(day, slot)); }
  function openEdit(item: DietItem) { setEditingItemId(item.id); setItemForm({ day: item.day, meal_slot: item.meal_slot, food_name: item.food_name, portion: item.portion ?? "", calories: String(n(item.calories)), protein_g: String(n(item.protein_g)), carbs_g: String(n(item.carbs_g)), fat_g: String(n(item.fat_g)) }); }

  const ItemCard = ({ item, day }: { item: DietItem; day: Day }) => <div className="plan-item">
    <p className="text-[.86rem] font-semibold leading-snug text-ink">{item.food_name}</p>
    <p className="text-xs text-slate-500">{item.portion ? `${item.portion} · ` : ""}<span className="num font-semibold text-slate-700">{fmt(n(item.calories))}</span> kcal</p>
    <div className="item-actions">
      {day === todayDay && <button className="icon-btn" title="Log to today’s diary" aria-label={`Log ${item.food_name} to today’s diary`} onClick={() => logToDiary.mutate(item)}><Check size={14}/></button>}
      <button className="icon-btn" title="Edit" aria-label={`Edit ${item.food_name}`} onClick={() => openEdit(item)}><Pencil size={13}/></button>
      <button className="icon-btn danger" title="Remove" aria-label={`Remove ${item.food_name}`} onClick={() => removeItem.mutate(item.id)}><Trash2 size={13}/></button>
    </div>
  </div>;

  if (charts.isLoading) return <main className="content"><div className="h-80 animate-pulse rounded-2xl bg-slate-200"/></main>;

  if (!chart) return <main className="content">
    <PageHeader title="Diet chart" description="Plan what you eat across the week. Each day is split into five meals, so you can see your calories and macros before the day starts."/>
    <section className="card max-w-lg p-6"><h2 className="font-display text-2xl font-bold">Create your first diet chart</h2><p className="mb-5 mt-1 text-sm text-slate-500">Give it a name and an optional daily calorie target. You’ll add meals next.</p><ChartForm onSubmit={(v) => createChart.mutate(v)} pending={createChart.isPending} submitLabel="Create diet chart"/></section>
  </main>;

  return <main className="content">
    <PageHeader title="Diet chart" description="Your planned meals for the week. Edit or remove any meal from its card. On today’s meals, the tick logs it straight to your food diary."
      action={<>
        {list.length > 1 && <select className="input w-auto min-w-[12rem]" value={chart.id} onChange={(e) => setSelectedId(Number(e.target.value))} aria-label="Choose a diet chart">{list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? " (following)" : ""}</option>)}</select>}
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16}/>New chart</button>
      </>}/>

    <section className="card mb-5 grid grid-cols-3 gap-x-4 gap-y-5 p-5 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:gap-6">
      <div className="col-span-3 min-w-0 lg:col-span-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-[1.7rem] font-bold leading-tight">{chart.name}</h2>{chart.is_active ? <span className="chip bg-teal-50 text-teal-700"><span className="dot bg-teal-600"/>Following</span> : <button className="btn btn-soft px-2.5 py-1 text-xs" onClick={() => activate.mutate(chart.id)}>Follow this chart</button>}</div>
        {chart.notes && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{chart.notes}</p>}
        <div className="mt-3 flex gap-2"><button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditingChart(true)}><Pencil size={13}/>Edit details</button><button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setCopyFrom(todayDay); setCopyTo([]); }}><Copy size={13}/>Copy a day</button></div>
      </div>
      <Stat label="Daily target" value={target ? fmt(target) : "—"} unit={target ? "kcal" : undefined} hint={target ? "Set on this chart" : "No target set"}/>
      <Stat label="Average planned" value={fmt(avg("calories"))} unit="kcal" hint={`${plannedDays.length} of 7 days planned`}/>
      <Stat label="Average protein" value={fmt(avg("protein"))} unit="g" hint={`Carbs ${fmt(avg("carbs"))} g · Fat ${fmt(avg("fat"))} g`}/>
    </section>

    {/* Mobile: one day at a time */}
    <div ref={dayStrip} className="day-strip mb-3 md:hidden" role="tablist" aria-label="Choose a day">{DAYS.map((day) => <button key={day} role="tab" aria-selected={mobileDay === day} onClick={() => setMobileDay(day)} className={`btn shrink-0 px-3 py-1.5 ${mobileDay === day ? "btn-primary" : "btn-ghost"}`}>{DAY_SHORT[day]}{day === todayDay ? " ·" : ""}</button>)}</div>
    <section className="mb-5 space-y-3 md:hidden">{MEAL_SLOTS.map((slot) => { const slotItems = items.filter((i) => i.day === mobileDay && i.meal_slot === slot); return <div className={`card p-3 ${mobileDay === todayDay ? "is-today" : ""}`} key={slot}><div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold capitalize">{slot}</p><span className="num text-sm text-slate-500">{fmt(slotItems.reduce((s, i) => s + n(i.calories), 0))} kcal</span></div>{slotItems.map((item) => <ItemCard key={item.id} item={item} day={mobileDay}/>)}<button className="add-cell" onClick={() => openAdd(mobileDay, slot)}><Plus size={13}/>Add food</button></div>; })}
      <p className="text-right text-sm text-slate-600">{DAY_LABEL[mobileDay]} total <b className="num text-base">{fmt(dayTotals(items, mobileDay).calories)} kcal</b></p></section>

    {/* Desktop: the full week board */}
    <div className="week-scroll mb-6 hidden md:block"><table className="week-table">
      <thead><tr><th className="slot">Meal</th>{DAYS.map((day) => <th key={day} className={day === todayDay ? "is-today" : ""}><span className="font-display text-lg font-bold">{DAY_SHORT[day]}</span>{day === todayDay && <span className="ml-1.5 text-xs font-semibold text-teal-700">Today</span>}</th>)}</tr></thead>
      <tbody>{MEAL_SLOTS.map((slot) => <tr key={slot}><th className="slot" scope="row">{slot}</th>{DAYS.map((day) => { const cell = items.filter((i) => i.day === day && i.meal_slot === slot); return <td key={day} className={day === todayDay ? "is-today" : ""}>{cell.map((item) => <ItemCard key={item.id} item={item} day={day}/>)}<button className="add-cell" onClick={() => openAdd(day, slot)} aria-label={`Add food to ${DAY_LABEL[day]} ${slot}`}><Plus size={13}/>Add</button></td>; })}</tr>)}</tbody>
      <tfoot><tr><th className="slot text-left">Day total</th>{totals.map((t) => { const over = target && t.calories > target * 1.05; return <td key={t.day} className={t.day === todayDay ? "is-today" : ""}><p className={`num text-xl font-bold ${over ? "text-roseline" : "text-ink"}`}>{fmt(t.calories)}<span className="ml-1 font-sans text-xs font-medium text-slate-500">kcal</span></p><p className="text-[.72rem] leading-tight text-slate-500">P {fmt(t.protein)} · C {fmt(t.carbs)} · F {fmt(t.fat)}</p></td>; })}</tr></tfoot>
    </table></div>

    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-display text-2xl font-bold">Calories by day</h2><p className="text-sm text-slate-500">Planned energy split by macronutrient{target ? "; the dashed line is your daily target" : ""}.</p></div></div>
      {plannedDays.length ? <div className="h-72"><ResponsiveContainer><BarChart data={macroKcal} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e8ee"/>
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={13}/><YAxis tickLine={false} axisLine={false} fontSize={12} width={52} tickCount={6} domain={[0, (max: number) => Math.ceil(Math.max(max, (target ?? 0) * 1.08) / 250) * 250]}/>
        <Tooltip cursor={{ fill: "#eef1f4" }} formatter={(value: number, name: string) => [`${fmt(value)} kcal`, name]}/>
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }}/>
        <Bar dataKey="Protein" stackId="k" fill={MACRO_COLOR.protein}/><Bar dataKey="Carbs" stackId="k" fill={MACRO_COLOR.carbs}/><Bar dataKey="Fat" stackId="k" fill={MACRO_COLOR.fat} radius={[5, 5, 0, 0]}/>
        {target && <ReferenceLine y={target} stroke="#18212e" strokeDasharray="5 4" label={{ value: `Target ${fmt(target)}`, position: "insideTopRight", fontSize: 12, fill: "#3c4859" }}/>}
      </BarChart></ResponsiveContainer></div> : <EmptyState title="No meals planned yet" detail="Add foods to any day on the board above and your weekly calorie picture appears here." action={<button className="btn btn-soft" onClick={() => openAdd(todayDay, "breakfast")}><Utensils size={15}/>Plan today’s breakfast</button>}/>}
    </section>

    <Modal open={creating} title="New diet chart" onClose={() => setCreating(false)}><ChartForm onSubmit={(v) => createChart.mutate(v)} pending={createChart.isPending} submitLabel="Create diet chart"/></Modal>
    <Modal open={editingChart} title="Edit diet chart" onClose={() => setEditingChart(false)}>
      <ChartForm initial={chart} onSubmit={(v) => updateChart.mutate(v)} pending={updateChart.isPending} submitLabel="Save changes"/>
      <button className="btn btn-danger mt-3 w-full" onClick={() => { if (confirm(`Delete “${chart.name}” and all its meals?`)) removeChart.mutate(chart.id); }}><Trash2 size={15}/>Delete chart</button>
    </Modal>
    <Modal open={!!itemForm} title={editingItemId ? "Edit meal" : "Add food to chart"} onClose={() => { setItemForm(null); setEditingItemId(null); }}>
      {itemForm && <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); saveItem.mutate(itemForm); }}>
        <label><span className="field-label">Day</span><select className="input" value={itemForm.day} onChange={(e) => setItemForm({ ...itemForm, day: e.target.value as Day })}>{DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select></label>
        <label><span className="field-label">Meal</span><select className="input capitalize" value={itemForm.meal_slot} onChange={(e) => setItemForm({ ...itemForm, meal_slot: e.target.value as MealSlot })}>{MEAL_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="col-span-2"><span className="field-label">Food</span><input className="input" required maxLength={180} value={itemForm.food_name} onChange={(e) => setItemForm({ ...itemForm, food_name: e.target.value })} placeholder="e.g. Ragi dosa with sambar"/></label>
        <label className="col-span-2"><span className="field-label">Portion</span><input className="input" maxLength={80} value={itemForm.portion} onChange={(e) => setItemForm({ ...itemForm, portion: e.target.value })} placeholder="e.g. 2 dosas, 1 cup, 150 g"/></label>
        {([["calories", "Calories (kcal)"], ["protein_g", "Protein (g)"], ["carbs_g", "Carbs (g)"], ["fat_g", "Fat (g)"]] as const).map(([key, label]) => <label key={key}><span className="field-label">{label}</span><input className="input num" type="number" min={0} step="0.1" value={itemForm[key]} onChange={(e) => setItemForm({ ...itemForm, [key]: e.target.value })}/></label>)}
        <button className="btn btn-primary col-span-2 mt-1" disabled={saveItem.isPending || !itemForm.food_name.trim()}>{saveItem.isPending ? "Saving…" : editingItemId ? "Save meal" : "Add to chart"}</button>
      </form>}
    </Modal>
    <Modal open={!!copyFrom} title="Copy a day" onClose={() => setCopyFrom(null)}>
      {copyFrom && <div className="grid gap-4">
        <label><span className="field-label">Copy meals from</span><select className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value as Day)}>{DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]} ({items.filter((i) => i.day === d).length} items)</option>)}</select></label>
        <fieldset><legend className="field-label">Add them to</legend><div className="flex flex-wrap gap-2">{DAYS.filter((d) => d !== copyFrom).map((d) => { const on = copyTo.includes(d); return <button type="button" key={d} aria-pressed={on} onClick={() => setCopyTo(on ? copyTo.filter((x) => x !== d) : [...copyTo, d])} className={`btn px-3 py-1.5 ${on ? "btn-primary" : "btn-ghost"}`}>{DAY_SHORT[d]}</button>; })}</div></fieldset>
        <p className="text-xs text-slate-500">Copied meals are added alongside anything already planned on those days.</p>
        <button className="btn btn-primary" disabled={!copyTo.length || copyDay.isPending || !items.some((i) => i.day === copyFrom)} onClick={() => copyDay.mutate()}>{copyDay.isPending ? "Copying…" : "Copy meals"}</button>
      </div>}
    </Modal>
  </main>;
}

export default function DietChartPage() { return <AppShell><DietChartContent/></AppShell>; }
