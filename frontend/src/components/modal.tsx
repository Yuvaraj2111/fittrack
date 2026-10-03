"use client";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("input, select, textarea")?.focus());
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}
