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
    <section className={cn("panel p-4", glow && "glow-ring", className)}>{children}</section>
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
    <div className="mb-2 flex items-end justify-between gap-2">
      <h2 className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
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
  tone?: "default" | "spark" | "momentum" | "run";
}) {
  const toneClass = {
    default: "text-foreground",
    spark: "text-spark",
    momentum: "text-momentum",
    run: "text-run",
  }[tone];

  return (
    <div className="panel px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("numeric mt-1 text-2xl font-bold leading-none", toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
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
    momentum: "bg-momentum",
    run: "bg-run",
    boss: "bg-destructive",
  }[tone];

  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-background/70 ring-1 ring-inset ring-border">
        <div className={cn("h-full rounded-full transition-[width] duration-500", fill)} style={{ width }} />
      </div>
      {label ? <p className="mt-1 text-[11px] text-muted-foreground">{label}</p> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "spark" | "accent" | "drain" | "destructive";
}) {
  const toneClass = {
    muted: "border-border text-muted-foreground",
    primary: "border-primary/40 text-primary",
    spark: "border-spark/40 text-spark",
    accent: "border-accent/50 text-accent",
    drain: "border-drain/50 text-drain",
    destructive: "border-destructive/50 text-destructive",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-6 text-center">
      <p className="font-display text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}