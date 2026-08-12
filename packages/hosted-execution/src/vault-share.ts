import {
  activityKindAliasGroups,
  isStrictIsoDate,
  normalizeIanaTimeZone,
  isStrictIsoDateTime,
  normalizeActivityKindToken,
} from "@murphai/contracts";
import { resolveWearableProviderDescriptor } from "@murphai/health-metrics";

import {
  readNullableStringValue,
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
} from "./parsers/assertions.ts";
import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
} from "./vault-share-limits.ts";

export {
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
};

/**
 * VaultShare v0: a member grants a standing share of a fixed vault projection to a
 * destination member. The grantor's runtime offers projected records through the signed
 * callback channel; the web control plane is the sole authority on whether an active share
 * exists and is the only writer into the destination mailbox.
 *
 * Projection kinds are a closed registry on purpose: each kind is a deterministic,
 * fixed-schema projection. The wire envelope is kind-generic — every record carries a
 * path-safe `recordKey` (its identity within the share) and an `occurredAt` timestamp,
 * with the kind-specific shape isolated under `data`. Adding a kind means adding a data
 * schema and a projector, never widening the envelope.
 */
export const HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS = [
  "activity-days.v0",
  "sleep-duration-days.v0",
  "deep-sleep-days.v0",
  "deep-sleep-sources-days.v1",
  "rem-sleep-days.v0",
  "rem-sleep-sources-days.v1",
  "steps-days.v0",
  "max-heart-rate-days.v0",
  "distance-days.v0",
  "active-calories-days.v0",
  "elevation-gain-days.v0",
  "floors-climbed-days.v0",
  "day-strain-days.v0",
  "workout-strain-days.v0",
  "activity-score-days.v0",
  "vo2-max-days.v0",
  "resting-heart-rate-days.v0",
  "hrv-days.v0",
  "protein-days.v0",
  "calories-days.v0",
  "carbs-days.v0",
  "fat-days.v0",
  "fiber-days.v0",
] as const;

const HOSTED_VAULT_SHARE_DAY_MAX_MINUTES = 24 * 60;
const HOSTED_VAULT_SHARE_DAY_MAX_DISTANCE_METERS = 1_000_000;
const HOSTED_VAULT_SHARE_DAY_MAX_SESSIONS = 100;
const HOSTED_VAULT_SHARE_GENERATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type HostedVaultShareDailyMetricProjectionKind =
  (typeof HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS)[number];

export type HostedVaultShareMealNutritionTotalKey =
  | "calories"
  | "carbsGrams"
  | "fatGrams"
  | "fiberGrams"
  | "proteinGrams";

/**
 * Declarative source for a daily-metric projection: the grantor runtime dispatches on
 * this instead of special-casing projection kinds. `metric-series` reads the member's
 * metric-point series; `meal-nutrition-total` reads complete-day nutrition totals
 * aggregated from canonical meal events.
 */
export type HostedVaultShareDailyMetricProjectionSource =
  | { kind: "meal-nutrition-total"; totalKey: HostedVaultShareMealNutritionTotalKey }
  | { kind: "metric-series" };

export interface HostedVaultShareDailyMetricProjectionSpec {
  /** When set, delivered records must carry exactly this unit. */
  expectedUnit?: string;
  maxValue: number;
  metricKey: string;
  minValue: number;
  projectionKind: HostedVaultShareDailyMetricProjectionKind;
  sourceMode?: "all-public-sleep-sources";
  source: HostedVaultShareDailyMetricProjectionSource;
}

const METRIC_SERIES_SOURCE = { kind: "metric-series" } as const;

export const HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS = [
  { projectionKind: "activity-days.v0", metricKey: "activity-minutes", minValue: 0, maxValue: 1_440, source: METRIC_SERIES_SOURCE },
  { projectionKind: "sleep-duration-days.v0", metricKey: "total-sleep-minutes", minValue: 0, maxValue: 1_440, source: METRIC_SERIES_SOURCE },
  { projectionKind: "deep-sleep-days.v0", metricKey: "deep-sleep-minutes", minValue: 0, maxValue: 1_440, source: METRIC_SERIES_SOURCE },
  { projectionKind: "deep-sleep-sources-days.v1", metricKey: "deep-sleep-minutes", expectedUnit: "minutes", minValue: 0, maxValue: 1_440, sourceMode: "all-public-sleep-sources", source: METRIC_SERIES_SOURCE },
  { projectionKind: "rem-sleep-days.v0", metricKey: "rem-sleep-minutes", minValue: 0, maxValue: 1_440, source: METRIC_SERIES_SOURCE },
  { projectionKind: "rem-sleep-sources-days.v1", metricKey: "rem-sleep-minutes", expectedUnit: "minutes", minValue: 0, maxValue: 1_440, sourceMode: "all-public-sleep-sources", source: METRIC_SERIES_SOURCE },
  { projectionKind: "steps-days.v0", metricKey: "steps", minValue: 0, maxValue: 1_000_000, source: METRIC_SERIES_SOURCE },
  { projectionKind: "max-heart-rate-days.v0", metricKey: "max-heart-rate", minValue: 0, maxValue: 260, source: METRIC_SERIES_SOURCE },
  { projectionKind: "distance-days.v0", metricKey: "distance-km", minValue: 0, maxValue: 1_000, source: METRIC_SERIES_SOURCE },
  { projectionKind: "active-calories-days.v0", metricKey: "active-calories", minValue: 0, maxValue: 20_000, source: METRIC_SERIES_SOURCE },
  { projectionKind: "elevation-gain-days.v0", metricKey: "elevation-gain-meters", minValue: 0, maxValue: 100_000, source: METRIC_SERIES_SOURCE },
  { projectionKind: "floors-climbed-days.v0", metricKey: "floors-climbed", minValue: 0, maxValue: 10_000, source: METRIC_SERIES_SOURCE },
  { projectionKind: "day-strain-days.v0", metricKey: "day-strain", minValue: 0, maxValue: 30, source: METRIC_SERIES_SOURCE },
  { projectionKind: "workout-strain-days.v0", metricKey: "workout-strain", minValue: 0, maxValue: 30, source: METRIC_SERIES_SOURCE },
  { projectionKind: "activity-score-days.v0", metricKey: "activity-score", minValue: 0, maxValue: 100, source: METRIC_SERIES_SOURCE },
  { projectionKind: "vo2-max-days.v0", metricKey: "estimated-vo2-max", minValue: 0, maxValue: 100, source: METRIC_SERIES_SOURCE },
  { projectionKind: "resting-heart-rate-days.v0", metricKey: "resting-heart-rate", minValue: 20, maxValue: 250, source: METRIC_SERIES_SOURCE },
  { projectionKind: "hrv-days.v0", metricKey: "hrv-rmssd", minValue: 0, maxValue: 500, source: METRIC_SERIES_SOURCE },
  // Nutrient bounds are corruption guards against unit or duplication errors, not
  // health targets; complete-day totals beyond them are skipped, never clamped.
  { projectionKind: "protein-days.v0", metricKey: "protein-grams", expectedUnit: "g", minValue: 0, maxValue: 2_000, source: { kind: "meal-nutrition-total", totalKey: "proteinGrams" } },
  { projectionKind: "calories-days.v0", metricKey: "dietary-calories", expectedUnit: "kcal", minValue: 0, maxValue: 20_000, source: { kind: "meal-nutrition-total", totalKey: "calories" } },
  { projectionKind: "carbs-days.v0", metricKey: "carbs-grams", expectedUnit: "g", minValue: 0, maxValue: 2_000, source: { kind: "meal-nutrition-total", totalKey: "carbsGrams" } },
  { projectionKind: "fat-days.v0", metricKey: "fat-grams", expectedUnit: "g", minValue: 0, maxValue: 2_000, source: { kind: "meal-nutrition-total", totalKey: "fatGrams" } },
  { projectionKind: "fiber-days.v0", metricKey: "fiber-grams", expectedUnit: "g", minValue: 0, maxValue: 500, source: { kind: "meal-nutrition-total", totalKey: "fiberGrams" } },
] as const satisfies readonly HostedVaultShareDailyMetricProjectionSpec[];

export const HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND =
  "activity-minutes-days.v1" as const;
export const HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND =
  "activity-distance-days.v1" as const;
export const HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND =
  "activity-session-count-days.v1" as const;

export type HostedVaultShareActivityMinutesProjectionKind =
  typeof HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND;
export type HostedVaultShareActivityDistanceProjectionKind =
  typeof HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND;
export type HostedVaultShareActivitySessionCountProjectionKind =
  typeof HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND;

export type HostedVaultShareActivitySelectorProjectionKind =
  | HostedVaultShareActivityDistanceProjectionKind
  | HostedVaultShareActivityMinutesProjectionKind
  | HostedVaultShareActivitySessionCountProjectionKind;

export const HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND =
  "device-sync-status.v0" as const;

const HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ALIAS_GROUPS = [
  ["walk", "walking"],
  ["run", "running"],
  ["bike", "biking", "cycle", "cycling", "ride"],
  ["surf", "surfing"],
  ["swim", "swimming"],
  ["hike", "hiking"],
  ["row", "rowing"],
] as const;

const HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ALIAS_GROUPS = [
  ["walk", "walking"],
  ["run", "running"],
  ["bike", "biking", "cycle", "cycling", "ride"],
  ["dance", "dancing"],
  ["surf", "surfing"],
  ["swim", "swimming"],
  ["hike", "hiking"],
  ["row", "rowing"],
  ["sauna"],
  ["strength", "strength-training", "weightlifting", "weights"],
] as const;

function buildHostedVaultShareActivitySelectorKinds(
  groups: readonly (readonly string[])[],
): readonly string[] {
  return Object.freeze(
    [...new Set(groups
      .flatMap((group) => [...group])
      .map((kind) => normalizeActivityKindToken(kind))
      .filter((kind): kind is string => kind !== null))]
      .sort((left, right) => left.localeCompare(right)),
  );
}

export const HOSTED_VAULT_SHARE_ACTIVITY_SELECTOR_ACTIVITY_KINDS =
  buildHostedVaultShareActivitySelectorKinds(activityKindAliasGroups);

export const HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS =
  HOSTED_VAULT_SHARE_ACTIVITY_SELECTOR_ACTIVITY_KINDS;
export const HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS =
  buildHostedVaultShareActivitySelectorKinds(
    HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ALIAS_GROUPS,
  );
export const HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS =
  buildHostedVaultShareActivitySelectorKinds(
    HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ALIAS_GROUPS,
  );

export type HostedVaultShareActivitySelectorActivityKind = string;
export type HostedVaultShareActivityMinutesSelectorActivityKind =
  HostedVaultShareActivitySelectorActivityKind;
export type HostedVaultShareActivityDistanceSelectorActivityKind =
  HostedVaultShareActivitySelectorActivityKind;
export type HostedVaultShareActivitySessionCountSelectorActivityKind =
  HostedVaultShareActivitySelectorActivityKind;

export interface HostedVaultShareActivitySelector {
  activityKind: HostedVaultShareActivitySelectorActivityKind;
}

export type HostedVaultShareActivityMinutesSelector =
  HostedVaultShareActivitySelector;
export type HostedVaultShareActivityDistanceSelector =
  HostedVaultShareActivitySelector;
export type HostedVaultShareActivitySessionCountSelector =
  HostedVaultShareActivitySelector;

export interface HostedVaultShareActivityMinutesProjectionSpec {
  activityKind: HostedVaultShareActivityMinutesSelectorActivityKind;
  projectionKind: HostedVaultShareActivityMinutesProjectionKind;
}

export interface HostedVaultShareActivityDistanceProjectionSpec {
  activityKind: HostedVaultShareActivityDistanceSelectorActivityKind;
  projectionKind: HostedVaultShareActivityDistanceProjectionKind;
}

export interface HostedVaultShareActivitySessionCountProjectionSpec {
  activityKind: HostedVaultShareActivitySessionCountSelectorActivityKind;
  projectionKind: HostedVaultShareActivitySessionCountProjectionKind;
}

export const HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS = [
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  "group-email.v0",
  "profile-name.v0",
  "sleep-times.v0",
  "time-zone.v0",
  "workout-days.v0",
  "workouts.v0",
  "heart-rate-zones-days.v0",
  ...HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS,
] as const;

export type HostedVaultShareFixedProjectionKind =
  (typeof HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS)[number];

export const HOSTED_VAULT_SHARE_PROJECTION_KINDS = [
  ...HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
] as const;

/**
 * Kinds members may individually select on a group join page. profile-name.v0 is
 * excluded: it is granted implicitly with group membership (introducing yourself by
 * name is what joining means), never requested as an optional health permission.
 */
export const HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS = [
  "group-email.v0",
  "time-zone.v0",
  "sleep-times.v0",
  "sleep-duration-days.v0",
  "deep-sleep-days.v0",
  "deep-sleep-sources-days.v1",
  "rem-sleep-days.v0",
  "rem-sleep-sources-days.v1",
  "activity-days.v0",
  "workout-days.v0",
  "workouts.v0",
  "heart-rate-zones-days.v0",
  "steps-days.v0",
  "max-heart-rate-days.v0",
  "distance-days.v0",
  "active-calories-days.v0",
  "elevation-gain-days.v0",
  "floors-climbed-days.v0",
  "day-strain-days.v0",
  "workout-strain-days.v0",
  "activity-score-days.v0",
  "vo2-max-days.v0",
  "resting-heart-rate-days.v0",
  "hrv-days.v0",
  "protein-days.v0",
  "calories-days.v0",
  "carbs-days.v0",
  "fat-days.v0",
  "fiber-days.v0",
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
] as const satisfies readonly HostedVaultShareProjectionKind[];

export type HostedVaultShareSelectableProjectionKind =
  (typeof HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS)[number];

/**
 * Kinds whose records are current-state facts rather than time-series entries: one
 * parser-enforced fixed recordKey per grantor, so a delivery replaces the previous fact
 * instead of extending a history. Two delivery-policy consequences, both keyed here so
 * they cannot drift apart: the server-side recency age bound does not apply (a fact set
 * long ago is still the current fact at a member's first group join), and the delivery
 * revision identity must hash the content alone — occurredAt is grantor-runtime-controlled
 * metadata, and hashing it would let drifted timestamps mint unbounded mailbox dedupe keys
 * for the same unchanged fact.
 */
export const HOSTED_VAULT_SHARE_CURRENT_STATE_PROJECTION_KINDS = [
  "profile-name.v0",
  "time-zone.v0",
] as const satisfies readonly HostedVaultShareProjectionKind[];

export function isHostedVaultShareCurrentStateProjectionKind(
  kind: HostedVaultShareProjectionKind,
): boolean {
  const kinds: readonly HostedVaultShareProjectionKind[] =
    HOSTED_VAULT_SHARE_CURRENT_STATE_PROJECTION_KINDS;
  return kinds.includes(kind);
}

/**
 * Kinds whose consent promise and producer contract are both bounded to recent
 * member-local civil dates. Reaffirming one of these permissions starts a fresh
 * projection generation so an older materialized window cannot be reused under
 * the new consent decision.
 */
export function isHostedVaultShareRecentDateProjectionKind(
  kind: HostedVaultShareProjectionKind,
): boolean {
  return kind !== "profile-name.v0"
    && kind !== "time-zone.v0"
    && kind !== "group-email.v0"
    && kind !== HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND;
}

export const HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS =
  Object.freeze(
    HOSTED_VAULT_SHARE_PROJECTION_KINDS.filter(
      isHostedVaultShareRecentDateProjectionKind,
    ),
  );

export type HostedVaultShareProjectionKind =
  (typeof HOSTED_VAULT_SHARE_PROJECTION_KINDS)[number];

export interface HostedVaultShareFixedProjectionScope {
  projectionKind: HostedVaultShareFixedProjectionKind;
}

export interface HostedVaultShareActivityMinutesProjectionScope {
  projectionKind: HostedVaultShareActivityMinutesProjectionKind;
  selector: HostedVaultShareActivityMinutesSelector;
}

export interface HostedVaultShareActivityDistanceProjectionScope {
  projectionKind: HostedVaultShareActivityDistanceProjectionKind;
  selector: HostedVaultShareActivityDistanceSelector;
}

export interface HostedVaultShareActivitySessionCountProjectionScope {
  projectionKind: HostedVaultShareActivitySessionCountProjectionKind;
  selector: HostedVaultShareActivitySessionCountSelector;
}

export type HostedVaultShareProjectionScope =
  | HostedVaultShareActivityDistanceProjectionScope
  | HostedVaultShareActivityMinutesProjectionScope
  | HostedVaultShareActivitySessionCountProjectionScope
  | HostedVaultShareFixedProjectionScope;

export type HostedVaultShareSelectableProjectionScope =
  HostedVaultShareProjectionScope;

export const HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES =
  Object.freeze([
    ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS
      .filter((projectionKind) =>
        projectionKind !== HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND
      )
      .map((projectionKind) => ({ projectionKind })),
    ...HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS.map((activityKind) => ({
      projectionKind: HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
      selector: { activityKind },
    })),
    ...HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS.map((activityKind) => ({
      projectionKind: HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
      selector: { activityKind },
    })),
    ...HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS.map((activityKind) => ({
      projectionKind: HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
      selector: { activityKind },
    })),
    { projectionKind: HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND },
  ] satisfies HostedVaultShareSelectableProjectionScope[]);

export const HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES =
  Object.freeze(uniqueHostedVaultShareProjectionScopeList([
    ...HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS.map((projectionKind) => ({
      projectionKind,
    })),
    ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  ] satisfies HostedVaultShareProjectionScope[]));

function uniqueHostedVaultShareProjectionScopeList(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionScope[] {
  const seen = new Set<string>();
  const unique: HostedVaultShareProjectionScope[] = [];
  for (const projectionScope of projectionScopes) {
    const key = buildHostedVaultShareProjectionScopeKey(projectionScope);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(projectionScope);
  }
  return unique;
}

export function isHostedVaultShareActivitySelectorActivityKind(
  value: unknown,
): value is HostedVaultShareActivitySelectorActivityKind {
  return isHostedVaultShareActivitySelectorActivityKindInSet(
    value,
    HOSTED_VAULT_SHARE_ACTIVITY_SELECTOR_ACTIVITY_KINDS,
  );
}

function isHostedVaultShareActivitySelectorActivityKindInSet(
  value: unknown,
  activityKinds: readonly string[],
): value is HostedVaultShareActivitySelectorActivityKind {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = normalizeActivityKindToken(value);
  return normalized !== null
    && normalized === value
    && activityKinds.includes(normalized);
}

export const isHostedVaultShareActivityMinutesSelectorActivityKind =
  isHostedVaultShareActivitySelectorActivityKind;
export function isHostedVaultShareActivityDistanceSelectorActivityKind(
  value: unknown,
): value is HostedVaultShareActivityDistanceSelectorActivityKind {
  return isHostedVaultShareActivitySelectorActivityKindInSet(
    value,
    HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS,
  );
}
export function isHostedVaultShareActivitySessionCountSelectorActivityKind(
  value: unknown,
): value is HostedVaultShareActivitySessionCountSelectorActivityKind {
  return isHostedVaultShareActivitySelectorActivityKindInSet(
    value,
    HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS,
  );
}

export const HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA =
  "murph.vault-share.delivery.v1";

export const HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA =
  "murph.vault-share.revoke.v1";

const HOSTED_VAULT_SHARE_RECORD_KEY_MAX_LENGTH = 128;
const HOSTED_VAULT_SHARE_RECORD_KEY_PATTERN = /^[A-Za-z0-9._-]+$/u;
export const HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH = 96;
const HOSTED_VAULT_SHARE_SOURCE_REVISION_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface HostedVaultShareSleepTimesData {
  date: string;
  sleepEndAt: string;
  sleepStartAt: string;
}

export const HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS =
  "broad-movement" as const;
export const HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS =
  "canonical-workout-day" as const;
export const HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS =
  "canonical-event-zone-or-vault-zone.v0" as const;
// With seven maximum-size day records, 13 workouts/day serialize to a 16,090-byte
// delivery request and a 16,067-byte snapshot. A 14-workout/day request is 17,147
// bytes and cannot cross the 16 KiB ingress ceiling. Parsers reject overflow rather
// than truncating a day.
export const HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY = 13;
export const HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH = 80;
/**
 * Providers can emit a real workout with no usable sport name; WHOOP maps an
 * unusable `sport_name` to the canonical type `workout`. The activity-kind
 * resolver deliberately rejects such generic tokens because it exists to
 * classify adherence, not to label a disclosure. A workout proved by durable
 * external-reference evidence is still a workout the group asked to see, so it
 * is disclosed under this truthful generic label rather than dropped.
 */
export const HOSTED_VAULT_SHARE_WORKOUT_GENERIC_KIND = "workout";

export interface HostedVaultShareDailyMetricData {
  date: string;
  metricKey: string;
  metricSemantics?: typeof HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS;
  projectedAt?: string;
  provisional?: true;
  sources?: HostedVaultShareSleepMetricSource[];
  sourcesDisagree?: boolean;
  unit: string | null;
  value: number;
}

export const HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_WEARABLE_SOURCES = 4;
export const HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES =
  HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_WEARABLE_SOURCES + 1;
export const HOSTED_VAULT_SHARE_SLEEP_METRIC_SOURCE_KEY_MAX_LENGTH = 80;
export const HOSTED_VAULT_SHARE_SLEEP_METRIC_SOURCE_LABEL_MAX_LENGTH = 80;

export interface HostedVaultShareSleepMetricSource {
  label: string;
  recordedAt: string | null;
  selected?: true;
  source: string;
  unit: string | null;
  value: number;
}

export interface HostedVaultShareWorkoutDayData {
  date: string;
  metricSemantics?: typeof HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS;
  workoutCount: number;
  workoutMinutes: number;
}

export interface HostedVaultShareWorkout {
  kind: string;
  minutes: number;
  startLocalMs: number;
}

export interface HostedVaultShareWorkoutsDayData {
  calendarClosedThroughDate: string;
  date: string;
  timeSemantics: typeof HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS;
  workouts: HostedVaultShareWorkout[];
}

export interface HostedVaultShareActivityMinutesDayData {
  activityKind: string;
  date: string;
  sessionCount: number;
  sessionMinutes: number;
}

export interface HostedVaultShareActivityDistanceDayData {
  activityKind: string;
  date: string;
  sessionCount: number;
  sessionDistanceMeters: number;
}

export interface HostedVaultShareActivitySessionCountDayData {
  activityKind: string;
  date: string;
  sessionCount: number;
}

export interface HostedVaultShareHeartRateZoneBucket {
  durationMinutes: number;
  label?: string;
  zone?: number;
}

export interface HostedVaultShareHeartRateZoneDayData {
  date: string;
  zones: HostedVaultShareHeartRateZoneBucket[];
}

export interface HostedVaultShareProfileNameData {
  displayName: string;
}

/**
 * The member's own IANA timezone, so a group can tell which calendar day a
 * shared daily fact belongs to and when that day has finished for them.
 * Without it a consumer must either guess from the data, which lets a late
 * import reclassify an already-published day, or wait for the day to end in
 * the last timezone on earth.
 */
export interface HostedVaultShareTimeZoneData {
  timeZone: string;
}

export type HostedVaultShareDeviceSyncSourceStatus =
  | "connected"
  | "disconnected"
  | "needs-attention"
  | "needs-reconnect"
  | "setting-up";

export interface HostedVaultShareDeviceSyncSource {
  connectionSyncJobCompletedAt: string | null;
  label: string;
  status: HostedVaultShareDeviceSyncSourceStatus;
  statusObservedAt: string;
}

export interface HostedVaultShareDeviceSyncStatusData {
  observedAt: string;
  sources: HostedVaultShareDeviceSyncSource[];
}

export type HostedVaultShareDeliveryRecordData =
  | HostedVaultShareActivityMinutesDayData
  | HostedVaultShareActivityDistanceDayData
  | HostedVaultShareActivitySessionCountDayData
  | HostedVaultShareDailyMetricData
  | HostedVaultShareDeviceSyncStatusData
  | HostedVaultShareHeartRateZoneDayData
  | HostedVaultShareProfileNameData
  | HostedVaultShareTimeZoneData
  | HostedVaultShareSleepTimesData
  | HostedVaultShareWorkoutDayData
  | HostedVaultShareWorkoutsDayData;

export interface HostedVaultShareDeliveryRecord {
  data: HostedVaultShareDeliveryRecordData;
  occurredAt: string;
  recordKey: string;
  sourceRevision?: string;
}

export interface HostedVaultShareDeliverRequest {
  /**
   * Opaque digest of the active share generations resolved immediately before
   * the runtime begins reading this scope. Web accepts delivery only while the
   * digest still matches, so a rotated consent cannot receive stale records.
   */
  expectedGenerationToken?: string;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  records: HostedVaultShareDeliveryRecord[];
}

/**
 * The deliver response is intentionally a bare status that depends on share configuration
 * alone: the grantor runtime may learn that an active share exists, never fan-out
 * cardinality, duplicate history, or per-record outcomes.
 */
export interface HostedVaultShareDeliverResponse {
  status: "delivered" | "no-active-share";
}

export interface HostedVaultShareActiveProjectionKindsResponse {
  projectionKinds: HostedVaultShareProjectionKind[];
  projectionScopes: HostedVaultShareProjectionScope[];
  generationTokensByProjectionScopeKey?: Record<string, string>;
}

export interface HostedVaultShareDeliveryPayload {
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  record: HostedVaultShareDeliveryRecord;
  schema: typeof HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA;
  shareId: string;
}

export interface HostedVaultShareRevokePayload {
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  revokedAt: string;
  schema: typeof HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA;
  shareId: string;
}

export function isHostedVaultShareProjectionKind(
  value: unknown,
): value is HostedVaultShareProjectionKind {
  return HOSTED_VAULT_SHARE_PROJECTION_KINDS.includes(
    value as HostedVaultShareProjectionKind,
  );
}

export function isHostedVaultShareFixedProjectionKind(
  value: unknown,
): value is HostedVaultShareFixedProjectionKind {
  return HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS.includes(
    value as HostedVaultShareFixedProjectionKind,
  );
}

export function isHostedVaultShareDailyMetricProjectionKind(
  value: HostedVaultShareProjectionKind,
): value is HostedVaultShareDailyMetricProjectionKind {
  return HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS.includes(
    value as HostedVaultShareDailyMetricProjectionKind,
  );
}

export function getHostedVaultShareDailyMetricProjectionSpec(
  projectionKind: HostedVaultShareProjectionKind,
): HostedVaultShareDailyMetricProjectionSpec | null {
  return HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS.find(
    (spec) => spec.projectionKind === projectionKind,
  ) ?? null;
}

function parseHostedVaultShareProjectionKind(
  value: unknown,
  label: string,
): HostedVaultShareProjectionKind {
  if (isHostedVaultShareProjectionKind(value)) {
    return value;
  }

  throw new TypeError(`${label} must be a known vault-share projection kind.`);
}

function parseHostedVaultShareFixedProjectionKind(
  value: unknown,
  label: string,
): HostedVaultShareFixedProjectionKind {
  const projectionKind = parseHostedVaultShareProjectionKind(value, label);
  if (isHostedVaultShareActivitySelectorProjectionKind(projectionKind)) {
    throw new TypeError(`${label} requires a vault-share projection selector.`);
  }
  return projectionKind;
}

export function hostedVaultShareProjectionKindToScope(
  projectionKind: HostedVaultShareFixedProjectionKind,
): HostedVaultShareFixedProjectionScope {
  return { projectionKind };
}

export function buildHostedVaultShareActivityMinutesProjectionScope(input: {
  activityKind: string;
}): HostedVaultShareActivityMinutesProjectionScope {
  const activityKind = parseHostedVaultShareActivitySelectorActivityKind(
    input.activityKind,
    "Vault share activity-minutes selector activityKind",
  );
  return {
    projectionKind: HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
    selector: { activityKind },
  };
}

export function buildHostedVaultShareActivityDistanceProjectionScope(input: {
  activityKind: string;
}): HostedVaultShareActivityDistanceProjectionScope {
  const activityKind = parseHostedVaultShareActivityDistanceSelectorActivityKind(
    input.activityKind,
    "Vault share activity-distance selector activityKind",
  );
  return {
    projectionKind: HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
    selector: { activityKind },
  };
}

export function buildHostedVaultShareActivitySessionCountProjectionScope(input: {
  activityKind: string;
}): HostedVaultShareActivitySessionCountProjectionScope {
  const activityKind = parseHostedVaultShareActivitySessionCountSelectorActivityKind(
    input.activityKind,
    "Vault share activity-session-count selector activityKind",
  );
  return {
    projectionKind: HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
    selector: { activityKind },
  };
}

export function buildHostedVaultShareProjectionScopeKey(
  scope: HostedVaultShareProjectionScope,
): string {
  switch (scope.projectionKind) {
    case HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND:
    case HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND:
    case HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND:
      return `${scope.projectionKind}.activityKind.${scope.selector.activityKind}`;
    default:
      return scope.projectionKind;
  }
}

export function parseHostedVaultShareProjectionScopeKey(
  value: unknown,
  label: string,
): HostedVaultShareProjectionScope {
  const scopeKey = requireString(value, label);
  const projectionScope = HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES.find(
    (scope) => buildHostedVaultShareProjectionScopeKey(scope) === scopeKey,
  );
  if (!projectionScope) {
    throw new TypeError(`${label} must be a known vault-share projection scope key.`);
  }
  return projectionScope;
}

export function parseHostedVaultShareProjectionScope(
  value: unknown,
  label: string,
): HostedVaultShareProjectionScope {
  if (typeof value === "string") {
    return hostedVaultShareProjectionKindToScope(
      parseHostedVaultShareFixedProjectionKind(value, label),
    );
  }

  const scope = requireObject(value, label);
  const projectionKind = parseHostedVaultShareProjectionKind(
    scope.projectionKind,
    `${label} projectionKind`,
  );

  if (projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND) {
    const selector = requireObject(scope.selector, `${label} selector`);
    assertObjectKeys(
      selector,
      `${label} selector`,
      ["activityKind"],
    );
    return {
      projectionKind,
      selector: {
        activityKind: parseHostedVaultShareActivitySelectorActivityKind(
          selector.activityKind,
          `${label} selector activityKind`,
        ),
      },
    };
  }
  if (projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND) {
    const selector = requireObject(scope.selector, `${label} selector`);
    assertObjectKeys(
      selector,
      `${label} selector`,
      ["activityKind"],
    );
    return {
      projectionKind,
      selector: {
        activityKind: parseHostedVaultShareActivityDistanceSelectorActivityKind(
          selector.activityKind,
          `${label} selector activityKind`,
        ),
      },
    };
  }
  if (projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND) {
    const selector = requireObject(scope.selector, `${label} selector`);
    assertObjectKeys(
      selector,
      `${label} selector`,
      ["activityKind"],
    );
    return {
      projectionKind,
      selector: {
        activityKind: parseHostedVaultShareActivitySessionCountSelectorActivityKind(
          selector.activityKind,
          `${label} selector activityKind`,
        ),
      },
    };
  }

  if (scope.selector !== undefined) {
    throw new TypeError(`${label} selector is not supported for ${projectionKind}.`);
  }

  return { projectionKind };
}

function isHostedVaultShareActivitySelectorProjectionKind(
  value: HostedVaultShareProjectionKind,
): value is HostedVaultShareActivitySelectorProjectionKind {
  return value === HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND
    || value === HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND
    || value === HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND;
}

function parseHostedVaultShareActivitySelectorActivityKind(
  value: unknown,
  label: string,
): HostedVaultShareActivitySelectorActivityKind {
  const activityKind = requireString(value, label);
  if (!isHostedVaultShareActivitySelectorActivityKind(activityKind)) {
    throw new TypeError(
      `${label} must be a recognized normalized activity alias.`,
    );
  }
  return activityKind;
}

function parseHostedVaultShareActivityDistanceSelectorActivityKind(
  value: unknown,
  label: string,
): HostedVaultShareActivityDistanceSelectorActivityKind {
  const activityKind = requireString(value, label);
  if (!isHostedVaultShareActivityDistanceSelectorActivityKind(activityKind)) {
    throw new TypeError(
      `${label} must be a recognized normalized distance activity alias.`,
    );
  }
  return activityKind;
}

function parseHostedVaultShareActivitySessionCountSelectorActivityKind(
  value: unknown,
  label: string,
): HostedVaultShareActivitySessionCountSelectorActivityKind {
  const activityKind = requireString(value, label);
  if (!isHostedVaultShareActivitySessionCountSelectorActivityKind(activityKind)) {
    throw new TypeError(
      `${label} must be a recognized normalized activity-session alias.`,
    );
  }
  return activityKind;
}

function assertObjectKeys(
  value: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} must not include ${key}.`);
    }
  }
}

function parseHostedVaultShareRequestProjectionScope(
  value: Record<string, unknown>,
  label: string,
): HostedVaultShareProjectionScope {
  const scope = value.projectionScope === undefined
    ? hostedVaultShareProjectionKindToScope(
        parseHostedVaultShareFixedProjectionKind(
          value.projectionKind,
          `${label} projectionKind`,
        ),
      )
    : parseHostedVaultShareProjectionScope(value.projectionScope, `${label} projectionScope`);

  if (value.projectionKind !== undefined) {
    const projectionKind = parseHostedVaultShareProjectionKind(
      value.projectionKind,
      `${label} projectionKind`,
    );
    if (projectionKind !== scope.projectionKind) {
      throw new TypeError(`${label} projectionKind must match projectionScope projectionKind.`);
    }
  }

  return scope;
}

export function getHostedVaultShareActivityMinutesProjectionSpec(
  scope: HostedVaultShareProjectionScope,
): HostedVaultShareActivityMinutesProjectionSpec | null {
  if (scope.projectionKind !== HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND) {
    return null;
  }
  return {
    activityKind: scope.selector.activityKind,
    projectionKind: scope.projectionKind,
  };
}

export function getHostedVaultShareActivityDistanceProjectionSpec(
  scope: HostedVaultShareProjectionScope,
): HostedVaultShareActivityDistanceProjectionSpec | null {
  if (scope.projectionKind !== HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND) {
    return null;
  }
  return {
    activityKind: scope.selector.activityKind,
    projectionKind: scope.projectionKind,
  };
}

export function getHostedVaultShareActivitySessionCountProjectionSpec(
  scope: HostedVaultShareProjectionScope,
): HostedVaultShareActivitySessionCountProjectionSpec | null {
  if (scope.projectionKind !== HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND) {
    return null;
  }
  return {
    activityKind: scope.selector.activityKind,
    projectionKind: scope.projectionKind,
  };
}

export function parseHostedVaultShareDeliveryRecord(
  value: unknown,
  projectionScope: HostedVaultShareProjectionScope,
): HostedVaultShareDeliveryRecord {
  const record = requireObject(value, "Vault share delivery record");
  const recordKey = requireRecordKey(
    record.recordKey,
    "Vault share delivery record recordKey",
  );

  const occurredAt = requireIsoTimestamp(
    record.occurredAt,
    "Vault share delivery record occurredAt",
  );
  const provisional = requireObject(record.data, "Vault share delivery record data").provisional;
  const completedDateScope = projectionScope.projectionKind === "deep-sleep-days.v0"
    || projectionScope.projectionKind === "deep-sleep-sources-days.v1"
    || projectionScope.projectionKind === "rem-sleep-days.v0"
    || projectionScope.projectionKind === "rem-sleep-sources-days.v1";
  if (provisional !== undefined && (provisional !== true || !completedDateScope)) {
    throw new TypeError(`Vault share ${projectionScope.projectionKind} data provisional is invalid.`);
  }
  const data = parseHostedVaultShareDeliveryRecordData(record.data, {
    occurredAt,
    projectionKind: projectionScope.projectionKind,
    projectionScope,
    recordKey,
  });

  return {
    data: provisional === true ? { ...data, provisional } : data,
    occurredAt,
    recordKey,
    ...parseHostedVaultShareSourceRevision(record.sourceRevision),
  };
}

function parseHostedVaultShareSourceRevision(value: unknown): { sourceRevision?: string } {
  if (value === undefined) {
    return {};
  }

  const sourceRevision = requireString(
    value,
    "Vault share delivery record sourceRevision",
  );
  if (
    sourceRevision.length > HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH
    || !HOSTED_VAULT_SHARE_SOURCE_REVISION_PATTERN.test(sourceRevision)
  ) {
    throw new TypeError(
      "Vault share delivery record sourceRevision must be an opaque base64url string.",
    );
  }

  return { sourceRevision };
}

function parseHostedVaultShareDeliveryRecordData(
  value: unknown,
  context: {
    occurredAt: string;
    projectionKind: HostedVaultShareProjectionKind;
    projectionScope: HostedVaultShareProjectionScope;
    recordKey: string;
  },
): HostedVaultShareDeliveryRecordData {
  const dailyMetricSpec = getHostedVaultShareDailyMetricProjectionSpec(
    context.projectionKind,
  );
  if (dailyMetricSpec) {
    return parseHostedVaultShareDailyMetricData(value, context, dailyMetricSpec);
  }

  const activityMinutesSpec =
    getHostedVaultShareActivityMinutesProjectionSpec(context.projectionScope);
  if (activityMinutesSpec) {
    return parseHostedVaultShareActivityMinutesDayData(value, context, activityMinutesSpec);
  }

  const activityDistanceSpec =
    getHostedVaultShareActivityDistanceProjectionSpec(context.projectionScope);
  if (activityDistanceSpec) {
    return parseHostedVaultShareActivityDistanceDayData(value, context, activityDistanceSpec);
  }

  const activitySessionCountSpec =
    getHostedVaultShareActivitySessionCountProjectionSpec(context.projectionScope);
  if (activitySessionCountSpec) {
    return parseHostedVaultShareActivitySessionCountDayData(
      value,
      context,
      activitySessionCountSpec,
    );
  }

  switch (context.projectionKind) {
    case HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND:
      return parseHostedVaultShareDeviceSyncStatusData(value, context);
    case "heart-rate-zones-days.v0":
      return parseHostedVaultShareHeartRateZoneDayData(value, context);
    case "profile-name.v0":
      return parseHostedVaultShareProfileNameData(value, context);
    case "time-zone.v0":
      return parseHostedVaultShareTimeZoneData(value, context);
    case "sleep-times.v0":
      return parseHostedVaultShareSleepTimesData(value, context);
    case "workout-days.v0":
      return parseHostedVaultShareWorkoutDayData(value, context);
    case "workouts.v0":
      return parseHostedVaultShareWorkoutsDayData(value, context);
  }

  throw new TypeError(
    `Vault share ${context.projectionKind} data parser is not implemented.`,
  );
}

export const HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY = "profile-name";
export const HOSTED_VAULT_SHARE_TIME_ZONE_RECORD_KEY = "time-zone";
export const HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH = 120;

export const HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_RECORD_KEY =
  "device-sync-status";
export const HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES = 8;
export const HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_SOURCE_LABEL_MAX_LENGTH = 80;
const HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function parseHostedVaultShareDeviceSyncStatusData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareDeviceSyncStatusData {
  const data = requireObject(value, "Vault share device-sync-status data");
  assertObjectKeys(
    data,
    "Vault share device-sync-status data",
    ["observedAt", "sources"],
  );

  if (context.recordKey !== HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_RECORD_KEY) {
    throw new TypeError(
      'Vault share device-sync-status recordKey must be "device-sync-status".',
    );
  }

  const observedAt = requireHostedVaultShareNonFutureTimestamp(
    data.observedAt,
    "Vault share device-sync-status data observedAt",
  );
  if (
    observedAt !== context.occurredAt
    || !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/u.test(observedAt)
  ) {
    throw new TypeError(
      "Vault share device-sync-status observedAt and occurredAt must equal the UTC day bucket.",
    );
  }

  const rawSources = requireArray(
    data.sources,
    "Vault share device-sync-status data sources",
  );
  if (rawSources.length > HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES) {
    throw new TypeError(
      `Vault share device-sync-status sources must contain at most ${HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES} entries.`,
    );
  }

  const seenLabels = new Set<string>();
  const sources = rawSources.map((source, index) => {
    const parsed = parseHostedVaultShareDeviceSyncSource(source, index);
    const normalizedLabel = parsed.label.toLocaleLowerCase("en-US");
    if (seenLabels.has(normalizedLabel)) {
      throw new TypeError(
        "Vault share device-sync-status source labels must be unique.",
      );
    }
    seenLabels.add(normalizedLabel);
    return parsed;
  });

  return { observedAt, sources };
}

function parseHostedVaultShareDeviceSyncSource(
  value: unknown,
  index: number,
): HostedVaultShareDeviceSyncSource {
  const label = `Vault share device-sync-status sources[${index}]`;
  const source = requireObject(value, label);
  assertObjectKeys(
    source,
    label,
    ["connectionSyncJobCompletedAt", "label", "status", "statusObservedAt"],
  );
  if (!Object.prototype.hasOwnProperty.call(source, "connectionSyncJobCompletedAt")) {
    throw new TypeError(`${label} connectionSyncJobCompletedAt must be a timestamp or null.`);
  }

  const publicLabel = parseHostedVaultShareBoundedText(
    source.label,
    `${label} label`,
    HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_SOURCE_LABEL_MAX_LENGTH,
  );
  if (publicLabel.toLocaleLowerCase("en-US") === "junction") {
    throw new TypeError(`${label} label must identify the public health source.`);
  }

  const status = requireString(source.status, `${label} status`);
  if (!isHostedVaultShareDeviceSyncSourceStatus(status)) {
    throw new TypeError(`${label} status is invalid.`);
  }

  const statusObservedAt = requireHostedVaultShareNonFutureTimestamp(
    source.statusObservedAt,
    `${label} statusObservedAt`,
  );
  const connectionSyncJobCompletedAt = source.connectionSyncJobCompletedAt === null
    ? null
    : requireHostedVaultShareNonFutureTimestamp(
        source.connectionSyncJobCompletedAt,
        `${label} connectionSyncJobCompletedAt`,
      );

  return {
    connectionSyncJobCompletedAt,
    label: publicLabel,
    status,
    statusObservedAt,
  };
}

function isHostedVaultShareDeviceSyncSourceStatus(
  value: string,
): value is HostedVaultShareDeviceSyncSourceStatus {
  return value === "connected"
    || value === "disconnected"
    || value === "needs-attention"
    || value === "needs-reconnect"
    || value === "setting-up";
}

function requireHostedVaultShareNonFutureTimestamp(
  value: unknown,
  label: string,
): string {
  const timestamp = requireIsoTimestamp(value, label);
  if (
    Date.parse(timestamp)
    > Date.now() + HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_FUTURE_SKEW_MS
  ) {
    throw new TypeError(`${label} must not be in the future.`);
  }
  return timestamp;
}

function parseHostedVaultShareTimeZoneData(
  value: unknown,
  context: { recordKey: string },
): HostedVaultShareTimeZoneData {
  const data = requireObject(value, "Vault share time-zone data");

  // One logical record per grantor, so a delivery replaces the previous
  // timezone rather than accumulating a travel history.
  if (context.recordKey !== HOSTED_VAULT_SHARE_TIME_ZONE_RECORD_KEY) {
    throw new TypeError(
      'Vault share time-zone recordKey must be "time-zone".',
    );
  }

  const timeZone = normalizeIanaTimeZone(
    requireString(data.timeZone, "Vault share time-zone data timeZone"),
  );
  if (!timeZone) {
    throw new TypeError("Vault share time-zone data timeZone is invalid.");
  }

  return { timeZone };
}

function parseHostedVaultShareProfileNameData(
  value: unknown,
  context: { recordKey: string },
): HostedVaultShareProfileNameData {
  const data = requireObject(value, "Vault share profile-name data");

  // One logical record per grantor: the fixed recordKey makes every delivery a
  // replacement of the previous name instead of an accumulating history.
  if (context.recordKey !== HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY) {
    throw new TypeError(
      'Vault share profile-name recordKey must be "profile-name".',
    );
  }

  const displayName = requireString(
    data.displayName,
    "Vault share profile-name data displayName",
  ).trim();

  if (
    displayName.length === 0
    || displayName.length > HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(displayName)
  ) {
    throw new TypeError(
      "Vault share profile-name displayName must be 1-120 characters with no control characters.",
    );
  }

  return { displayName };
}

function parseHostedVaultShareDailyMetricData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
  spec: HostedVaultShareDailyMetricProjectionSpec,
): HostedVaultShareDailyMetricData {
  const data = requireObject(
    value,
    `Vault share ${spec.projectionKind} data`,
  );
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: `Vault share ${spec.projectionKind} data`,
    occurredAt: context.occurredAt,
    occurredAtDescription: `${spec.projectionKind} date at UTC midnight`,
    recordKey: context.recordKey,
  });
  const metricKey = requireString(
    data.metricKey,
    `Vault share ${spec.projectionKind} data metricKey`,
  );

  if (metricKey !== spec.metricKey) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} metricKey must be ${spec.metricKey}.`,
    );
  }

  const unit = readNullableStringValue(
    data.unit,
    `Vault share ${spec.projectionKind} data unit`,
  );
  if (unit !== null && (unit.length > 40 || /[\u0000-\u001f\u007f]/u.test(unit))) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} unit must be at most 40 characters with no control characters.`,
    );
  }
  if (spec.expectedUnit !== undefined && unit !== spec.expectedUnit) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} unit must be ${spec.expectedUnit}.`,
    );
  }

  const valueNumber = requireNumber(
    data.value,
    `Vault share ${spec.projectionKind} data value`,
  );
  if (valueNumber < spec.minValue || valueNumber > spec.maxValue) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} value must be between ${spec.minValue} and ${spec.maxValue}.`,
    );
  }

  const metricSemantics = data.metricSemantics === undefined
    ? undefined
    : requireString(
        data.metricSemantics,
        `Vault share ${spec.projectionKind} data metricSemantics`,
      );
  if (
    metricSemantics !== undefined
    && (
      spec.projectionKind !== "activity-days.v0"
      || metricSemantics !== HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS
    )
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} data metricSemantics is invalid.`,
    );
  }

  const sourceAware = spec.sourceMode === "all-public-sleep-sources";
  if (sourceAware) {
    assertObjectKeys(
      data,
      `Vault share ${spec.projectionKind} data`,
      [
        "date",
        "metricKey",
        "projectedAt",
        "provisional",
        "sources",
        "sourcesDisagree",
        "unit",
        "value",
      ],
    );
  }
  if (!sourceAware) {
    if (
      data.projectedAt !== undefined
      || data.sources !== undefined
      || data.sourcesDisagree !== undefined
    ) {
      throw new TypeError(
        `Vault share ${spec.projectionKind} does not accept source-aware sleep data.`,
      );
    }
  }

  const sourceAwareData = sourceAware
    ? parseHostedVaultShareSleepMetricSources(data, spec, {
        unit,
        value: valueNumber,
      })
    : {};

  return {
    date,
    metricKey,
    ...(metricSemantics === undefined ? {} : { metricSemantics }),
    ...sourceAwareData,
    unit,
    value: valueNumber,
  };
}

function parseHostedVaultShareSleepMetricSources(
  data: Record<string, unknown>,
  spec: HostedVaultShareDailyMetricProjectionSpec,
  selectedMetric: { unit: string | null; value: number },
): Pick<
  HostedVaultShareDailyMetricData,
  "projectedAt" | "sources" | "sourcesDisagree"
> {
  const projectedAt = requireHostedVaultShareNonFutureTimestamp(
    data.projectedAt,
    `Vault share ${spec.projectionKind} data projectedAt`,
  );
  const rawSources = requireArray(
    data.sources,
    `Vault share ${spec.projectionKind} data sources`,
  );
  if (
    rawSources.length === 0
    || rawSources.length > HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sources must contain 1-${HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES} entries.`,
    );
  }

  const sources = rawSources.map((value, index) =>
    parseHostedVaultShareSleepMetricSource(value, spec, index)
  );
  const sourceKeys = new Set(sources.map((source) => source.source));
  if (sourceKeys.size !== sources.length) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} source keys must be unique.`,
    );
  }
  const wearableSourceCount = sources.filter((source) => source.source !== "manual").length;
  if (wearableSourceCount > HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_WEARABLE_SOURCES) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sources must contain at most ${HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_WEARABLE_SOURCES} wearable entries.`,
    );
  }

  const selectedSources = sources.filter((source) => source.selected === true);
  if (selectedSources.length !== 1) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sources must contain exactly one selected source.`,
    );
  }
  const selectedSource = selectedSources[0];
  if (
    !selectedSource
    || selectedSource.unit !== selectedMetric.unit
    || selectedSource.value !== selectedMetric.value
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} selected source must match the canonical value and unit.`,
    );
  }

  const sourcesDisagree = requireBoolean(
    data.sourcesDisagree,
    `Vault share ${spec.projectionKind} data sourcesDisagree`,
  );
  const firstSource = sources[0];
  const computedSourcesDisagree = firstSource
    ? sources.some((source) =>
        source.unit !== firstSource.unit || source.value !== firstSource.value
      )
    : false;
  if (sourcesDisagree !== computedSourcesDisagree) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sourcesDisagree must match the source values.`,
    );
  }

  return {
    projectedAt,
    sources,
    sourcesDisagree,
  };
}

function parseHostedVaultShareSleepMetricSource(
  value: unknown,
  spec: HostedVaultShareDailyMetricProjectionSpec,
  index: number,
): HostedVaultShareSleepMetricSource {
  const label = `Vault share ${spec.projectionKind} data sources[${index}]`;
  const source = requireObject(value, label);
  assertObjectKeys(source, label, [
    "label",
    "recordedAt",
    "selected",
    "source",
    "unit",
    "value",
  ]);

  const sourceKey = requireString(source.source, `${label} source`).trim();
  if (
    sourceKey.length > HOSTED_VAULT_SHARE_SLEEP_METRIC_SOURCE_KEY_MAX_LENGTH
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(sourceKey)
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} source keys must be canonical public provider slugs.`,
    );
  }

  const sourceLabel = requireString(source.label, `${label} label`).trim();
  if (
    sourceLabel.length === 0
    || sourceLabel.length > HOSTED_VAULT_SHARE_SLEEP_METRIC_SOURCE_LABEL_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(sourceLabel)
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} source labels must be bounded text without control characters.`,
    );
  }
  const providerDescriptor = resolveWearableProviderDescriptor(sourceKey);
  const hasCanonicalPublicIdentity = sourceKey === "manual"
    ? sourceLabel === "Manual"
    : sourceKey !== "junction"
      && (providerDescriptor?.displayName ?? sourceKey) === sourceLabel;
  if (!hasCanonicalPublicIdentity) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sources must use canonical public provider keys and labels.`,
    );
  }

  const recordedAt = source.recordedAt === null
    ? null
    : requireHostedVaultShareNonFutureTimestamp(
        source.recordedAt,
        `${label} recordedAt`,
      );
  let selected: true | undefined;
  if (source.selected !== undefined) {
    if (source.selected !== true) {
      throw new TypeError(`${label} selected must be true when present.`);
    }
    selected = true;
  }
  const unit = readNullableStringValue(source.unit, `${label} unit`);
  if (unit !== null && (unit.length > 40 || /[\u0000-\u001f\u007f]/u.test(unit))) {
    throw new TypeError(`${label} unit must be bounded text without control characters.`);
  }
  if (spec.expectedUnit !== undefined && unit !== spec.expectedUnit) {
    throw new TypeError(`${label} unit must be ${spec.expectedUnit}.`);
  }
  const metricValue = requireNumber(source.value, `${label} value`);
  if (metricValue < spec.minValue || metricValue > spec.maxValue) {
    throw new TypeError(
      `${label} value must be between ${spec.minValue} and ${spec.maxValue}.`,
    );
  }

  return {
    label: sourceLabel,
    recordedAt,
    ...(selected === true ? { selected } : {}),
    source: sourceKey,
    unit,
    value: metricValue,
  };
}

function parseHostedVaultShareWorkoutDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareWorkoutDayData {
  const data = requireObject(value, "Vault share workout-days data");
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: "Vault share workout-days data",
    occurredAt: context.occurredAt,
    occurredAtDescription: "workout date at UTC midnight",
    recordKey: context.recordKey,
  });
  const workoutCount = requireNumber(
    data.workoutCount,
    "Vault share workout-days data workoutCount",
  );
  const workoutMinutes = requireNumber(
    data.workoutMinutes,
    "Vault share workout-days data workoutMinutes",
  );

  if (!Number.isInteger(workoutCount) || workoutCount < 0 || workoutCount > 100) {
    throw new TypeError(
      "Vault share workout-days workoutCount must be an integer between 0 and 100.",
    );
  }
  if (workoutMinutes < 0 || workoutMinutes > HOSTED_VAULT_SHARE_DAY_MAX_MINUTES) {
    throw new TypeError(
      "Vault share workout-days workoutMinutes must be between 0 and 1440.",
    );
  }

  const metricSemantics = data.metricSemantics === undefined
    ? undefined
    : requireString(
        data.metricSemantics,
        "Vault share workout-days data metricSemantics",
      );
  if (
    metricSemantics !== undefined
    && metricSemantics !== HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS
  ) {
    throw new TypeError(
      "Vault share workout-days data metricSemantics is invalid.",
    );
  }

  return {
    date,
    ...(metricSemantics === undefined ? {} : { metricSemantics }),
    workoutCount,
    workoutMinutes,
  };
}

function parseHostedVaultShareWorkoutsDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareWorkoutsDayData {
  const data = requireObject(value, "Vault share workouts data");
  assertObjectKeys(
    data,
    "Vault share workouts data",
    ["calendarClosedThroughDate", "date", "timeSemantics", "workouts"],
  );
  const calendarClosedThroughDate = requireString(
    data.calendarClosedThroughDate,
    "Vault share workouts data calendarClosedThroughDate",
  );
  if (!isStrictIsoDate(calendarClosedThroughDate)) {
    throw new TypeError(
      "Vault share workouts data calendarClosedThroughDate is invalid.",
    );
  }
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: "Vault share workouts data",
    occurredAt: context.occurredAt,
    occurredAtDescription: "workout date at UTC midnight",
    recordKey: context.recordKey,
  });
  const rawWorkouts = requireArray(
    data.workouts,
    "Vault share workouts data workouts",
  );
  if (rawWorkouts.length > HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY) {
    throw new TypeError(
      `Vault share workouts data workouts must contain at most ${HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY} entries.`,
    );
  }
  const workouts = rawWorkouts.map((workout, index) =>
    parseHostedVaultShareWorkout(workout, index)
  );
  const timeSemantics = requireString(
    data.timeSemantics,
    "Vault share workouts data timeSemantics",
  );
  if (
    timeSemantics
    !== HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS
  ) {
    throw new TypeError(
      "Vault share workouts data timeSemantics is invalid.",
    );
  }

  return { calendarClosedThroughDate, date, timeSemantics, workouts };
}

function parseHostedVaultShareWorkout(
  value: unknown,
  index: number,
): HostedVaultShareWorkout {
  const label = `Vault share workouts data workouts[${index}]`;
  const workout = requireObject(value, label);
  assertObjectKeys(workout, label, ["kind", "minutes", "startLocalMs"]);

  const kind = requireString(workout.kind, `${label} kind`);
  if (
    kind.length === 0
    || kind.length > HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH
    || normalizeActivityKindToken(kind) !== kind
  ) {
    throw new TypeError(
      `${label} kind must be a normalized activity token of at most ${HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH} characters.`,
    );
  }

  const minutes = requireNumber(workout.minutes, `${label} minutes`);
  if (minutes <= 0 || minutes > HOSTED_VAULT_SHARE_DAY_MAX_MINUTES) {
    throw new TypeError(
      `${label} minutes must be greater than 0 and at most ${HOSTED_VAULT_SHARE_DAY_MAX_MINUTES}.`,
    );
  }

  const startLocalMs = requireNumber(
    workout.startLocalMs,
    `${label} startLocalMs`,
  );
  if (
    !Number.isInteger(startLocalMs)
    || startLocalMs < 0
    || startLocalMs >= 24 * 60 * 60 * 1_000
  ) {
    throw new TypeError(
      `${label} startLocalMs must be an integer between 0 and 86399999.`,
    );
  }

  return { kind, minutes, startLocalMs };
}

function parseHostedVaultShareActivityMinutesDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
  spec: HostedVaultShareActivityMinutesProjectionSpec,
): HostedVaultShareActivityMinutesDayData {
  const data = requireObject(
    value,
    `Vault share ${spec.projectionKind} data`,
  );
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: `Vault share ${spec.projectionKind} data`,
    occurredAt: context.occurredAt,
    occurredAtDescription: `${spec.projectionKind} date at UTC midnight`,
    recordKey: context.recordKey,
  });
  const activityKind = requireString(
    data.activityKind,
    `Vault share ${spec.projectionKind} data activityKind`,
  );
  const sessionCount = requireNumber(
    data.sessionCount,
    `Vault share ${spec.projectionKind} data sessionCount`,
  );
  const sessionMinutes = requireNumber(
    data.sessionMinutes,
    `Vault share ${spec.projectionKind} data sessionMinutes`,
  );

  if (activityKind !== spec.activityKind) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} activityKind must be ${spec.activityKind}.`,
    );
  }
  if (!Number.isInteger(sessionCount) || sessionCount < 0 || sessionCount > 100) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sessionCount must be an integer between 0 and 100.`,
    );
  }
  if (sessionMinutes < 0 || sessionMinutes > HOSTED_VAULT_SHARE_DAY_MAX_MINUTES) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sessionMinutes must be between 0 and 1440.`,
    );
  }

  return { activityKind, date, sessionCount, sessionMinutes };
}

function parseHostedVaultShareActivityDistanceDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
  spec: HostedVaultShareActivityDistanceProjectionSpec,
): HostedVaultShareActivityDistanceDayData {
  const data = requireObject(
    value,
    `Vault share ${spec.projectionKind} data`,
  );
  assertObjectKeys(
    data,
    `Vault share ${spec.projectionKind} data`,
    ["activityKind", "date", "sessionCount", "sessionDistanceMeters"],
  );
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: `Vault share ${spec.projectionKind} data`,
    occurredAt: context.occurredAt,
    occurredAtDescription: `${spec.projectionKind} date at UTC midnight`,
    recordKey: context.recordKey,
  });
  const activityKind = requireString(
    data.activityKind,
    `Vault share ${spec.projectionKind} data activityKind`,
  );
  const sessionCount = requireNumber(
    data.sessionCount,
    `Vault share ${spec.projectionKind} data sessionCount`,
  );
  const sessionDistanceMeters = requireNumber(
    data.sessionDistanceMeters,
    `Vault share ${spec.projectionKind} data sessionDistanceMeters`,
  );

  if (activityKind !== spec.activityKind) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} activityKind must be ${spec.activityKind}.`,
    );
  }
  if (
    !Number.isInteger(sessionCount)
    || sessionCount < 0
    || sessionCount > HOSTED_VAULT_SHARE_DAY_MAX_SESSIONS
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sessionCount must be an integer between 0 and ${HOSTED_VAULT_SHARE_DAY_MAX_SESSIONS}.`,
    );
  }
  if (
    !Number.isInteger(sessionDistanceMeters)
    || sessionDistanceMeters < 0
    || sessionDistanceMeters > HOSTED_VAULT_SHARE_DAY_MAX_DISTANCE_METERS
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sessionDistanceMeters must be an integer between 0 and ${HOSTED_VAULT_SHARE_DAY_MAX_DISTANCE_METERS}.`,
    );
  }

  return { activityKind, date, sessionCount, sessionDistanceMeters };
}

function parseHostedVaultShareActivitySessionCountDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
  spec: HostedVaultShareActivitySessionCountProjectionSpec,
): HostedVaultShareActivitySessionCountDayData {
  const data = requireObject(
    value,
    `Vault share ${spec.projectionKind} data`,
  );
  assertObjectKeys(
    data,
    `Vault share ${spec.projectionKind} data`,
    ["activityKind", "date", "sessionCount"],
  );
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: `Vault share ${spec.projectionKind} data`,
    occurredAt: context.occurredAt,
    occurredAtDescription: `${spec.projectionKind} date at UTC midnight`,
    recordKey: context.recordKey,
  });
  const activityKind = requireString(
    data.activityKind,
    `Vault share ${spec.projectionKind} data activityKind`,
  );
  const sessionCount = requireNumber(
    data.sessionCount,
    `Vault share ${spec.projectionKind} data sessionCount`,
  );

  if (activityKind !== spec.activityKind) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} activityKind must be ${spec.activityKind}.`,
    );
  }
  if (
    !Number.isInteger(sessionCount)
    || sessionCount < 0
    || sessionCount > HOSTED_VAULT_SHARE_DAY_MAX_SESSIONS
  ) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} sessionCount must be an integer between 0 and ${HOSTED_VAULT_SHARE_DAY_MAX_SESSIONS}.`,
    );
  }

  return { activityKind, date, sessionCount };
}

function parseHostedVaultShareHeartRateZoneDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareHeartRateZoneDayData {
  const data = requireObject(value, "Vault share heart-rate-zones-days data");
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: "Vault share heart-rate-zones-days data",
    occurredAt: context.occurredAt,
    occurredAtDescription: "heart-rate-zone date at UTC midnight",
    recordKey: context.recordKey,
  });
  const zones = requireArray(
    data.zones,
    "Vault share heart-rate-zones-days data zones",
  ).map((entry, index) =>
    parseHostedVaultShareHeartRateZoneBucket(entry, index, "heart-rate-zones-days")
  );

  if (zones.length === 0 || zones.length > 20) {
    throw new TypeError(
      "Vault share heart-rate-zones-days zones must contain 1-20 entries.",
    );
  }

  return { date, zones };
}

function parseHostedVaultShareHeartRateZoneBucket(
  value: unknown,
  index: number,
  projectionKind: string,
): HostedVaultShareHeartRateZoneBucket {
  const data = requireObject(
    value,
    `Vault share ${projectionKind} zones[${index}]`,
  );
  const zone = data.zone === undefined
    ? undefined
    : requireNumber(data.zone, `Vault share ${projectionKind} zones[${index}] zone`);
  const label = data.label === undefined
    ? undefined
    : parseHostedVaultShareBoundedText(
        data.label,
        `Vault share ${projectionKind} zones[${index}] label`,
        80,
      );
  const durationMinutes = requireNumber(
    data.durationMinutes,
    `Vault share ${projectionKind} zones[${index}] durationMinutes`,
  );

  if (zone !== undefined && (!Number.isInteger(zone) || zone < 0 || zone > 20)) {
    throw new TypeError(
      `Vault share ${projectionKind} zones[${index}] zone must be an integer between 0 and 20.`,
    );
  }
  if (durationMinutes < 0 || durationMinutes > HOSTED_VAULT_SHARE_DAY_MAX_MINUTES) {
    throw new TypeError(
      `Vault share ${projectionKind} zones[${index}] durationMinutes must be between 0 and 1440.`,
    );
  }
  if (
    zone === undefined
    && label === undefined
  ) {
    throw new TypeError(
      `Vault share ${projectionKind} zones[${index}] must identify the zone.`,
    );
  }

  return {
    ...(label === undefined ? {} : { label }),
    ...(zone === undefined ? {} : { zone }),
    durationMinutes,
  };
}

function parseHostedVaultShareDailyDate(
  value: unknown,
  context: {
    dataLabel: string;
    occurredAt: string;
    occurredAtDescription: string;
    recordKey: string;
  },
): string {
  const date = requireString(value, `${context.dataLabel} date`);

  if (!isStrictIsoDate(date)) {
    throw new TypeError(
      `${context.dataLabel} date must be a real calendar day formatted YYYY-MM-DD.`,
    );
  }

  if (context.recordKey !== date) {
    throw new TypeError(
      `${context.dataLabel.replace(" data", "")} recordKey must equal the data date.`,
    );
  }

  if (context.occurredAt !== `${date}T00:00:00.000Z`) {
    throw new TypeError(
      `${context.dataLabel.replace(" data", "")} occurredAt must be the ${context.occurredAtDescription}.`,
    );
  }

  return date;
}

function parseHostedVaultShareBoundedText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  const text = requireString(value, label).trim();
  if (text.length === 0 || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new TypeError(
      `${label} must be 1-${maxLength} characters with no control characters.`,
    );
  }
  return text;
}

const HOSTED_VAULT_SHARE_SLEEP_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseHostedVaultShareSleepTimesData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareSleepTimesData {
  const data = requireObject(value, "Vault share sleep-times data");
  const date = requireString(data.date, "Vault share sleep-times data date");

  if (!isStrictIsoDate(date)) {
    throw new TypeError(
      "Vault share sleep-times data date must be a real calendar day formatted YYYY-MM-DD.",
    );
  }

  // The record's identity is its night date; rejecting any drift keeps the dedupe key and
  // the destination vault path derived from recordKey byte-identical to the night itself.
  if (context.recordKey !== date) {
    throw new TypeError(
      "Vault share sleep-times recordKey must equal the data date.",
    );
  }

  // occurredAt is the envelope's only plaintext timestamp at rest (mailbox metadata).
  // Pinning it to the night-date midnight keeps exact sleep times out of Postgres and
  // anchors server-side recency filtering on the night itself, not a runtime-chosen time.
  if (context.occurredAt !== `${date}T00:00:00.000Z`) {
    throw new TypeError(
      "Vault share sleep-times occurredAt must be the night date at UTC midnight.",
    );
  }

  const sleepEndAt = requireIsoTimestamp(
    data.sleepEndAt,
    "Vault share sleep-times data sleepEndAt",
  );
  const sleepStartAt = requireIsoTimestamp(
    data.sleepStartAt,
    "Vault share sleep-times data sleepStartAt",
  );
  const windowMs = Date.parse(sleepEndAt) - Date.parse(sleepStartAt);

  // Fails closed on corrupted projections: a sleep window must be a positive interval of
  // plausible length, not reversed and not spanning multiple days.
  if (!(windowMs > 0) || windowMs > HOSTED_VAULT_SHARE_SLEEP_MAX_WINDOW_MS) {
    throw new TypeError(
      "Vault share sleep-times window must end after it starts and span at most 24 hours.",
    );
  }

  return { date, sleepEndAt, sleepStartAt };
}

export function parseHostedVaultShareDeliverRequest(
  value: unknown,
): HostedVaultShareDeliverRequest {
  const request = requireObject(value, "Vault share deliver request");
  const projectionScope = parseHostedVaultShareRequestProjectionScope(
    request,
    "Vault share deliver request",
  );
  const projectionKind = projectionScope.projectionKind;
  if (projectionKind === HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND) {
    throw new TypeError(
      "Vault share deliver request does not accept device-sync-status.v0 because Web reads it live.",
    );
  }
  const records = requireArray(request.records, "Vault share deliver request records");
  const expectedGenerationToken = request.expectedGenerationToken === undefined
    ? undefined
    : requireString(
        request.expectedGenerationToken,
        "Vault share deliver request expectedGenerationToken",
      );
  if (
    expectedGenerationToken !== undefined
    && !HOSTED_VAULT_SHARE_GENERATION_TOKEN_PATTERN.test(expectedGenerationToken)
  ) {
    throw new TypeError(
      "Vault share deliver request expectedGenerationToken must be a SHA-256 base64url digest.",
    );
  }

  if (records.length > HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS) {
    throw new TypeError(
      `Vault share deliver request records must contain at most ${HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS} records.`,
    );
  }

  const parsedRecords = records.map((record) =>
    parseHostedVaultShareDeliveryRecord(record, projectionScope)
  );
  if (projectionKind === "workouts.v0") {
    let calendarClosedThroughDate: string | undefined;
    for (const record of parsedRecords) {
      if (!("workouts" in record.data)) {
        throw new TypeError("Vault share workouts record data is invalid.");
      }
      if (
        calendarClosedThroughDate !== undefined
        && record.data.calendarClosedThroughDate !== calendarClosedThroughDate
      ) {
        throw new TypeError(
          "Vault share workouts records must use one calendarClosedThroughDate.",
        );
      }
      calendarClosedThroughDate = record.data.calendarClosedThroughDate;
    }
  }

  return {
    ...(expectedGenerationToken ? { expectedGenerationToken } : {}),
    projectionKind,
    projectionScope,
    records: parsedRecords,
  };
}

export function parseHostedVaultShareDeliverResponse(
  value: unknown,
): HostedVaultShareDeliverResponse {
  const record = requireObject(value, "Vault share deliver response");
  const status = requireString(record.status, "Vault share deliver response status");

  if (status !== "delivered" && status !== "no-active-share") {
    throw new TypeError(
      "Vault share deliver response status must be delivered or no-active-share.",
    );
  }

  return { status };
}

export function parseHostedVaultShareActiveProjectionKindsResponse(
  value: unknown,
): HostedVaultShareActiveProjectionKindsResponse {
  const record = requireObject(value, "Vault share active projection kinds response");
  const projectionKinds = record.projectionKinds === undefined
    ? []
    : requireArray(
        record.projectionKinds,
        "Vault share active projection kinds response projectionKinds",
      );
  const uniqueProjectionKinds: HostedVaultShareProjectionKind[] = [];

  for (const projectionKind of projectionKinds) {
    const text = requireString(
      projectionKind,
      "Vault share active projection kind",
    );
    const parsedProjectionKind = parseHostedVaultShareProjectionKind(
      text,
      "Vault share active projection kind",
    );
    if (!uniqueProjectionKinds.includes(parsedProjectionKind)) {
      uniqueProjectionKinds.push(parsedProjectionKind);
    }
  }

  const scopeValues = record.projectionScopes === undefined
    ? uniqueProjectionKinds
    : requireArray(
        record.projectionScopes,
        "Vault share active projection kinds response projectionScopes",
      );
  const uniqueProjectionScopes: HostedVaultShareProjectionScope[] = [];
  const uniqueScopeKeys = new Set<string>();

  for (const scopeValue of scopeValues) {
    const scope = parseHostedVaultShareProjectionScope(
      scopeValue,
      "Vault share active projection scope",
    );
    const scopeKey = buildHostedVaultShareProjectionScopeKey(scope);
    if (uniqueScopeKeys.has(scopeKey)) {
      continue;
    }
    uniqueScopeKeys.add(scopeKey);
    uniqueProjectionScopes.push(scope);
  }

  const generationTokensByProjectionScopeKey =
    record.generationTokensByProjectionScopeKey === undefined
    ? undefined
    : parseHostedVaultShareGenerationTokensByProjectionScopeKey(
        record.generationTokensByProjectionScopeKey,
        uniqueScopeKeys,
      );

  return {
    projectionKinds: uniqueProjectionKinds,
    projectionScopes: uniqueProjectionScopes,
    ...(generationTokensByProjectionScopeKey
      ? { generationTokensByProjectionScopeKey }
      : {}),
  };
}

function parseHostedVaultShareGenerationTokensByProjectionScopeKey(
  value: unknown,
  activeScopeKeys: ReadonlySet<string>,
): Record<string, string> {
  const record = requireObject(
    value,
    "Vault share active projection kinds response generationTokensByProjectionScopeKey",
  );
  const result: Record<string, string> = {};
  for (const [scopeKey, generationToken] of Object.entries(record)) {
    if (!activeScopeKeys.has(scopeKey)) {
      throw new TypeError(
        "Vault share active projection generation tokens contain an inactive scope key.",
      );
    }
    const token = requireString(
      generationToken,
      "Vault share active projection generation token",
    );
    if (!HOSTED_VAULT_SHARE_GENERATION_TOKEN_PATTERN.test(token)) {
      throw new TypeError(
        "Vault share active projection generation token must be a SHA-256 base64url digest.",
      );
    }
    result[scopeKey] = token;
  }
  return result;
}

export function parseHostedVaultShareDeliveryPayload(
  value: unknown,
): HostedVaultShareDeliveryPayload {
  const payload = requireObject(value, "Vault share delivery payload");
  const schema = requireString(payload.schema, "Vault share delivery payload schema");

  if (schema !== HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA) {
    throw new TypeError(
      `Vault share delivery payload schema must be ${HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA}.`,
    );
  }

  const projectionScope = parseHostedVaultShareRequestProjectionScope(
    payload,
    "Vault share delivery payload",
  );
  const projectionKind = projectionScope.projectionKind;

  return {
    grantorMemberId: requireString(
      payload.grantorMemberId,
      "Vault share delivery payload grantorMemberId",
    ),
    projectionKind,
    projectionScope,
    record: parseHostedVaultShareDeliveryRecord(payload.record, projectionScope),
    schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
    shareId: requireString(payload.shareId, "Vault share delivery payload shareId"),
  };
}

export function parseHostedVaultShareRevokePayload(
  value: unknown,
): HostedVaultShareRevokePayload {
  const payload = requireObject(value, "Vault share revoke payload");
  const schema = requireString(payload.schema, "Vault share revoke payload schema");

  if (schema !== HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA) {
    throw new TypeError(
      `Vault share revoke payload schema must be ${HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA}.`,
    );
  }

  const projectionScope = parseHostedVaultShareRequestProjectionScope(
    payload,
    "Vault share revoke payload",
  );

  return {
    grantorMemberId: requireString(
      payload.grantorMemberId,
      "Vault share revoke payload grantorMemberId",
    ),
    projectionKind: projectionScope.projectionKind,
    projectionScope,
    revokedAt: requireIsoTimestamp(
      payload.revokedAt,
      "Vault share revoke payload revokedAt",
    ),
    schema: HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
    shareId: requireString(payload.shareId, "Vault share revoke payload shareId"),
  };
}

function requireRecordKey(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (
    text.length > HOSTED_VAULT_SHARE_RECORD_KEY_MAX_LENGTH
    || text.includes("..")
    || !HOSTED_VAULT_SHARE_RECORD_KEY_PATTERN.test(text)
  ) {
    throw new TypeError(
      `${label} must be at most ${HOSTED_VAULT_SHARE_RECORD_KEY_MAX_LENGTH} path-safe characters (A-Z, a-z, 0-9, '.', '_', '-') without '..'.`,
    );
  }

  return text;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (!isStrictIsoDateTime(text)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return text;
}
