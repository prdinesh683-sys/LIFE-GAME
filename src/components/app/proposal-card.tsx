import { Check, X } from "lucide-react";

import { PROPOSAL_KIND_LABELS, type ProposalRecord } from "../../lib/ai/records";
import type { GoalPlanResponse, QuestResponse } from "../../lib/ai/schemas";
import { Button } from "../ui/button";
import { Panel, Pill } from "./primitives";

/**
 * Action card for anything the brain proposes. Nothing is applied until the
 * user approves it here, and applying always runs through the deterministic
 * game actions.
 */
export function ProposalCard({
  proposal,
  onDecide,
  busy,
}: {
  proposal: ProposalRecord;
  onDecide: (id: string, decision: "approved" | "rejected") => void;
  busy?: boolean;
}) {
  const pending = proposal.status === "pending";
  return (
    <Panel className="space-y-3" glow={pending}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {PROPOSAL_KIND_LABELS[proposal.kind]} proposal
          </p>
          <h3 className="truncate font-display text-base font-semibold">{proposal.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{proposal.summary}</p>
        </div>
        <Pill tone={proposal.source === "ai" ? "primary" : "muted"}>
          {proposal.source === "ai" ? (proposal.brain ?? "AI") : "Local engine"}
        </Pill>
      </div>

      {proposal.kind === "goal_plan" ? <GoalPlanDetail plan={proposal.payload as GoalPlanResponse} /> : null}
      {proposal.kind === "quest" ? <QuestDetail quest={proposal.payload as QuestResponse} /> : null}

      {proposal.factsUsed.length ? (
        <Section title="Based on (your data)" items={proposal.factsUsed} />
      ) : null}
      {proposal.hypotheses.length ? (
        <Section title="Guesses (not facts)" items={proposal.hypotheses} muted />
      ) : null}

      {pending ? (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy}
            onClick={() => onDecide(proposal.id, "approved")}
          >
            <Check className="mr-1 size-4" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => onDecide(proposal.id, "rejected")}
          >
            <X className="mr-1 size-4" /> Not now
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {proposal.status === "applied"
            ? "Approved and applied to your game."
            : "Dismissed — kept as learning data."}
        </p>
      )}
    </Panel>
  );
}

function Section({ title, items, muted }: { title: string; items: string[]; muted?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <ul className={`mt-1 space-y-0.5 text-xs ${muted ? "text-muted-foreground" : ""}`}>
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function GoalPlanDetail({ plan }: { plan: GoalPlanResponse }) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3 text-xs">
      <p>{plan.destination.description}</p>
      {plan.milestones.length ? (
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Milestones</p>
          <ol className="mt-1 space-y-0.5">
            {plan.milestones.map((m) => (
              <li key={m}>— {m}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {plan.quests.length ? (
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Starting quests
          </p>
          <ul className="mt-1 space-y-0.5">
            {plan.quests.map((q) => (
              <li key={q.name}>
                {q.name} — {q.duration_minutes} min · {q.difficulty}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.schedule ? <p className="text-muted-foreground">Rhythm: {plan.schedule}</p> : null}
      {plan.risks.length ? (
        <p className="text-muted-foreground">Risks: {plan.risks.join(", ")}</p>
      ) : null}
    </div>
  );
}

function QuestDetail({ quest }: { quest: QuestResponse }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3 text-xs">
      <p>{quest.quest.description || "No extra description."}</p>
      <p className="mt-1 text-muted-foreground">
        {quest.quest.duration_minutes} minutes · {quest.quest.difficulty}
      </p>
    </div>
  );
}
