"use client";

import { MurphCardHandoffPanel } from "@/src/components/homepage/murph-card-handoff-dialog";

export function MurphCardHandoffStudy() {
  return (
    <div
      className="rounded-2xl border border-border bg-[#2d3436]/8 p-4 sm:p-8"
      data-design-component="murph-card-handoff-dialog"
      inert
    >
      <div className="mx-auto max-w-md overflow-hidden rounded-3xl border border-[#c4a882]/25 bg-[#fffcf6] ring-1 ring-black/5">
        <MurphCardHandoffPanel onDismiss={() => undefined} />
      </div>
    </div>
  );
}
