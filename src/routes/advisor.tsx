import { createFileRoute } from "@tanstack/react-router";
import { Brain, Gauge, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AdvisorCard } from "@/components/app/advisor-card";
import { AppShell } from "@/components/app/app-shell";
import { BrainChip } from "@/components/app/brain-chip";
import { EmptyState, Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { permissionForAction, useAdvisor } from "@/lib/services/advisor-store";

export const Route = createFileRoute("/advisor")({
  head: () => ({
    meta: [
      { title: "Advisor — Life Game" },
      {
        name: "description",
        content:
          "The Advisor reads your own records, explains what it sees, and proposes one validated action at a time. You approve everything.",
      },
      { property: "og:title", content: "Advisor — Life Game" },
      {
        property: "og:description",
        content: "Situations from your own data, explained, with validated actions you approve.",
      },
    ],
  }),
  component: AdvisorPage,
});

function AdvisorPage() {
  const advisor = useAdvisor();
  const [busy, setBusy] = useState(false);

  // Outcome measurement is deterministic and runs quietly when due.
  useEffect(() => {
    if (!advisor.ready) return;
    void advisor.measureDue();
  }, [advisor.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (id: string, opts: { force: boolean; optionId: string }) => {
    setBusy(true);
    try {
      const result = await advisor.approve(id, { force: opts.force, optionId: opts.optionId });
      if (result.ok) toast.success("Approved. The engine created it — nothing was auto-started.");
      else if (result.needsReapproval) toast.info("Your state changed. Re-checked — approve again to apply.");
      else toast.error(result.problems[0] ?? "That could not be applied.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (id: string, reason: string) => {
    setBusy(true);
    try {
      await advisor.reject(id, reason);
      toast.success("Declined. Kept as learning data.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Advisor 🧭" subtitle="Reads your data, proposes, never decides">
      <div className="space-y-4">
        <BrainChip />

        <Panel>
          <SectionTitle
            action={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={advisor.generating}
                  onClick={() => void advisor.assessWithCloud()}
                  title="Open advice is re-checked on this device automatically. This asks your cloud AI, and only when you press it."
                >
                  Re-check with cloud AI
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={advisor.generating}
                  onClick={() => void advisor.generate(true)}
                >
                  <RefreshCw className={`mr-1 size-4 ${advisor.generating ? "animate-spin" : ""}`} />
                  Review my system
                </Button>
              </div>
            }
          >
            Situations detected
          </SectionTitle>

          {advisor.triggers.length ? (
            <ul className="space-y-2">
              {advisor.triggers.map((trigger) => (
                <li key={trigger.code} className="text-xs">
                  <span className="font-medium">{trigger.label}</span>
                  <span className="text-muted-foreground"> — {trigger.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No situation stands out in your records right now.
            </p>
          )}
          {advisor.note ? <p className="mt-3 text-xs text-muted-foreground">{advisor.note}</p> : null}
        </Panel>

        {advisor.facts ? (
          <Panel className="space-y-1 text-xs">
            <SectionTitle>Facts it reasoned from</SectionTitle>
            <p className="flex items-center gap-2">
              <Gauge className="size-4 text-momentum" /> Momentum {advisor.facts.momentum}/100 · run{" "}
              {advisor.facts.currentRun}d · {advisor.facts.finishedRuns} recorded run(s)
            </p>
            <p className="text-muted-foreground">
              {advisor.facts.completions7d} completion(s) and {advisor.facts.misses7d} miss(es) in the
              last 7 days
              {advisor.facts.availableMinutes != null
                ? ` · ${advisor.facts.availableMinutes} min available today`
                : ""}
            </p>
            {advisor.memoryLines.length ? (
              <div className="pt-1">
                {advisor.memoryLines.map((line) => (
                  <p key={line} className="text-muted-foreground">
                    • {line}
                  </p>
                ))}
              </div>
            ) : null}
          </Panel>
        ) : null}

        <div>
          <SectionTitle>Open recommendations</SectionTitle>
          {advisor.live.length ? (
            <div className="space-y-3">
              {advisor.live.map((record) => (
                <AdvisorCard
                  key={record.id}
                  record={record}
                  busy={busy}
                  onApprove={(id, force, optionId) => void approve(id, { force, optionId })}
                  onReject={(id, reason) => void reject(id, reason)}
              streamlined={advisor.isStreamlined(record)}
              trustOffer={advisor.trustOfferFor(record)}
              onTrust={(actionType) =>
                void advisor.grantActionTrust(actionType, permissionForAction(record.action))
              }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nothing waiting for you"
              body="Tap “Review my system” to have the Advisor look at your current records."
            />
          )}
        </div>

        {advisor.past.length ? (
          <div>
            <SectionTitle>History</SectionTitle>
            <div className="space-y-3">
              {advisor.past.slice(0, 10).map((record) => (
                <AdvisorCard
                  key={record.id}
                  record={record}
                  outcome={advisor.outcomeFor(record.id)}
                  onApprove={(id, force, optionId) => void approve(id, { force, optionId })}
                  onReject={(id, reason) => void reject(id, reason)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <Panel className="flex items-start gap-2 text-xs text-muted-foreground">
          <Brain className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            The Advisor only proposes. Every number it uses comes from your own records, the
            deterministic engine validates each action twice, and nothing changes your game until you
            approve it. <Pill tone="muted">AI proposes · engine decides</Pill>
          </span>
        </Panel>
      </div>
    </AppShell>
  );
}