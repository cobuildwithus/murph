import type { ReactNode } from "react";
import { BlockedNumbers, type BlockPage } from "../(dashboard)/ops/blocked-numbers";

const SYNTHETIC_BLOCKS: BlockPage = {
  blocks: [
    { contact: "+15550100142", reason: "operator", createdAt: "2026-11-15T19:00:00.000Z" },
    { contact: "+15550100187", reason: "operator", createdAt: "2026-11-15T19:05:00.000Z" },
    { contact: "ring-bot@example.invalid", reason: "operator", createdAt: "2026-11-15T19:10:00.000Z" },
  ],
  nextCursor: "synthetic-next",
};

/** The production Blocked numbers section on /ops, with synthetic numbers. */
export function OpsBlockedNumbersStudy() {
  return (
    <div className="grid gap-16" inert>
      <StudyFrame title="Before the list is opened">
        <BlockedNumbers />
      </StudyFrame>
      <StudyFrame title="Blocked numbers with more to load">
        <BlockedNumbers initialPage={SYNTHETIC_BLOCKS} />
      </StudyFrame>
      <StudyFrame title="No blocked numbers">
        <BlockedNumbers initialPage={{ blocks: [], nextCursor: null }} />
      </StudyFrame>
      <StudyFrame title="List failed to load">
        <BlockedNumbers initialError="Could not load blocked numbers. Try again." />
      </StudyFrame>
    </div>
  );
}

function StudyFrame(input: { children: ReactNode; title: string }) {
  return (
    <section className="grid gap-4">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {input.title}
      </p>
      {input.children}
    </section>
  );
}
