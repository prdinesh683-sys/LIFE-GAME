import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";

import { useAdvisor } from "@/lib/services/advisor-store";
import { Button } from "../ui/button";
import { Panel, Pill, SectionTitle } from "./primitives";

/**
 * Compact Advisor surface for Home. Proactive but bounded: it shows what is
 * already waiting, and never generates advice on its own.
 */
export function AdvisorTeaser() {
  const advisor = useAdvisor();
  const top = advisor.live[0] ?? null;
  const situation = advisor.triggers[0] ?? null;

  return (
    <Panel className="space-y-2">
      <SectionTitle
        action={
          <Link to="/advisor" className="text-xs text-primary hover:underline">
            Open Advisor
          </Link>
        }
      >
        Advisor
      </SectionTitle>
      {top ? (
        <>
          <p className="text-sm font-medium">{top.title}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="primary">{top.evidenceScore.strength} evidence</Pill>
            <Pill tone="muted">confidence {Math.round(top.confidence * 100)}%</Pill>
          </div>
          <p className="text-xs text-muted-foreground">
            {advisor.live.length} recommendation(s) waiting for your approval.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {situation
              ? `Noticed: ${situation.label}.`
              : "Nothing stands out in your records right now."}
          </p>
          <Button asChild variant="secondary" size="sm" className="w-full">
            <Link to="/advisor">
              <Compass className="size-4" />
              Ask the Advisor
            </Link>
          </Button>
        </>
      )}
    </Panel>
  );
}