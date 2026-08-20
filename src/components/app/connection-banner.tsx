import { CloudOff, WifiOff, FolderX } from "lucide-react";
import { useEffect, useState } from "react";

import { useGame } from "@/lib/services/game-store";
import { useSync } from "@/lib/services/sync-store";

/**
 * Friendly connection states (Phase 5, item 10 / 36-38).
 *
 * Local-first operation is not an error. Offline, cloud-AI-unavailable and
 * Drive-unavailable are stated calmly and never with a provider error code.
 */
export function ConnectionBanner() {
  const [online, setOnline] = useState(true);
  const sync = useSync();
  const { snapshot } = useGame();

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const driveTrouble = sync.state?.status === "error";
  const cloudAi = snapshot?.settings.ai.cloud;
  const cloudTrouble =
    Boolean(cloudAi?.enabled) && (cloudAi?.lastStatus === "error" || cloudAi?.lastStatus === "rate_limited");

  if (online && !driveTrouble && !cloudTrouble) return null;

  return (
    <div className="mb-4 space-y-2">
      {!online ? (
        <Line icon={<WifiOff className="size-4" />}>
          Working offline. Your game still works and changes will sync when you're connected.
        </Line>
      ) : null}
      {cloudTrouble ? (
        <Line icon={<CloudOff className="size-4" />}>
          Cloud AI isn't available right now. I'm continuing with local intelligence.
        </Line>
      ) : null}
      {driveTrouble ? (
        <Line icon={<FolderX className="size-4" />}>
          Drive isn't available. Your local data is safe; sync will resume later.
        </Line>
      ) : null}
    </div>
  );
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-surface/70 p-3 text-xs text-muted-foreground">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
