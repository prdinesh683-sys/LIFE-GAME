import { Battery, Clock, Smile } from "lucide-react";

import { cn } from "@/lib/utils";
import { useGame } from "@/lib/services/game-store";

const LEVELS = [1, 2, 3, 4, 5];
const TIME_OPTIONS = [5, 15, 30, 60, 120];

/**
 * Current State — updated in seconds with taps. Never a blocking form:
 * Next Move works with or without it.
 */
export function CurrentStateBar() {
  const { today, updateDailyState } = useGame();

  return (
    <div className="panel space-y-3 p-3">
      <Row icon={<Battery className="size-4" />} label="Energy">
        {LEVELS.map((level) => (
          <Chip
            key={level}
            active={today?.energy === level}
            onClick={() => void updateDailyState({ energy: level })}
          >
            {level}
          </Chip>
        ))}
      </Row>
      <Row icon={<Smile className="size-4" />} label="Mood">
        {LEVELS.map((level) => (
          <Chip
            key={level}
            active={today?.mood === level}
            onClick={() => void updateDailyState({ mood: level })}
          >
            {level}
          </Chip>
        ))}
      </Row>
      <Row icon={<Clock className="size-4" />} label="Time">
        {TIME_OPTIONS.map((minutes) => (
          <Chip
            key={minutes}
            active={today?.availableMinutes === minutes}
            onClick={() => void updateDailyState({ availableMinutes: minutes })}
          >
            {minutes}m
          </Chip>
        ))}
      </Row>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        {label}
      </span>
      <div className="flex flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "numeric min-w-9 rounded-md border px-2 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}