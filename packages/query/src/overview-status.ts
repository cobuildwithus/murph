const ACTIVE_OVERVIEW_EXPERIMENT_STATUSES = new Set(["active", "in_progress", "running", "ongoing", "open"]);
const COMPLETED_OVERVIEW_EXPERIMENT_STATUSES = new Set(["complete", "completed", "done", "finished"]);

export function isActiveOverviewExperimentStatus(status: string | null | undefined): boolean {
  return ACTIVE_OVERVIEW_EXPERIMENT_STATUSES.has(normalizeOverviewExperimentStatus(status));
}

export function isCompletedOverviewExperimentStatus(status: string | null | undefined): boolean {
  return COMPLETED_OVERVIEW_EXPERIMENT_STATUSES.has(normalizeOverviewExperimentStatus(status));
}

function normalizeOverviewExperimentStatus(status: string | null | undefined): string {
  return status?.trim().toLowerCase() ?? "";
}
