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
  { to: "/", label: "Home", icon: Home },
  { to: "/next-move", label: "Next Move", icon: Zap },
  { to: "/quests", label: "Journey", icon: Compass },
  { to: "/chat", label: "Brain", icon: Brain },
];

const MORE_NAV: NavItem[] = [
  { to: "/recovery", label: "Recovery · Return Point", icon: LifeBuoy },
  { to: "/identity", label: "Identity & Growth", icon: User },
  { to: "/memory", label: "Memory & Insights", icon: Brain },
  { to: "/advisor", label: "Advisor History", icon: Swords },
  { to: "/agent", label: "Campaign Plans", icon: Bot },
  { to: "/boosts", label: "Boosts & Drains", icon: Compass },
  { to: "/settings", label: "Settings", icon: Settings2 },
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
  const { ready, error } = useGame();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!ready) return;
    if (currentPath === "/onboarding") return;
    try {
      if (localStorage.getItem("lifegame_onboarded") !== "true") {
        void navigate({ to: "/onboarding" });
      }
    } catch {
      /* localStorage blocked; stay on current route */
    }
  }, [ready, currentPath, navigate]);

  return (
    <div
      className={cn(
        "relative min-h-screen bg-background text-foreground selection:bg-primary/25 selection:text-foreground",
      )}
    >
      <div className="pointer-events-none absolute inset-0 grid-backdrop" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-border/40 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-3.5">
          <div className="min-w-0">
            <h1 className="truncate font-display text-base font-bold tracking-tight text-foreground">{title}</h1>
            {subtitle ? (
              <p className="truncate text-xs font-normal text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <Sheet>
            <SheetTrigger
              className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-surface/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              aria-label="More screens"
            >
              <Menu className="size-4" />
              <span>Menu</span>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-border/60 bg-surface">
              <SheetTitle className="font-display text-base font-bold text-foreground">Menu & Sanctuary</SheetTitle>
              <nav className="mt-5 flex flex-col gap-1.5">
                {MORE_NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
                    activeProps={{ className: "bg-surface-raised font-semibold text-primary" }}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-2xl px-5 pb-28 pt-4">
        {error ? (
          <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">Local storage unavailable</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        ) : null}
        {ready ? <ConnectionBanner /> : null}
        {!ready ? <ShellSkeleton /> : children}
      </main>

      {hideNav ? null : (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border/40 bg-surface/90 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-2xl items-stretch">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{ className: "font-semibold text-primary" }}
              >
                <item.icon className="size-5" />
                <span className="font-sans">{item.label}</span>
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
    <div className="space-y-4 animate-pulse">
      <div className="h-28 rounded-xl bg-surface/60 border border-border/40" />
      <div className="h-44 rounded-xl bg-surface/60 border border-border/40" />
    </div>
  );
}