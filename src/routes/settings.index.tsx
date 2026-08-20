import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { Panel, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useGame } from "@/lib/services/game-store";
import { useAdvisor } from "@/lib/services/advisor-store";
import { trustLabel } from "@/lib/advisor/action-trust";
import { rhythmOf } from "@/lib/game/daily-rhythm";
import { TIME_WINDOWS, TIME_WINDOW_LABELS, type TimeWindow } from "@/lib/game/time-window";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/")({
  head: () => ({
    meta: [
      { title: "Settings — Life Game" },
      {
        name: "description",
        content:
          "Local-first controls: theme, motion, sound, and full export, import or wipe of your own data.",
      },
      { property: "og:title", content: "Settings — Life Game" },
      {
        property: "og:description",
        content: "Theme, motion, sound, and full control over your local data.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { snapshot, updateSettings, exportData, importData, wipeData } = useGame();
  const advisor = useAdvisor();
  const trusted = advisor.trustGrants;
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [payload, setPayload] = useState("");

  if (!snapshot) return <AppShell title="Settings">{null}</AppShell>;
  const { settings } = snapshot;
  const rhythm = rhythmOf(settings);

  return (
    <AppShell title="Settings" subtitle="Local-first, yours only">
      <div className="space-y-4">
        <Panel className="space-y-1">
          <SectionTitle>Everything in one place</SectionTitle>
          {[
            { to: "/settings/privacy", label: "What leaves this device", hint: "Privacy, in plain language" },
            { to: "/settings/ai", label: "AI", hint: "Which brain answers, and when" },
            { to: "/settings/storage", label: "Backup & sync", hint: "Google Drive, conflicts, restore points" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center justify-between rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-surface-raised"
            >
              <span>
                {item.label}
                <span className="block text-xs text-muted-foreground">{item.hint}</span>
              </span>
              <span className="text-primary">›</span>
            </Link>
          ))}
        </Panel>

        <Panel className="space-y-4">
          <SectionTitle>Interface</SectionTitle>
          <Row label="Light theme">
            <Switch
              checked={settings.theme === "light"}
              onCheckedChange={(v) => void updateSettings({ theme: v ? "light" : "dark" })}
            />
          </Row>
          <Row label="Reduced motion">
            <Switch
              checked={settings.reducedMotion}
              onCheckedChange={(v) => void updateSettings({ reducedMotion: v })}
            />
          </Row>
          <Row label="Sound">
            <Switch
              checked={settings.sound}
              onCheckedChange={(v) => void updateSettings({ sound: v })}
            />
          </Row>
        </Panel>

        <Panel className="space-y-3">
          <SectionTitle>One-tap actions</SectionTitle>
          <p className="text-sm text-muted-foreground">
            These are the low-risk actions you chose to approve in one tap. Everything is still
            checked against your situation first, and anything that takes over your time always
            asks.
          </p>
          {trusted.length ? (
            <div className="space-y-2">
              {trusted.map((grant) => (
                <div key={grant.actionType} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{trustLabel(grant.actionType)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await advisor.revokeActionTrust(grant.actionType);
                      toast("Back to asking every time.");
                    }}
                  >
                    Ask me again
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing is streamlined yet. You'll be offered this after you approve the same kind of
              thing a few times.
            </p>
          )}
        </Panel>

        <Panel className="space-y-3">
          <SectionTitle>Nudges</SectionTitle>
          <p className="text-sm text-muted-foreground">
            A quiet reminder to open the game at the part of the day you choose. It runs on this
            device only — no account, no server, no AI, and nothing leaves the phone. The game works
            exactly the same with this off.
          </p>
          <Row label="Remind me on this device">
            <Switch
              checked={rhythm.reentryEnabled}
              onCheckedChange={async (v) => {
                await updateSettings({
                  rhythm: { ...rhythm, reentryEnabled: v, slots: v && !rhythm.slots.length ? ["evening"] : rhythm.slots },
                });
                if (v && typeof Notification !== "undefined" && Notification.permission === "default") {
                  try {
                    await Notification.requestPermission();
                  } catch {
                    /* A refused prompt is fine — the in-app reminder still works. */
                  }
                }
              }}
            />
          </Row>
          {rhythm.reentryEnabled ? (
            <div className="grid grid-cols-3 gap-2">
              {TIME_WINDOWS.map((slot: TimeWindow) => {
                const active = rhythm.slots.includes(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() =>
                      void updateSettings({
                        rhythm: {
                          ...rhythm,
                          slots: active
                            ? rhythm.slots.filter((s) => s !== slot)
                            : [...rhythm.slots, slot],
                        },
                      })
                    }
                    className={cn(
                      "rounded-md border px-2 py-2 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {TIME_WINDOW_LABELS[slot]}
                  </button>
                );
              })}
            </div>
          ) : null}
        </Panel>

        <Panel>
          <SectionTitle>Your data</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Everything lives in this device's local database. Export gives you the full vault as
            JSON — the same file a Google Drive backup would hold.
          </p>
          <Button
            className="mt-3 w-full"
            onClick={async () => {
              setPayload(await exportData());
              toast.success("Export ready below");
            }}
          >
            Export vault
          </Button>
          <Textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={6}
            placeholder="Paste a vault export here to restore it"
            className="mt-2 bg-background/50 font-mono text-xs"
          />
          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={!payload.trim()}
            onClick={async () => {
              try {
                await importData(payload);
                toast.success("Vault restored");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "That file could not be read");
              }
            }}
          >
            Import vault
          </Button>
          {confirmWipe ? (
            <div className="mt-2 space-y-2 rounded-lg border border-destructive/40 p-3">
              <p className="text-xs text-destructive">
                This deletes every local quest, run and record on this device. Export first if you want a
                copy. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setConfirmWipe(false)}
                >
                  Keep my data
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 text-destructive"
                  onClick={async () => {
                    setConfirmWipe(false);
                    await wipeData();
                    toast("Everything wiped. Starting over.");
                  }}
                >
                  Yes, wipe everything
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="mt-2 w-full text-destructive"
              onClick={() => setConfirmWipe(true)}
            >
              Wipe everything
            </Button>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}