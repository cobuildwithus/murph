import { isStrictIsoDate, isValidIanaTimeZone } from "@murphai/contracts";

import { listMetricPointsRuntime, summarizeWearableRecoveryRuntime, summarizeWearableSleepRuntime } from "../query-projection.ts";
import { readVaultMetadataSource } from "../vault-source.ts";
import { isWearableSleepPatternEligibleNight, resolveWearableSleepAnalysisDate, resolveWearableSleepPatternReadFilters } from "./sleep-pattern.ts";
import type { ProjectedWearableRecoverySummary, ProjectedWearableSleepSummary } from "./types.ts";

export interface WearableSleepCardNight {
  night: ProjectedWearableSleepSummary;
  recovery: ProjectedWearableRecoverySummary | null;
  timeZone: string | null;
  sdnnMilliseconds: number | null;
}

/** One completed night by localized wake date, including total-only evidence. */
export async function resolveWearableSleepCardNight(
  vaultRoot: string,
  { wakeDate }: { wakeDate: string },
): Promise<WearableSleepCardNight | null> {
  if (!isStrictIsoDate(wakeDate)) throw new TypeError("Invalid sleep wake date.");
  const metadata = await readVaultMetadataSource(vaultRoot);
  const reportingZone = typeof metadata?.timezone === "string" && isValidIanaTimeZone(metadata.timezone)
    ? metadata.timezone : null;
  // Explicit selectors need the adjacent stored dates even for a future, empty date.
  // Anchor the shared range helper to the selector rather than its default today.
  const filters = resolveWearableSleepPatternReadFilters({ from: wakeDate, to: wakeDate, now: `${wakeDate}T12:00:00Z` });
  const nights = await summarizeWearableSleepRuntime(vaultRoot, filters);
  const night = nights.filter((candidate) => {
    const total = candidate.totalSleepMinutes.selection.value;
    return isWearableSleepPatternEligibleNight(candidate)
      && total !== null && Number.isFinite(total) && Math.round(total) >= 1 && Math.round(total) <= 1440
      && resolveWearableSleepAnalysisDate(candidate, reportingZone) === wakeDate;
  }).sort((left, right) =>
    Number(right.sleepType === "main_sleep") - Number(left.sleepType === "main_sleep")
    || (right.totalSleepMinutes.selection.value ?? 0) - (left.totalSleepMinutes.selection.value ?? 0)
    || (right.sleepEndAt ?? "").localeCompare(left.sleepEndAt ?? "")
    || left.date.localeCompare(right.date)
  )[0];
  if (!night) return null;
  const timeZone = night.timeZone && isValidIanaTimeZone(night.timeZone) ? night.timeZone : reportingZone;
  const recovery = (await summarizeWearableRecoveryRuntime(vaultRoot, { date: night.date }))[0] ?? null;
  let sdnnMilliseconds: number | null = null;
  const start = Date.parse(night.sleepStartAt ?? "");
  const end = Date.parse(night.sleepEndAt ?? "");
  if (night.hrv.selection.value === null && Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 86_400_000) {
    // A bounded read, then exact instant membership. Never substitute a daytime
    // or date-wide HRV mean. Saturation omits enrichment rather than biasing it.
    const points = await listMetricPointsRuntime(vaultRoot, {
      metricKey: "hrv-sdnn", from: filters.from, to: filters.to, limit: 10_000,
    });
    if (points.length < 10_000) {
      const values = points.filter((point) => {
        const at = Date.parse(point.observedAt);
        return at >= start && at <= end && point.canonicalUnit === "ms"
          && point.canonicalValue !== null && Number.isFinite(point.canonicalValue)
          && point.canonicalValue > 0 && point.canonicalValue <= 1000;
      }).map((point) => point.canonicalValue!);
      if (values.length > 0) sdnnMilliseconds = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }
  return { night, recovery, timeZone, sdnnMilliseconds };
}
