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
        "inline-flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.22em]",
        tone === "danger" ? "text-destructive" : "text-olive-light",
      )}
    >
      {tone === "danger" ? (
        <AlertCircleIcon className="size-3.5" />
      ) : (
        <span className="size-1.5 rounded-full bg-olive-light/80" />
      )}
      <span>{label}</span>
    </div>
  );
}
