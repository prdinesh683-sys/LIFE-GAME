import { createFileRoute, Link } from "@tanstack/react-router";
import { Cloud, FolderSync, Laptop, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { useGame } from "@/lib/services/game-store";
import { useSync } from "@/lib/services/sync-store";

export const Route = createFileRoute("/settings/privacy")({
  head: () => ({
    meta: [
      { title: "What leaves this device — Life Game" },
      {
        name: "description",
        content:
          "A plain-language view of what stays on your device, what can leave it, and exactly when — with a single switch for each.",
      },
      { property: "og:title", content: "What leaves this device — Life Game" },
      {
        property: "og:description",
        content: "Plain-language privacy: what stays local, what can leave, and when.",
      },
    ],
  }),
  component: PrivacyPage,
});

/**
 * Phase 5, items 21–24. Trust has to be readable, not inferred from settings
 * scattered across screens. This page states the current posture in one place
 * and links to the switch that changes it; it never changes anything itself.
 */
function PrivacyPage() {
  const { snapshot } = useGame();
  const sync = useSync();

  if (!snapshot) return <AppShell title="What leaves this device">{null}</AppShell>;

  const cloud = snapshot.settings.ai.cloud;
  const cloudOn = Boolean(cloud?.enabled);
  const driveOn = sync.state?.status === "up_to_date" || sync.state?.status === "syncing" || sync.state?.status === "pending";

  return (
    <AppShell title="What leaves this device" subtitle="Plain language, no small print">
      <div className="space-y-4">
        <Panel className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-primary" />
            {cloudOn || driveOn
              ? "Some things can leave this device — each one is listed below."
              : "Right now, nothing leaves this device."}
          </p>
          <p className="text-xs text-muted-foreground">
            Your quests, runs, notes and memory live in a database on this device. Nothing is sent
            anywhere unless one of the switches below is on, and you approve the moment it happens.
          </p>
        </Panel>

        <Panel className="space-y-2">
          <SectionTitle>Stays on this device, always</SectionTitle>
          <Item icon={<Laptop className="size-4" />} title="Your whole game">
            Quests, runs, misses, Sparks, Rank, Momentum, boosts, drains, identity and everything I
            remember about you.
          </Item>
        </Panel>

        <Panel className="space-y-2">
          <SectionTitle
            action={
              <Link to="/settings/ai" className="text-xs text-primary hover:underline">
                Change
              </Link>
            }
          >
            Cloud AI
          </SectionTitle>
          <Pill tone={cloudOn ? "primary" : "muted"}>{cloudOn ? "On" : "Off"}</Pill>
          <Item icon={<Cloud className="size-4" />} title="What would be sent">
            {cloudOn
              ? "Only the short summary of your current state needed to answer the question you asked — never your full history, and only when you tap the cloud button and confirm."
              : "Nothing. Advice is generated on this device by the local engine."}
          </Item>
        </Panel>

        <Panel className="space-y-2">
          <SectionTitle
            action={
              <Link to="/settings/storage" className="text-xs text-primary hover:underline">
                Change
              </Link>
            }
          >
            Google Drive backup
          </SectionTitle>
          <Pill tone={driveOn ? "primary" : "muted"}>{driveOn ? "Connected" : "Not connected"}</Pill>
          <Item icon={<FolderSync className="size-4" />} title="What would be sent">
            {driveOn
              ? "Backups of your game data, to your own Drive account. Memory entries are only uploaded one by one, when you pick them."
              : "Nothing. No backup is being uploaded."}
          </Item>
        </Panel>

        <Panel className="space-y-2">
          <SectionTitle>Turning things off</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Switching cloud AI off stops all outgoing requests immediately. Disconnecting Drive stops
            all uploads and leaves your local data untouched. You can also export or delete
            everything from{" "}
            <Link to="/settings" className="text-primary hover:underline">
              Settings
            </Link>
            .
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}

function Item({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
