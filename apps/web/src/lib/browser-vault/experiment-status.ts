import { isActiveOverviewExperimentStatus } from "@murphai/query/browser-experiments";

import type { ExperimentStatus } from "@/src/types/experiments";

const FINISHED_EXPERIMENT_STATUSES = new Set([
  "complete",
  "completed",
  "concluded",
  "done",
  "finished",
]);

const STOPPED_EXPERIMENT_STATUSES = new Set([
  "abandoned",
  "closed",
  "stopped",
]);

export interface NormalizeExperimentRunStatusInput {
  fallback?: Exclude<ExperimentStatus, "upcoming">;
  phase?: string | null;
  startedOn?: string | null;
  status: string | null | undefined;
}

export function normalizeExperimentRunStatus({
  fallback = "active",
  phase,
  startedOn,
  status,
}: NormalizeExperimentRunStatusInput): Exclude<ExperimentStatus, "upcoming"> {
  const normalizedStatus = status?.trim().toLowerCase() ?? "";

  if (phase === "paused" || normalizedStatus === "paused") {
    return "paused";
  }

  if (phase === "abandoned" || STOPPED_EXPERIMENT_STATUSES.has(normalizedStatus)) {
    return "stopped";
  }

  if (phase === "completed" || phase === "review_due" || FINISHED_EXPERIMENT_STATUSES.has(normalizedStatus)) {
    return "finished";
  }

  if (isActiveOverviewExperimentStatus(normalizedStatus) || normalizedStatus === "planned" || startedOn) {
    return "active";
  }

  return fallback;
}
