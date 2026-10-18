/** FitTrack by uv — mark + stacked wordmark. `tone` matches the background it sits on. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
    <rect width="40" height="40" rx="9" fill="#2f4bd8"/>
    <path d="M12 9h17v5.5H18v4h9v5.5h-9V31h-6z" fill="#fff"/>
  </svg>;
}

export function Logo({ tone = "dark", size = "md" }: { tone?: "dark" | "light"; size?: "sm" | "md" | "lg" }) {
  const s = { sm: { mark: 28, word: "text-[1.3rem]", by: "text-[.7rem]" }, md: { mark: 34, word: "text-[1.6rem]", by: "text-[.78rem]" }, lg: { mark: 42, word: "text-[2rem]", by: "text-[.9rem]" } }[size];
  const onDark = tone === "dark";
  return <span className="inline-flex items-center gap-2.5" aria-label="FitTrack by uv">
    <LogoMark size={s.mark}/>
    <span className="flex flex-col leading-none">
      <span className={`font-display font-bold tracking-[.01em] ${s.word} ${onDark ? "text-white" : "text-ink"}`}>FitTrack</span>
      <span className={`mt-[3px] font-medium ${s.by} ${onDark ? "text-[#8fa0b8]" : "text-slate-500"}`}>by uv</span>
    </span>
  </span>;
}
