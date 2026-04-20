import type {
  Experiment,
  ExperimentProtocol,
  ExperimentRunProjection,
} from "@/src/types/experiments";

export interface ComposeExperimentDetailInput {
  protocol: ExperimentProtocol;
  privateRun: ExperimentRunProjection | null;
}

export function composeExperimentDetail({
  protocol,
  privateRun,
}: ComposeExperimentDetailInput): Experiment {
  return {
    ...protocol,
    status: privateRun?.status ?? "upcoming",
    day: privateRun?.day,
    completionPercent: privateRun?.completionPercent,
    dateRange: privateRun?.dateRange,
    analysisAvailableOn: privateRun?.analysisAvailableOn,
    signals: privateRun?.signals ?? [],
    trends: privateRun?.trends ?? [],
    timeline: privateRun?.timeline ?? [],
    privateRun: privateRun ?? undefined,
    nextStep: privateRun?.nextStep,
    summary: privateRun?.summary,
    summaryDetail: privateRun?.summaryDetail,
    conclusions: privateRun?.conclusions,
  };
}
