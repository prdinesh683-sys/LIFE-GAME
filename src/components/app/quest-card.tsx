import { Clock, Sparkles, Target, Timer } from "lucide-react";

import { Pill } from "./primitives";
import { ATTRIBUTE_LABELS, QUEST_TYPE_LABELS, type Quest } from "@/lib/game/types";

export function QuestCard({
  quest,
  action,
  because,
}: {
  quest: Quest;
  action?: React.ReactNode;
  /** Deterministic "because…" line, already selected elsewhere. */
  because?: React.ReactNode;
}) {
  return (
    <article className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold leading-snug">{quest.name}</h3>
          {because ? <div className="mt-1">{because}</div> : null}
          {quest.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{quest.description}</p>
          ) : null}
        </div>
        <span className="numeric flex shrink-0 items-center gap-1 text-sm font-bold text-spark">
          <Sparkles className="size-4" />
          {quest.sparks}
        </span>
      </div>


      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone={quest.type === "rush" ? "accent" : "muted"}>
          {quest.type === "rush" ? <Timer className="size-3" /> : null}
          {QUEST_TYPE_LABELS[quest.type]}
        </Pill>
        <Pill>
          <Clock className="size-3" />
          {quest.durationMinutes}m
        </Pill>
        <Pill>{quest.difficulty}</Pill>
        <Pill tone="primary">
          <Target className="size-3" />
          {ATTRIBUTE_LABELS[quest.attribute]}
        </Pill>
        {quest.isRecovery ? <Pill tone="accent">Recovery 🛟</Pill> : null}
        {quest.aiGenerated ? <Pill tone="accent">AI</Pill> : null}
      </div>

      {action ? <div className="mt-4">{action}</div> : null}
    </article>
  );
}