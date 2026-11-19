import { addDaysToIsoDate, isStrictIsoDateTime } from "@murphai/contracts";
import type { CompanionRunsProjection } from "./shared.ts";
import type { VaultReadModel } from "../read-model.ts";
import type { WearableDataset } from "../wearables/types.ts";
import { dedupeActivitySessionCandidates, groupMetricCandidatesByDate } from "../wearables/candidates.ts";
import { readWearableExternalRef } from "../wearables/observation.ts";

const RUN_LOOKBACK_DAYS = 365;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
// "run", "running", "trail_running", "Treadmill Run", "virtual-run".
const RUN = /(?:^|-)run(?:ning)?(?:$|-)|^(?:trail|virtual)run$/u;

export function isRunActivity(activityType: string | null | undefined): boolean {
  return RUN.test((activityType ?? "").trim().toLowerCase().replace(/[\s_]+/gu, "-"));
}

type RunDistance = { start: number; end: number; deviceKm: number; loggedKm: number };

function runDistance(startAt: unknown, endAt: unknown, deviceKm: number, loggedKm: number): RunDistance {
  const start = typeof startAt === "string" && isStrictIsoDateTime(startAt) ? Date.parse(startAt) : NaN;
  const end = typeof endAt === "string" && isStrictIsoDateTime(endAt) ? Date.parse(endAt) : NaN;
  // Missing or reversed bounds could overlap any run that day.
  return start < end
    ? { start, end, deviceKm, loggedKm }
    : { start: -Infinity, end: Infinity, deviceKm, loggedKm };
}

function addLoggedRuns(vault: VaultReadModel, byDay: Map<string, RunDistance[]>): void {
  for (const entity of vault.events) {
    if (entity.kind !== "activity_session" || !entity.date) continue;
    const attributes = entity.attributes;
    const system = readWearableExternalRef(attributes.externalRef)?.system?.trim().toLowerCase();
    if (system && system !== "manual") continue;
    const km = attributes.distanceKm;
    const activityType = typeof attributes.activityType === "string" ? attributes.activityType : null;
    if (typeof km !== "number" || !Number.isFinite(km) || km <= 0 || !isRunActivity(activityType)) continue;
    const workout = attributes.workout;
    const bounds = workout && typeof workout === "object" ? workout : {};
    const start = attributes.startAt ?? ("startedAt" in bounds ? bounds.startedAt : null);
    const end = attributes.endAt ?? ("endedAt" in bounds ? bounds.endedAt : null);
    const entries = byDay.get(entity.date) ?? [];
    entries.push(runDistance(start, end, 0, km));
    byDay.set(entity.date, entries);
  }
}

function totalRunDistance(runs: RunDistance[]): number {
  let total = 0;
  let end = -Infinity;
  let deviceKm = 0;
  let loggedKm = 0;
  // Within an overlapping group either source can contain a mirror of the other.
  for (const run of runs.sort((left, right) => left.start - right.start)) {
    if (run.start >= end) {
      total += Math.max(deviceKm, loggedKm);
      deviceKm = 0;
      loggedKm = 0;
    }
    end = Math.max(end, run.end);
    deviceKm += run.deviceKm;
    loggedKm += run.loggedKm;
  }
  return total + Math.max(deviceKm, loggedKm);
}

export function buildCompanionRunsProjection(
  vault: VaultReadModel,
  wearables: Pick<WearableDataset, "activitySessionCandidates">,
  today: string,
): CompanionRunsProjection {
  const from = addDaysToIsoDate(today, -RUN_LOOKBACK_DAYS);
  const byDay = new Map<string, RunDistance[]>();
  const deviceRuns = wearables.activitySessionCandidates.filter((candidate) => isRunActivity(candidate.activityType));
  for (const [date, candidates] of groupMetricCandidatesByDate(deviceRuns)) {
    const runs = dedupeActivitySessionCandidates(candidates)
      .flatMap((candidate) => {
        const km = candidate.workoutMetricValues?.distanceKm;
        return km && km > 0 ? [runDistance(candidate.sessionStartAt, candidate.sessionEndAt, km, 0)] : [];
      });
    byDay.set(date, runs);
  }
  addLoggedRuns(vault, byDay);
  const days = [...byDay.entries()]
    .filter(([date]) => DAY.test(date) && date >= from && date <= today)
    .map(([date, runs]) => ({ date, km: Math.min(1_000, Math.round(totalRunDistance(runs) * 1000) / 1000) }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .filter((day) => day.km > 0);
  return { schemaVersion: 1, days };
}
