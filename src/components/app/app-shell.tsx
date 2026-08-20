import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  Brain,
  Compass,
  Home,
  LifeBuoy,
  Menu,
  MessageSquare,
  Settings2,
  Swords,
  User,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { ConnectionBanner } from "./connection-banner";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useGame } from "@/lib/services/game-store";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Phase 5, items 11–14: at most four primary destinations. Everything else is
 * depth, reachable from "More" — never competing for the same decision.
 */
const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "Today", icon: Home },
  { to: "/quests", label: "Quests", icon: Swords },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

const MORE_NAV: NavItem[] = [
  { to: "/next-move", label: "More next moves", icon: Zap },
  { to: "/advisor", label: "Advice history", icon: Compass },
  { to: "/agent", label: "Plans", icon: Bot },
  { to: "/memory", label: "What I remember", icon: Brain },
  { to: "/identity", label: "Identity", icon: User },
  { to: "/boosts", label: "Boosts", icon: Compass },
  { to: "/drains", label: "Drains", icon: LifeBuoy },
  { to: "/recovery", label: "Recovery", icon: LifeBuoy },
];


export function AppShell({
  title,
  subtitle,
  children,
  hideNav,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  hideNav?: boolean;
}) {
  const { ready, error, snapshot } = useGame();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const onboardingComplete = snapshot?.settings.onboardingComplete ?? false;

  useEffect(() => {
    if (ready && snapshot && !onboardingComplete && pathname !== "/onboarding") {
      void navigate({ to: "/onboarding" });
    }
  }, [ready, snapshot, onboardingComplete, pathname, navigate]);

  const theme = snapshot?.settings.theme ?? "dark";
  const reduced = snapshot?.settings.reducedMotion ?? false;

  return (
    <div
      className={cn(
        "relative min-h-screen bg-background text-foreground",
        theme === "light" && "theme-light",
        reduced && "reduce-motion",
      )}
    >
      <div className="pointer-events-none absolute inset-0 grid-backdrop" aria-hidden />

      <header className="relative z-10 border-b border-border/60 bg-surface/60 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold tracking-wide">{title}</h1>
            {subtitle ? (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <Sheet>
            <SheetTrigger
              className="rounded-md border border-border bg-surface-raised p-2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="More screens"
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-surface">
              <SheetTitle className="font-display">More</SheetTitle>
              <nav className="mt-4 flex flex-col gap-1">
                {MORE_NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
                    activeProps={{ className: "bg-surface-raised text-foreground" }}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <p className="mt-6 rounded-md border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
                These screens are for depth. Today is the only place you need to start from.
              </p>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-28 pt-4">
        {error ? (
          <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm">
            <p className="font-medium">Local storage unavailable</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        ) : null}
        {ready ? <ConnectionBanner /> : null}
        {!ready ? <ShellSkeleton /> : children}
      </main>

      {hideNav ? null : (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-surface/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-stretch">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground transition-colors"
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{ className: "text-primary" }}
              >
                <item.icon className="size-5" />
                <span className="font-display tracking-wide">{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-24 animate-pulse rounded-lg bg-surface" />
      <div className="h-40 animate-pulse rounded-lg bg-surface" />
      <div className="h-16 animate-pulse rounded-lg bg-surface" />
    </div>
  );
}