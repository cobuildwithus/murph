import { addDaysToIsoDate, type CompanionRunsProjection } from "@murphai/contracts";
import type { VaultReadModel } from "../read-model.ts";
import type { WearableDataset } from "../wearables/types.ts";
import { buildActivitySessionDayRollups } from "../wearables/candidates.ts";
import { readWearableExternalRef } from "../wearables/observation.ts";

const RUN_LOOKBACK_DAYS = 365;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
// "run", "running", "trail_running", "Treadmill Run", "virtual-run".
const RUN = /(?:^|-)run(?:ning)?(?:$|-)/u;

export function isRunActivity(activityType: string | null | undefined): boolean {
  return RUN.test((activityType ?? "").trim().toLowerCase().replace(/[\s_]+/gu, "-"));
}

/**
 * Run distance per local day. Device runs go through the wearable day rollup,
 * which counts a workout and its imported mirror once. Runs logged in chat or
 * by hand carry no device identity, so each day keeps the larger of the two
 * totals: a run logged both ways never counts twice.
 */
export function buildCompanionRunsProjection(
  vault: VaultReadModel,
  wearables: Pick<WearableDataset, "activitySessionCandidates">,
  generatedAt: string,
): CompanionRunsProjection {
  const from = addDaysToIsoDate(generatedAt.slice(0, 10), -RUN_LOOKBACK_DAYS);
  const device = new Map<string, number>();
  const rollups = buildActivitySessionDayRollups(
    wearables.activitySessionCandidates.filter((candidate) => isRunActivity(candidate.activityType)),
  );
  for (const rollup of rollups) {
    const km = rollup.workoutMetricValues.distanceKm;
    if (km !== undefined && km > 0) device.set(rollup.date, km);
  }
  const logged = new Map<string, number>();
  for (const entity of vault.events) {
    if (entity.kind !== "activity_session" || !entity.date) continue;
    const system = readWearableExternalRef(entity.attributes.externalRef)?.system?.trim().toLowerCase();
    if (system && system !== "manual") continue;
    const km = entity.attributes.distanceKm;
    const activityType = typeof entity.attributes.activityType === "string" ? entity.attributes.activityType : null;
    if (typeof km !== "number" || !Number.isFinite(km) || km <= 0 || !isRunActivity(activityType)) continue;
    logged.set(entity.date, (logged.get(entity.date) ?? 0) + km);
  }
  const days = [...new Set([...device.keys(), ...logged.keys()])]
    // Every row must parse: one bad day would block the member's whole replica.
    .filter((date) => DAY.test(date) && date >= from && date <= generatedAt.slice(0, 10))
    .sort()
    .map((date) => ({ date, km: Math.min(1_000, Math.round(Math.max(device.get(date) ?? 0, logged.get(date) ?? 0) * 1000) / 1000) }))
    // A run under half a meter (a watch started and stopped) rounds to no distance.
    .filter((day) => day.km > 0);
  return { schemaVersion: 1, days };
}
