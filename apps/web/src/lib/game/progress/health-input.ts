import "server-only";
import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";
import { HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS } from "@murphai/hosted-execution/vault-share";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { COMPANION_HEALTH_METRICS, readCompanionHealthSeries, type RawHealthPoint } from "../../device-sync/companion-numbers";
import { getPrisma } from "../../prisma";
import { gameHttpError } from "../http/errors";
import type { HealthMetric } from "./contract";
import { openProgressMany, progressLookup } from "./crypto";
import { progressHealthDays } from "./health";
import { HEALTH } from "./registry";
import type { MeasureState } from "./state";

export const healthMetricIds = Object.keys(HEALTH) as HealthMetric["id"][];

/** Reporting bounds are inclusive, including for a previously frozen baseline. */
export function healthValueInRange(id: HealthMetric["id"], value: number) {
  const { minValue, maxValue } = HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS
    .find(spec => spec.metricKey === COMPANION_HEALTH_METRICS[id].key)!;
  const scale = id === "sleep" ? 60 : 1;
  return value >= minValue * scale && value <= maxValue * scale;
}

/** Canonical input already owns source selection and settled Steps dates. */
export function normalizeHealthDays(id: HealthMetric["id"], daily: readonly RawHealthPoint[], today: string) {
  const from = addDaysToIsoDate(today, -364);
  return progressHealthDays(id, daily.filter(point => point.date >= from && point.date <= today))
    .filter(point => healthValueInRange(id, point.value));
}

export async function readHealthProfile(memberId: string) {
  const profile = await getPrisma().gameProfile.findUnique({ where: { memberId }, select: { createdAt: true, timeZone: true } });
  if (!profile) throw gameHttpError("PROFILE_REQUIRED", 409, "Add your first name and time zone first.");
  return { timeZone: profile.timeZone, today: toLocalDayKey(new Date(), profile.timeZone),
    joinedOn: toLocalDayKey(profile.createdAt, profile.timeZone) };
}

export async function readHealthInput(auth: HostedNativeMemberAuth, signal: AbortSignal, today: string) {
  const snapshot = await readCompanionHealthSeries(auth, signal);
  const metrics = healthMetricIds.map(id => ({ id, daily: normalizeHealthDays(id, snapshot?.numbers[id]?.daily ?? [], today) }));
  return { snapshot, metrics };
}

export async function readHealthStates(memberId: string): Promise<Map<string, MeasureState>> {
  const lookups = healthMetricIds.map(id => progressLookup(memberId, "measure", [id]));
  const rows = await getPrisma().gameProgressMeasure.findMany({ where: { memberId, lookup: { in: lookups } },
    take: 4, select: { lookup: true, stateEncrypted: true } });
  const opened = await openProgressMany<MeasureState>(rows.map(row => ({ memberId, table: "game_progress_measure",
    rowId: row.lookup, field: "state", value: row.stateEncrypted })));
  return new Map(healthMetricIds.map((id, index) => [id, opened[rows.findIndex(row => row.lookup === lookups[index])] ?? {}]));
}
