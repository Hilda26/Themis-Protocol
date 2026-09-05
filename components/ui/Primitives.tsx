"use client";
import React from "react";
import { cn } from "@/lib/utils/cn";

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-card px-4 py-2 text-sm font-body tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-ink text-parchment hover:bg-ink/85",
    secondary: "border border-gold/50 bg-transparent text-ink hover:bg-gold-pale",
    ghost: "text-muted hover:text-ink",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
  } as const;
  return (
    <button className={cn(base, styles[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-card border border-line bg-panel p-6 shadow-page", className)}>
      {children}
    </div>
  );
}

/** A thin gold rule -- the editorial device that carries this whole design. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-rule", className)} />;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "gold";
}) {
  const tones = {
    neutral: "border-line text-muted",
    success: "border-success/40 text-success",
    warning: "border-warning/40 text-warning",
    danger: "border-danger/40 text-danger",
    gold: "border-gold/50 text-gold bg-gold-pale",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-card border border-line bg-parchment/60 px-3 py-2 font-body text-sm text-ink outline-none placeholder:text-muted/60 focus:border-gold",
        props.className,
      )}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-card border border-line bg-parchment/60 px-3 py-2 font-body text-sm text-ink outline-none placeholder:text-muted/60 focus:border-gold",
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-card border border-line bg-parchment/60 px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold",
        props.className,
      )}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
      {children}
    </label>
  );
}

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-1 font-body text-sm text-ink">{value}</div>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-8">
      {eyebrow && (
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.24em] text-gold">{eyebrow}</div>
      )}
      <h1 className="font-display text-3xl leading-tight text-ink md:text-4xl">{title}</h1>
      <Rule className="mt-4 max-w-[7rem]" />
      {description && <p className="mt-4 max-w-2xl font-body text-sm leading-relaxed text-muted">{description}</p>}
    </header>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: React.ReactNode }) {
  const tones = {
    info: "border-line text-muted",
    error: "border-danger/40 bg-danger/5 text-danger",
    success: "border-success/40 bg-success/5 text-success",
  } as const;
  return (
    <div className={cn("rounded-card border px-4 py-3 font-body text-sm", tones[tone])}>{children}</div>
  );
}
