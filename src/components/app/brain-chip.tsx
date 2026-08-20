import { Brain, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { AI_MODE_LABELS } from "../../lib/ai/router";
import type { AiMode } from "../../lib/game/types";
import { useAi } from "../../lib/services/ai-store";
import { useGame } from "../../lib/services/game-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const MODES: AiMode[] = ["auto", "phone_local", "ollama", "cloud", "off"];

/**
 * Always-visible brain indicator. It never claims a connection that does not
 * exist: with nothing connected it says so and names the local engine.
 */
export function BrainChip() {
  const { snapshot, updateSettings } = useGame();
  const { brainLabel, aiConnected, providerStates } = useAi();
  const mode = snapshot?.settings.ai.mode ?? "auto";

  const setMode = async (next: AiMode) => {
    if (!snapshot) return;
    await updateSettings({ ai: { ...snapshot.settings.ai, mode: next } });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex max-w-[58%] items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-left text-[11px] transition-colors hover:border-primary/50">
        <span
          className={`size-2 shrink-0 rounded-full ${aiConnected ? "bg-primary shadow-[0_0_8px_var(--color-primary)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        <Brain className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-display tracking-wide">{brainLabel}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="font-display">Brain mode</DropdownMenuLabel>
        {MODES.map((item) => (
          <DropdownMenuItem key={item} onSelect={() => void setMode(item)}>
            <span className="flex-1">{AI_MODE_LABELS[item]}</span>
            {mode === item ? <span className="text-primary">active</span> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-display">Providers</DropdownMenuLabel>
        {providerStates.map((state) => (
          <div key={state.id} className="px-2 py-1 text-[11px] text-muted-foreground">
            <span className="text-foreground">{state.label}</span> — {state.detail}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/ai">Open AI Control Center</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
