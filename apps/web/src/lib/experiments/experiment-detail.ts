import type {
  Experiment,
  ExperimentProtocol,
  ExperimentRunProjection,
} from "@/src/types/experiments";

export const CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION = 1;

export interface ComposeExperimentDetailInput {
  protocol: ExperimentProtocol;
  privateRun: ExperimentRunProjection | null;
}

export function hasCurrentExperimentProtocolContract(value: {
  protocolContractVersion?: number;
}): boolean {
  return value.protocolContractVersion === CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION;
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
    schedule: privateRun?.schedule,
    sessionContext: privateRun?.sessionContext,
    privateRun: privateRun ?? undefined,
    nextStep: privateRun?.nextStep,
    outcomeConfidence: privateRun?.outcomeConfidence,
    summary: privateRun?.summary,
    summaryDetail: privateRun?.summaryDetail,
    conclusions: privateRun?.conclusions,
  };
}
