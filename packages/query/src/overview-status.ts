export function isActiveOverviewExperimentStatus(status: string | null | undefined): boolean {
  if (!status) {
    return false;
  }

  return new Set(["active", "in_progress", "running", "ongoing", "open"]).has(
    status.trim().toLowerCase(),
  );
}
