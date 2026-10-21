"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useEffect, useState } from "react";
import { ArrowRight, Dumbbell, Lock, Salad, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";

type Mode = "signin" | "signup";
type SignupMode = "open" | "code" | "closed";
const schema = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  invite_code: z.string().max(120).optional(),
});
type Values = z.infer<typeof schema>;

const FEATURES = [
  { icon: Salad, title: "Diet charts in your cuisine", text: "Weekly meal plans with dishes from your region, and swaps for every meal." },
  { icon: Dumbbell, title: "Training that fits your week", text: "A split built around your days, equipment and any injuries." },
  { icon: Lock, title: "Your data stays yours", text: "Every account is private. Nobody else can see your logs or plans." },
];

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [signup, setSignup] = useState<SignupMode>("open");
  const [serverError, setServerError] = useState("");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "", invite_code: "" } });

  useEffect(() => {
    api<{ signup_mode: SignupMode }>("/auth/config").then((c) => setSignup(c.signup_mode)).catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
  }, []);

  function switchMode(next: Mode) { setMode(next); setServerError(""); form.clearErrors(); }

  async function submit(values: Values) {
    setServerError("");
    if (mode === "signup") {
      if (!values.name?.trim()) return form.setError("name", { message: "Enter your name" });
      if (values.password.length < 10) return form.setError("password", { message: "Use at least 10 characters" });
      if (signup === "code" && !values.invite_code?.trim()) return form.setError("invite_code", { message: "Enter the invite code you were given" });
    }
    try {
      await api(mode === "signup" ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(mode === "signup" ? values : { email: values.email, password: values.password }) });
      window.location.assign(mode === "signup" ? "/diet-chart" : "/dashboard");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Couldn't sign in. Please try again.");
    }
  }

  const errors = form.formState.errors;
  const canSignUp = signup !== "closed";

  return <main className="min-h-screen bg-ink text-white lg:grid lg:grid-cols-[1fr_minmax(28rem,34rem)]">
    <section className="relative hidden overflow-hidden px-14 py-12 lg:flex lg:flex-col">
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full border-[3.5rem] border-marigold/90"/>
      <Logo tone="dark" size="lg"/>
      <div className="relative mt-auto max-w-xl pb-6">
        <h1 className="text-[4.2rem] font-bold leading-[.98]">Eat well. Train smart. See it all in one place.</h1>
        <ul className="mt-10 grid gap-5">{FEATURES.map((f) => <li key={f.title} className="flex gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-marigold"><f.icon size={21}/></span>
          <span><b className="block text-[1.02rem]">{f.title}</b><span className="text-sm text-white/70">{f.text}</span></span>
        </li>)}</ul>
      </div>
    </section>

    <section className="flex min-h-screen items-center justify-center bg-chalk px-5 py-10 text-ink lg:rounded-l-[2.25rem]">
      <div className="w-full max-w-md">
        <div className="mb-8 lg:hidden"><span className="inline-flex rounded-2xl bg-ink px-4 py-3"><Logo tone="dark" size="md"/></span></div>

        {canSignUp && <div className="mb-7 grid grid-cols-2 rounded-full bg-white p-1 shadow-[inset_0_0_0_1px_#dfe6e3]" role="tablist">
          {(["signin", "signup"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => switchMode(m)} className={`rounded-full py-2.5 text-sm font-bold transition-colors ${mode === m ? "bg-ink text-white" : "text-slate-600 hover:text-ink"}`}>{m === "signin" ? "Sign in" : "Create account"}</button>)}
        </div>}

        <h2 className="font-display text-[2.4rem] font-bold leading-tight tracking-tight">{mode === "signin" ? "Welcome back" : "Start your FitTrack"}</h2>
        <p className="mt-1.5 text-slate-600">{mode === "signin" ? "Sign in to see today’s plan and log your progress." : "Free and private. Takes under a minute, then we’ll help you build your first plan."}</p>

        <form className="mt-7 grid gap-4" onSubmit={form.handleSubmit(submit)} noValidate>
          {mode === "signup" && <label><span className="field-label">Your name</span><input className="input py-3" autoComplete="name" {...form.register("name")}/>{errors.name && <span className="mt-1 block text-xs text-roseline">{errors.name.message}</span>}</label>}
          <label><span className="field-label">Email</span><input className="input py-3" type="email" autoComplete="email" {...form.register("email")}/>{errors.email && <span className="mt-1 block text-xs text-roseline">{errors.email.message}</span>}</label>
          <label><span className="field-label">Password</span><input className="input py-3" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} {...form.register("password")}/>
            {errors.password ? <span className="mt-1 block text-xs text-roseline">{errors.password.message}</span> : mode === "signup" && <span className="mt-1 block text-xs text-slate-500">At least 10 characters.</span>}</label>
          {mode === "signup" && signup === "code" && <label><span className="field-label">Invite code</span><input className="input py-3" autoComplete="off" {...form.register("invite_code")}/>{errors.invite_code && <span className="mt-1 block text-xs text-roseline">{errors.invite_code.message}</span>}</label>}
          {serverError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{serverError}{serverError.includes("already exists") && <> <button type="button" className="font-bold underline" onClick={() => switchMode("signin")}>Sign in</button></>}</p>}
          <button className="btn btn-primary mt-1 w-full py-3.5 text-base" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Please wait…" : mode === "signin" ? "Sign in" : "Create my account"}<ArrowRight size={18}/></button>
        </form>

        {!canSignUp && <p className="mt-6 text-sm text-slate-500">New accounts are closed on this FitTrack. Ask the owner for access.</p>}
        <p className="mt-8 flex gap-2 text-xs leading-5 text-slate-500"><Sparkles size={15} className="shrink-0 text-marigold"/>Plans are general guidance, not medical advice.</p>
      </div>
    </section>
  </main>;
}
