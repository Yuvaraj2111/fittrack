"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, Play, Square } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, subDays } from "date-fns";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PageHeader, Stat } from "@/components/page";
import { api, today } from "@/lib/api";
import { fmt } from "@/lib/week";

type Session = { id: number; name: string; local_date: string; started_at: string; status: string; duration_minutes: number | null; total_volume_kg: number | string };
type DayStat = { date: string; sessions: number; minutes: number; volume_kg: number };
const workoutOptions = ["Full body", "Upper body", "Lower body", "Push", "Pull", "Legs", "Cardio", "Mobility", "Custom workout"];

function Workouts() {
  const client = useQueryClient();
  const [choice, setChoice] = useState(workoutOptions[0]); const [customName, setCustomName] = useState("");
  const [volumes, setVolumes] = useState<Record<number, string>>({});
  const sessions = useQuery({ queryKey: ["workouts"], queryFn: () => api<Session[]>("/workout-sessions") });
  const stats = useQuery({ queryKey: ["workout-analytics"], queryFn: () => api<DayStat[]>("/analytics/workouts?days=14") });
  const refresh = () => { client.invalidateQueries({ queryKey: ["workouts"] }); client.invalidateQueries({ queryKey: ["summary"] }); client.invalidateQueries({ queryKey: ["workout-analytics"] }); };
  const workoutName = choice === "Custom workout" ? customName : choice;
  const start = useMutation({ mutationFn: () => api<Session>("/workout-sessions", { method: "POST", body: JSON.stringify({ name: workoutName, local_date: today() }) }), onSuccess: () => { toast.success("Workout started"); setCustomName(""); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  // Duration is omitted so the API derives it from the stored start time.
  const finish = useMutation({ mutationFn: (id: number) => api<Session>(`/workout-sessions/${id}/finish`, { method: "POST", body: JSON.stringify({ total_volume_kg: Number(volumes[id] || 0) }) }), onSuccess: (s) => { toast.success(`Workout completed in ${s.duration_minutes ?? 0} min`); refresh(); }, onError: (e: Error) => toast.error(e.message) });

  const byDate = new Map((stats.data ?? []).map((d) => [String(d.date), d]));
  const series = Array.from({ length: 14 }, (_, i) => { const d = subDays(new Date(), 13 - i); const key = format(d, "yyyy-MM-dd"); return { label: format(d, "d MMM"), minutes: byDate.get(key)?.minutes ?? 0 }; });
  const totalMinutes = series.reduce((s, d) => s + d.minutes, 0);
  const activeDays = series.filter((d) => d.minutes > 0).length;
  const totalSessions = (stats.data ?? []).reduce((s, d) => s + d.sessions, 0);

  return <main className="content">
    <PageHeader title="Workouts" description="Start a session when you begin and finish it when you’re done. Duration is worked out from the saved start time." action={<Link href="/workout-chart" className="btn btn-ghost"><ClipboardList size={16}/>Workout chart</Link>}/>
    <section className="card mb-5 grid gap-6 p-5 sm:grid-cols-3">
      <Stat label="Last 14 days" value={fmt(totalMinutes)} unit="min" hint="Completed training time"/>
      <Stat label="Sessions" value={String(totalSessions)} hint="Completed in 14 days"/>
      <Stat label="Active days" value={String(activeDays)} unit="/ 14" hint="Days with a finished session"/>
    </section>
    <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <section className="card p-5"><h2 className="font-display text-xl font-bold">Start a session</h2>
          <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
            <div><label className="field-label" htmlFor="workout-type">Workout</label><select id="workout-type" className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>{workoutOptions.map((o) => <option key={o}>{o}</option>)}</select>{choice === "Custom workout" && <input className="input mt-2" value={customName} onChange={(e) => setCustomName(e.target.value)} required placeholder="Name your workout"/>}</div>
            <button className="btn btn-primary self-end" disabled={start.isPending || !workoutName.trim()}><Play size={16}/>Start</button>
          </form></section>
        <section className="space-y-2.5">{sessions.data?.length ? sessions.data.map((s) => <article className="card flex flex-wrap items-center justify-between gap-3 p-4" key={s.id}>
          <div><p className="font-semibold">{s.name}</p><p className="mt-0.5 text-sm text-slate-500">{format(new Date(s.local_date + "T00:00:00"), "EEE d MMM")} · {s.status === "completed" ? <span className="num">{s.duration_minutes ?? 0} min · {fmt(Number(s.total_volume_kg))} kg volume</span> : <span className="font-semibold text-teal-700">In progress since {format(new Date(s.started_at), "h:mm a")}</span>}</p></div>
          {s.status !== "completed" && <div className="flex items-center gap-2"><input className="input w-28 py-1.5 text-sm" type="number" min={0} placeholder="Volume kg" aria-label="Total volume in kg (optional)" value={volumes[s.id] ?? ""} onChange={(e) => setVolumes({ ...volumes, [s.id]: e.target.value })}/><button className="btn btn-soft" onClick={() => finish.mutate(s.id)} disabled={finish.isPending}><Square size={14}/>Finish</button></div>}
        </article>) : <EmptyState title="No sessions yet" detail="Choose a workout above to start your training history."/>}</section>
      </div>
      <section className="card h-fit p-5"><h2 className="font-display text-xl font-bold">Training minutes</h2><p className="mb-4 text-sm text-slate-500">Completed sessions over the last 14 days.</p>
        {totalMinutes ? <div className="h-72"><ResponsiveContainer><BarChart data={series} margin={{ left: -16, right: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e8ee"/><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval={1}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12}/><Tooltip cursor={{ fill: "#eef1f4" }} formatter={(v: number) => [`${v} min`, "Training"]}/><Bar dataKey="minutes" fill="#2f4bd8" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer></div>
          : <EmptyState title="No finished sessions yet" detail="Finish a workout and your training minutes will chart here."/>}
      </section>
    </div>
  </main>;
}
export default function WorkoutsPage() { return <AppShell><Workouts/></AppShell>; }
