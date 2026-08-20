import { AlertTriangle, Check, ChevronDown, FolderSync, ShieldCheck, Scale, X, Zap } from "lucide-react";
import { useState } from "react";

import {
  EVIDENCE_KIND_LABELS,
  RECOMMENDATION_KIND_LABELS,
  type RecommendationOutcomeRecord,
  type RecommendationRecord,
} from "@/lib/advisor/advisor-types";
import { OUTCOME_RESULT_LABELS } from "@/lib/advisor/advisor-types";
import { recommendationStatusLabel } from "@/lib/ui/labels";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Panel, Pill } from "./primitives";

/**
 * Advisor recommendation card. Everything the Advisor claims is shown with its
 * evidence class, so a guess can never look like a fact. Nothing is applied
 * until Approve is pressed, and approval revalidates first.
 */
export function AdvisorCard({
  record,
  outcome,
  busy,
  onApprove,
  onReject,
  streamlined = false,
  trustOffer = null,
  onTrust,
  because = null,
}: {
  record: RecommendationRecord;
  outcome?: RecommendationOutcomeRecord | null;
  busy?: boolean;
  onApprove: (id: string, force: boolean, optionId: string) => void;
  onReject: (id: string, reason: string) => void;
  /** True when the player streamlined this action type — one tap, still checked. */
  streamlined?: boolean;
  trustOffer?: { actionType: string; label: string } | null;
  onTrust?: (actionType: string) => void;
  /** Deterministic "because…" line shown under the title. */
  because?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const preferred = record.options[record.preferredOptionIndex] ?? record.options[0] ?? null;
  const [optionId, setOptionId] = useState(preferred?.id ?? "");
  const selected = record.options.find((o) => o.id === optionId) ?? preferred;
  const chosen = record.chosenOptionId
    ? record.options.find((o) => o.id === record.chosenOptionId)
    : null;
  const decidable = record.status === "pending" || record.status === "needs_reapproval";
  const facts = record.evidence.filter((e) => e.kind === "fact");
  const observations = record.evidence.filter((e) => e.kind === "observation");
  const hypotheses = record.evidence.filter((e) => e.kind === "hypothesis");

  return (
    <Panel className="space-y-3" glow={record.status === "pending"}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {RECOMMENDATION_KIND_LABELS[record.kind]} · {record.triggerLabel}
          </p>
          <h3 className="font-display text-base font-semibold leading-tight">{record.title}</h3>
          {because ? <div className="mt-0.5">{because}</div> : null}
          {record.summary ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{record.summary}</p>
          ) : null}
        </div>

        <Pill tone={record.source === "ai" ? "primary" : "muted"}>
          {record.source === "ai" ? (record.brain ?? "AI") : "Local engine"}
        </Pill>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={strengthTone(record.evidenceScore.strength)}>
          {record.evidenceScore.strength} evidence
        </Pill>
        <Pill tone="muted">confidence {Math.round(record.confidence * 100)}%</Pill>
        {selected?.action.type === "create_quest" ? (
          <Pill tone="spark">
            {selected.action.quest.durationMinutes} min · {selected.action.quest.difficulty}
          </Pill>
        ) : (
          <Pill tone="muted">guidance only</Pill>
        )}
        {record.usedDriveContext ? (
          <Pill tone="muted">
            <FolderSync className="mr-1 inline size-3" />
            Drive context used
          </Pill>
        ) : null}
        {!decidable ? <Pill tone="muted">{recommendationStatusLabel(record.status)}</Pill> : null}
      </div>

      {record.status === "needs_reapproval" ? (
        <p className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" />
          Your situation changed enough to matter since this was written. I've re-checked it —
          approve again to apply the updated version.
        </p>
      ) : null}

      {record.validation?.adjustments.length ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          {record.validation.adjustments.join(" ")}
        </p>
      ) : null}

      {decidable && record.options.length > 1 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Your options — pick one
          </p>
          {record.options.map((option) => {
            const active = option.id === optionId;
            return (
              <button
                key={option.id}
                onClick={() => setOptionId(option.id)}
                aria-pressed={active}
                className={`w-full rounded-md border p-2 text-left text-xs transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/60 bg-background/40 hover:border-border"
                }`}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {option.label}
                  {option.validation && !option.validation.ok ? (
                    <span className="text-[10px] text-drain">needs adjusting</span>
                  ) : null}
                </span>
                {option.summary ? (
                  <span className="mt-0.5 block text-muted-foreground">{option.summary}</span>
                ) : null}
                <span className="mt-1 flex items-start gap-1.5 text-muted-foreground">
                  <Scale className="mt-0.5 size-3 shrink-0" />
                  {option.tradeOff}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!decidable && chosen ? (
        <p className="rounded-md border border-border/60 bg-background/40 p-2 text-xs">
          <span className="text-muted-foreground">You chose: </span>
          {chosen.label} — {chosen.tradeOff}
        </p>
      ) : null}

      {decidable && record.options.length === 1 && record.tradeOff ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Scale className="mt-0.5 size-3.5 shrink-0" />
          {record.tradeOff}
        </p>
      ) : null}

      <button
        className="flex w-full items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Why this?</span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="space-y-3 rounded-md border border-border/60 bg-background/40 p-3 text-xs">
          {facts.length ? <EvidenceBlock kind="fact" items={facts.map((f) => f.text)} /> : null}
          {observations.length ? (
            <EvidenceBlock kind="observation" items={observations.map((o) => o.text)} />
          ) : null}
          {hypotheses.length ? (
            <EvidenceBlock kind="hypothesis" items={hypotheses.map((h) => h.text)} />
          ) : null}
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Cross-impact
            </p>
            <ul className="mt-1 space-y-0.5">
              {record.crossImpacts.map((impact) => (
                <li key={impact.area}>
                  <span
                    className={
                      impact.effect === "risk"
                        ? "text-drain"
                        : impact.effect === "positive"
                          ? "text-spark"
                          : "text-muted-foreground"
                    }
                  >
                    {impact.area}
                  </span>{" "}
                  — {impact.note}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-muted-foreground">
            Expected outcome: {record.expectedOutcome} (checked after {record.measureAfterHours}h)
          </p>
          <p className="text-muted-foreground">
            Based on {record.evidenceScore.facts} fact(s), {record.evidenceScore.observations}{" "}
            observation(s), {record.evidenceScore.hypotheses} guess(es) across{" "}
            {record.evidenceScore.sampleSize} recorded run(s).
          </p>
        </div>
      ) : null}

      {outcome ? (
        <p className="rounded-md border border-border/60 bg-background/40 p-2 text-xs">
          <span className="text-muted-foreground">Measured: </span>
          {OUTCOME_RESULT_LABELS[outcome.result]} — {outcome.note}
        </p>
      ) : null}

      {decidable ? (
        <div className="space-y-2 pt-1">
          {streamlined ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Zap className="mt-0.5 size-3.5 shrink-0 text-spark" />
              You streamlined this kind of action, so it's one tap. It's still checked against your
              situation before anything happens.
            </p>
          ) : (
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional: why not? (kept as your preference)"
              className="h-9 text-xs"
            />
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                onApprove(record.id, record.status === "needs_reapproval", selected?.id ?? "")
              }
            >
              <Check className="mr-1 size-4" />
              {record.status === "needs_reapproval"
                ? "Approve updated"
                : streamlined
                  ? "Do it"
                  : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => onReject(record.id, reason)}
            >
              <X className="mr-1 size-4" /> Not now
            </Button>
          </div>
        </div>
      ) : null}

      {trustOffer && onTrust ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-xs">
          <span>
            You've approved this a few times. Want {trustOffer.label.toLowerCase()} to be one tap
            from now on? You can turn it off any time in Settings.
          </span>
          <Button size="sm" variant="secondary" onClick={() => onTrust(trustOffer.actionType)}>
            Yes, streamline
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}


function EvidenceBlock({
  kind,
  items,
}: {
  kind: keyof typeof EVIDENCE_KIND_LABELS;
  items: string[];
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {EVIDENCE_KIND_LABELS[kind]}s{kind === "hypothesis" ? " (guesses, not facts)" : ""}
      </p>
      <ul className={`mt-1 space-y-0.5 ${kind === "hypothesis" ? "text-muted-foreground" : ""}`}>
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function strengthTone(strength: string): "spark" | "primary" | "muted" | "drain" {
  if (strength === "strong") return "spark";
  if (strength === "moderate") return "primary";
  if (strength === "weak") return "muted";
  return "drain";
}