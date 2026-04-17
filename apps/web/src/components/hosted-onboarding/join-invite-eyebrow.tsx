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
        "flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em]",
        tone === "danger" ? "text-destructive" : "text-olive/80",
      )}
    >
      {tone === "danger" ? (
        <AlertCircleIcon className="size-3.5" />
      ) : (
        <span className="size-1 rounded-full bg-olive/70" />
      )}
      <span>{label}</span>
    </div>
  );
}
