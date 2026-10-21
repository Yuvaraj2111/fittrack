"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Apple, BarChart3, CalendarDays, ChevronDown, ClipboardList, Droplets, Dumbbell, Goal, LayoutDashboard, LineChart, LogOut, NotebookPen, Pill, Salad, Settings, Sparkles, Sun } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";

type Icon = typeof Activity;
type Page = readonly [label: string, href: string, icon: Icon];
type Section = { label: string; icon: Icon; pages: Page[] };

// Tier 1 = sections in the header; tier 2 = the pages of the current section.
const SECTIONS: Section[] = [
  { label: "Today", icon: Sun, pages: [["Dashboard", "/dashboard", LayoutDashboard], ["Hydration", "/hydration", Droplets]] },
  { label: "Plan", icon: ClipboardList, pages: [["Diet chart", "/diet-chart", Salad], ["Workout chart", "/workout-chart", ClipboardList], ["Schedule", "/schedule", CalendarDays], ["Goals", "/goals", Goal]] },
  { label: "Log", icon: NotebookPen, pages: [["Nutrition", "/nutrition", Apple], ["Workouts", "/workouts", Dumbbell], ["Activity", "/activity", Activity], ["Supplements", "/supplements", Sparkles], ["Medications", "/medications", Pill]] },
  { label: "Review", icon: LineChart, pages: [["Analytics", "/analytics", BarChart3], ["Settings", "/settings", Settings]] },
];
const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

type User = { name: string; email: string };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const user = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/auth/me"), retry: false });
  const currentUser = user.data;
  useEffect(() => { if (user.isError) window.location.assign("/login"); }, [user.isError]);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [pathname]);
  useEffect(() => { document.querySelector<HTMLElement>(".subnav a.active")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [pathname, user.data]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  if (user.isLoading || user.isError || !currentUser) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Opening your FitTrack…</div>;
  async function signOut() { await api<void>("/auth/logout", { method: "POST" }); window.location.assign("/login"); }
  const section = SECTIONS.find((s) => s.pages.some(([, href]) => matches(pathname, href))) ?? SECTIONS[0];
  const initial = currentUser.name.trim().charAt(0).toUpperCase() || "F";
  const firstName = currentUser.name.trim().split(/\s+/)[0];

  return <>
    <div className="shell-top">
      <header className="shell-header">
        <div className="shell-row">
          <Link href="/dashboard" className="brand" aria-label="FitTrack home"><Logo tone="dark" size="sm"/></Link>
          <nav className="section-tabs" aria-label="Sections">{SECTIONS.map((s) => <Link key={s.label} href={s.pages[0][1]} aria-current={s === section ? "true" : undefined} className={s === section ? "active" : ""}><s.icon size={17}/>{s.label}</Link>)}</nav>
          <details className="account" ref={menu}>
            <summary aria-label="Account menu"><span className="account-name">{firstName}</span><span className="avatar">{initial}</span><ChevronDown size={15} className="account-name"/></summary>
            <div className="account-menu">
              <div className="border-b border-slate-100 px-[.9rem] py-3"><p className="truncate font-semibold">{currentUser.name}</p><p className="truncate text-xs text-slate-500">{currentUser.email}</p></div>
              <Link href="/settings"><Settings size={16}/>Account and goals</Link>
              <button onClick={signOut}><LogOut size={16}/>Sign out</button>
            </div>
          </details>
        </div>
      </header>
      <nav className="subnav" aria-label={`${section.label} pages`}>
        <div className="shell-row">
          {section.pages.map(([label, href, PageIcon]) => <Link key={href} href={href} aria-current={matches(pathname, href) ? "page" : undefined} className={matches(pathname, href) ? "active" : ""}><PageIcon size={15}/>{label}</Link>)}
          <span className="subnav-date">{format(new Date(), "EEEE, d MMMM")}</span>
        </div>
      </nav>
    </div>
    {children}
    <nav className="mobile-tabs" aria-label="Sections">{SECTIONS.map((s) => <Link key={s.label} href={s.pages[0][1]} className={s === section ? "active" : ""}><s.icon size={20}/><span>{s.label}</span></Link>)}</nav>
  </>;
}
