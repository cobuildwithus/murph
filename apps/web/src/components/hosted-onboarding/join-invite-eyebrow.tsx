import { AlertCircleIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";

export type JoinInviteEyebrowTone = "default" | "danger";

export function JoinInviteEyebrow({
  label,
  tone,
}: {
  label: string;
  tone: JoinInviteEyebrowTone;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-widest",
        tone === "danger" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {tone === "danger" ? (
        <AlertCircleIcon className="size-3.5" />
      ) : null}
      <span>{label}</span>
    </div>
  );
}
