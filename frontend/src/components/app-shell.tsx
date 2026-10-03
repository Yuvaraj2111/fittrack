"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Apple, BarChart3, CalendarDays, ClipboardList, Droplets, Dumbbell, Goal, LayoutDashboard, LogOut, Pill, Salad, Settings, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { format } from "date-fns";
import { api } from "@/lib/api";

type NavItem = readonly [label: string, href: string, icon: typeof Activity];
const groups: { label: string; items: NavItem[] }[] = [
  { label: "Today", items: [["Dashboard", "/dashboard", LayoutDashboard]] },
  { label: "Plan", items: [["Diet chart", "/diet-chart", Salad], ["Workout chart", "/workout-chart", ClipboardList], ["Schedule", "/schedule", CalendarDays], ["Goals", "/goals", Goal]] },
  { label: "Log", items: [["Nutrition", "/nutrition", Apple], ["Workouts", "/workouts", Dumbbell], ["Activity", "/activity", Activity], ["Hydration", "/hydration", Droplets], ["Supplements", "/supplements", Sparkles], ["Medications", "/medications", Pill]] },
  { label: "Review", items: [["Analytics", "/analytics", BarChart3], ["Settings", "/settings", Settings]] },
];
const all = groups.flatMap((group) => group.items);
const mobileTabs = ["/dashboard", "/diet-chart", "/workout-chart", "/nutrition", "/workouts"];
const shortLabel: Record<string, string> = { "/dashboard": "Today", "/diet-chart": "Diet", "/workout-chart": "Training", "/nutrition": "Food log", "/workouts": "Workouts" };

type User = { name: string; email: string };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/auth/me"), retry: false });
  const currentUser = user.data;
  useEffect(() => { if (user.isError) window.location.assign("/login"); }, [user.isError]);
  if (user.isLoading || user.isError || !currentUser) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Opening your private dashboard…</div>;
  async function signOut() { await api<void>("/auth/logout", { method: "POST" }); window.location.assign("/login"); }
  const initial = currentUser.name.trim().charAt(0).toUpperCase() || "F";
  return <><div className="app-grid">
    <aside className="sidebar" aria-label="Main navigation">
      <Link href="/dashboard" className="brand"><span className="brand-mark">F</span>FitTrack</Link>
      <nav>{groups.map((group) => <div className="nav-group" key={group.label}>
        <p className="nav-group-label">{group.label}</p>
        <div className="space-y-0.5">{group.items.map(([label, href, Icon]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`nav-link ${pathname === href ? "active" : ""}`}><Icon size={17}/>{label}</Link>)}</div>
      </div>)}</nav>
      <div className="sidebar-foot"><p className="truncate px-3 text-xs text-[#8592a5]">{currentUser.email}</p><button className="nav-link mt-1 w-full" onClick={signOut}><LogOut size={17}/>Sign out</button></div>
    </aside>
    <div className="main">
      <header className="topbar">
        <div className="min-w-0"><p className="truncate text-sm text-slate-500">{format(new Date(), "EEEE, d MMMM")}</p></div>
        <div className="flex items-center gap-2">
          <details className="mobile-menu"><summary>More</summary><nav>{all.filter(([, href]) => !mobileTabs.includes(href)).map(([label, href, Icon]) => <Link key={href} href={href}><Icon size={16}/>{label}</Link>)}<button onClick={signOut} className="flex w-full items-center gap-2.5 border-t border-slate-100 px-[.85rem] py-[.7rem] text-left text-[.92rem] text-slate-600"><LogOut size={16}/>Sign out</button></nav></details>
          <Link href="/settings" className="avatar" title={`${currentUser.name} — account settings`} aria-label="Account settings">{initial}</Link>
        </div>
      </header>
      {children}
    </div>
  </div>
  <nav className="mobile-tabs" aria-label="Mobile navigation">{mobileTabs.map((href) => { const [, , Icon] = all.find(([, h]) => h === href)!; return <Link key={href} href={href} className={pathname === href ? "active" : ""}><Icon size={19}/><span>{shortLabel[href]}</span></Link>; })}</nav></>;
}
