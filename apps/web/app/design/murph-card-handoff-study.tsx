"use client";

import { MurphCardHandoffPanel } from "@/src/components/homepage/murph-card-handoff-dialog";

export function MurphCardHandoffStudy() {
  return (
    <div
      className="rounded-2xl border border-border bg-muted/40 p-4 sm:p-8"
      data-design-component="murph-card-handoff-dialog"
      inert
    >
      <div className="relative mx-auto grid max-w-[30rem] gap-6 rounded-3xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 md:p-7">
        <MurphCardHandoffPanel onDismiss={() => undefined} />
      </div>
    </div>
  );
}
