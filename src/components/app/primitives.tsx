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
    <section className={cn("panel rounded-xl border border-border/60 bg-surface/60 p-4.5 transition-all", glow && "border-primary/30 bg-surface/80", className)}>
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
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
    <div className="rounded-xl border border-border/40 bg-surface/40 px-3.5 py-3 transition-colors">
      <p className="text-[11px] font-medium text-muted-foreground">
        {label}
      </p>
      <p className={cn("numeric mt-1 text-2xl font-bold leading-tight", toneClass)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p> : null}
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
    energy: "bg-primary",
    momentum: "bg-momentum",
    run: "bg-run",
    boss: "bg-destructive",
  }[tone];

  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised/80">
        <div className={cn("h-full rounded-full transition-[width] duration-500", fill)} style={{ width }} />
      </div>
      {label ? <p className="mt-1.5 text-xs text-muted-foreground">{label}</p> : null}
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
    muted: "border-border/60 bg-surface/50 text-muted-foreground",
    primary: "border-primary/30 bg-primary/10 text-primary font-medium",
    spark: "border-spark/30 bg-spark/10 text-spark font-medium",
    accent: "border-accent/30 bg-accent/10 text-accent font-medium",
    focus: "border-focus/30 bg-focus/10 text-focus font-medium",
    drain: "border-drain/30 bg-drain/10 text-drain",
    destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-normal",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-surface/40 p-6 text-center">
      <p className="font-display text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}