export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="mt-0.5 text-[2.6rem] font-bold leading-none tracking-tight text-ink">{title}</h1>
      {description && <p className="mt-3 max-w-2xl text-[0.95rem] text-slate-600">{description}</p>}
    </div>
    {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
  </div>;
}

export function ProgressBar({ value, max, color = "bg-teal-600" }: { value: number; max: number; color?: string }) {
  const percentage = max ? Math.min((value / max) * 100, 100) : 0;
  return <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70" role="progressbar" aria-valuenow={Math.round(percentage)} aria-valuemin={0} aria-valuemax={100}>
    <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }}/>
  </div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-7 text-center">
    <p className="font-semibold text-slate-700">{title}</p>
    <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{detail}</p>
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>;
}

export function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: React.ReactNode }) {
  return <div>
    <p className="text-sm font-medium text-slate-500">{label}</p>
    <p className="mt-1.5 stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</p>
    {hint && <div className="mt-1.5 text-xs text-slate-500">{hint}</div>}
  </div>;
}
