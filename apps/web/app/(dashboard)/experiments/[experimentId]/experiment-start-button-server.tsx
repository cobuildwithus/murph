import { ArrowRightIcon } from "lucide-react";

import { StartExperimentButton } from "@/src/components/experiments/experiment-detail/start-experiment-button";
import {
  getHostedMurphContactContext,
  readHostedMurphContactContext,
} from "@/src/lib/hosted-onboarding/hosted-contact-context";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";
import { ExperimentStartOrRunStatus } from "./experiment-start-or-run-status";

interface HostedExperimentStartButtonProps {
  activeRunProtocol?: ExperimentResultsPublicProjection | null;
  protocolDays: number;
  protocolTitle: string;
}

export function ExperimentStartButtonFallback({
  protocolDays,
  protocolTitle,
}: HostedExperimentStartButtonProps) {
  const protocolSummary = `${protocolDays}-day protocol`;

  return (
    <div className="flex flex-col items-stretch gap-2 md:shrink-0 md:items-center">
      <button
        type="button"
        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-transparent bg-primary px-6 py-4 text-base font-semibold whitespace-nowrap text-primary-foreground opacity-70 outline-none select-none md:px-12"
        disabled
        aria-busy="true"
        aria-label={`Resolving start channel for ${protocolTitle}`}
      >
        <span>Start Experiment</span>
        <ArrowRightIcon data-icon="inline-end" className="size-4 shrink-0" />
      </button>
      <span className="text-center font-mono text-[10px]/3.5 uppercase tracking-[0.12em] text-muted-foreground/75">
        {protocolSummary}
      </span>
    </div>
  );
}

export async function HostedExperimentStartButton({
  activeRunProtocol = null,
  protocolDays,
  protocolTitle,
}: HostedExperimentStartButtonProps) {
  const { initialContactChannels, murphEmailAddress, murphPhoneNumber } =
    await getHostedMurphContactContext();

  const startAction = (
    <StartExperimentButton
      initialContactChannels={initialContactChannels}
      murphEmailAddress={murphEmailAddress}
      murphPhoneNumber={murphPhoneNumber}
      protocolDays={protocolDays}
      protocolTitle={protocolTitle}
    />
  );

  if (!activeRunProtocol) {
    return startAction;
  }

  return (
    <ExperimentStartOrRunStatus
      activeRunProtocol={activeRunProtocol}
      protocolDays={protocolDays}
      startAction={startAction}
    />
  );
}

export const readHostedExperimentStartContactContext = readHostedMurphContactContext;
