import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
  glow,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <section className={cn("panel rounded-xl border border-border/80 bg-surface/80 p-4.5 backdrop-blur-sm transition-all", glow && "glow-ring border-primary/40", className)}>
      {children}
    </section>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "spark" | "momentum" | "run" | "focus";
}) {
  const toneClass = {
    default: "text-foreground",
    spark: "text-spark",
    momentum: "text-momentum",
    run: "text-run",
    focus: "text-focus",
  }[tone];

  return (
    <div className="panel rounded-xl border border-border/70 bg-surface/70 px-3.5 py-3 transition-colors hover:border-border">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">
        {label}
      </p>
      <p className={cn("numeric mt-1.5 text-2xl font-black leading-none tracking-tight", toneClass)}>{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ProgressRail({
  ratio,
  label,
  tone = "energy",
}: {
  ratio: number;
  label?: string;
  tone?: "energy" | "momentum" | "run" | "boss";
}) {
  const width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  const fill = {
    energy: "energy-fill",
    momentum: "bg-momentum shadow-[0_0_12px_rgba(0,229,255,0.4)]",
    run: "bg-run shadow-[0_0_12px_rgba(216,179,106,0.4)]",
    boss: "bg-destructive shadow-[0_0_12px_rgba(255,90,95,0.4)]",
  }[tone];

  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-background/80 ring-1 ring-inset ring-border/80">
        <div className={cn("h-full rounded-full transition-[width] duration-500", fill)} style={{ width }} />
      </div>
      {label ? <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{label}</p> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "spark" | "accent" | "drain" | "destructive" | "focus";
}) {
  const toneClass = {
    muted: "border-border/80 bg-background/60 text-muted-foreground",
    primary: "border-primary/40 bg-primary/10 text-primary font-semibold shadow-[0_0_8px_rgba(255,179,0,0.15)]",
    spark: "border-spark/40 bg-spark/10 text-spark font-semibold shadow-[0_0_8px_rgba(255,179,0,0.15)]",
    accent: "border-accent/40 bg-accent/10 text-accent font-semibold shadow-[0_0_8px_rgba(0,229,255,0.15)]",
    focus: "border-focus/40 bg-focus/10 text-focus font-semibold",
    drain: "border-drain/40 bg-drain/10 text-drain",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel rounded-xl border border-border/80 bg-surface/60 p-6 text-center">
      <p className="font-display text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}