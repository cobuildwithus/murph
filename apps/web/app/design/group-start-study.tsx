import type { ReactNode } from "react";

import {
  HostedGroupStartScreen,
  HostedGroupStartSignIn,
  type HostedGroupStartScreenState,
} from "@/src/components/hosted-groups/group-start-frame";
import { LinkPageSurface } from "@/src/components/link-page/link-page-shell";

const STATES: readonly HostedGroupStartScreenState[] = [
  "finish",
  "conflict",
  "ready",
  "failed",
  "linking",
];

export function GroupStartStudy() {
  return (
    <div
      id="linq-unknown-group-recovery"
      data-design-section="linq-unknown-group-recovery"
      className="grid gap-6 lg:grid-cols-3"
      inert
    >
      <StudyCard state="sign-in">
        <HostedGroupStartSignIn />
      </StudyCard>

      {STATES.map((state) => (
        <StudyCard key={state} state={state}>
          <HostedGroupStartScreen state={state} />
        </StudyCard>
      ))}
    </div>
  );
}

function StudyCard({ children, state }: { children: ReactNode; state: string }) {
  return (
    <div
      className="flex min-h-[46rem] max-w-[402px] flex-col overflow-hidden rounded-[2rem] bg-[#1C1915]"
      data-design-state={state}
    >
      <LinkPageSurface>{children}</LinkPageSurface>
    </div>
  );
}
