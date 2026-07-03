import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import type { Junction } from "@junction-api/sdk";
import { HistoricalPullCompleted as JunctionHistoricalPullCompletedSchema } from "@junction-api/sdk/serialization";
import type * as JunctionSerialization from "@junction-api/sdk/serialization";
import { canNormalizeJunctionSleepCycleRecordToCompactStages } from "@murphai/importers";
import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  JUNCTION_SLEEP_END_TIMESTAMP_PATHS,
  JUNCTION_SLEEP_STAGE_ARRAY_PATHS,
  JUNCTION_SLEEP_STAGE_COUNT_PATHS,
  JUNCTION_SLEEP_STAGE_DURATION_PATHS,
  JUNCTION_SLEEP_STAGE_VALUE_PATHS,
  JUNCTION_SLEEP_START_TIMESTAMP_PATHS,
  JUNCTION_SLEEP_SUMMARY_NUMBER_PATHS,
  isJunctionRawDirectIdentityContainerKey,
  isJunctionRawDirectIdentityKey,
  normalizeJunctionSleepStageValue,
  normalizeJunctionResourceName,
} from "@murphai/importers/device-providers/junction-resources";
import { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR } from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError, isDeviceSyncError, type DeviceSyncError } from "../errors.ts";
import { sanitizeHostedRuntimeDiagnosticText } from "../hosted-runtime.ts";
import {
  JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS,
  type JunctionHistoricalBackfillStatus,
} from "../junction-historical-backfill-progress.ts";
import { DEVICE_SYNC_METADATA_MAX_STRING_LENGTH } from "../metadata.ts";
import {
  assertValidJunctionClientUserIdSecret,
  normalizeJunctionDeviceSyncRuntimeConfig,
} from "../configured-provider-runtime-descriptors.ts";
import {
  addMilliseconds,
  normalizeString,
  sha256Text,
  subtractDays,
} from "../shared.ts";
import {
  JunctionClient,
  type JunctionClientConfig,
  type JunctionDateQueryFormat,
  type JunctionProviderConnection,
} from "./junction-client.ts";
import {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  normalizeJunctionProviderFilter,
} from "../config/junction-connect-sources.ts";
import type {
  JunctionDeviceSyncProviderConfig,
  JunctionEnvironment,
} from "../config/provider-types.ts";

import type {
  DeviceConnectionSourceStatus,
  DeviceSyncAccount,
  DeviceSyncWebhookExternalAccountDiagnostic,
  DeviceSyncBackfillDiagnosticContext,
  DeviceSyncBackfillDiagnosticResult,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
  DeviceSyncRestDiagnosticContext,
  ProviderBeginConnectionContext,
  ProviderBeginConnectionResult,
  ProviderCompleteConnectionContext,
  ProviderConnectionResult,
  ProviderJobContext,
  ProviderJobResult,
  ProviderScheduleResult,
  ProviderWebhookContext,
  ProviderWebhookResult,
  StoredDeviceSyncAccount,
} from "../types.ts";
import { classifyDeviceSyncWebhookAcceptanceMode } from "../types.ts";

export type { JunctionDeviceSyncProviderConfig } from "../config/provider-types.ts";
export { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR };
export {
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  normalizeJunctionProviderFilter,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
} from "../config/junction-connect-sources.ts";
export type { JunctionConnectSourceTarget } from "../config/junction-connect-sources.ts";

export const JUNCTION_PROVIDER_CONFIG_KEY = "junction";
export {
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
};

interface JunctionTimeseriesImportResult {
  yieldedAt: string | null;
}

type JunctionHistoricalBackfillFollowUp = Pick<ProviderJobResult, "metadataPatch" | "scheduledJobs"> & {
  nextRetryAt?: string;
};

type JunctionResourceCategory = "summary" | "timeseries";

interface JunctionDirectResourceJobInput {
  record: Record<string, unknown>;
  resource: string;
  resourceCategory: "summary";
  sourceProviderSlug: string;
  windowEnd: string;
  windowStart: string;
}

type JunctionSdkHistoricalPullCompleted = Junction.HistoricalPullCompleted;
type JunctionSdkHistoricalSleepCompletionWebhook = Junction.ClientFacingSleepHistoricalPullCompleted;
type JunctionSdkHistoricalSleepCompletionWebhookWire =
  JunctionSerialization.ClientFacingSleepHistoricalPullCompleted.Raw;

const JUNCTION_WEBHOOK_ROOT_FIELDS = Object.freeze({
  eventType: "event_type",
  userId: "user_id",
  clientUserId: "client_user_id",
  data: "data",
} satisfies Record<
  keyof Pick<
    JunctionSdkHistoricalSleepCompletionWebhook,
    "eventType" | "userId" | "clientUserId" | "data"
  >,
  keyof JunctionSdkHistoricalSleepCompletionWebhookWire
>);

interface JunctionWindowFetchOptions {
  dateQueryFormat?: JunctionDateQueryFormat;
}

const JUNCTION_PROFILE_SUMMARY_RESOURCE = "profile";
const JUNCTION_PROFILE_SUMMARY_CHECKED_AT_METADATA_KEY = "junctionProfileSummaryCheckedAt";

// `profile` is deliberately excluded: it is a current-state snapshot, so
// counting it as completion evidence would mark every backfill useful and
// defeat empty-history detection. The provider fetches it through the separate
// one-shot current-state path instead of the windowed summary loop.
const JUNCTION_HISTORICAL_BACKFILL_COMPLETION_SUMMARY_RESOURCES = Object.freeze([
  "activity",
  "sleep",
  "sleep_cycle",
  "workouts",
  "body",
  "meal",
  "menstrual_cycle",
  "electrocardiogram",
] as const);
type JunctionHistoricalBackfillCompletionSummaryResource =
  (typeof JUNCTION_HISTORICAL_BACKFILL_COMPLETION_SUMMARY_RESOURCES)[number];
const JUNCTION_HISTORICAL_BACKFILL_COMPLETION_SUMMARY_RESOURCE_SET = new Set<string>(
  JUNCTION_HISTORICAL_BACKFILL_COMPLETION_SUMMARY_RESOURCES,
);

type JunctionOptionalResourceFailureReason = "not_found" | "unavailable" | "unsupported" | "ambiguous";

interface JunctionOptionalResourceFailure {
  reason: JunctionOptionalResourceFailureReason;
  responseStatus: number;
  responseDetail?: string;
}

interface JunctionSkippedOptionalResource {
  reason: JunctionOptionalResourceFailureReason;
  resource: string;
  resourceCategory: JunctionResourceCategory;
  responseStatus: number;
  responseDetail?: string;
}

const JUNCTION_HISTORICAL_SUMMARY_METRIC_PATHS = Object.freeze({
  activity: [
    "steps",
    "step_count",
    "daily_steps",
    "activeCalories",
    "active_calories",
    "calories",
    "totalCalories",
    "total_calories",
    "distanceKm",
    "distance_km",
    "floors",
    "floorsClimbed",
    "floors_climbed",
    "floorsAscended",
    "floors_ascended",
    "activityScore",
    "activity_score",
    "score",
  ],
  body: [
    "weightKg",
    "weight_kg",
    "weight",
    "bmi",
    "body_mass_index",
    "bodyFatPercentage",
    "body_fat_percentage",
    "body_fat_percent",
    "leanBodyMassKg",
    "lean_body_mass_kg",
    "leanBodyMassKilogram",
    "lean_body_mass_kilogram",
    "leanMassKg",
    "lean_mass_kg",
    "waistCircumference",
    "waist_circumference",
    "waistCircumferenceCentimeter",
    "waist_circumference_centimeter",
    "waistCircumferenceCm",
    "waist_circumference_cm",
  ],
  sleep: JUNCTION_SLEEP_SUMMARY_NUMBER_PATHS,
  sleep_cycle: [],
  workouts: [
    "calories",
    "totalCalories",
    "total_calories",
    "averageHeartRate",
    "average_heart_rate",
    "average_hr",
    "avg_hr",
    "maxHeartRate",
    "max_heart_rate",
    "max_hr",
  ],
  meal: [],
  menstrual_cycle: [],
  electrocardiogram: [],
} satisfies Record<JunctionHistoricalBackfillCompletionSummaryResource, readonly string[]>);
const JUNCTION_RAW_ONLY_COMPLETION_PATHS = Object.freeze({
  meal: {
    strings: [
      "timestamp",
      "recordedAt",
      "recorded_at",
      "loggedAt",
      "logged_at",
      "date",
      "day",
      "calendarDate",
      "calendar_date",
      "name",
      "mealName",
      "meal_name",
      "mealType",
      "meal_type",
      "description",
      "notes",
    ],
    numbers: [
      "calories",
      "caloriesKcal",
      "calories_kcal",
      "energyKcal",
      "energy_kcal",
      "kcal",
      "protein",
      "proteinGrams",
      "protein_grams",
      "protein_g",
      "carbs",
      "carbohydrates",
      "carbohydrateGrams",
      "carbohydrate_grams",
      "carbohydrate_g",
      "fat",
      "fatGrams",
      "fat_grams",
      "fat_g",
      "fiber",
      "fibre",
      "water",
      "macros.water",
      "macros.fibre",
      "macros.fiber",
      "energy.value",
    ],
    arrays: [
      "foods",
      "foodItems",
      "food_items",
      "items",
      "ingredients",
      "nutrients",
    ],
  },
  menstrual_cycle: {
    strings: [
      "timestamp",
      "recordedAt",
      "recorded_at",
      "createdAt",
      "created_at",
      "date",
      "day",
      "cycleStart",
      "cycle_start",
      "cycleEnd",
      "cycle_end",
      "periodStart",
      "period_start",
      "periodEnd",
      "period_end",
      "flow",
      "menstrualFlow",
      "menstrual_flow",
      "cyclePhase",
      "cycle_phase",
      "menstrualPhase",
      "menstrual_phase",
    ],
    numbers: [
      "cycleDay",
      "cycle_day",
      "menstrualCycleDay",
      "menstrual_cycle_day",
      "cycleLengthDays",
      "cycle_length_days",
      "periodLengthDays",
      "period_length_days",
    ],
    arrays: [
      "menstrualFlow",
      "menstrual_flow",
      "symptoms",
      "sexualActivity",
      "sexual_activity",
      // Facet arrays the importer normalizes; a window containing only
      // these must not be classified as an empty backfill.
      "ovulationTest",
      "ovulation_test",
      "homePregnancyTest",
      "home_pregnancy_test",
      "detectedDeviations",
      "detected_deviations",
      "basalBodyTemperature",
      "basal_body_temperature",
    ],
  },
  electrocardiogram: {
    strings: [
      "sessionStart",
      "session_start",
      "classification",
      "inconclusiveCause",
      "inconclusive_cause",
    ],
    numbers: [
      "heartRateMean",
      "heart_rate_mean",
      "voltageSampleCount",
      "voltage_sample_count",
    ],
    arrays: [],
  },
} satisfies Record<"meal" | "menstrual_cycle" | "electrocardiogram", {
  readonly strings: readonly string[];
  readonly numbers: readonly string[];
  readonly arrays: readonly string[];
}>);
const JUNCTION_WEBHOOK_NESTED_RECORD_KEYS = Object.freeze([
  "data",
  "results",
  "items",
  "records",
] as const);
const JUNCTION_WORKOUT_START_TIMESTAMP_PATHS = Object.freeze([
  "startAt",
  "start_at",
  "start",
  "timeStart",
  "time_start",
] as const);
const JUNCTION_WORKOUT_END_TIMESTAMP_PATHS = Object.freeze([
  "endAt",
  "end_at",
  "end",
  "timeEnd",
  "time_end",
] as const);
const JUNCTION_WORKOUT_DURATION_MINUTE_PATHS = Object.freeze([
  "durationMinutes",
  "duration_minutes",
  "movingTimeMinutes",
  "moving_time_minutes",
] as const);
const JUNCTION_WORKOUT_DURATION_SECOND_PATHS = Object.freeze([
  "durationSeconds",
  "duration_seconds",
  "movingTime",
  "moving_time",
  "duration",
] as const);
const JUNCTION_WORKOUT_DURATION_MILLISECOND_PATHS = Object.freeze([
  "durationMillis",
  "duration_millis",
] as const);
const JUNCTION_FLOATING_TIMESTAMP_SOURCE_PROVIDER_SLUGS = new Set([
  "abbott_libreview",
  "freestyle_libre",
]);
const JUNCTION_TIMESERIES_RESOURCE_NAMES = new Set<string>([
  ...JUNCTION_KNOWN_TIMESERIES_RESOURCES,
]);
const JUNCTION_KNOWN_WEBHOOK_RESOURCE_NAMES = new Set<string>([
  ...JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  ...JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  ...JUNCTION_TIMESERIES_RESOURCE_NAMES,
]);
const DEFAULT_SUMMARY_BACKFILL_DAYS = JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync.windows.backfillDays;
const DEFAULT_TIMESERIES_BACKFILL_DAYS = 14;
const DEFAULT_RECONCILE_DAYS = JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync.windows.reconcileDays;
const DEFAULT_RECONCILE_INTERVAL_MS = JUNCTION_DEVICE_PROVIDER_DESCRIPTOR.sync.windows.reconcileIntervalMs;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SETUP_TTL_MS = 30 * 60_000;
const DEFAULT_WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;
const TIMESERIES_CHUNK_MS = 24 * 60 * 60_000;
const JUNCTION_MAX_DIAGNOSTIC_TIMESERIES_PROBE_DAYS = 14;
const JUNCTION_DIAGNOSTIC_SHAPE_KEY_LIMIT = 24;
const JUNCTION_DIAGNOSTIC_RESOURCE_NAME_LIMIT = 64;
const EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS = Object.freeze([
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const);

export function createJunctionDeviceSyncProvider(
  config: JunctionDeviceSyncProviderConfig,
): DeviceSyncProvider {
  const runtimeConfig = normalizeJunctionDeviceSyncRuntimeConfig(config);
  const client = new JunctionClient(toClientConfig(config));
  const { providerFilter, summaryResources, timeseriesResources } = runtimeConfig;
  const summaryBackfillDays = config.summaryBackfillDays ?? DEFAULT_SUMMARY_BACKFILL_DAYS;
  const timeseriesBackfillDays = config.timeseriesBackfillDays ?? DEFAULT_TIMESERIES_BACKFILL_DAYS;
  const reconcileDays = config.reconcileDays ?? DEFAULT_RECONCILE_DAYS;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
  const webhookTimestampToleranceMs =
    config.webhookTimestampToleranceMs ?? DEFAULT_WEBHOOK_TIMESTAMP_TOLERANCE_MS;

  async function beginConnection(
    context: ProviderBeginConnectionContext,
  ): Promise<ProviderBeginConnectionResult> {
    const ownerId = normalizeString(context.ownerId);
    if (!ownerId) {
      throw deviceSyncError({
        code: "JUNCTION_OWNER_ID_REQUIRED",
        message: "Junction Link requires an owner id to derive a stable client_user_id.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const linkProvider = resolveJunctionLinkDirectProvider(
      providerFilter,
      context.sourceProviderSlug,
    );
    const clientUserId = buildJunctionClientUserId(config.clientUserIdSecret, ownerId);
    const user = await client.createOrResolveUser(clientUserId);
    const linkToken = await client.createLinkToken({
      userId: user.userId,
      callbackUrl: buildJunctionRedirectUrl(context.callbackUrl, context.state),
      provider: linkProvider,
      providerFilter: linkProvider ? undefined : providerFilter,
    });

    return {
      authorizationUrl: linkToken.linkWebUrl,
      connectionSeed: {
        externalAccountId: user.userId,
        displayName: "Junction",
        status: "active",
        setupPhase: "pending_link",
        setupExpiresAt: addMilliseconds(context.now, DEFAULT_SETUP_TTL_MS),
        scopes: [],
        credential: {
          kind: "provider_config",
          providerConfigKey: JUNCTION_PROVIDER_CONFIG_KEY,
        },
        nextReconcileAt: null,
      },
    };
  }

  // Mobile SDK (companion app) connection ensure. This mirrors the
  // beginConnection/completeConnection identity discipline exactly: the same
  // secret-derived deterministic client_user_id resolves the same Junction
  // user a prior Junction Link flow created for this owner, so both flows
  // share one device-sync account and SDK webhooks are never orphan-delayed.
  async function ensureSdkConnection(context: {
    ownerId: string;
    now: string;
  }): Promise<ProviderConnectionResult> {
    const ownerId = normalizeString(context.ownerId);
    if (!ownerId) {
      throw deviceSyncError({
        code: "JUNCTION_OWNER_ID_REQUIRED",
        message: "Junction SDK sign-in requires an owner id to derive a stable client_user_id.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const clientUserId = buildJunctionClientUserId(config.clientUserIdSecret, ownerId);
    const user = await client.createOrResolveUser(clientUserId);

    return {
      externalAccountId: user.userId,
      displayName: "Junction",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: JUNCTION_PROVIDER_CONFIG_KEY,
      },
      setupPhase: "source_confirmed",
      initialJobs: buildInitialJobs(context.now),
      nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
    };
  }

  async function createSdkSignInToken(input: {
    externalAccountId: string;
  }): Promise<{ signInToken: string; environment: JunctionEnvironment }> {
    const userId = normalizeString(input.externalAccountId);
    if (!userId) {
      throw deviceSyncError({
        code: "JUNCTION_USER_ID_MISSING",
        message: "Junction sign-in token creation requires a stored Junction user id.",
        retryable: false,
        httpStatus: 409,
      });
    }

    const { signInToken } = await client.createSignInToken(userId);

    // The active environment comes from the validated Junction client config
    // (the API key prefix is asserted against environment/region at
    // construction), so sandbox and production can never mix silently.
    return { signInToken, environment: config.environment };
  }

  async function completeConnection(
    context: ProviderCompleteConnectionContext,
  ): Promise<ProviderConnectionResult> {
    validateJunctionLinkOutcome(context.query);
    const seededExternalAccountId = readSeededJunctionExternalAccountId(context);
    const callbackExternalAccountId = readJunctionCallbackUserId(context.query);
    if (
      seededExternalAccountId &&
      callbackExternalAccountId &&
      seededExternalAccountId !== callbackExternalAccountId
    ) {
      throw deviceSyncError({
        code: "JUNCTION_LINK_USER_MISMATCH",
        message: "Junction Link callback user id did not match the seeded account.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const externalAccountId = seededExternalAccountId ?? callbackExternalAccountId;
    if (!externalAccountId) {
      throw deviceSyncError({
        code: "JUNCTION_LINK_USER_MISSING",
        message: "Junction Link callback did not include a seeded or callback user id.",
        retryable: false,
        httpStatus: 400,
      });
    }

    return {
      externalAccountId,
      displayName: "Junction",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: JUNCTION_PROVIDER_CONFIG_KEY,
      },
      setupPhase: "link_returned",
      initialJobs: buildInitialJobs(context.now),
      nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
    };
  }

  async function revokeAccess(account: DeviceSyncAccount): Promise<void> {
    const userId = normalizeString(account.externalAccountId);
    if (!userId) {
      throw deviceSyncError({
        code: "JUNCTION_USER_ID_MISSING",
        message: "Junction disconnect requires a stored Junction user id.",
        retryable: false,
        httpStatus: 409,
      });
    }

    const providers = await client.listUserProviders(userId);
    const providerSlugs = [
      ...new Set(
        providers
          .filter((provider) => mapJunctionSourceStatus(provider.status) === "connected")
          .map((provider) =>
            normalizeProviderSlug(provider.origin.sourceProviderSlug)
            ?? normalizeProviderSlug(provider.slug)
          )
          .filter((providerSlug): providerSlug is string => providerSlug !== null),
      ),
    ];

    const failedProviderSlugs: string[] = [];
    for (const providerSlug of providerSlugs) {
      try {
        await client.deregisterProvider({
          providerSlug,
          userId,
        });
      } catch {
        failedProviderSlugs.push(providerSlug);
      }
    }

    if (failedProviderSlugs.length > 0) {
      throw deviceSyncError({
        code: "JUNCTION_PROVIDER_DEREGISTER_FAILED",
        message: "Junction provider deregistration failed for one or more connected sources.",
        retryable: true,
        httpStatus: 503,
        details: {
          providerSlugs: failedProviderSlugs,
        },
      });
    }
  }

  function createScheduledJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): ProviderScheduleResult {
    return {
      jobs: [
        buildWindowJob({
          kind: "reconcile",
          now,
          windowStart: subtractDays(now, reconcileDays),
          priority: 40,
        }),
        ...buildDueHistoricalBackfillJobs(account, now),
      ],
      nextReconcileAt: addMilliseconds(now, reconcileIntervalMs),
    };
  }

  // Historical backfill work is derived from durable connection metadata on
  // every scheduled pass, not carried by in-flight job chains: if a backfill
  // job dies (worker crash, provider outage, attempts exhausted), the next
  // pass re-materializes the due work from the recorded state. The exact
  // window dedupe key keeps re-enqueueing idempotent while a job is queued.
  function buildDueHistoricalBackfillJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): DeviceSyncJobInput[] {
    const metadata = account.metadata;
    const status = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status]);
    const connectWindow = buildConnectHistoricalBackfillWindow(account, summaryBackfillDays);
    const metadataWindowStart = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]);
    const metadataWindowEnd = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]);
    const metadataMatchesConnectWindow =
      metadataWindowStart === connectWindow.windowStart
      && metadataWindowEnd === connectWindow.windowEnd;

    if ((status === "complete" || status === "exhausted") && metadataMatchesConnectWindow) {
      return [];
    }

    if (status === "retrying" && metadataMatchesConnectWindow) {
      const emptyAttempts = Math.max(
        1,
        readHistoricalBackfillEmptyAttempts(metadata, connectWindow.windowStart, connectWindow.windowEnd),
      );
      const retryDelayMs = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyAttempts - 1] ?? null;
      if (retryDelayMs === null) {
        return [];
      }
      const lastEmptyAtMs = Date.parse(
        normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt]) ?? "",
      );
      if (Number.isFinite(lastEmptyAtMs) && Date.parse(now) < lastEmptyAtMs + retryDelayMs) {
        return [];
      }
      return [buildExactWindowJob({
        kind: "backfill",
        windowStart: connectWindow.windowStart,
        windowEnd: connectWindow.windowEnd,
        priority: 30,
      })];
    }

    // No recorded outcome: the connect-time historical backfill never ran to
    // completion (or predates this bookkeeping). Re-derive its exact window
    // from the connection's connect time and run it until a terminal status
    // lands; imports are idempotent so a redundant pass is safe.
    return [buildExactWindowJob({
      kind: "backfill",
      windowStart: connectWindow.windowStart,
      windowEnd: connectWindow.windowEnd,
      priority: 30,
    })];
  }

  async function executeJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
  ): Promise<ProviderJobResult> {
    const skippedOptionalResources: JunctionSkippedOptionalResource[] = [];

    if (job.kind === "resource") {
      return executeResourceJob(context, job, skippedOptionalResources);
    }

    const window = resolveJobWindow(job, context.now, job.kind === "backfill" ? summaryBackfillDays : reconcileDays);
    const sourceProviders = await client.listUserProviders(context.account.externalAccountId, {
      signal: context.signal ?? null,
    });
    await projectJunctionSources(context, sourceProviders);

    const isCurrentSummaryReconcile =
      job.kind === "reconcile" && isCurrentScheduledClosedWindow(window, context.now, reconcileDays);
    const summaryWindow = isCurrentSummaryReconcile
      ? resolveCurrentSummaryWindow(context.now, reconcileDays)
      : window;
    const summaryDateQueryFormat: JunctionDateQueryFormat =
      job.kind === "reconcile" && !isCurrentSummaryReconcile && isFullUtcDayWindow(summaryWindow)
        ? "date"
        : "datetime";
    const summaries = await fetchSummarySnapshots(
      context,
      summaryWindow.windowStart,
      summaryWindow.windowEnd,
      skippedOptionalResources,
      { dateQueryFormat: summaryDateQueryFormat },
    );
    const profileSummaryResult = await fetchProfileSummaryOnce(context, skippedOptionalResources);
    const profileMetadataPatch = profileSummaryResult.checked
      ? buildJunctionProfileSummaryCheckedMetadataPatch(context)
      : {};
    if (profileSummaryResult.records.length > 0) {
      summaries[JUNCTION_PROFILE_SUMMARY_RESOURCE] = profileSummaryResult.records;
    }
    const historicalSummaryHasRecords = hasJunctionHistoricalBackfillSummaryRecords(summaries, sourceProviders);
    const summaryHasFetchedRecords = hasJunctionSnapshotRecords(summaries);
    const baseTimeseriesWindowStart = job.kind === "backfill"
      ? maxIsoTimestamp(window.windowStart, subtractDays(window.windowEnd, timeseriesBackfillDays))
      : window.windowStart;
    const timeseriesCursor = job.kind === "backfill"
      ? readBackfillTimeseriesCursor(job, window)
      : null;
    const timeseriesWindowStart = timeseriesCursor
      ? maxIsoTimestamp(baseTimeseriesWindowStart, timeseriesCursor)
      : baseTimeseriesWindowStart;
    if (job.kind !== "backfill" || summaryHasFetchedRecords) {
      await context.importSnapshot({
        provider: "junction",
        accountId: buildJunctionImportAccountId(context.account.externalAccountId),
        connectionId: context.account.id,
        importedAt: summaryWindow.windowEnd,
        windowStart: summaryWindow.windowStart,
        windowEnd: summaryWindow.windowEnd,
        connections: sanitizeJunctionImportConnections(sourceProviders),
        summaries: sanitizeJunctionImportSnapshots(summaries, sourceProviders),
        timeseries: {},
      });
    }
    if (
      job.kind === "backfill"
      || shouldImportClosedTimeseriesForReconcile(context.account.lastSyncCompletedAt, window.windowEnd)
    ) {
      const timeseriesImport = await importTimeseriesDailySnapshots(
        context,
        sourceProviders,
        timeseriesWindowStart,
        window.windowEnd,
        skippedOptionalResources,
      );
      if (timeseriesImport.yieldedAt) {
        return withJunctionSkippedResourceMetadata(
          context,
          withJunctionMetadataPatch(
            buildYieldedJunctionJobResult({
              context,
              job,
              windowEnd: window.windowEnd,
              windowStart: job.kind === "backfill" ? window.windowStart : timeseriesImport.yieldedAt,
              timeseriesCursor: job.kind === "backfill" ? timeseriesImport.yieldedAt : null,
            }),
            profileMetadataPatch,
          ),
          skippedOptionalResources,
        );
      }
    }

    const connectHistoricalWindow = buildConnectHistoricalBackfillWindow(
      context.account,
      summaryBackfillDays,
    );
    const isConnectHistoricalBackfill =
      window.windowStart === connectHistoricalWindow.windowStart
      && window.windowEnd === connectHistoricalWindow.windowEnd;
    const backfillFollowUp = job.kind === "backfill"
      ? isConnectHistoricalBackfill
        ? buildHistoricalBackfillFollowUp({
            hasRecords: historicalSummaryHasRecords,
            metadata: context.account.metadata,
            now: context.now,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
          })
        : buildNonConnectHistoricalBackfillFollowUp({
            hasRecords: historicalSummaryHasRecords,
            job,
            now: context.now,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
          })
      : {};
    const { nextRetryAt, ...backfillFollowUpResult } = backfillFollowUp;
    const nextReconcileAt = nextRetryAt
      ? minIsoTimestamp(addMilliseconds(context.now, reconcileIntervalMs), nextRetryAt)
      : addMilliseconds(context.now, reconcileIntervalMs);

    return withJunctionSkippedResourceMetadata(
      context,
      withJunctionMetadataPatch(
        {
          ...backfillFollowUpResult,
          nextReconcileAt,
        },
        profileMetadataPatch,
      ),
      skippedOptionalResources,
    );
  }

  function readJunctionDirectResourceJobInput(
    job: DeviceSyncJobRecord,
    window: { windowEnd: string; windowStart: string },
  ): JunctionDirectResourceJobInput | null {
    if (job.kind !== "resource") {
      return null;
    }

    const resource = normalizeJunctionResourceName(job.payload.resource);
    if (!resource) {
      return null;
    }

    const resourceCategory = inferJunctionResourceJobCategory(
      normalizeString(job.payload.resourceCategory),
      resource,
    );
    if (!isConfiguredJunctionResource(resourceCategory, resource)) {
      return null;
    }

    if (resourceCategory !== "summary") {
      return null;
    }

    const webhookDataJson = normalizeString(job.payload.webhookDataJson);
    if (!webhookDataJson) {
      return null;
    }
    const record = parseJunctionWebhookDataJobRecord(webhookDataJson);
    if (!record) {
      return null;
    }

    // Provenance check only: a configured summary resource with a parseable
    // inline payload and a single, consistent source provider imports inline.
    // The downstream normalizer decides meaning (as it already does for
    // fetched records); there is no usefulness gate here.
    const sourceProviderSlug = resolveJunctionWebhookDataRecordSourceProviderSlug(record);
    if (!sourceProviderSlug) {
      return null;
    }
    if (
      resource === "sleep_cycle"
      && !hasNormalizableJunctionDirectSleepCycleRecord(record, sourceProviderSlug)
    ) {
      return null;
    }

    return {
      record,
      resource,
      resourceCategory,
      sourceProviderSlug,
      windowEnd: window.windowEnd,
      windowStart: window.windowStart,
    };
  }

  function shouldLoadJunctionDirectResourceSourceProviders(input: JunctionDirectResourceJobInput): boolean {
    return (input.resource === "sleep_cycle" || input.resource === "sleep") &&
      hasJunctionSourceReferenceIdentity(input.record);
  }

  async function diagnoseBackfill(
    context: DeviceSyncBackfillDiagnosticContext,
  ): Promise<DeviceSyncBackfillDiagnosticResult> {
    const window = resolveDiagnosticBackfillWindow(context, summaryBackfillDays);
    const timeseriesProbeDays = normalizeDiagnosticTimeseriesProbeDays(
      context.timeseriesProbeDays,
    );
    const timeseriesProbeWindow = timeseriesProbeDays > 0
      ? {
          windowStart: maxIsoTimestamp(
            window.windowStart,
            subtractDays(window.windowEnd, timeseriesProbeDays),
          ),
          windowEnd: window.windowEnd,
        }
      : null;
    const providerSnapshot = await runJunctionDiagnosticCall(() =>
      client.listUserProviders(context.account.externalAccountId)
    );
    const sourceProviders = (providerSnapshot.records ?? []).filter(isJunctionProviderConnectionRecord);
    const summaries: Record<string, unknown[]> = {};
    const summaryDiagnostics = [];

    for (const resource of summaryResources) {
      const resourceResult = await runJunctionDiagnosticCall(() =>
        client.listSummary({
          resource,
          userId: context.account.externalAccountId,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
        })
      );
      summaries[resource] = resourceResult.records ?? [];
      summaryDiagnostics.push({
        resource,
        ...describeJunctionDiagnosticRecords(resourceResult),
      });
    }

    const timeseriesDiagnostics = [];
    if (timeseriesProbeWindow) {
      for (const resource of timeseriesResources) {
        const resourceResult = await runJunctionDiagnosticCall(() =>
          client.listTimeseries({
            resource,
            userId: context.account.externalAccountId,
            windowStart: timeseriesProbeWindow.windowStart,
            windowEnd: timeseriesProbeWindow.windowEnd,
          })
        );
        timeseriesDiagnostics.push({
          resource,
          ...describeJunctionDiagnosticRecords(resourceResult),
        });
      }
    }

    return {
      generatedAt: context.now,
      provider: "junction",
      result: {
        account: {
          status: context.account.status,
          setupPhase: context.account.setupPhase ?? null,
          historicalBackfill: readJunctionHistoricalBackfillMetadata(context.account.metadata),
        },
        window,
        sourceProviders: describeJunctionDiagnosticSourceProviders(providerSnapshot),
        summary: {
          hasUsefulHistoricalRecords: providerSnapshot.ok
            ? hasJunctionHistoricalBackfillSummaryRecords(summaries, sourceProviders)
            : false,
          resources: summaryDiagnostics,
        },
        timeseriesProbe: {
          days: timeseriesProbeDays,
          window: timeseriesProbeWindow,
          resources: timeseriesDiagnostics,
        },
      },
    };
  }

  async function probeRest(
    context: DeviceSyncRestDiagnosticContext,
  ): Promise<DeviceSyncBackfillDiagnosticResult> {
    const requestedEndpoint = context.endpoint;
    const normalizedResource = normalizeJunctionResourceName(context.resource);
    const endpoint = requestedEndpoint === "auto"
      ? normalizedResource ? inferJunctionResourceCategory(null, normalizedResource) : "providers"
      : requestedEndpoint;

    if (endpoint === "refresh") {
      const timeoutSeconds = normalizeJunctionRefreshDiagnosticTimeout(context.timeoutSeconds);
      const payloadResult = await runJunctionDiagnosticPayloadCall(() =>
        client.refreshUserData({
          timeoutSeconds,
          userId: context.account.externalAccountId,
        })
      );

      return {
        generatedAt: context.now,
        provider: "junction",
        result: {
          request: {
            endpoint: "refresh",
            endpointKind: "junction_user_refresh",
            method: "POST",
            queryParameterNames: timeoutSeconds === null ? [] : ["timeout"],
            timeoutSeconds,
          },
          response: describeJunctionRefreshUserData(payloadResult),
        },
      };
    }

    if (endpoint === "introspect_resources" || endpoint === "historical_pull") {
      const sourceProviderSlug = normalizeProviderSlug(context.sourceProviderSlug);
      const payloadResult = await runJunctionDiagnosticPayloadCall(() =>
        endpoint === "introspect_resources"
          ? client.introspectResources({
              sourceProviderSlug,
              userId: context.account.externalAccountId,
              userLimit: 1,
            })
          : client.introspectHistoricalPull({
              sourceProviderSlug,
              userId: context.account.externalAccountId,
              userLimit: 1,
            })
      );

      return {
        generatedAt: context.now,
        provider: "junction",
        result: {
          request: {
            endpoint,
            endpointKind: endpoint === "introspect_resources"
              ? "junction_introspect_resources"
              : "junction_introspect_historical_pull",
            queryParameterNames: stripUndefined({
              provider: sourceProviderSlug ? true : undefined,
              user_id: true,
              user_limit: true,
            }),
            sourceFiltered: Boolean(sourceProviderSlug),
          },
          response: endpoint === "introspect_resources"
            ? describeJunctionIntrospectionResources(payloadResult, sourceProviderSlug)
            : describeJunctionIntrospectionHistoricalPull(payloadResult, sourceProviderSlug),
        },
      };
    }

    if (endpoint === "devices") {
      const devicesResult = await runJunctionDiagnosticCall(() =>
        client.listUserDevices(context.account.externalAccountId)
      );

      return {
        generatedAt: context.now,
        provider: "junction",
        result: {
          request: {
            endpoint: "devices",
            endpointKind: "junction_user_devices",
          },
          response: describeJunctionDiagnosticDevices(devicesResult),
        },
      };
    }

    if (endpoint === "providers") {
      const providerSnapshot = await runJunctionDiagnosticCall(() =>
        client.listUserProviders(context.account.externalAccountId)
      );

      return {
        generatedAt: context.now,
        provider: "junction",
        result: {
          request: {
            endpoint: "providers",
            endpointKind: "junction_user_providers",
          },
          response: {
            ...describeJunctionDiagnosticSourceProviders(providerSnapshot),
            shape: describeJunctionDiagnosticShape(providerSnapshot.records ?? []),
          },
        },
      };
    }

    if (endpoint === "matrix") {
      return runJunctionRestDiagnosticMatrix({
        account: context.account,
        client,
        now: context.now,
        resource: normalizedResource,
        sourceProviderSlug: context.sourceProviderSlug,
        summaryBackfillDays,
        summaryResources,
        timeseriesResources,
        windowEnd: context.windowEnd,
        windowStart: context.windowStart,
      });
    }

    if (endpoint !== "summary" && endpoint !== "timeseries") {
      throw deviceSyncError({
        code: "JUNCTION_REST_DIAGNOSTIC_ENDPOINT_UNSUPPORTED",
        message: "Junction REST diagnostics support providers, devices, matrix, refresh, introspection, summary, and timeseries probes.",
        httpStatus: 400,
        retryable: false,
      });
    }

    if (!normalizedResource) {
      throw deviceSyncError({
        code: "JUNCTION_REST_DIAGNOSTIC_RESOURCE_REQUIRED",
        message: "Junction REST diagnostics require a resource for summary or timeseries probes.",
        httpStatus: 400,
        retryable: false,
      });
    }

    const window = resolveDiagnosticBackfillWindow(context, summaryBackfillDays);
    const sourceProviderSlug = normalizeProviderSlug(context.sourceProviderSlug);
    const resourceCategory = endpoint;
    const resourceResult = await runJunctionDiagnosticCall(() =>
      resourceCategory === "timeseries"
        ? client.listTimeseries({
            resource: normalizedResource,
            sourceProviderSlug,
            userId: context.account.externalAccountId,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
          })
        : client.listSummary({
            resource: normalizedResource,
            sourceProviderSlug,
            userId: context.account.externalAccountId,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
          })
    );

    return {
      generatedAt: context.now,
      provider: "junction",
      result: {
        request: {
          configuredResource: isConfiguredJunctionResource(resourceCategory, normalizedResource),
          endpoint: resourceCategory,
          endpointKind: resourceCategory === "timeseries"
            ? "junction_timeseries_collection"
            : "junction_summary_collection",
          queryParameterNames: resolveJunctionDiagnosticResourceQueryParameterNames(
            resourceCategory,
            normalizedResource,
            sourceProviderSlug,
          ),
          resource: normalizedResource,
          resourceCategory,
          sourceFiltered: Boolean(sourceProviderSlug),
          window,
        },
        response: describeJunctionDiagnosticRecords(resourceResult),
      },
    };
  }

  async function executeResourceJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
  ): Promise<ProviderJobResult> {
    const window = resolveJobWindow(job, context.now, reconcileDays);
    const resource = normalizeJunctionResourceName(job.payload.resource);
    const resourceCategory = normalizeString(job.payload.resourceCategory);
    const sourceProviderSlug = normalizeProviderSlug(job.payload.sourceProviderSlug);
    let listedSourceProviders: readonly JunctionProviderConnection[] | null = null;
    let projectedSourceProviders: readonly JunctionProviderConnection[] | null = null;
    const loadSourceProviders = async (): Promise<readonly JunctionProviderConnection[]> => {
      if (listedSourceProviders) {
        return listedSourceProviders;
      }

      const sourceProviders = await client.listUserProviders(context.account.externalAccountId, {
        signal: context.signal ?? null,
      });
      listedSourceProviders = sourceProviders;
      return sourceProviders;
    };
    const loadAndProjectSourceProviders = async (): Promise<readonly JunctionProviderConnection[]> => {
      if (projectedSourceProviders) {
        return projectedSourceProviders;
      }
      const sourceProviders = await loadSourceProviders();
      await projectJunctionSources(context, sourceProviders);
      projectedSourceProviders = sourceProviders;
      return sourceProviders;
    };

    const summaries: Record<string, unknown[]> = {};

    if (resource) {
      let effectiveResource = resource;
      let inferredCategory = inferJunctionResourceJobCategory(resourceCategory, resource);
      if (!isConfiguredJunctionResource(inferredCategory, resource)) {
        // Defense in depth for jobs enqueued by an older webhook parser: an
        // enriched payload can hijack the resource name with a value that is
        // not an enabled resource. Fall back to the event-type resource when
        // it resolves to a configured one instead of dropping the job.
        const fallback = resolveConfiguredJunctionEventTypeResource(job);
        if (!fallback) {
          context.logger.warn?.("Skipping Junction resource webhook job for a resource that is not enabled.", {
            provider: "junction",
            resource,
            resourceCategory: inferredCategory,
          });
          skippedOptionalResources.push({
            reason: "unsupported",
            resource: resource.slice(0, JUNCTION_DIAGNOSTIC_RESOURCE_NAME_LIMIT),
            resourceCategory: inferredCategory,
            responseStatus: 0,
          });
          // Degrade to the pull floor instead of completing silently: a webhook
          // we cannot import or fetch (resource not enabled, no event-type
          // fallback) must still leave the connection scheduled for a windowed
          // reconcile so the floor recovers the data. The persisted skip log
          // above stays the louder observability signal; this is the recovery.
          // Emit a day-floored `reconcile` job (NOT a unique-window resource
          // job per webhook) so a burst of such webhooks coalesces on the
          // shared dedupe key to a single floor wake.
          return withJunctionSkippedResourceMetadata(
            context,
            {
              nextReconcileAt: clampWebhookJobNextReconcileAt(context),
              scheduledJobs: [
                buildWindowJob({
                  kind: "reconcile",
                  now: context.now,
                  windowStart: window.windowStart,
                  priority: 50,
                }),
              ],
            },
            skippedOptionalResources,
          );
        }
        context.logger.warn?.("Junction resource webhook job fell back to the event-type resource.", {
          provider: "junction",
          resource,
          resourceCategory: inferredCategory,
          fallbackResource: fallback.name,
          fallbackResourceCategory: fallback.category,
        });
        effectiveResource = fallback.name;
        inferredCategory = fallback.category;
      }

      const directInput = readJunctionDirectResourceJobInput(job, window);
      if (directInput) {
        const sourceProviders = shouldLoadJunctionDirectResourceSourceProviders(directInput)
          ? await loadSourceProviders()
          : [];
        await importJunctionDirectResourceSnapshot(
          context,
          sourceProviders,
          directInput.windowStart,
          directInput.windowEnd,
          directInput.resource,
          [directInput.record],
        );
        return {
          nextReconcileAt: clampWebhookJobNextReconcileAt(context),
        };
      }

      if (inferredCategory === "timeseries") {
        const sourceProviders = await loadAndProjectSourceProviders();
        const timeseriesImport = await importTimeseriesPreciseSnapshots(
          context,
          sourceProviders,
          window.windowStart,
          window.windowEnd,
          skippedOptionalResources,
          [effectiveResource],
          sourceProviderSlug,
        );
        if (timeseriesImport.yieldedAt) {
          return withJunctionSkippedResourceMetadata(
            context,
            buildYieldedJunctionJobResult({
              context,
              job,
              windowEnd: window.windowEnd,
              windowStart: timeseriesImport.yieldedAt,
            }),
            skippedOptionalResources,
          );
        }
        return withJunctionSkippedResourceMetadata(
          context,
          {
            nextReconcileAt: clampWebhookJobNextReconcileAt(context),
          },
          skippedOptionalResources,
        );
      }

      const dateQueryFormat: JunctionDateQueryFormat = isFullUtcDayWindow(window) ? "date" : "datetime";
      summaries[effectiveResource] = await fetchOptionalJunctionResourceRecords(
        context,
        "summary",
        effectiveResource,
        skippedOptionalResources,
        () => client.listSummary({
          dateQueryFormat,
          resource: effectiveResource,
          signal: context.signal ?? null,
          sourceProviderSlug,
          userId: context.account.externalAccountId,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
        }),
      );
    }

    const sourceProviders = await loadAndProjectSourceProviders();
    await context.importSnapshot({
      provider: "junction",
      accountId: buildJunctionImportAccountId(context.account.externalAccountId),
      connectionId: context.account.id,
      importedAt: context.now,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      connections: sanitizeJunctionImportConnections(sourceProviders),
      summaries: sanitizeJunctionImportSnapshots(summaries, sourceProviders),
      timeseries: {},
    });

    return withJunctionSkippedResourceMetadata(
      context,
      {
        nextReconcileAt: clampWebhookJobNextReconcileAt(context),
      },
      skippedOptionalResources,
    );
  }

  function isConfiguredJunctionResource(
    category: "summary" | "timeseries",
    resource: string,
  ): boolean {
    return category === "timeseries"
      ? timeseriesResources.includes(resource)
      : summaryResources.includes(resource);
  }

  function inferJunctionResourceJobCategory(
    resourceCategory: string | null | undefined,
    resource: string,
  ): "summary" | "timeseries" {
    const explicitCategory = resourceCategory?.toLowerCase();
    if (explicitCategory === "summary" || explicitCategory === "timeseries") {
      return explicitCategory;
    }

    return inferJunctionResourceCategory(null, resource);
  }

  function resolveConfiguredJunctionEventTypeResource(
    job: DeviceSyncJobRecord,
  ): { category: "summary" | "timeseries"; name: string } | null {
    const eventType = normalizeString(job.payload.eventType);
    const eventResource = eventType
      ? normalizeJunctionResourceName(readJunctionWebhookResourceFromEventType(eventType))
      : null;
    if (!eventResource) {
      return null;
    }

    const category = inferJunctionResourceJobCategory(null, eventResource);
    return isConfiguredJunctionResource(category, eventResource)
      ? { category, name: eventResource }
      : null;
  }

  // Webhook-driven jobs must never push the scheduled full-resource reconcile
  // further out: with webhooks arriving more often than the reconcile
  // interval, returning `now + interval` from every completion starves the
  // reconcile forever. Keep the earlier of the existing schedule and
  // `now + interval` (the latter also seeds accounts that have no schedule
  // yet).
  function clampWebhookJobNextReconcileAt(context: ProviderJobContext): string {
    const scheduledAt = normalizeString(context.account.nextReconcileAt);
    const latestAt = addMilliseconds(context.now, reconcileIntervalMs);
    return scheduledAt && Date.parse(scheduledAt) <= Date.parse(latestAt)
      ? scheduledAt
      : latestAt;
  }

  async function verifyAndParseWebhook(
    context: ProviderWebhookContext,
  ): Promise<ProviderWebhookResult> {
    const webhookSecret = normalizeString(config.webhookSecret);
    if (!webhookSecret) {
      throw deviceSyncError({
        code: "JUNCTION_WEBHOOK_SECRET_MISSING",
        message: "Junction webhook verification requires JUNCTION_WEBHOOK_SECRET.",
        retryable: false,
        httpStatus: 500,
      });
    }

    const verified = verifyAndParseJunctionWebhookEnvelope({
      headers: context.headers,
      rawBody: context.rawBody,
      secret: webhookSecret,
      now: context.now,
      timestampToleranceMs: webhookTimestampToleranceMs,
    });
    const eventType = requireJunctionWebhookEventType(verified.payload);
    const data = readPlainObject(verified.payload[JUNCTION_WEBHOOK_ROOT_FIELDS.data]);
    const externalAccountSelection = requireJunctionWebhookUserIdSelection(verified.payload, data);
    const resource = inferJunctionWebhookResource(eventType, data);
    const sourceProviderSlug = extractJunctionWebhookSourceProviderSlug(data);
    const objectId = extractJunctionWebhookObjectId(data);
    const occurredAt = extractJunctionWebhookOccurredAt(data) ?? context.now;
    const window = buildJunctionWebhookWindow(data, occurredAt, context.now, resource);
    const webhookDataJsons = buildJunctionWebhookDataJobJsons({
      data,
      eventType,
      externalAccountId: externalAccountSelection.userId,
      resource,
      summaryResources,
      sourceProviderSlug,
    });
    const jobs = buildJunctionWebhookJobs({
      eventType,
      objectId,
      occurredAt,
      resource,
      sourceProviderSlug,
      summaryBackfillDays,
      webhookDataJsons,
      window,
    });

    return {
      acceptanceMode: classifyDeviceSyncWebhookAcceptanceMode(jobs),
      externalAccountId: externalAccountSelection.userId,
      externalAccountDiagnostic: buildJunctionWebhookExternalAccountDiagnostic(externalAccountSelection),
      eventType,
      traceId: verified.messageId,
      occurredAt,
      resourceCategory: resource?.category ?? null,
      jobs,
      unknownAccountAction: "accept",
    };
  }

  async function fetchSummarySnapshots(
    context: ProviderJobContext,
    windowStart: string,
    windowEnd: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    options: JunctionWindowFetchOptions = {},
  ): Promise<Record<string, unknown[]>> {
    const snapshots: Record<string, unknown[]> = {};

    for (const resource of summaryResources) {
      if (isJunctionProfileSummaryResource(resource)) {
        continue;
      }

      snapshots[resource] = await fetchOptionalJunctionResourceRecords(
        context,
        "summary",
        resource,
        skippedOptionalResources,
        () => client.listSummary({
          resource,
          signal: context.signal ?? null,
          userId: context.account.externalAccountId,
          windowStart,
          windowEnd,
          ...(options.dateQueryFormat ? { dateQueryFormat: options.dateQueryFormat } : {}),
        }),
      );
    }

    return snapshots;
  }

  async function fetchProfileSummaryOnce(
    context: ProviderJobContext,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
  ): Promise<{ checked: boolean; records: unknown[] }> {
    if (
      !summaryResources.some(isJunctionProfileSummaryResource)
      || hasCheckedJunctionProfileSummary(context.account.metadata)
    ) {
      return { checked: false, records: [] };
    }

    const records = await fetchOptionalJunctionResourceRecords(
      context,
      "summary",
      JUNCTION_PROFILE_SUMMARY_RESOURCE,
      skippedOptionalResources,
      () => client.listProfileSummary({
        signal: context.signal ?? null,
        userId: context.account.externalAccountId,
      }),
    );

    return { checked: true, records };
  }

  async function fetchTimeseriesSnapshots(
    context: ProviderJobContext,
    windowStart: string,
    windowEnd: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    resources: readonly string[] = timeseriesResources,
    sourceProviderSlug?: string | null,
    options: JunctionWindowFetchOptions = {},
  ): Promise<Record<string, unknown[]>> {
    const snapshots: Record<string, unknown[]> = {};

    for (const resource of resources) {
      snapshots[resource] = await fetchTimeseriesResourceInChunks(
        context,
        resource,
        windowStart,
        windowEnd,
        skippedOptionalResources,
        sourceProviderSlug,
        options,
      );
    }

    return snapshots;
  }

  async function fetchTimeseriesResourceInChunks(
    context: ProviderJobContext,
    resource: string,
    windowStart: string,
    windowEnd: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    sourceProviderSlug?: string | null,
    options: JunctionWindowFetchOptions = {},
  ): Promise<unknown[]> {
    const records: unknown[] = [];
    let chunkStart = Date.parse(windowStart);
    const end = Date.parse(windowEnd);
    let optionalFailureLogged = false;

    while (chunkStart < end) {
      const chunkEnd = Math.min(chunkStart + TIMESERIES_CHUNK_MS, end);
      const chunkWindowStart = new Date(chunkStart).toISOString();
      const chunkWindowEnd = new Date(chunkEnd).toISOString();
      try {
        const chunkRecords = await client.listTimeseries({
          resource,
          signal: context.signal ?? null,
          sourceProviderSlug,
          userId: context.account.externalAccountId,
          windowStart: chunkWindowStart,
          windowEnd: chunkWindowEnd,
          ...(options.dateQueryFormat ? { dateQueryFormat: options.dateQueryFormat } : {}),
        });
        records.push(
          ...filterJunctionTimeseriesRecordsToWindow(
            chunkRecords,
            chunkWindowStart,
            chunkWindowEnd,
          ),
        );
      } catch (error) {
        const failure = classifyOptionalJunctionResourceFailure(
          error,
          "timeseries",
          resource,
          context.account.externalAccountId,
        );
        if (!failure) {
          throw error;
        }

        if (!optionalFailureLogged) {
          logSkippedOptionalJunctionResource(context, "timeseries", resource, failure);
          optionalFailureLogged = true;
        }
        skippedOptionalResources.push({
          ...failure,
          resource,
          resourceCategory: "timeseries",
        });
        break;
      }
      chunkStart = chunkEnd;
    }

    return dedupeJunctionTimeseriesRecords(resource, records);
  }

  async function importTimeseriesPreciseSnapshots(
    context: ProviderJobContext,
    sourceProviders: readonly JunctionProviderConnection[],
    windowStart: string,
    windowEnd: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    resources: readonly string[],
    sourceProviderSlug?: string | null,
  ): Promise<JunctionTimeseriesImportResult> {
    const accumulatedTimeseries: Record<string, unknown[]> = {};
    let executionWindowEnd: string | null = null;
    let executionWindowStart: string | null = null;
    let yieldedAt: string | null = null;

    for (const window of buildPreciseTimeseriesWindows(windowStart, windowEnd)) {
      if (context.shouldYield?.()) {
        yieldedAt = window.windowStart;
        break;
      }

      const skippedResourceCountBeforeFetch = skippedOptionalResources.length;
      const timeseries = await fetchTimeseriesSnapshots(
        context,
        window.windowStart,
        window.windowEnd,
        skippedOptionalResources,
        resources,
        sourceProviderSlug,
        { dateQueryFormat: "datetime" },
      );

      if (skippedOptionalResources.length > skippedResourceCountBeforeFetch) {
        break;
      }

      executionWindowStart ??= window.windowStart;
      executionWindowEnd = window.windowEnd;
      for (const [resource, records] of Object.entries(timeseries)) {
        accumulatedTimeseries[resource] = [
          ...(accumulatedTimeseries[resource] ?? []),
          ...records,
        ];
      }
    }

    const dedupedTimeseries = dedupeJunctionTimeseriesSnapshotRecords(accumulatedTimeseries);
    if (executionWindowStart && executionWindowEnd && hasJunctionSnapshotRecords(dedupedTimeseries)) {
      await context.importSnapshot({
        provider: "junction",
        accountId: buildJunctionImportAccountId(context.account.externalAccountId),
        connectionId: context.account.id,
        importedAt: executionWindowEnd,
        windowStart: executionWindowStart,
        windowEnd: executionWindowEnd,
        connections: sanitizeJunctionImportConnections(sourceProviders),
        summaries: {},
        timeseries: sanitizeJunctionImportSnapshots(dedupedTimeseries, sourceProviders),
      });
    }

    return {
      yieldedAt,
    };
  }

  async function importTimeseriesDailySnapshots(
    context: ProviderJobContext,
    sourceProviders: readonly JunctionProviderConnection[],
    windowStart: string,
    windowEnd: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    resources?: readonly string[],
    sourceProviderSlug?: string | null,
  ): Promise<JunctionTimeseriesImportResult> {
    for (const window of buildClosedDailyWindows(windowStart, windowEnd)) {
      if (context.shouldYield?.()) {
        return {
          yieldedAt: window.windowStart,
        };
      }
      const timeseries = await fetchTimeseriesSnapshots(
        context,
        window.windowStart,
        window.windowEnd,
        skippedOptionalResources,
        resources,
        sourceProviderSlug,
        { dateQueryFormat: "date" },
      );
      if (!hasJunctionSnapshotRecords(timeseries)) {
        continue;
      }

      await context.importSnapshot({
        provider: "junction",
        accountId: buildJunctionImportAccountId(context.account.externalAccountId),
        connectionId: context.account.id,
        importedAt: window.windowEnd,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        connections: sanitizeJunctionImportConnections(sourceProviders),
        summaries: {},
        timeseries: sanitizeJunctionImportSnapshots(timeseries, sourceProviders),
      });
    }
    return {
      yieldedAt: null,
    };
  }

  async function importJunctionDirectResourceSnapshot(
    context: ProviderJobContext,
    sourceProviders: readonly JunctionProviderConnection[],
    windowStart: string,
    windowEnd: string,
    resource: string,
    records: readonly Record<string, unknown>[],
  ): Promise<void> {
    const snapshots: Record<string, unknown[]> = { [resource]: [...records] };

    await context.importSnapshot({
      provider: "junction",
      accountId: buildJunctionImportAccountId(context.account.externalAccountId),
      connectionId: context.account.id,
      importedAt: context.now,
      windowStart,
      windowEnd,
      connections: sanitizeJunctionImportConnections(sourceProviders),
      summaries: sanitizeJunctionImportSnapshots(snapshots, sourceProviders, {
        blockedStringValues: [context.account.externalAccountId],
      }),
      timeseries: {},
    });
  }

  async function fetchOptionalJunctionResourceRecords(
    context: ProviderJobContext,
    resourceCategory: JunctionResourceCategory,
    resource: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    load: () => Promise<unknown[]>,
  ): Promise<unknown[]> {
    try {
      return await load();
    } catch (error) {
      const failure = classifyOptionalJunctionResourceFailure(
        error,
        resourceCategory,
        resource,
        context.account.externalAccountId,
      );
      if (!failure) {
        throw error;
      }

      logSkippedOptionalJunctionResource(context, resourceCategory, resource, failure);
      skippedOptionalResources.push({
        ...failure,
        resource,
        resourceCategory,
      });
      return [];
    }
  }

  function logSkippedOptionalJunctionResource(
    context: ProviderJobContext,
    resourceCategory: JunctionResourceCategory,
    resource: string,
    failure: JunctionOptionalResourceFailure,
  ): void {
    context.logger.warn?.("Skipping unavailable Junction resource response.", {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      reason: failure.reason,
      resource,
      resourceCategory,
      responseStatus: failure.responseStatus,
      ...(failure.responseDetail ? { responseDetail: failure.responseDetail } : {}),
    });
  }

  function buildYieldedJunctionJobResult(input: {
    context: ProviderJobContext;
    job: DeviceSyncJobRecord;
    timeseriesCursor?: string | null;
    windowEnd: string;
    windowStart: string;
  }): ProviderJobResult {
    const followUp = buildYieldedJunctionFollowUpJob(input);
    return {
      ...(followUp ? { scheduledJobs: [followUp] } : {}),
      nextReconcileAt: input.job.kind === "resource"
        ? clampWebhookJobNextReconcileAt(input.context)
        : addMilliseconds(input.context.now, reconcileIntervalMs),
    };
  }

  function buildYieldedJunctionFollowUpJob(input: {
    job: DeviceSyncJobRecord;
    timeseriesCursor?: string | null;
    windowEnd: string;
    windowStart: string;
  }): DeviceSyncJobInput | null {
    if (Date.parse(input.windowStart) >= Date.parse(input.windowEnd)) {
      return null;
    }

    if (input.job.kind === "backfill") {
      const cursor = toIsoTimestampIfValid(input.timeseriesCursor);
      if (!cursor || !isTimestampInHalfOpenWindow(cursor, input)) {
        return null;
      }
      const emptyBackfillAttempts = readNonConnectHistoricalBackfillEmptyAttempts(input.job);
      const followUp = buildExactWindowJob({
        kind: "backfill",
        priority: input.job.priority,
        windowEnd: input.windowEnd,
        windowStart: input.windowStart,
      });
      return {
        ...followUp,
        payload: {
          ...followUp.payload,
          ...(emptyBackfillAttempts > 0 ? { emptyBackfillAttempts } : {}),
          timeseriesCursor: cursor,
        },
      };
    }

    if (input.job.kind === "reconcile") {
      return buildExactWindowJob({
        kind: input.job.kind,
        priority: input.job.priority,
        windowEnd: input.windowEnd,
        windowStart: input.windowStart,
      });
    }

    if (input.job.kind !== "resource") {
      return null;
    }

    const payload: Record<string, unknown> = {
      ...input.job.payload,
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    };
    return {
      kind: "resource",
      payload,
      priority: input.job.priority,
      dedupeKey: sha256Text(JSON.stringify([
        "junction",
        "yield-follow-up",
        input.windowStart,
        input.windowEnd,
        normalizeString(payload.eventType),
        normalizeString(payload.objectId),
        normalizeString(payload.occurredAt),
        normalizeString(payload.resource),
        normalizeString(payload.resourceCategory),
        normalizeString(payload.sourceProviderSlug),
      ])),
    };
  }

  function buildInitialJobs(now: string): DeviceSyncJobInput[] {
    return [
      buildWindowJob({
        kind: "backfill",
        now,
        windowStart: subtractDays(now, summaryBackfillDays),
        priority: 30,
      }),
      buildWindowJob({
        kind: "reconcile",
        now,
        windowStart: subtractDays(now, reconcileDays),
        priority: 40,
      }),
    ];
  }

  return {
    provider: "junction",
    descriptor: JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: JUNCTION_PROVIDER_CONFIG_KEY,
    },
    connectionHandler: {
      beginConnection,
      completeConnection,
      revokeAccess,
    },
    sdkConnectionHandler: {
      ensureConnection: ensureSdkConnection,
      createSignInToken: createSdkSignInToken,
    },
    webhookHandler: {
      verifyAndParseWebhook,
    },
    diagnostics: {
      diagnoseBackfill,
      probeRest,
    },
    jobExecutor: {
      createScheduledJobs,
      executeJob,
    },
  };
}

function withJunctionSkippedResourceMetadata(
  context: ProviderJobContext,
  result: ProviderJobResult,
  skippedOptionalResources: readonly JunctionSkippedOptionalResource[],
): ProviderJobResult {
  if (skippedOptionalResources.length === 0) {
    return result;
  }

  return {
    ...result,
    metadataPatch: {
      ...(result.metadataPatch ?? {}),
      ...buildJunctionSkippedResourceMetadataPatch(context, skippedOptionalResources),
    },
  };
}

function withJunctionMetadataPatch(
  result: ProviderJobResult,
  metadataPatch: Record<string, unknown>,
): ProviderJobResult {
  if (Object.keys(metadataPatch).length === 0) {
    return result;
  }

  return {
    ...result,
    metadataPatch: {
      ...(result.metadataPatch ?? {}),
      ...metadataPatch,
    },
  };
}

function buildJunctionProfileSummaryCheckedMetadataPatch(
  context: ProviderJobContext,
): Record<string, unknown> {
  return {
    [JUNCTION_PROFILE_SUMMARY_CHECKED_AT_METADATA_KEY]: context.now,
  };
}

function buildJunctionSkippedResourceMetadataPatch(
  context: ProviderJobContext,
  skippedOptionalResources: readonly JunctionSkippedOptionalResource[],
): Record<string, unknown> {
  const summaryCount = skippedOptionalResources.filter((entry) => entry.resourceCategory === "summary").length;
  const timeseriesCount = skippedOptionalResources.filter((entry) => entry.resourceCategory === "timeseries").length;
  const last = skippedOptionalResources[skippedOptionalResources.length - 1]!;

  return {
    junctionSkippedResourceTotal:
      readJunctionMetadataCount(context.account.metadata.junctionSkippedResourceTotal) + skippedOptionalResources.length,
    junctionSkippedSummaryTotal:
      readJunctionMetadataCount(context.account.metadata.junctionSkippedSummaryTotal) + summaryCount,
    junctionSkippedTimeseriesTotal:
      readJunctionMetadataCount(context.account.metadata.junctionSkippedTimeseriesTotal) + timeseriesCount,
    junctionSkippedResourceJobCount: skippedOptionalResources.length,
    junctionSkippedResourceLastAt: context.now,
    junctionSkippedResourceLast: [
      last.resourceCategory,
      last.resource,
      last.responseStatus,
      last.reason,
    ].join("."),
    junctionSkippedResourceLastDetail: last.responseDetail ?? null,
  };
}

function readJunctionMetadataCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isJunctionProfileSummaryResource(resource: string): boolean {
  return resource === JUNCTION_PROFILE_SUMMARY_RESOURCE;
}

function hasCheckedJunctionProfileSummary(metadata: Record<string, unknown>): boolean {
  const checkedAt = normalizeString(metadata[JUNCTION_PROFILE_SUMMARY_CHECKED_AT_METADATA_KEY]);
  return checkedAt !== undefined && Number.isFinite(Date.parse(checkedAt));
}

function classifyOptionalJunctionResourceFailure(
  error: unknown,
  resourceCategory: JunctionResourceCategory,
  resource: string,
  accountExternalId: string,
): JunctionOptionalResourceFailure | null {
  if (!isDeviceSyncError(error) || error.code !== "JUNCTION_API_REQUEST_FAILED") {
    return null;
  }

  const status = error.details?.status;
  if (status !== 404 && status !== 422) {
    return null;
  }

  const responseErrorCode = readJunctionDiagnosticString(error.details?.responseErrorCode);
  const responseErrorDescription = readJunctionDiagnosticString(error.details?.responseErrorDescription);
  const reason = classifyClearOptionalJunctionResourceFailureReason({
    responseErrorCode,
    responseErrorDescription,
  });

  if (reason) {
    return {
      reason,
      responseStatus: status,
    };
  }

  if (
    resourceCategory === "summary"
    && isJunctionProfileSummaryResource(resource)
    && status === 404
    && isJunctionProfileSummaryNotFoundResponse({ responseErrorCode, responseErrorDescription })
  ) {
    return {
      reason: "not_found",
      responseStatus: status,
    };
  }

  // Unrecognized 404/422 bodies skip only this optional resource. Keep the
  // provider's own explanation (redacted) so operators can see why it failed
  // without one broken optional endpoint aborting the whole sync job.
  const responseDetail = buildJunctionOptionalResourceResponseDetail({
    accountExternalId,
    responseErrorCode,
    responseErrorDescription,
  });

  return {
    reason: "ambiguous",
    responseStatus: status,
    ...(responseDetail ? { responseDetail } : {}),
  };
}

function buildJunctionOptionalResourceResponseDetail(input: {
  accountExternalId: string;
  responseErrorCode: string | null;
  responseErrorDescription: string | null;
}): string | null {
  // The generic redactor does not know the current Junction user id; strip it
  // explicitly before the shared sanitizer so provider prose that embeds the
  // account id can never reach logs or connection metadata. Case-insensitive
  // because the provider-diagnostics parser lowercases error codes.
  const accountIdPattern = input.accountExternalId
    ? new RegExp(input.accountExternalId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu")
    : null;
  const redactAccountId = (value: string | null): string | null =>
    value === null || accountIdPattern === null
      ? value
      : value.replace(accountIdPattern, "<redacted-account>");
  const code = readJunctionDiagnosticToken(redactAccountId(input.responseErrorCode));
  const description = readJunctionDiagnosticText(redactAccountId(input.responseErrorDescription));
  // Clamp to the stored-metadata string cap so the persisted
  // junctionSkippedResourceLastDetail is truncated instead of silently dropped.
  const detail = [code, description]
    .filter(Boolean)
    .join(": ")
    .slice(0, DEVICE_SYNC_METADATA_MAX_STRING_LENGTH)
    .trimEnd();
  return detail || null;
}

function classifyClearOptionalJunctionResourceFailureReason(input: {
  responseErrorCode: string | null;
  responseErrorDescription: string | null;
}): JunctionOptionalResourceFailureReason | null {
  const rawDescription = input.responseErrorDescription?.trim() ?? "";
  if (rawDescription && hasJunctionRequestShapeFailureTerms(rawDescription)) {
    return null;
  }

  const codeReason = classifyClearOptionalJunctionResourceCode(input.responseErrorCode);
  if (codeReason) {
    return codeReason;
  }

  if (!rawDescription) {
    return null;
  }

  const description = rawDescription.toLowerCase();
  if (/\b(resource|collection|provider|endpoint)\b/u.test(description)) {
    if (/\bnot[\s_-]*found\b/u.test(description)) {
      return "not_found";
    }
    if (/\b(unavailable|not[\s_-]*available)\b/u.test(description)) {
      return "unavailable";
    }
    if (/\b(unsupported|not[\s_-]*supported)\b/u.test(description)) {
      return "unsupported";
    }
  }

  return null;
}

function isJunctionProfileSummaryNotFoundResponse(input: {
  responseErrorCode: string | null;
  responseErrorDescription: string | null;
}): boolean {
  const rawDescription = input.responseErrorDescription?.trim() ?? "";
  if (rawDescription && hasJunctionRequestShapeFailureTerms(rawDescription)) {
    return false;
  }

  const code = input.responseErrorCode?.toLowerCase().replace(/[-\s]+/gu, "_") ?? "";
  return !code || code === "not_found" || code === "profile_not_found";
}

function classifyClearOptionalJunctionResourceCode(value: string | null): JunctionOptionalResourceFailureReason | null {
  const code = value?.toLowerCase().replace(/[-\s]+/gu, "_") ?? "";
  if (!code) {
    return null;
  }

  if (
    code === "collection_not_found"
    || code === "endpoint_not_found"
    || code === "provider_not_found"
    || code === "resource_not_found"
  ) {
    return "not_found";
  }
  if (
    code === "collection_not_available"
    || code === "collection_unavailable"
    || code === "endpoint_not_available"
    || code === "endpoint_unavailable"
    || code === "provider_not_available"
    || code === "provider_unavailable"
    || code === "resource_not_available"
    || code === "resource_unavailable"
  ) {
    return "unavailable";
  }
  if (
    code === "collection_unsupported"
    || code === "endpoint_unsupported"
    || code === "provider_unsupported"
    || code === "resource_unsupported"
    || code === "unsupported_collection"
    || code === "unsupported_endpoint"
    || code === "unsupported_provider"
    || code === "unsupported_resource"
  ) {
    return "unsupported";
  }
  return null;
}

function hasJunctionRequestShapeFailureTerms(value: string): boolean {
  const normalized = value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/gu, " ");
  return /\b(dates?|date window|start date|end date|windows?|filters?|formats?|invalid|parameters?|params?|queries?|requests?|schemas?|fields?|contracts?)\b/u.test(normalized);
}

function readJunctionDiagnosticString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readJunctionDiagnosticText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return sanitizeHostedRuntimeDiagnosticText(value);
}

function readJunctionDiagnosticToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();
  return /^[A-Za-z0-9_.:-]{1,128}$/u.test(token) ? token : null;
}

interface JunctionDiagnosticCallResult {
  ok: boolean;
  records?: unknown[];
  errorDetails?: Record<string, unknown>;
  errorCode?: string;
  responseStatus?: number | null;
  retryable?: boolean;
}

interface JunctionDiagnosticPayloadResult {
  ok: boolean;
  payload?: unknown;
  errorDetails?: Record<string, unknown>;
  errorCode?: string;
  responseStatus?: number | null;
  retryable?: boolean;
}

async function runJunctionDiagnosticCall(
  load: () => Promise<unknown[]>,
): Promise<JunctionDiagnosticCallResult> {
  try {
    return {
      ok: true,
      records: await load(),
      responseStatus: 200,
    };
  } catch (error) {
    if (isDeviceSyncError(error)) {
      return {
        ok: false,
        ...(error.details ? { errorDetails: error.details } : {}),
        errorCode: error.code,
        responseStatus: readJunctionDiagnosticResponseStatus(error),
        retryable: error.retryable,
      };
    }

    return {
      ok: false,
      errorCode: "JUNCTION_DIAGNOSTIC_REQUEST_FAILED",
      responseStatus: null,
      retryable: false,
    };
  }
}

async function runJunctionDiagnosticPayloadCall(
  load: () => Promise<unknown>,
): Promise<JunctionDiagnosticPayloadResult> {
  try {
    return {
      ok: true,
      payload: await load(),
      responseStatus: 200,
    };
  } catch (error) {
    if (isDeviceSyncError(error)) {
      return {
        ok: false,
        ...(error.details ? { errorDetails: error.details } : {}),
        errorCode: error.code,
        responseStatus: readJunctionDiagnosticResponseStatus(error),
        retryable: error.retryable,
      };
    }

    return {
      ok: false,
      errorCode: "JUNCTION_DIAGNOSTIC_REQUEST_FAILED",
      responseStatus: null,
      retryable: false,
    };
  }
}

function readJunctionDiagnosticResponseStatus(error: unknown): number | null {
  if (!isDeviceSyncError(error)) {
    return null;
  }

  const status = error.details?.status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function describeJunctionDiagnosticRecords(
  result: JunctionDiagnosticCallResult,
): Record<string, unknown> {
  if (!result.ok) {
    return {
      ok: false,
      ...(result.errorDetails ? { diagnostics: result.errorDetails } : {}),
      errorCode: result.errorCode ?? "JUNCTION_DIAGNOSTIC_REQUEST_FAILED",
      responseStatus: result.responseStatus ?? null,
      retryable: result.retryable ?? false,
      recordCount: 0,
    };
  }

  const records = result.records ?? [];
  return {
    ok: true,
    responseStatus: result.responseStatus ?? 200,
    recordCount: records.length,
    shape: describeJunctionDiagnosticShape(records),
  };
}

function describeJunctionDiagnosticDevices(
  result: JunctionDiagnosticCallResult,
): Record<string, unknown> {
  if (!result.ok) {
    return {
      ...describeJunctionDiagnosticRecords(result),
      deviceCount: 0,
      devices: [],
    };
  }

  const records = result.records ?? [];
  const sourceKeyMap = buildJunctionDiagnosticSourceKeyMap(
    records.flatMap((record) => {
      const sourceProviderSlug = readJunctionDeviceSourceProviderSlug(record);
      return sourceProviderSlug ? [{ sourceProviderSlug }] : [];
    }),
  );
  const devices = records
    .map((record) => describeJunctionDiagnosticDevice(record, sourceKeyMap))
    .filter((record): record is Record<string, unknown> => record !== null)
    .sort(compareJunctionDiagnosticDeviceEntries);

  return {
    ok: true,
    responseStatus: result.responseStatus ?? 200,
    deviceCount: devices.length,
    sourceCount: sourceKeyMap.size,
    devices,
    shape: describeJunctionDiagnosticShape(records),
  };
}

function describeJunctionDiagnosticDevice(
  value: unknown,
  sourceKeyMap: Map<string, string>,
): Record<string, unknown> | null {
  const record = readPlainObject(value);
  if (!record) {
    return null;
  }

  const sourceProviderSlug = readJunctionDeviceSourceProviderSlug(record);
  return {
    appIdPresent: Boolean(
      normalizeString(record.app_id)
      ?? normalizeString(record.appId)
    ),
    deviceIdPresent: Boolean(
      normalizeString(record.device_id)
      ?? normalizeString(record.deviceId)
    ),
    manufacturerPresent: Boolean(
      normalizeString(record.device_manufacturer)
      ?? normalizeString(record.deviceManufacturer)
    ),
    modelPresent: Boolean(
      normalizeString(record.device_model)
      ?? normalizeString(record.deviceModel)
    ),
    shape: describeJunctionDiagnosticShape([record]),
    sourceKey: sourceProviderSlug
      ? readJunctionDiagnosticSourceKey(sourceKeyMap, sourceProviderSlug)
      : null,
    sourceType:
      normalizeProviderSlug(record.source_type)
      ?? normalizeProviderSlug(record.sourceType)
      ?? null,
    versionPresent: Boolean(
      normalizeString(record.device_version)
      ?? normalizeString(record.deviceVersion)
    ),
  };
}

function readJunctionDeviceSourceProviderSlug(value: unknown): string | null {
  const record = readPlainObject(value);
  if (!record) {
    return null;
  }

  const source = readPlainObject(record.source);
  const provider = readPlainObject(record.provider);
  const origin = resolveJunctionOrigin(record);
  return (
    normalizeProviderSlug(origin.sourceProviderSlug)
    ?? normalizeProviderSlug(record.source_provider_slug)
    ?? normalizeProviderSlug(record.sourceProviderSlug)
    ?? normalizeProviderSlug(record.provider_slug)
    ?? normalizeProviderSlug(record.providerSlug)
    ?? normalizeProviderSlug(record.provider)
    ?? normalizeProviderSlug(source?.provider)
    ?? normalizeProviderSlug(source?.slug)
    ?? normalizeProviderSlug(provider?.slug)
    ?? normalizeProviderSlug(provider?.provider)
    ?? null
  );
}

function compareJunctionDiagnosticDeviceEntries(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftSource = typeof left.sourceKey === "string" ? left.sourceKey : "";
  const rightSource = typeof right.sourceKey === "string" ? right.sourceKey : "";
  const leftType = typeof left.sourceType === "string" ? left.sourceType : "";
  const rightType = typeof right.sourceType === "string" ? right.sourceType : "";

  return leftSource.localeCompare(rightSource) || leftType.localeCompare(rightType);
}

async function runJunctionRestDiagnosticMatrix(input: {
  account: DeviceSyncAccount;
  client: JunctionClient;
  now: string;
  resource: string | null;
  sourceProviderSlug?: string | null;
  summaryBackfillDays: number;
  summaryResources: readonly string[];
  timeseriesResources: readonly string[];
  windowEnd?: string | null;
  windowStart?: string | null;
}): Promise<DeviceSyncBackfillDiagnosticResult> {
  const window = resolveDiagnosticBackfillWindow(
    {
      account: input.account,
      now: input.now,
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    },
    input.summaryBackfillDays,
  );
  const sourceProviderSlug = normalizeProviderSlug(input.sourceProviderSlug);
  const resourceProbes = resolveJunctionDiagnosticMatrixResources({
    resource: input.resource,
    summaryResources: input.summaryResources,
    timeseriesResources: input.timeseriesResources,
  });

  const [
    providers,
    devices,
    resourcesAll,
    historicalPullAll,
    resourcesFiltered,
    historicalPullFiltered,
  ] = await Promise.all([
    runJunctionDiagnosticCall(() => input.client.listUserProviders(input.account.externalAccountId)),
    runJunctionDiagnosticCall(() => input.client.listUserDevices(input.account.externalAccountId)),
    runJunctionDiagnosticPayloadCall(() =>
      input.client.introspectResources({
        userId: input.account.externalAccountId,
        userLimit: 1,
      })
    ),
    runJunctionDiagnosticPayloadCall(() =>
      input.client.introspectHistoricalPull({
        userId: input.account.externalAccountId,
        userLimit: 1,
      })
    ),
    sourceProviderSlug
      ? runJunctionDiagnosticPayloadCall(() =>
          input.client.introspectResources({
            sourceProviderSlug,
            userId: input.account.externalAccountId,
            userLimit: 1,
          })
        )
      : Promise.resolve(null),
    sourceProviderSlug
      ? runJunctionDiagnosticPayloadCall(() =>
          input.client.introspectHistoricalPull({
            sourceProviderSlug,
            userId: input.account.externalAccountId,
            userLimit: 1,
          })
        )
      : Promise.resolve(null),
  ]);
  const reads = [];

  for (const probe of resourceProbes) {
    reads.push(await runJunctionDiagnosticMatrixRead({
      account: input.account,
      category: probe.category,
      configuredResource: probe.configuredResource,
      client: input.client,
      resource: probe.resource,
      sourceProviderSlug: null,
      window,
    }));
    if (sourceProviderSlug) {
      reads.push(await runJunctionDiagnosticMatrixRead({
        account: input.account,
        category: probe.category,
        configuredResource: probe.configuredResource,
        client: input.client,
        resource: probe.resource,
        sourceProviderSlug,
        window,
      }));
    }
  }

  return {
    generatedAt: input.now,
    provider: "junction",
    result: {
      request: {
        endpoint: "matrix",
        endpointKind: "junction_rest_diagnostic_matrix",
        resourceCount: resourceProbes.length,
        resources: resourceProbes.map((probe) => ({
          configuredResource: probe.configuredResource,
          resource: probe.resource,
          resourceCategory: probe.category,
        })),
        sourceFiltered: Boolean(sourceProviderSlug),
        window,
      },
      providers: {
        request: {
          endpoint: "providers",
          endpointKind: "junction_user_providers",
        },
        response: {
          ...describeJunctionDiagnosticSourceProviders(providers),
          shape: describeJunctionDiagnosticShape(providers.records ?? []),
        },
      },
      devices: {
        request: {
          endpoint: "devices",
          endpointKind: "junction_user_devices",
        },
        response: describeJunctionDiagnosticDevices(devices),
      },
      introspection: [
        {
          request: buildJunctionDiagnosticIntrospectionRequest("introspect_resources", false),
          response: describeJunctionIntrospectionResources(resourcesAll, null),
        },
        ...(resourcesFiltered
          ? [{
              request: buildJunctionDiagnosticIntrospectionRequest("introspect_resources", true),
              response: describeJunctionIntrospectionResources(resourcesFiltered, sourceProviderSlug),
            }]
          : []),
      ],
      historicalPull: [
        {
          request: buildJunctionDiagnosticIntrospectionRequest("historical_pull", false),
          response: describeJunctionIntrospectionHistoricalPull(historicalPullAll, null),
        },
        ...(historicalPullFiltered
          ? [{
              request: buildJunctionDiagnosticIntrospectionRequest("historical_pull", true),
              response: describeJunctionIntrospectionHistoricalPull(historicalPullFiltered, sourceProviderSlug),
            }]
          : []),
      ],
      reads,
    },
  };
}

function resolveJunctionDiagnosticMatrixResources(input: {
  resource: string | null;
  summaryResources: readonly string[];
  timeseriesResources: readonly string[];
}): Array<{ category: "summary" | "timeseries"; configuredResource: boolean; resource: string }> {
  if (input.resource) {
    const category = inferJunctionResourceCategory(null, input.resource);
    return [{
      category,
      configuredResource: category === "timeseries"
        ? input.timeseriesResources.includes(input.resource)
        : input.summaryResources.includes(input.resource),
      resource: input.resource,
    }];
  }

  const resources = new Map<string, { category: "summary" | "timeseries"; configuredResource: boolean; resource: string }>();
  for (const resource of input.summaryResources) {
    resources.set(`summary:${resource}`, { category: "summary", configuredResource: true, resource });
  }
  for (const resource of input.timeseriesResources) {
    resources.set(`timeseries:${resource}`, { category: "timeseries", configuredResource: true, resource });
  }

  return [...resources.values()];
}

async function runJunctionDiagnosticMatrixRead(input: {
  account: DeviceSyncAccount;
  category: "summary" | "timeseries";
  configuredResource: boolean;
  client: JunctionClient;
  resource: string;
  sourceProviderSlug: string | null;
  window: { windowStart: string; windowEnd: string };
}): Promise<Record<string, unknown>> {
  const response = await runJunctionDiagnosticCall(() =>
    input.category === "timeseries"
      ? input.client.listTimeseries({
          resource: input.resource,
          sourceProviderSlug: input.sourceProviderSlug,
          userId: input.account.externalAccountId,
          windowStart: input.window.windowStart,
          windowEnd: input.window.windowEnd,
        })
      : input.client.listSummary({
          resource: input.resource,
          sourceProviderSlug: input.sourceProviderSlug,
          userId: input.account.externalAccountId,
          windowStart: input.window.windowStart,
          windowEnd: input.window.windowEnd,
        })
  );

  return {
    request: {
      configuredResource: input.configuredResource,
      endpoint: input.category,
      endpointKind: input.category === "timeseries"
        ? "junction_timeseries_collection"
        : "junction_summary_collection",
      queryParameterNames: resolveJunctionDiagnosticResourceQueryParameterNames(
        input.category,
        input.resource,
        input.sourceProviderSlug,
      ),
      resource: input.resource,
      resourceCategory: input.category,
      sourceFiltered: Boolean(input.sourceProviderSlug),
      window: input.window,
    },
    response: describeJunctionDiagnosticRecords(response),
  };
}

function resolveJunctionDiagnosticResourceQueryParameterNames(
  category: "summary" | "timeseries",
  resource: string,
  sourceProviderSlug: string | null,
): readonly string[] {
  if (category === "summary" && isJunctionProfileSummaryResource(resource)) {
    return sourceProviderSlug ? ["provider"] : [];
  }

  return sourceProviderSlug
    ? ["end_date", "provider", "start_date"]
    : ["end_date", "start_date"];
}

function buildJunctionDiagnosticIntrospectionRequest(
  endpoint: "historical_pull" | "introspect_resources",
  sourceFiltered: boolean,
): Record<string, unknown> {
  return {
    endpoint,
    endpointKind: endpoint === "introspect_resources"
      ? "junction_introspect_resources"
      : "junction_introspect_historical_pull",
    queryParameterNames: stripUndefined({
      provider: sourceFiltered ? true : undefined,
      user_id: true,
      user_limit: true,
    }),
    sourceFiltered,
  };
}

function describeJunctionIntrospectionResources(
  result: JunctionDiagnosticPayloadResult,
  requestedSourceProviderSlug: string | null,
): Record<string, unknown> {
  if (!result.ok) {
    return describeJunctionDiagnosticPayloadFailure(result, "JUNCTION_INTROSPECT_RESOURCES_FAILED");
  }

  const sourceProviders = extractJunctionIntrospectionSourceProviders(
    result.payload,
    requestedSourceProviderSlug,
  );
  const resources = [];
  const sourceKeyMap = buildJunctionDiagnosticSourceKeyMap(sourceProviders);

  for (const sourceProvider of sourceProviders) {
    for (const [resource, rawDetails] of Object.entries(sourceProvider.details)) {
      const details = readPlainObject(rawDetails) ?? {};
      const lastAttempt = readPlainObject(details.last_attempt ?? details.lastAttempt);
      resources.push({
        resource,
        sourceKey: readJunctionDiagnosticSourceKey(sourceKeyMap, sourceProvider.sourceProviderSlug),
        sentCount: readSafeInteger(details.sent_count ?? details.sentCount),
        oldestData: normalizeString(details.oldest_data ?? details.oldestData) ?? null,
        newestData: normalizeString(details.newest_data ?? details.newestData) ?? null,
        lastAttemptStatus: normalizeString(lastAttempt?.status) ?? null,
        lastAttemptAt: normalizeString(lastAttempt?.timestamp) ?? null,
      });
    }
  }

  resources.sort(compareJunctionDiagnosticSourceResourceEntries);

  return {
    ok: true,
    responseStatus: result.responseStatus ?? 200,
    sourceProviderCount: sourceProviders.length,
    resourceCount: resources.length,
    resources,
  };
}

function describeJunctionIntrospectionHistoricalPull(
  result: JunctionDiagnosticPayloadResult,
  requestedSourceProviderSlug: string | null,
): Record<string, unknown> {
  if (!result.ok) {
    return describeJunctionDiagnosticPayloadFailure(result, "JUNCTION_INTROSPECT_HISTORICAL_PULL_FAILED");
  }

  const sourceProviders = extractJunctionIntrospectionSourceProviders(
    result.payload,
    requestedSourceProviderSlug,
  );
  const sourceKeyMap = buildJunctionDiagnosticSourceKeyMap(sourceProviders);
  const pulled = [];
  const notPulled = [];

  for (const sourceProvider of sourceProviders) {
    const notPulledResources = Array.isArray(sourceProvider.details.not_pulled)
      ? sourceProvider.details.not_pulled
          .map(normalizeProviderSlug)
          .filter((entry): entry is string => Boolean(entry))
      : [];
    for (const resource of notPulledResources) {
      notPulled.push({
        resource,
        sourceKey: readJunctionDiagnosticSourceKey(sourceKeyMap, sourceProvider.sourceProviderSlug),
      });
    }

    const pulledByResource = readPlainObject(sourceProvider.details.pulled);
    if (!pulledByResource) {
      continue;
    }

    for (const [resource, rawDetails] of Object.entries(pulledByResource)) {
      const details = readPlainObject(rawDetails) ?? {};
      const timeline = readPlainObject(details.timeline);
      pulled.push({
        resource,
        sourceKey: readJunctionDiagnosticSourceKey(sourceKeyMap, sourceProvider.sourceProviderSlug),
        status: normalizeString(details.status) ?? null,
        daysWithData: readSafeInteger(details.days_with_data ?? details.daysWithData),
        rangeStart: normalizeString(details.range_start ?? details.rangeStart) ?? null,
        rangeEnd: normalizeString(details.range_end ?? details.rangeEnd) ?? null,
        scheduledAt: normalizeString(timeline?.scheduled_at ?? timeline?.scheduledAt) ?? null,
        startedAt: normalizeString(timeline?.started_at ?? timeline?.startedAt) ?? null,
        endedAt: normalizeString(timeline?.ended_at ?? timeline?.endedAt) ?? null,
        hasErrorDetails: Boolean(normalizeString(details.error_details ?? details.errorDetails)),
      });
    }
  }

  pulled.sort(compareJunctionDiagnosticSourceResourceEntries);
  notPulled.sort(compareJunctionDiagnosticSourceResourceEntries);

  return {
    ok: true,
    responseStatus: result.responseStatus ?? 200,
    sourceProviderCount: sourceProviders.length,
    pulledCount: pulled.length,
    notPulledCount: notPulled.length,
    pulled,
    notPulled,
  };
}

function describeJunctionRefreshUserData(
  result: JunctionDiagnosticPayloadResult,
): Record<string, unknown> {
  if (!result.ok) {
    return describeJunctionDiagnosticPayloadFailure(result, "JUNCTION_USER_REFRESH_FAILED");
  }

  const root = readPlainObject(result.payload) ?? {};
  const data = readPlainObject(root.data) ?? root;
  const refreshedSources = readJunctionRefreshSourceList(
    data.refreshed_sources ?? data.refreshedSources ?? data.refreshed,
  );
  const inProgressSources = readJunctionRefreshSourceList(
    data.in_progress_sources ?? data.inProgressSources ?? data.in_progress ?? data.inProgress,
  );
  const failedSources = readJunctionRefreshSourceList(
    data.failed_sources ?? data.failedSources ?? data.failed,
  );
  const sourceKeyMap = buildJunctionRefreshSourceKeyMap([
    ...refreshedSources,
    ...inProgressSources,
    ...failedSources,
  ]);
  const success = typeof data.success === "boolean"
    ? data.success
    : typeof root.success === "boolean" ? root.success : null;

  return {
    ok: true,
    responseStatus: result.responseStatus ?? 200,
    success,
    refreshedSourceCount: refreshedSources.length,
    inProgressSourceCount: inProgressSources.length,
    failedSourceCount: failedSources.length,
    refreshedSources: redactJunctionRefreshSourceNames(refreshedSources, sourceKeyMap),
    inProgressSources: redactJunctionRefreshSourceNames(inProgressSources, sourceKeyMap),
    failedSources: redactJunctionRefreshSourceNames(failedSources, sourceKeyMap),
    shape: describeJunctionDiagnosticShape([data]),
  };
}

function describeJunctionDiagnosticPayloadFailure(
  result: JunctionDiagnosticPayloadResult,
  fallbackErrorCode: string,
): Record<string, unknown> {
  return {
    ok: false,
    ...(result.errorDetails ? { diagnostics: result.errorDetails } : {}),
    errorCode: result.errorCode ?? fallbackErrorCode,
    responseStatus: result.responseStatus ?? null,
    retryable: result.retryable ?? false,
  };
}

function extractJunctionIntrospectionSourceProviders(
  payload: unknown,
  requestedSourceProviderSlug: string | null,
): Array<{ sourceProviderSlug: string; details: Record<string, unknown> }> {
  const root = readPlainObject(payload);
  const data = Array.isArray(root?.data) ? root.data : [];
  const sourceProviders: Array<{ sourceProviderSlug: string; details: Record<string, unknown> }> = [];

  for (const userEntry of data) {
    const providerRoot = readPlainObject(readPlainObject(userEntry)?.provider);
    if (!providerRoot) {
      continue;
    }

    for (const [rawSourceProviderSlug, rawDetails] of Object.entries(providerRoot)) {
      const sourceProviderSlug = normalizeProviderSlug(rawSourceProviderSlug);
      const details = readPlainObject(rawDetails);
      if (
        !sourceProviderSlug
        || !details
        || (requestedSourceProviderSlug && sourceProviderSlug !== requestedSourceProviderSlug)
      ) {
        continue;
      }

      sourceProviders.push({
        sourceProviderSlug,
        details,
      });
    }
  }

  return sourceProviders;
}

function readJunctionRefreshSourceList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const names = entries
    .map(normalizeJunctionRefreshSourceName)
    .filter((entry): entry is string => Boolean(entry));

  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function redactJunctionRefreshSourceNames(
  sourceNames: readonly string[],
  sourceKeyMap: Map<string, string>,
): string[] {
  return sourceNames.map((sourceName) => {
    const [sourceSlug, ...path] = sourceName.split(".");
    const sourceKey = readJunctionDiagnosticSourceKey(sourceKeyMap, sourceSlug ?? "source");
    return path.length > 0 ? `${sourceKey}.${path.join(".")}` : sourceKey;
  });
}

function buildJunctionRefreshSourceKeyMap(sourceNames: readonly string[]): Map<string, string> {
  const sourceSlugs = [...new Set(
    sourceNames.flatMap((sourceName) => {
      const [sourceSlug] = sourceName.split(".");
      const normalized = normalizeProviderSlug(sourceSlug);
      return normalized ? [normalized] : [];
    }),
  )].sort((left, right) => left.localeCompare(right));

  return new Map(sourceSlugs.map((sourceSlug, index) => [
    sourceSlug,
    formatJunctionDiagnosticSourceKey(index),
  ]));
}

function normalizeJunctionRefreshSourceName(value: unknown): string | null {
  const text = normalizeString(value);
  if (text) {
    const normalized = text.toLowerCase();
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
    return /^[a-z0-9._:-]+$/u.test(normalized)
      && !uuidLike.test(normalized)
      && !normalized.startsWith("murph_")
      ? normalized
      : null;
  }

  const record = readPlainObject(value);
  if (!record) {
    return null;
  }

  const sourceProviderSlug =
    normalizeProviderSlug(record.provider)
    ?? normalizeProviderSlug(record.source_provider)
    ?? normalizeProviderSlug(record.sourceProvider)
    ?? normalizeProviderSlug(record.source_provider_slug)
    ?? normalizeProviderSlug(record.sourceProviderSlug);
  const resource =
    normalizeProviderSlug(record.resource)
    ?? normalizeProviderSlug(record.resource_type)
    ?? normalizeProviderSlug(record.resourceType);

  if (!sourceProviderSlug) {
    return null;
  }

  return resource ? `${sourceProviderSlug}.${resource}` : sourceProviderSlug;
}

function normalizeJunctionRefreshDiagnosticTimeout(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 30;
  }

  return Math.max(5, Math.min(60, Math.trunc(value)));
}

function readSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function compareJunctionDiagnosticSourceResourceEntries(
  left: { sourceKey: string; resource: string },
  right: { sourceKey: string; resource: string },
): number {
  return (
    left.sourceKey.localeCompare(right.sourceKey)
    || left.resource.localeCompare(right.resource)
  );
}

function buildJunctionDiagnosticSourceKeyMap(
  sourceProviders: readonly { sourceProviderSlug: string }[],
): Map<string, string> {
  const sourceSlugs = [...new Set(sourceProviders.map((sourceProvider) => sourceProvider.sourceProviderSlug))]
    .sort((left, right) => left.localeCompare(right));

  return new Map(sourceSlugs.map((sourceSlug, index) => [
    sourceSlug,
    formatJunctionDiagnosticSourceKey(index),
  ]));
}

function readJunctionDiagnosticSourceKey(sourceKeyMap: Map<string, string>, sourceSlug: string): string {
  const existing = sourceKeyMap.get(sourceSlug);
  if (existing) {
    return existing;
  }

  const sourceKey = formatJunctionDiagnosticSourceKey(sourceKeyMap.size);
  sourceKeyMap.set(sourceSlug, sourceKey);
  return sourceKey;
}

function formatJunctionDiagnosticSourceKey(index: number): string {
  return `source_${index + 1}`;
}

function describeJunctionDiagnosticShape(records: readonly unknown[]): Record<string, unknown> {
  if (records.length === 0) {
    return {
      kind: "empty",
    };
  }

  const firstRecord = records[0];
  if (Array.isArray(firstRecord)) {
    return {
      kind: "array",
      firstLength: firstRecord.length,
    };
  }

  const record = readPlainObject(firstRecord);
  if (!record) {
    return {
      kind: typeof firstRecord,
    };
  }

  const keys = Object.keys(record)
    .filter(isSafeJunctionDiagnosticShapeKey)
    .sort((left, right) => left.localeCompare(right));

  return {
    kind: "object",
    keyCount: keys.length,
    keys: keys.slice(0, JUNCTION_DIAGNOSTIC_SHAPE_KEY_LIMIT),
  };
}

function isSafeJunctionDiagnosticShapeKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  return Boolean(normalized)
    && !normalized.includes("token")
    && !normalized.includes("secret")
    && !normalized.includes("authorization")
    && !normalized.includes("raw");
}

function describeJunctionDiagnosticSourceProviders(
  result: JunctionDiagnosticCallResult,
): Record<string, unknown> {
  if (!result.ok) {
    return {
      ok: false,
      errorCode: result.errorCode ?? "JUNCTION_PROVIDER_LIST_FAILED",
      responseStatus: result.responseStatus ?? null,
      retryable: result.retryable ?? false,
      providerCount: 0,
    };
  }

  const providers = (result.records ?? []).filter(isJunctionProviderConnectionRecord);
  const slugs = [...new Set(
    providers
      .map((provider) => normalizeProviderSlug(provider.origin.sourceProviderSlug ?? provider.slug))
      .filter((entry): entry is string => Boolean(entry)),
  )].sort((left, right) => left.localeCompare(right));
  const connectedCount = providers.filter((provider) =>
    mapJunctionSourceStatus(provider.status) === "connected"
  ).length;

  return {
    ok: true,
    responseStatus: result.responseStatus ?? 200,
    providerCount: providers.length,
    connectedCount,
    sourceCount: slugs.length,
    sources: slugs.map((slug, index) => ({
      resourceCount: countJunctionDiagnosticAvailableResourcesForSlug(providers, slug),
      resources: listJunctionDiagnosticAvailableResourcesForSlug(providers, slug),
      sourceKey: formatJunctionDiagnosticSourceKey(index),
    })),
  };
}

function isJunctionProviderConnectionRecord(value: unknown): value is JunctionProviderConnection {
  const record = readPlainObject(value);
  if (!record) {
    return false;
  }

  return (record.id === null || typeof record.id === "string")
    && typeof record.slug === "string"
    && typeof record.status === "string"
    && readPlainObject(record.origin) !== null
    && readPlainObject(record.resourceAvailability) !== null;
}

function countJunctionDiagnosticAvailableResourcesForSlug(
  providers: readonly JunctionProviderConnection[],
  slug: string,
): number {
  return listJunctionDiagnosticAvailableResourcesForSlug(providers, slug).length;
}

function listJunctionDiagnosticAvailableResourcesForSlug(
  providers: readonly JunctionProviderConnection[],
  slug: string,
): string[] {
  const resourceNames = new Set<string>();

  for (const provider of providers) {
    const providerSlug = normalizeProviderSlug(provider.origin.sourceProviderSlug ?? provider.slug);
    if (providerSlug !== slug) {
      continue;
    }

    for (const [key, value] of Object.entries(provider.resourceAvailability)) {
      if (normalizeProviderSlug(key) && value !== false && value !== null && value !== undefined) {
        resourceNames.add(key);
      }
    }
  }

  return [...resourceNames]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, JUNCTION_DIAGNOSTIC_RESOURCE_NAME_LIMIT);
}

function readJunctionHistoricalBackfillMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return {
    status: normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status]) ?? null,
    emptyAttempts: typeof metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts] === "number"
      ? metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts]
      : null,
    lastEmptyAt: normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt]) ?? null,
    windowStart: normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]) ?? null,
    windowEnd: normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]) ?? null,
  };
}

function resolveDiagnosticBackfillWindow(
  context: DeviceSyncBackfillDiagnosticContext,
  summaryBackfillDays: number,
): { windowStart: string; windowEnd: string } {
  const metadataWindowStart = normalizeString(
    context.account.metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart],
  );
  const metadataWindowEnd = normalizeString(
    context.account.metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd],
  );
  const requestedWindowEnd =
    parseJunctionDiagnosticRequestedTimestamp(context.windowEnd, "windowEnd")
    ?? parseJunctionDiagnosticStoredTimestamp(metadataWindowEnd);
  const fallbackWindowEnd =
    parseJunctionDiagnosticStoredTimestamp(context.now)
    ?? new Date().toISOString();
  const windowEnd = requestedWindowEnd ?? floorUtcDayTimestamp(fallbackWindowEnd);
  const earliestWindowStart = subtractDays(windowEnd, summaryBackfillDays);
  const requestedWindowStart = parseJunctionDiagnosticRequestedTimestamp(
    context.windowStart,
    "windowStart",
  )
    ?? parseJunctionDiagnosticStoredTimestamp(metadataWindowStart);
  const boundedWindowStart = maxIsoTimestamp(requestedWindowStart ?? earliestWindowStart, earliestWindowStart);

  return {
    windowStart: Date.parse(boundedWindowStart) > Date.parse(windowEnd) ? windowEnd : boundedWindowStart,
    windowEnd,
  };
}

function parseJunctionDiagnosticRequestedTimestamp(
  value: string | null | undefined,
  field: "windowEnd" | "windowStart",
): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const timestamp = parseJunctionDiagnosticTimestamp(normalized);
  if (timestamp) {
    return timestamp;
  }

  throw deviceSyncError({
    code: "JUNCTION_DIAGNOSTIC_WINDOW_INVALID",
    message: `Junction diagnostic ${field} must be a valid ISO timestamp.`,
    httpStatus: 400,
    retryable: false,
  });
}

function parseJunctionDiagnosticStoredTimestamp(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  return normalized ? parseJunctionDiagnosticTimestamp(normalized) : null;
}

function parseJunctionDiagnosticTimestamp(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeDiagnosticTimeseriesProbeDays(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }

  if (!Number.isInteger(value) || value < 0) {
    return 1;
  }

  return Math.min(value, JUNCTION_MAX_DIAGNOSTIC_TIMESERIES_PROBE_DAYS);
}

export function buildJunctionClientUserId(secret: string, ownerId: string): string {
  const normalizedSecret = assertValidJunctionClientUserIdSecret(secret);
  const digest = createHmac("sha256", normalizedSecret).update(ownerId).digest();
  return `murph_${base32UrlEncode(digest)}`.slice(0, 32);
}

function resolveJunctionLinkDirectProvider(
  providerFilter: string[],
  sourceProviderSlug: string | null | undefined,
): string | null {
  const requested = normalizeString(sourceProviderSlug);
  if (!requested) {
    return null;
  }

  const normalizedSource = normalizeProviderSlug(requested);
  if (!normalizedSource || !providerFilter.includes(normalizedSource)) {
    throw deviceSyncError({
      code: "JUNCTION_SOURCE_PROVIDER_NOT_CONFIGURED",
      message: "Junction source provider is not enabled for this connection target.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return normalizedSource;
}

function toClientConfig(config: JunctionDeviceSyncProviderConfig): JunctionClientConfig {
  return {
    apiKey: config.apiKey,
    environment: config.environment,
    region: config.region,
    allowedLinkHosts: config.allowedLinkHosts,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImpl: config.fetchImpl,
  };
}

function normalizeProviderSlug(value: unknown): string | null {
  const normalized = normalizeString(value)?.toLowerCase().replace(/[^a-z0-9_]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || null;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function sanitizeJunctionImportConnections(
  providers: readonly JunctionProviderConnection[],
): Array<Record<string, unknown>> {
  return providers.map((provider) => stripUndefined({
    sourceProviderSlug: provider.origin.sourceProviderSlug ?? provider.slug,
    sourceInstanceId: provider.origin.sourceInstanceId,
  }));
}

function sanitizeJunctionImportSnapshots(
  snapshots: Record<string, unknown[]>,
  providers: readonly JunctionProviderConnection[],
  options: JunctionImportSnapshotSanitizeOptions = {},
): Record<string, unknown[]> {
  const sourceReferences = buildJunctionSourceReferenceMap(providers);

  return Object.fromEntries(
    Object.entries(snapshots).map(([resource, records]) => [
      resource,
      records.map((record) => sanitizeJunctionImportSnapshotValue(record, sourceReferences, options)),
    ]),
  );
}

function buildJunctionSourceReferenceMap(
  providers: readonly JunctionProviderConnection[],
): ReadonlyMap<string, Record<string, unknown>> {
  const references = new Map<string, Record<string, unknown>>();

  for (const provider of providers) {
    const sourceProviderSlug = provider.origin.sourceProviderSlug ?? provider.slug;
    const reference = stripUndefined({
      sourceProviderSlug,
      sourceInstanceId: provider.origin.sourceInstanceId,
    });

    for (const rawKey of [
      provider.id,
      provider.origin.sourceInstanceId,
    ]) {
      const key = normalizeString(rawKey);
      if (key) {
        references.set(key, reference);
      }
    }
  }

  return references;
}

interface JunctionImportSnapshotSanitizeOptions {
  blockedStringValues?: readonly string[];
  preserveSourceReferenceKeys?: boolean;
}

function sanitizeJunctionImportSnapshotValue(
  value: unknown,
  sourceReferences: ReadonlyMap<string, Record<string, unknown>>,
  options: JunctionImportSnapshotSanitizeOptions = {},
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJunctionImportSnapshotValue(entry, sourceReferences, options));
  }

  if (typeof value === "string") {
    return redactJunctionBlockedStringValue(value, options.blockedStringValues ?? []);
  }

  const record = readPlainObject(value);
  if (!record) {
    return value;
  }

  const fallback = readJunctionSourceReference(record, sourceReferences);
  const origin = resolveJunctionOrigin(record, fallback);
  const sanitized = stripJunctionRawSourceIdentityFields(record, sourceReferences, options);
  const fallbackSourceInstanceId = normalizeString(fallback.sourceInstanceId);
  const unresolvedPreservedSourceReference =
    options.preserveSourceReferenceKeys === true &&
    !fallbackSourceInstanceId &&
    hasJunctionSourceReferenceIdentity(record);
  const sourceInstanceId = fallbackSourceInstanceId ??
    (unresolvedPreservedSourceReference ? undefined : origin.sourceInstanceId);

  return stripUndefined({
    ...sanitized,
    sourceProviderSlug: normalizeProviderSlug(origin.sourceProviderSlug) ?? sanitized.sourceProviderSlug,
    sourceType: origin.sourceType ?? sanitized.sourceType,
    sourceInstanceId: sourceInstanceId ?? sanitized.sourceInstanceId,
  });
}

function readJunctionSourceReference(
  record: Record<string, unknown>,
  sourceReferences: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  for (const key of [
    normalizeString(record.connectionId),
    normalizeString(record.connection_id),
    normalizeString(record.providerConnectionId),
    normalizeString(record.provider_connection_id),
    normalizeString(record.sourceId),
    normalizeString(record.source_id),
    normalizeString(record.sourceInstanceId),
    normalizeString(record.source_instance_id),
  ]) {
    const reference = key ? sourceReferences.get(key) : undefined;
    if (reference) {
      return reference;
    }
  }

  return {};
}

function stripJunctionRawSourceIdentityFields(
  record: Record<string, unknown>,
  sourceReferences: ReadonlyMap<string, Record<string, unknown>>,
  options: JunctionImportSnapshotSanitizeOptions,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (
      (
        isBlockedJunctionImportSourceIdentityKey(key)
        && !(options.preserveSourceReferenceKeys && isJunctionSourceReferenceIdentityKey(key))
      )
      || isBlockedJunctionImportSourceIdentityContainerKey(key)
    ) {
      continue;
    }

    sanitized[key] = sanitizeJunctionImportSnapshotValue(value, sourceReferences, options);
  }

  return sanitized;
}

function redactJunctionBlockedStringValue(
  value: string,
  blockedValues: readonly string[],
): string {
  let redacted = value;

  for (const rawBlockedValue of blockedValues) {
    const blockedValue = normalizeString(rawBlockedValue);
    if (!blockedValue || blockedValue.length < 4) {
      continue;
    }
    redacted = redacted.split(blockedValue).join("[redacted]");
  }

  return redacted;
}

function normalizeJunctionImportSourceIdentityKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function isBlockedJunctionImportSourceIdentityKey(key: string): boolean {
  const normalized = normalizeJunctionImportSourceIdentityKey(key);

  return isJunctionRawDirectIdentityKey(key)
    || normalized.includes("connectionid")
    || normalized.includes("providerconnectionid")
    || normalized.includes("sourceid")
    || normalized.includes("sourceinstanceid")
    || normalized.includes("sourcedeviceid")
    || normalized.includes("sourceappid")
    || normalized.includes("deviceid")
    || normalized.includes("appid")
    || normalized.includes("userid")
    || normalized.includes("accountid")
    || normalized.includes("clientuserid")
    || normalized.includes("ownerid")
    || normalized.includes("sourcename")
    || normalized.includes("providername")
    || normalized.includes("devicename")
    || normalized.includes("appname");
}

function isJunctionSourceReferenceIdentityKey(key: string): boolean {
  const normalized = normalizeJunctionImportSourceIdentityKey(key);
  return normalized === "connectionid"
    || normalized === "providerconnectionid"
    || normalized === "sourceid";
}

function hasJunctionSourceReferenceIdentity(
  value: unknown,
  seen: Set<Record<string, unknown>> = new Set(),
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasJunctionSourceReferenceIdentity(entry, seen));
  }

  const record = readPlainObject(value);
  if (!record || seen.has(record)) {
    return false;
  }
  seen.add(record);

  return Object.entries(record).some(([key, nested]) =>
    (isJunctionSourceReferenceIdentityKey(key) && normalizeString(nested) !== undefined) ||
    hasJunctionSourceReferenceIdentity(nested, seen)
  );
}

function isBlockedJunctionImportSourceIdentityContainerKey(key: string): boolean {
  const normalized = normalizeJunctionImportSourceIdentityKey(key);

  return isJunctionRawDirectIdentityContainerKey(key)
    || normalized === "source"
    || normalized === "provider"
    || normalized === "device"
    || normalized === "app"
    || normalized === "account"
    || normalized === "user"
    || normalized === "client"
    || normalized === "owner";
}

function dedupeJunctionTimeseriesRecords(resource: string, records: unknown[]): unknown[] {
  const seen = new Set<string>();
  const deduped: unknown[] = [];

  for (const record of records) {
    const key = buildJunctionTimeseriesRecordKey(resource, record);
    if (key && seen.has(key)) {
      continue;
    }

    if (key) {
      seen.add(key);
    }
    deduped.push(record);
  }

  return deduped;
}

function dedupeJunctionTimeseriesSnapshotRecords(
  snapshot: Record<string, unknown[]>,
): Record<string, unknown[]> {
  const deduped: Record<string, unknown[]> = {};
  for (const [resource, records] of Object.entries(snapshot)) {
    deduped[resource] = dedupeJunctionTimeseriesRecords(resource, records);
  }
  return deduped;
}

function filterJunctionTimeseriesRecordsToWindow(
  records: readonly unknown[],
  windowStart: string,
  windowEnd: string,
): unknown[] {
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return [...records];
  }

  return records.filter((record) => {
    const entry = readPlainObject(record);
    if (!entry) {
      return true;
    }
    const timestamp = resolveJunctionTimeseriesRecordTimestamp(entry);
    if (!timestamp) {
      return true;
    }
    const recordedMs = Date.parse(timestamp);
    if (!Number.isFinite(recordedMs)) {
      return true;
    }
    return recordedMs >= startMs && recordedMs < endMs;
  });
}

function buildJunctionTimeseriesRecordKey(resource: string, record: unknown): string | null {
  const entry = readPlainObject(record);
  if (!entry) {
    return null;
  }

  const origin = resolveJunctionOrigin(entry);
  const sourceProviderSlug = normalizeProviderSlug(origin.sourceProviderSlug);
  const timestamp = resolveJunctionTimeseriesRecordTimestamp(entry);
  if (!sourceProviderSlug || !timestamp) {
    return null;
  }

  return JSON.stringify([
    "junction-timeseries",
    resource,
    sourceProviderSlug,
    normalizeString(origin.sourceType) ?? "",
    normalizeString(origin.sourceInstanceId) ?? "",
    timestamp,
    ...junctionTimeseriesRecordValueIdentity(resource, entry),
  ]);
}

// Blood-pressure readings carry their paired values as part of identity
// (the importer keeps distinct same-second readings as distinct events), so
// the pre-import dedupe key must not collapse same-timestamp rows whose
// values differ. A stable provider row id wins when present.
function junctionTimeseriesRecordValueIdentity(
  resource: string,
  entry: Record<string, unknown>,
): string[] {
  if (resource !== "blood_pressure") {
    return [];
  }

  // Same stable-id alias list as the importer's reading identity: rows
  // distinguished only by a provider id must survive fetch-side dedupe.
  for (const key of ["id", "resourceId", "resource_id", "externalId", "external_id"]) {
    const rowId = normalizeString(entry[key]);
    if (rowId) {
      return [rowId];
    }
  }

  // Field names mirror the importer's blood-pressure value paths.
  return [String(entry.systolic ?? ""), String(entry.diastolic ?? "")];
}

function resolveJunctionTimeseriesRecordTimestamp(record: Record<string, unknown>): string | null {
  for (const key of [
    "observedAt",
    "observed_at",
    "observed_at_utc",
    "timestamp",
    "time",
    "date",
    "day",
    "end",
    "endAt",
    "end_at",
    "start",
    "startAt",
    "start_at",
  ]) {
    const normalized = normalizeString(record[key]);
    if (!normalized) {
      continue;
    }

    return toIsoTimestampIfValid(normalized) ?? normalized;
  }

  return null;
}

function buildJunctionRedirectUrl(callbackUrl: string, state: string): string {
  const url = new URL(callbackUrl);
  url.searchParams.set("murph_state", state);
  return url.toString();
}

function validateJunctionLinkOutcome(query: URLSearchParams): void {
  if (normalizeString(query.get("error")) ?? normalizeString(query.get("error_description"))) {
    throw junctionLinkFailedError("Junction Link callback reported a failed link outcome.", query);
  }

  const status = normalizeString(query.get("status"))?.toLowerCase();
  const linkState = normalizeString(query.get("state"))?.toLowerCase();
  if (
    (status && ["cancelled", "canceled", "error", "failed"].includes(status))
    || (linkState && ["cancelled", "canceled", "error", "failed"].includes(linkState))
  ) {
    throw junctionLinkFailedError("Junction Link callback reported a failed link state.", query);
  }

  const success = normalizeString(query.get("success"))?.toLowerCase();
  if (success && !["1", "true", "yes"].includes(success)) {
    throw junctionLinkFailedError("Junction Link callback did not report a successful link outcome.", query);
  }
}

// Junction reports why a hosted Link attempt failed only through these
// callback query params. Fold them into one sanitized reason inside the error
// message so the persisted `last_error_message` and hosted logs carry the
// cause. The diagnostic helper fails closed: it redacts secrets, identifiers,
// and URLs, and drops a value entirely when it still looks unsafe.
function junctionLinkFailedError(message: string, query: URLSearchParams): DeviceSyncError {
  const reason = ["error", "error_type", "error_description", "status", "state", "success"]
    .map((name) => {
      const value = sanitizeHostedRuntimeDiagnosticText(normalizeString(query.get(name)) ?? null);
      return value ? `${name}=${value}` : null;
    })
    .filter((part) => part !== null)
    .join(", ");

  return deviceSyncError({
    code: "JUNCTION_LINK_FAILED",
    message: reason ? `${message} (${reason})` : message,
    retryable: false,
    httpStatus: 400,
  });
}

function readJunctionCallbackUserId(query: URLSearchParams): string | null {
  return (
    normalizeString(query.get("user_id"))
    ?? normalizeString(query.get("userId"))
    ?? normalizeString(query.get("vital_user_id"))
    ?? normalizeString(query.get("external_account_id"))
    ?? null
  );
}

function readSeededJunctionExternalAccountId(context: ProviderCompleteConnectionContext): string | null {
  const seededExternalAccountId = normalizeString(context.seededExternalAccountId);
  if (seededExternalAccountId) {
    return seededExternalAccountId;
  }

  return (
    normalizeString(context.stateMetadata?.seededExternalAccountId)
    ?? normalizeString(context.stateMetadata?.externalAccountId)
    ?? null
  );
}

function resolveJobWindow(
  job: DeviceSyncJobRecord,
  now: string,
  fallbackDays: number,
): { windowStart: string; windowEnd: string } {
  const explicitWindowEnd = normalizeString(job.payload.windowEnd);
  const windowEnd = explicitWindowEnd
    ? new Date(explicitWindowEnd).toISOString()
    : new Date(now).toISOString();
  const earliestWindowStart = subtractDays(windowEnd, fallbackDays);
  const explicitWindowStart = normalizeString(job.payload.windowStart);
  const windowStart = explicitWindowStart
    ? new Date(explicitWindowStart).toISOString()
    : earliestWindowStart;

  return {
    windowStart: Date.parse(windowStart) > Date.parse(windowEnd) ? windowEnd : windowStart,
    windowEnd,
  };
}

function readBackfillTimeseriesCursor(
  job: DeviceSyncJobRecord,
  ownerWindow: { windowStart: string; windowEnd: string },
): string | null {
  const cursor = toIsoTimestampIfValid(job.payload.timeseriesCursor);
  return cursor && isTimestampInHalfOpenWindow(cursor, ownerWindow)
    ? cursor
    : null;
}

function isTimestampInHalfOpenWindow(
  timestamp: string,
  window: { windowStart: string; windowEnd: string },
): boolean {
  const timestampMs = Date.parse(timestamp);
  const windowStartMs = Date.parse(window.windowStart);
  const windowEndMs = Date.parse(window.windowEnd);
  return Number.isFinite(timestampMs)
    && Number.isFinite(windowStartMs)
    && Number.isFinite(windowEndMs)
    && timestampMs >= windowStartMs
    && timestampMs < windowEndMs;
}

function resolveCurrentSummaryWindow(
  now: string,
  fallbackDays: number,
): { windowStart: string; windowEnd: string } {
  const windowEnd = new Date(now).toISOString();
  return {
    windowStart: subtractDays(windowEnd, fallbackDays),
    windowEnd,
  };
}

function isCurrentScheduledClosedWindow(
  window: { windowStart: string; windowEnd: string },
  now: string,
  fallbackDays: number,
): boolean {
  const expectedWindowEnd = floorUtcDayTimestamp(now);
  const expectedWindowStart = floorUtcDayTimestamp(subtractDays(expectedWindowEnd, fallbackDays));
  return window.windowStart === expectedWindowStart && window.windowEnd === expectedWindowEnd;
}

function isFullUtcDayWindow(window: { windowStart: string; windowEnd: string }): boolean {
  return Date.parse(window.windowStart) < Date.parse(window.windowEnd)
    && window.windowStart === floorUtcDayTimestamp(window.windowStart)
    && window.windowEnd === floorUtcDayTimestamp(window.windowEnd);
}

function shouldImportClosedTimeseriesForReconcile(
  lastSyncCompletedAt: string | null | undefined,
  windowEnd: string,
): boolean {
  if (!lastSyncCompletedAt) {
    return true;
  }
  const lastCompletedClosedDayMs = Date.parse(floorUtcDayTimestamp(lastSyncCompletedAt));
  const windowEndMs = Date.parse(windowEnd);
  return !Number.isFinite(lastCompletedClosedDayMs)
    || !Number.isFinite(windowEndMs)
    || lastCompletedClosedDayMs < windowEndMs;
}

function buildClosedDailyWindows(
  windowStart: string,
  windowEnd: string,
): Array<{ windowStart: string; windowEnd: string }> {
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return [];
  }

  const closedEndMs = Date.parse(floorUtcDayTimestamp(windowEnd));
  const flooredStartMs = Date.parse(floorUtcDayTimestamp(windowStart));
  if (flooredStartMs >= closedEndMs) {
    return [];
  }

  const windows: Array<{ windowStart: string; windowEnd: string }> = [];
  let chunkStartMs = flooredStartMs;
  while (chunkStartMs < closedEndMs) {
    const nextDayMs = Date.parse(
      addMilliseconds(
        floorUtcDayTimestamp(new Date(chunkStartMs).toISOString()),
        TIMESERIES_CHUNK_MS,
      ),
    );
    const chunkEndMs = Math.min(nextDayMs, closedEndMs);
    if (chunkEndMs <= chunkStartMs) {
      break;
    }
    windows.push({
      windowStart: new Date(chunkStartMs).toISOString(),
      windowEnd: new Date(chunkEndMs).toISOString(),
    });
    chunkStartMs = chunkEndMs;
  }

  return windows;
}

function buildPreciseTimeseriesWindows(
  windowStart: string,
  windowEnd: string,
): Array<{ windowStart: string; windowEnd: string }> {
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return [];
  }

  const windows: Array<{ windowStart: string; windowEnd: string }> = [];
  let chunkStartMs = startMs;
  while (chunkStartMs < endMs) {
    const chunkEndMs = Math.min(chunkStartMs + TIMESERIES_CHUNK_MS, endMs);
    if (chunkEndMs <= chunkStartMs) {
      break;
    }
    windows.push({
      windowStart: new Date(chunkStartMs).toISOString(),
      windowEnd: new Date(chunkEndMs).toISOString(),
    });
    chunkStartMs = chunkEndMs;
  }

  return windows;
}

function floorUtcDayTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return timestamp;
  }
  const date = new Date(parsed);
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )).toISOString();
}

function hasJunctionSnapshotRecords(snapshot: Record<string, unknown[]>): boolean {
  return Object.values(snapshot).some((records) => records.length > 0);
}

function hasJunctionHistoricalBackfillSummaryRecords(
  snapshot: Record<string, unknown[]>,
  sourceProviders: readonly JunctionProviderConnection[],
): boolean {
  const sourceReferences = buildJunctionSourceReferenceMap(sourceProviders);

  return Object.entries(snapshot).some(([resource, records]) =>
    isJunctionHistoricalBackfillCompletionSummaryResource(resource)
      && records.some((record) =>
        expandJunctionHistoricalBackfillSummaryRecord(record).some(({ entry, originFallback }) =>
          hasUsefulJunctionHistoricalBackfillSummaryRecord(
            resource,
            entry,
            resolveJunctionSummarySourceProviderSlug(entry, originFallback, sourceReferences),
          )
        )
      )
  );
}

function isJunctionHistoricalBackfillCompletionSummaryResource(
  resource: string,
): resource is JunctionHistoricalBackfillCompletionSummaryResource {
  return JUNCTION_HISTORICAL_BACKFILL_COMPLETION_SUMMARY_RESOURCE_SET.has(resource);
}

function hasUsefulJunctionHistoricalBackfillSummaryRecord(
  resource: JunctionHistoricalBackfillCompletionSummaryResource,
  entry: Record<string, unknown>,
  sourceProviderSlug: string | null,
  options: { acceptSleepCycleStageCount?: boolean } = {},
): boolean {
  if (!sourceProviderSlug) {
    return false;
  }

  if (
    resource !== "sleep_cycle"
    && !isJunctionSourceSpecificFloatingTimestampProvider(sourceProviderSlug)
    && hasFiniteNumberFromJunctionRecordPaths(entry, JUNCTION_HISTORICAL_SUMMARY_METRIC_PATHS[resource])
  ) {
    return true;
  }

  if (resource === "sleep") {
    return hasPositiveJunctionTimestampRange(
      entry,
      JUNCTION_SLEEP_START_TIMESTAMP_PATHS,
      JUNCTION_SLEEP_END_TIMESTAMP_PATHS,
      sourceProviderSlug,
    );
  }

  if (resource === "sleep_cycle") {
    return (
      (options.acceptSleepCycleStageCount ?? true)
      && hasPositiveFiniteNumberFromJunctionRecordPaths(entry, JUNCTION_SLEEP_STAGE_COUNT_PATHS)
    )
      || hasUsefulJunctionSleepCycleStageRecord(entry, sourceProviderSlug);
  }

  if (resource === "workouts") {
    return hasUsefulJunctionWorkoutSessionRecord(entry, sourceProviderSlug);
  }

  if (resource === "meal" || resource === "menstrual_cycle" || resource === "electrocardiogram") {
    return hasUsefulJunctionRawOnlyHistoricalBackfillSummaryRecord(resource, entry);
  }

  return false;
}

function hasUsefulJunctionRawOnlyHistoricalBackfillSummaryRecord(
  resource: "meal" | "menstrual_cycle" | "electrocardiogram",
  entry: Record<string, unknown>,
): boolean {
  // Mirrors the importer invariant: predicted cycles are forecasts, not
  // facts — they emit no normalized events, so forecast-only windows must
  // not complete the historical backfill.
  if (
    resource === "menstrual_cycle"
    && (entry.isPredicted === true || entry.is_predicted === true)
  ) {
    return false;
  }

  const paths = JUNCTION_RAW_ONLY_COMPLETION_PATHS[resource];
  return hasStringFromJunctionRecordPaths(entry, paths.strings)
    || hasFiniteNumberFromJunctionRecordPaths(entry, paths.numbers)
    || hasNonEmptyJunctionRecordArrayFromPaths(entry, paths.arrays);
}

function hasUsefulJunctionSleepCycleStageRecord(
  entry: Record<string, unknown>,
  sourceProviderSlug: string,
): boolean {
  return collectJunctionSleepCycleStageRecords(entry).some((stage) =>
    hasUsefulJunctionSleepCycleStageInterval(stage, sourceProviderSlug)
  );
}

function hasNormalizableJunctionDirectSleepCycleRecord(
  record: Record<string, unknown>,
  sourceProviderSlug: string,
): boolean {
  return canNormalizeJunctionSleepCycleRecordToCompactStages(record, sourceProviderSlug);
}

function hasJunctionSleepStageValue(entry: Record<string, unknown>): boolean {
  return firstJunctionSleepStageFromPaths(entry) !== null;
}

function firstJunctionSleepStageFromPaths(entry: Record<string, unknown>) {
  for (const path of JUNCTION_SLEEP_STAGE_VALUE_PATHS) {
    const stage = normalizeJunctionSleepStageValue(readJunctionRecordPath(entry, path));
    if (stage !== null) {
      return stage;
    }
  }

  return null;
}

function collectJunctionSleepCycleStageRecords(value: unknown): Record<string, unknown>[] {
  return collectJunctionSleepCycleStageRecordsWithSeen(value, new Set());
}

function collectJunctionSleepCycleStageRecordsWithSeen(
  value: unknown,
  seen: Set<Record<string, unknown>>,
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJunctionSleepCycleStageRecordsWithSeen(entry, seen));
  }

  const entry = readPlainObject(value);
  if (!entry || seen.has(entry)) {
    return [];
  }
  seen.add(entry);

  if (hasJunctionSleepStageValue(entry)) {
    return [entry];
  }

  return JUNCTION_SLEEP_STAGE_ARRAY_PATHS.flatMap((path) => {
    const nested = readJunctionRecordPath(entry, path);
    return nested === value ? [] : collectJunctionSleepCycleStageRecordsWithSeen(nested, seen);
  });
}

function hasUsefulJunctionSleepCycleStageInterval(
  entry: Record<string, unknown>,
  sourceProviderSlug: string,
): boolean {
  return hasPositiveFiniteNumberFromJunctionRecordPaths(entry, JUNCTION_SLEEP_STAGE_DURATION_PATHS)
    || hasPositiveJunctionTimestampRange(
      entry,
      JUNCTION_SLEEP_START_TIMESTAMP_PATHS,
      JUNCTION_SLEEP_END_TIMESTAMP_PATHS,
      sourceProviderSlug,
    );
}

function expandJunctionHistoricalBackfillSummaryRecord(
  value: unknown,
): Array<{ entry: Record<string, unknown>; originFallback?: Record<string, unknown> }> {
  const record = readPlainObject(value);
  if (!record) {
    return [];
  }

  const nestedEntries = readNestedJunctionHistoricalBackfillSummaryEntries(record);
  if (!nestedEntries) {
    return [{ entry: record }];
  }

  return nestedEntries.map((entry) => ({
    entry,
    originFallback: record,
  }));
}

function readNestedJunctionHistoricalBackfillSummaryEntries(
  record: Record<string, unknown>,
): Record<string, unknown>[] | null {
  for (const key of ["data", "results", "items", "records"]) {
    const directEntry = readPlainObject(record[key]);
    const entries = directEntry
      ? [directEntry]
      : readJunctionRecordArray(record[key]).flatMap((entry) => {
          const normalized = readPlainObject(entry);
          return normalized ? [normalized] : [];
        });
    if (entries.length > 0) {
      return entries;
    }
  }

  return null;
}

function resolveJunctionSummarySourceProviderSlug(
  entry: Record<string, unknown>,
  originFallback: Record<string, unknown> | undefined,
  sourceReferences: ReadonlyMap<string, Record<string, unknown>>,
): string | null {
  const resolvedOrigin = resolveJunctionOrigin(
    entry,
    buildJunctionSummarySourceFallback(entry, originFallback, sourceReferences),
  );
  return resolvedOrigin.sourceProviderSlug ?? null;
}

function buildJunctionSummarySourceFallback(
  entry: Record<string, unknown>,
  originFallback: Record<string, unknown> | undefined,
  sourceReferences: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  const entryReference = readJunctionSourceReference(entry, sourceReferences);
  const fallbackReference = originFallback
    ? readJunctionSourceReference(originFallback, sourceReferences)
    : {};

  return {
    ...(originFallback ?? {}),
    ...fallbackReference,
    ...entryReference,
  };
}

function hasUsefulJunctionWorkoutSessionRecord(
  entry: Record<string, unknown>,
  sourceProviderSlug: string,
): boolean {
  const hasDuration =
    hasPositiveFiniteNumberFromJunctionRecordPaths(entry, JUNCTION_WORKOUT_DURATION_MINUTE_PATHS)
    || hasPositiveFiniteNumberFromJunctionRecordPaths(entry, JUNCTION_WORKOUT_DURATION_SECOND_PATHS)
    || hasPositiveFiniteNumberFromJunctionRecordPaths(entry, JUNCTION_WORKOUT_DURATION_MILLISECOND_PATHS)
    || hasPositiveJunctionTimestampRange(
      entry,
      JUNCTION_WORKOUT_START_TIMESTAMP_PATHS,
      JUNCTION_WORKOUT_END_TIMESTAMP_PATHS,
      sourceProviderSlug,
    );
  if (!hasDuration) {
    return false;
  }

  const startAt = firstJunctionTimestampMillisFromPaths(
    entry,
    JUNCTION_WORKOUT_START_TIMESTAMP_PATHS,
    sourceProviderSlug,
  );
  const endAt = firstJunctionTimestampMillisFromPaths(
    entry,
    JUNCTION_WORKOUT_END_TIMESTAMP_PATHS,
    sourceProviderSlug,
  );
  return startAt !== null || (endAt === null && !isJunctionSourceSpecificFloatingTimestampProvider(sourceProviderSlug));
}

function hasFiniteNumberFromJunctionRecordPaths(
  entry: Record<string, unknown>,
  paths: readonly string[],
): boolean {
  return paths.some((path) => finiteJunctionNumber(readJunctionRecordPath(entry, path)) !== undefined);
}

function hasStringFromJunctionRecordPaths(
  entry: Record<string, unknown>,
  paths: readonly string[],
): boolean {
  return paths.some((path) => normalizeString(readJunctionRecordPath(entry, path)) !== undefined);
}

function hasPositiveFiniteNumberFromJunctionRecordPaths(
  entry: Record<string, unknown>,
  paths: readonly string[],
): boolean {
  return paths.some((path) => {
    const numeric = finiteJunctionNumber(readJunctionRecordPath(entry, path));
    return numeric !== undefined && numeric > 0;
  });
}

function hasNonEmptyJunctionRecordArrayFromPaths(
  entry: Record<string, unknown>,
  paths: readonly string[],
): boolean {
  return paths.some((path) =>
    readJunctionRecordArray(readJunctionRecordPath(entry, path)).some(isUsefulJunctionRawOnlyArrayEntry)
  );
}

function isUsefulJunctionRawOnlyArrayEntry(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return normalizeString(value) !== undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some(isUsefulJunctionRawOnlyArrayEntry);
  }

  const record = readPlainObject(value);
  if (!record) {
    return false;
  }

  return Object.entries(record).some(([key, nested]) =>
    !isBlockedJunctionImportSourceIdentityKey(key)
    && !isBlockedJunctionImportSourceIdentityContainerKey(key)
    && isUsefulJunctionRawOnlyArrayEntry(nested)
  );
}

function hasPositiveJunctionTimestampRange(
  entry: Record<string, unknown>,
  startPaths: readonly string[],
  endPaths: readonly string[],
  sourceProviderSlug: string,
): boolean {
  const startAt = firstJunctionTimestampMillisFromPaths(entry, startPaths, sourceProviderSlug);
  const endAt = firstJunctionTimestampMillisFromPaths(entry, endPaths, sourceProviderSlug);
  return startAt !== null && endAt !== null && endAt > startAt;
}

function firstJunctionTimestampMillisFromPaths(
  entry: Record<string, unknown>,
  paths: readonly string[],
  sourceProviderSlug: string,
): number | null {
  for (const path of paths) {
    const timestamp = junctionTimestampMillis(readJunctionRecordPath(entry, path), sourceProviderSlug);
    if (timestamp !== null) {
      return timestamp;
    }
  }

  return null;
}

function readJunctionRecordPath(entry: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    const record = readPlainObject(current);
    return record ? record[key] : undefined;
  }, entry);
}

function readJunctionRecordArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteJunctionNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  return undefined;
}

function junctionTimestampMillis(value: unknown, sourceProviderSlug: string): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (isRejectedJunctionSafeTimestampString(trimmed, sourceProviderSlug)) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRejectedJunctionSafeTimestampString(value: string, sourceProviderSlug: string): boolean {
  if (isJunctionSourceSpecificFloatingTimestampProvider(sourceProviderSlug)) {
    return true;
  }

  return /^\d{4}-\d{2}-\d{2}(?:$|[ t]\d{2}:\d{2})/iu.test(value)
    && !/z$/iu.test(value)
    && !/[+-]\d{2}:?\d{2}$/u.test(value);
}

function isJunctionSourceSpecificFloatingTimestampProvider(sourceProviderSlug: string): boolean {
  const normalizedSourceProviderSlug = normalizeProviderSlug(sourceProviderSlug);
  return normalizedSourceProviderSlug
    ? JUNCTION_FLOATING_TIMESTAMP_SOURCE_PROVIDER_SLUGS.has(normalizedSourceProviderSlug)
    : false;
}

function buildHistoricalBackfillFollowUp(input: {
  hasRecords: boolean;
  metadata: Record<string, unknown>;
  now: string;
  windowStart: string;
  windowEnd: string;
}): JunctionHistoricalBackfillFollowUp {
  if (input.hasRecords) {
    return {
      metadataPatch: buildHistoricalBackfillMetadataPatch({
        status: "complete",
        emptyAttempts: 0,
        lastEmptyAt: null,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
      }),
    };
  }

  if (
    hasHistoricalBackfillWindowStatus(input.metadata, "complete", input.windowStart, input.windowEnd)
    || hasHistoricalBackfillWindowStatus(input.metadata, "exhausted", input.windowStart, input.windowEnd)
  ) {
    return {};
  }

  const emptyAttempts = readHistoricalBackfillEmptyAttempts(
    input.metadata,
    input.windowStart,
    input.windowEnd,
  ) + 1;
  const retryDelayMs = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyAttempts - 1] ?? null;
  const status: JunctionHistoricalBackfillStatus = retryDelayMs === null ? "exhausted" : "retrying";

  // No retry job is scheduled here: the scheduled pass derives due retries
  // from this metadata (buildDueHistoricalBackfillJobs), which survives job
  // loss where an in-flight chain would not.
  return {
    metadataPatch: buildHistoricalBackfillMetadataPatch({
      status,
      emptyAttempts,
      lastEmptyAt: input.now,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    }),
    ...(retryDelayMs === null ? {} : { nextRetryAt: addMilliseconds(input.now, retryDelayMs) }),
  };
}

function buildNonConnectHistoricalBackfillFollowUp(input: {
  hasRecords: boolean;
  job: DeviceSyncJobRecord;
  now: string;
  windowStart: string;
  windowEnd: string;
}): JunctionHistoricalBackfillFollowUp {
  if (input.hasRecords) {
    return {};
  }

  const emptyAttempts = readNonConnectHistoricalBackfillEmptyAttempts(input.job) + 1;
  const retryDelayMs = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyAttempts - 1] ?? null;
  if (retryDelayMs === null) {
    return {};
  }

  const retryAt = addMilliseconds(input.now, retryDelayMs);
  const retryJob = buildExactWindowJob({
    kind: "backfill",
    priority: input.job.priority,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });

  return {
    nextRetryAt: retryAt,
    scheduledJobs: [
      {
        ...retryJob,
        availableAt: retryAt,
        payload: {
          ...(retryJob.payload ?? {}),
          emptyBackfillAttempts: emptyAttempts,
        },
      },
    ],
  };
}

function buildHistoricalBackfillMetadataPatch(input: {
  status: JunctionHistoricalBackfillStatus;
  emptyAttempts: number;
  lastEmptyAt: string | null;
  windowStart: string;
  windowEnd: string;
}): Record<string, unknown> {
  return {
    [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status]: input.status,
    [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts]: input.emptyAttempts,
    [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt]: input.lastEmptyAt,
    [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]: input.windowStart,
    [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]: input.windowEnd,
  };
}

function hasHistoricalBackfillWindowStatus(
  metadata: Record<string, unknown>,
  status: JunctionHistoricalBackfillStatus,
  windowStart: string,
  windowEnd: string,
): boolean {
  return normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status]) === status
    && normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]) === windowStart
    && normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]) === windowEnd;
}

function readHistoricalBackfillEmptyAttempts(
  metadata: Record<string, unknown>,
  windowStart: string,
  windowEnd: string,
): number {
  if (
    normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]) !== windowStart
    || normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]) !== windowEnd
  ) {
    return 0;
  }

  const rawAttempts = metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts];
  return typeof rawAttempts === "number" && Number.isInteger(rawAttempts) && rawAttempts >= 0
    ? rawAttempts
    : 0;
}

function readNonConnectHistoricalBackfillEmptyAttempts(job: DeviceSyncJobRecord): number {
  const rawAttempts = job.payload.emptyBackfillAttempts;
  return typeof rawAttempts === "number" && Number.isInteger(rawAttempts) && rawAttempts > 0 ? rawAttempts : 0;
}

function buildConnectHistoricalBackfillWindow(
  account: Pick<DeviceSyncAccount, "connectedAt">,
  summaryBackfillDays: number,
): { windowStart: string; windowEnd: string } {
  return {
    windowStart: floorUtcDayTimestamp(subtractDays(account.connectedAt, summaryBackfillDays)),
    windowEnd: floorUtcDayTimestamp(account.connectedAt),
  };
}

function buildWindowJob(input: {
  kind: "backfill" | "reconcile";
  now: string;
  windowStart: string;
  priority: number;
}): DeviceSyncJobInput {
  const windowEnd = floorUtcDayTimestamp(input.now);
  const windowStart = floorUtcDayTimestamp(input.windowStart);

  return buildExactWindowJob({
    kind: input.kind,
    windowStart,
    windowEnd,
    priority: input.priority,
  });
}

function buildExactWindowJob(input: {
  kind: "backfill" | "reconcile";
  windowStart: string;
  windowEnd: string;
  priority: number;
}): DeviceSyncJobInput {
  return {
    kind: input.kind,
    payload: {
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    },
    priority: input.priority,
    dedupeKey: sha256Text(JSON.stringify(["junction", input.kind, input.windowStart, input.windowEnd])),
  };
}

function buildJunctionWebhookJobs(input: {
  eventType: string;
  objectId: string | null;
  occurredAt: string;
  resource: { name: string; category: "summary" | "timeseries" } | null;
  sourceProviderSlug: string | null;
  summaryBackfillDays: number;
  webhookDataJsons: readonly string[];
  window: { windowStart: string; windowEnd: string };
}): DeviceSyncJobInput[] {
  if (isJunctionProviderConnectionEvent(input.eventType)) {
    const backfillWindowStart = subtractDays(input.window.windowEnd, input.summaryBackfillDays);

    return [
      {
        kind: "backfill",
        payload: {
          windowStart: backfillWindowStart,
          windowEnd: input.window.windowEnd,
        },
        priority: 35,
        dedupeKey: sha256Text(JSON.stringify([
          "junction-webhook",
          "connection-backfill",
          backfillWindowStart,
          input.window.windowEnd,
        ])),
      },
      {
        kind: "reconcile",
        payload: {
          windowStart: input.window.windowStart,
          windowEnd: input.window.windowEnd,
        },
        priority: 45,
        dedupeKey: sha256Text(JSON.stringify([
          "junction-webhook",
          "connection-reconcile",
          input.window.windowStart,
          input.window.windowEnd,
        ])),
      },
    ];
  }

  if (input.resource) {
    const directPayloads = input.webhookDataJsons.length > 0 ? input.webhookDataJsons : [null];
    return directPayloads.map((webhookDataJson, index) => ({
      kind: "resource",
      payload: {
        eventType: input.eventType,
        objectId: input.objectId ?? "",
        occurredAt: input.occurredAt,
        resource: input.resource?.name ?? "",
        resourceCategory: input.resource?.category ?? "",
        sourceProviderSlug: input.sourceProviderSlug ?? "",
        ...(webhookDataJson ? { webhookDataJson } : {}),
        windowStart: input.window.windowStart,
        windowEnd: input.window.windowEnd,
      },
      priority: 65,
      dedupeKey: webhookDataJson
        ? sha256Text(JSON.stringify([
            "junction-webhook",
            "resource-data",
            input.sourceProviderSlug,
            input.resource?.category,
            input.resource?.name,
            input.objectId ?? "",
            input.occurredAt,
            index,
            sha256Text(webhookDataJson),
          ]))
        : sha256Text(JSON.stringify([
            "junction-webhook",
            "resource",
            input.sourceProviderSlug,
            input.resource?.category,
            input.resource?.name,
            input.window.windowStart,
            input.window.windowEnd,
          ])),
    }));
  }

  return [
    {
      kind: "reconcile",
      payload: {
        windowStart: input.window.windowStart,
        windowEnd: input.window.windowEnd,
      },
      priority: 50,
      dedupeKey: sha256Text(JSON.stringify([
        "junction-webhook",
        "reconcile",
        input.window.windowStart,
        input.window.windowEnd,
      ])),
    },
  ];
}

function isJunctionProviderConnectionEvent(eventType: string): boolean {
  return eventType === "provider.connection.created" || eventType === "provider.connection.updated";
}

function isJunctionDataEvent(eventType: string): boolean {
  return eventType.startsWith("daily.data.") || eventType.startsWith("historical.data.");
}

function isJunctionHistoricalDataEvent(eventType: string): boolean {
  return eventType.startsWith("historical.data.");
}

function isJunctionHistoricalPullCompletedWebhookData(
  data: Record<string, unknown>,
  externalAccountId: string,
): boolean {
  const completed = parseJunctionHistoricalPullCompletedWebhookData(data, externalAccountId);
  if (completed && normalizeJunctionWebhookSourceProviderCandidate(completed.provider)) {
    return true;
  }

  if (hasJunctionHistoricalInlineRecordCarrierFields(data)) {
    return false;
  }

  return isDocumentedJunctionHistoricalPullCompletedWebhookData(data, externalAccountId);
}

function parseJunctionHistoricalPullCompletedWebhookData(
  data: Record<string, unknown>,
  externalAccountId: string,
): JunctionSdkHistoricalPullCompleted | null {
  const parsed = JunctionHistoricalPullCompletedSchema.parse(
    {
      ...data,
      [JUNCTION_WEBHOOK_ROOT_FIELDS.userId]:
        normalizeString(data[JUNCTION_WEBHOOK_ROOT_FIELDS.userId]) ?? externalAccountId,
    },
    {
      unrecognizedObjectKeys: "passthrough",
    },
  );

  return parsed.ok ? parsed.value : null;
}

const JUNCTION_HISTORICAL_INLINE_RECORD_CARRIER_FIELDS = new Set([
  "activities",
  "bedtime_start",
  "bedtime_stop",
  "data",
  "data_type",
  "date",
  "duration",
  "end_time",
  "groups",
  "id",
  "items",
  "object_id",
  "records",
  "resource_id",
  "resource_type",
  "samples",
  "source",
  "stages",
  "start_time",
  "timestamp",
  "total",
  "total_sleep_minutes",
  "type",
  "workout_id",
  "workouts",
]);

function hasJunctionHistoricalInlineRecordCarrierFields(data: Record<string, unknown>): boolean {
  return Object.keys(data).some((key) => JUNCTION_HISTORICAL_INLINE_RECORD_CARRIER_FIELDS.has(key));
}

function isDocumentedJunctionHistoricalPullCompletedWebhookData(
  data: Record<string, unknown>,
  externalAccountId: string,
): boolean {
  const finalFlag = data.is_final ?? data.isFinal;
  if (finalFlag === false) {
    return false;
  }

  const userId = normalizeString(data[JUNCTION_WEBHOOK_ROOT_FIELDS.userId]) ?? externalAccountId;
  const provider = extractJunctionWebhookSourceProviderSlug(data);
  const windowStart = toJunctionWebhookWindowBoundaryTimestampIfValid(data.start_date, "start");
  const windowEnd = toJunctionWebhookWindowBoundaryTimestampIfValid(data.end_date, "end");
  if (!userId || !provider || !windowStart || !windowEnd) {
    return false;
  }

  return Date.parse(windowStart) < Date.parse(windowEnd);
}

function buildJunctionWebhookDataJobJsons(input: {
  data: Record<string, unknown> | null;
  eventType: string;
  externalAccountId: string;
  resource: { name: string; category: "summary" | "timeseries" } | null;
  summaryResources: readonly string[];
  sourceProviderSlug: string | null;
}): string[] {
  if (!input.data || !input.resource || !isJunctionDataEvent(input.eventType)) {
    return [];
  }

  if (input.resource.category !== "summary" || !input.summaryResources.includes(input.resource.name)) {
    return [];
  }

  if (
    isJunctionHistoricalDataEvent(input.eventType)
    && isJunctionHistoricalPullCompletedWebhookData(input.data, input.externalAccountId)
  ) {
    return [];
  }

  const sanitized = sanitizeJunctionImportSnapshotValue(
    input.data,
    new Map(),
    {
      blockedStringValues: [input.externalAccountId],
      preserveSourceReferenceKeys: true,
    },
  );
  const record = readPlainObject(sanitized);
  if (!record) {
    return [];
  }

  const withSource = stripUndefined({
    ...record,
    sourceProviderSlug:
      normalizeProviderSlug(record.sourceProviderSlug) ?? input.sourceProviderSlug ?? undefined,
  });
  return [serializeJunctionWebhookDataJobRecord(withSource)];
}

function serializeJunctionWebhookDataJobRecord(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

function parseJunctionWebhookDataJobRecord(value: unknown): Record<string, unknown> | null {
  const json = normalizeString(value);
  if (!json) {
    return null;
  }

  try {
    return readPlainObject(JSON.parse(json));
  } catch {
    return null;
  }
}

function resolveJunctionWebhookDataRecordSourceProviderSlug(
  record: Record<string, unknown>,
): string | null {
  const slugs = new Set<string>();
  const addSlug = (value: unknown): void => {
    const slug = normalizeProviderSlug(value);
    if (slug) {
      slugs.add(slug);
    }
  };
  const addRecordSlug = (entry: Record<string, unknown>): void => {
    addSlug(resolveJunctionOrigin(entry).sourceProviderSlug);
  };

  addRecordSlug(record);
  for (const entryRecord of readJunctionWebhookNestedRecordEntries(record)) {
    addRecordSlug(entryRecord);
  }

  const groups = readPlainObject(record.groups);
  if (groups) {
    for (const [sourceSlug, rawGroups] of Object.entries(groups)) {
      addSlug(sourceSlug);
      for (const rawGroup of readJunctionRecordArray(rawGroups)) {
        const group = readPlainObject(rawGroup);
        if (!group) {
          continue;
        }

        addRecordSlug(group);
        for (const entryRecord of readJunctionWebhookNestedRecordEntries(group)) {
          addRecordSlug(entryRecord);
        }
      }
    }
  }

  return slugs.size === 1 ? [...slugs][0] ?? null : null;
}

function expandJunctionWebhookTimeseriesDataRecords(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  const entries = [
    record,
    ...readJunctionWebhookNestedRecordEntries(record),
  ];
  const groups = readPlainObject(record.groups);
  if (!groups) {
    return entries;
  }

  for (const rawGroups of Object.values(groups)) {
    for (const rawGroup of readJunctionRecordArray(rawGroups)) {
      const group = readPlainObject(rawGroup);
      if (!group) {
        continue;
      }

      entries.push(group, ...readJunctionWebhookNestedRecordEntries(group));
    }
  }

  return entries;
}

function readJunctionWebhookNestedRecordEntries(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  return JUNCTION_WEBHOOK_NESTED_RECORD_KEYS.flatMap((key) => {
    const directEntry = readPlainObject(record[key]);
    if (directEntry) {
      return [directEntry];
    }

    return readJunctionRecordArray(record[key]).flatMap((entry) => {
      const entryRecord = readPlainObject(entry);
      return entryRecord ? [entryRecord] : [];
    });
  });
}

function inferJunctionResourceCategory(
  resourceCategory: string | null | undefined,
  resource: string,
): "summary" | "timeseries" {
  const normalizedCategory = resourceCategory?.toLowerCase();
  if (normalizedCategory === "summary" || normalizedCategory === "timeseries") {
    return normalizedCategory;
  }

  return JUNCTION_TIMESERIES_RESOURCE_NAMES.has(resource)
    ? "timeseries"
    : "summary";
}

function inferJunctionWebhookResource(
  eventType: string,
  data: Record<string, unknown> | null,
): { name: string; category: "summary" | "timeseries" } | null {
  const explicitResource =
    normalizeJunctionResourceName(data?.resource)
    ?? normalizeJunctionResourceName(data?.resource_type)
    ?? normalizeJunctionResourceName(data?.type)
    ?? normalizeJunctionResourceName(data?.data_type);
  const eventResource = normalizeJunctionResourceName(readJunctionWebhookResourceFromEventType(eventType));
  // Enriched payloads can carry record-level discriminators (for example
  // `resource_type: "sleep_v2"`) that are not Junction resource names. Only
  // let the payload value override the event-type resource when it is a known
  // Junction resource; otherwise an enriched `daily.data.sleep.created` event
  // would build a job for a resource that can never import.
  const resource = explicitResource && JUNCTION_KNOWN_WEBHOOK_RESOURCE_NAMES.has(explicitResource)
    ? explicitResource
    : eventResource ?? explicitResource;

  if (!resource) {
    return null;
  }

  const explicitCategory =
    normalizeString(data?.resource_category)
    ?? normalizeString(data?.category)
    ?? (eventType.includes(".timeseries.") ? "timeseries" : null)
    ?? (eventType.includes(".summary.") ? "summary" : null);

  return {
    name: resource,
    category: inferJunctionResourceCategory(explicitCategory, resource),
  };
}

export { normalizeJunctionResourceName, readJunctionWebhookResourceName } from "../junction-resources.ts";

function readJunctionWebhookResourceFromEventType(eventType: string): string | null {
  const parts = eventType.split(".").map((part) => part.trim()).filter(Boolean);
  const dataIndex = parts.indexOf("data");

  if (dataIndex >= 0 && parts[dataIndex + 1]) {
    return parts[dataIndex + 1] ?? null;
  }

  return null;
}

function extractJunctionWebhookSourceProviderSlug(data: Record<string, unknown> | null): string | null {
  return (
    normalizeProviderSlug(resolveJunctionOrigin(data ?? undefined).sourceProviderSlug)
    ?? extractJunctionWebhookSourceProviderSlugFallback(data)
  );
}

function extractJunctionWebhookSourceProviderSlugFallback(data: Record<string, unknown> | null): string | null {
  if (!data) {
    return null;
  }

  const source = readPlainObject(data.source);
  const provider = readPlainObject(data.provider);

  return (
    normalizeJunctionWebhookSourceProviderCandidate(source?.provider)
    ?? normalizeJunctionWebhookSourceProviderCandidate(source?.providerSlug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(source?.provider_slug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(source?.slug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(data.sourceProviderSlug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(data.source_provider_slug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(data.sourceProvider)
    ?? normalizeJunctionWebhookSourceProviderCandidate(data.source_provider)
    ?? normalizeJunctionWebhookSourceProviderCandidate(data.provider)
    ?? normalizeJunctionWebhookSourceProviderCandidate(data.providerSlug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(data.provider_slug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(provider?.provider)
    ?? normalizeJunctionWebhookSourceProviderCandidate(provider?.providerSlug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(provider?.provider_slug)
    ?? normalizeJunctionWebhookSourceProviderCandidate(provider?.slug)
  );
}

function normalizeJunctionWebhookSourceProviderCandidate(value: unknown): string | null {
  const slug = normalizeProviderSlug(value);
  return slug && slug !== "junction" ? slug : null;
}

function extractJunctionWebhookObjectId(data: Record<string, unknown> | null): string | null {
  return (
    normalizeString(data?.id)
    ?? normalizeString(data?.object_id)
    ?? normalizeString(data?.resource_id)
    ?? normalizeString(data?.workout_id)
    ?? normalizeString(readPlainObject(data?.data)?.id)
    ?? null
  );
}

function extractJunctionWebhookRootTimestamp(data: Record<string, unknown> | null): string | null {
  const candidates = [
    data?.observedAt,
    data?.observed_at,
    data?.occurred_at,
    data?.created_at,
    data?.updated_at,
    data?.timestamp,
    data?.date,
    data?.start_time,
  ];

  for (const candidate of candidates) {
    const iso = toIsoTimestampIfValid(candidate);
    if (iso) {
      return iso;
    }
  }

  return null;
}

function extractJunctionWebhookOccurredAt(data: Record<string, unknown> | null): string | null {
  const rootTimestamp = extractJunctionWebhookRootTimestamp(data);
  if (rootTimestamp) {
    return rootTimestamp;
  }

  const nestedTimestamp = toIsoTimestampIfValid(readPlainObject(data?.data)?.timestamp);
  if (nestedTimestamp) {
    return nestedTimestamp;
  }

  return readJunctionWebhookDataTimestampRange(data)?.firstTimestamp ?? null;
}

function buildJunctionWebhookWindow(
  data: Record<string, unknown> | null,
  occurredAt: string,
  now: string,
  resource: { name: string } | null,
): { windowStart: string; windowEnd: string } {
  const explicitStart =
    toJunctionWebhookWindowBoundaryTimestampIfValid(data?.window_start, "start")
    ?? toJunctionWebhookWindowBoundaryTimestampIfValid(data?.start_date, "start")
    ?? toJunctionWebhookWindowBoundaryTimestampIfValid(data?.start, "start")
    ?? toJunctionWebhookWindowBoundaryTimestampIfValid(data?.from, "start");
  const explicitEnd =
    toJunctionWebhookWindowBoundaryTimestampIfValid(data?.window_end, "end")
    ?? toJunctionWebhookWindowBoundaryTimestampIfValid(data?.end_date, "end")
    ?? toJunctionWebhookWindowBoundaryTimestampIfValid(data?.end, "end")
    ?? toJunctionWebhookWindowBoundaryTimestampIfValid(data?.to, "end");

  if (explicitStart && explicitEnd) {
    return {
      windowStart: explicitStart,
      windowEnd: minIsoTimestamp(explicitEnd, now),
    };
  }

  const dataTimestampRange = readJunctionWebhookDataTimestampRange(data);
  if (dataTimestampRange) {
    const windowStart = floorUtcDayTimestamp(dataTimestampRange.firstTimestamp);
    const windowEnd = minIsoTimestamp(
      addMilliseconds(floorUtcDayTimestamp(dataTimestampRange.lastTimestamp), TIMESERIES_CHUNK_MS),
      now,
    );
    if (Date.parse(windowStart) < Date.parse(windowEnd)) {
      return { windowStart, windowEnd };
    }
  }

  if (resource?.name === "stress_level") {
    const rootTimestamp = extractJunctionWebhookRootTimestamp(data);
    if (rootTimestamp) {
      const windowStart = floorUtcDayTimestamp(rootTimestamp);
      const windowEnd = minIsoTimestamp(
        addMilliseconds(windowStart, TIMESERIES_CHUNK_MS),
        now,
      );
      if (Date.parse(windowStart) < Date.parse(windowEnd)) {
        return { windowStart, windowEnd };
      }
    }
  }

  const occurredAtMs = Date.parse(occurredAt);
  const boundedOccurredAt = Number.isFinite(occurredAtMs) ? occurredAt : now;

  return {
    windowStart: subtractDays(boundedOccurredAt, 1),
    windowEnd: minIsoTimestamp(addMilliseconds(boundedOccurredAt, 24 * 60 * 60_000), now),
  };
}

function toJunctionWebhookWindowBoundaryTimestampIfValid(
  value: unknown,
  boundary: "end" | "start",
): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    const startOfDay = new Date(`${normalized}T00:00:00.000Z`);
    if (!Number.isFinite(startOfDay.getTime()) || startOfDay.toISOString().slice(0, 10) !== normalized) {
      return null;
    }
    const timestampMs = boundary === "end"
      ? startOfDay.getTime() + TIMESERIES_CHUNK_MS
      : startOfDay.getTime();
    return new Date(timestampMs).toISOString();
  }

  return toIsoTimestampIfValid(normalized);
}

function readJunctionWebhookDataTimestampRange(
  data: Record<string, unknown> | null,
): { firstTimestamp: string; lastTimestamp: string } | null {
  const record = data ? readPlainObject(data) : null;
  const timestamps = record
    ? expandJunctionWebhookTimeseriesDataRecords(record).slice(1).flatMap((entry) => {
        const timestamp = toIsoTimestampIfValid(resolveJunctionTimeseriesRecordTimestamp(entry));
        return timestamp ? [timestamp] : [];
      })
    : [];

  if (timestamps.length === 0) {
    return null;
  }

  return {
    firstTimestamp: timestamps.reduce(minIsoTimestamp),
    lastTimestamp: timestamps.reduce(maxIsoTimestamp),
  };
}

function verifyAndParseJunctionWebhookEnvelope(input: {
  headers: Headers;
  rawBody: Buffer;
  secret: string;
  now: string;
  timestampToleranceMs: number;
}): { messageId: string; payload: Record<string, unknown> } {
  const messageId = requireJunctionWebhookHeader(input.headers, "svix-id");
  const timestamp = requireJunctionWebhookHeader(input.headers, "svix-timestamp");
  const signatureHeader = requireJunctionWebhookHeader(input.headers, "svix-signature");
  const timestampMs = parseJunctionWebhookTimestamp(timestamp);
  const nowMs = Date.parse(input.now);

  if (Number.isFinite(nowMs) && Math.abs(nowMs - timestampMs) > input.timestampToleranceMs) {
    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_TIMESTAMP_STALE",
      message: "Junction webhook timestamp is outside the allowed tolerance.",
      retryable: false,
      httpStatus: 400,
    });
  }

  if (!verifySvixSignature({
    messageId,
    rawBody: input.rawBody,
    secret: input.secret,
    signatureHeader,
    timestamp,
  })) {
    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_SIGNATURE_INVALID",
      message: "Junction webhook signature verification failed.",
      retryable: false,
      httpStatus: 401,
    });
  }

  const payload = parseWebhookJsonBody(input.rawBody);

  return {
    messageId,
    payload,
  };
}

function requireJunctionWebhookHeader(headers: Headers, name: string): string {
  const value = normalizeString(headers.get(name));
  if (value) {
    return value;
  }

  throw deviceSyncError({
    code: "JUNCTION_WEBHOOK_SIGNATURE_MISSING",
    message: `Junction webhook is missing ${name}.`,
    retryable: false,
    httpStatus: 400,
  });
}

function parseJunctionWebhookTimestamp(timestamp: string): number {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_TIMESTAMP_INVALID",
      message: "Junction webhook timestamp is invalid.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return seconds * 1000;
}

function verifySvixSignature(input: {
  messageId: string;
  rawBody: Buffer;
  secret: string;
  signatureHeader: string;
  timestamp: string;
}): boolean {
  const secret = decodeSvixWebhookSecret(input.secret);
  const signedContent = Buffer.concat([
    Buffer.from(`${input.messageId}.${input.timestamp}.`, "utf8"),
    input.rawBody,
  ]);
  const expected = createHmac("sha256", secret).update(signedContent).digest();

  for (const signature of readSvixV1Signatures(input.signatureHeader)) {
    if (signature.length === expected.length && timingSafeEqual(signature, expected)) {
      return true;
    }
  }

  return false;
}

function decodeSvixWebhookSecret(secret: string): Buffer {
  const normalized = secret.trim();
  if (normalized.startsWith("whsec_")) {
    const decoded = decodeBase64LikeStrict(normalized.slice("whsec_".length));
    if (decoded.length > 0) {
      return decoded;
    }

    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_SECRET_INVALID",
      message: "Junction webhook secret must be valid whsec_ base64.",
      retryable: false,
      httpStatus: 500,
    });
  }

  return Buffer.from(normalized, "utf8");
}

function readSvixV1Signatures(signatureHeader: string): Buffer[] {
  const signatureValues: string[] = [];
  const parts = signatureHeader.split(/[\s,]+/u).map((part) => part.trim()).filter(Boolean);

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }

    if (part === "v1" && parts[index + 1]) {
      signatureValues.push(parts[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (part.startsWith("v1=") || part.startsWith("v1:")) {
      signatureValues.push(part.slice(3));
    }
  }

  return signatureValues
    .map(decodeBase64Like)
    .filter((signature) => signature.length > 0);
}

function decodeBase64Like(value: string): Buffer {
  const normalized = value.trim().replace(/-/gu, "+").replace(/_/gu, "/");
  if (!normalized) {
    return Buffer.alloc(0);
  }

  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(padding)}`;
  try {
    return Buffer.from(padded, "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function decodeBase64LikeStrict(value: string): Buffer {
  const normalized = value.trim().replace(/-/gu, "+").replace(/_/gu, "/");
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    return Buffer.alloc(0);
  }

  const firstPadding = normalized.indexOf("=");
  if (firstPadding >= 0 && !/^=+$/u.test(normalized.slice(firstPadding))) {
    return Buffer.alloc(0);
  }

  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(padding)}`;
  try {
    const decoded = Buffer.from(padded, "base64");
    return decoded.length > 0 ? decoded : Buffer.alloc(0);
  } catch {
    return Buffer.alloc(0);
  }
}

function parseWebhookJsonBody(rawBody: Buffer): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_BODY_INVALID",
      message: "Junction webhook body is not valid JSON.",
      retryable: false,
      httpStatus: 400,
    });
  }

  const record = readPlainObject(parsed);
  if (!record) {
    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_BODY_INVALID",
      message: "Junction webhook body must be a JSON object.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return record;
}

function requireJunctionWebhookEventType(payload: Record<string, unknown>): string {
  const eventType =
    normalizeString(payload[JUNCTION_WEBHOOK_ROOT_FIELDS.eventType])
    ?? normalizeString(payload.eventType);
  if (eventType) {
    return eventType;
  }

  throw deviceSyncError({
    code: "JUNCTION_WEBHOOK_EVENT_TYPE_MISSING",
    message: "Junction webhook event_type is missing.",
    retryable: false,
    httpStatus: 400,
  });
}

interface JunctionWebhookIdentityCandidate {
  kind: "client_user_id" | "external_account_id";
  path: string;
  value: string;
}

interface JunctionWebhookUserIdSelection {
  candidates: readonly JunctionWebhookIdentityCandidate[];
  selectedPath: string;
  userId: string;
}

function requireJunctionWebhookUserIdSelection(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): JunctionWebhookUserIdSelection {
  const candidates = collectJunctionWebhookIdentityCandidates(payload, data);
  const externalAccountCandidates = candidates.filter((candidate) =>
    candidate.kind === "external_account_id"
  );
  const distinctUserIds = new Set(externalAccountCandidates.map((candidate) => candidate.value));

  if (distinctUserIds.size > 1) {
    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_USER_ID_CONFLICT",
      message: "Junction webhook payload contains conflicting user_id values.",
      retryable: false,
      httpStatus: 400,
      details: {
        externalAccountCandidates: describeJunctionWebhookIdentityCandidateDiagnostics(candidates, null),
      },
    });
  }

  const selected = externalAccountCandidates[0];
  if (selected) {
    return {
      candidates,
      selectedPath: selected.path,
      userId: selected.value,
    };
  }

  throw deviceSyncError({
    code: "JUNCTION_WEBHOOK_USER_ID_MISSING",
    message: "Junction webhook user_id is missing.",
    retryable: false,
    httpStatus: 400,
    details: {
      externalAccountCandidates: describeJunctionWebhookIdentityCandidateDiagnostics(candidates, null),
    },
  });
}

function collectJunctionWebhookIdentityCandidates(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): JunctionWebhookIdentityCandidate[] {
  const candidates: JunctionWebhookIdentityCandidate[] = [];
  const seenContainers = new Set<Record<string, unknown>>();

  const collectCandidates = (
    container: Record<string, unknown> | null,
    path: string,
    depth: number,
    allowGenericUserId: boolean,
  ): void => {
    if (!container || depth > 5 || seenContainers.has(container)) {
      return;
    }

    seenContainers.add(container);

    for (const key of [JUNCTION_WEBHOOK_ROOT_FIELDS.userId, "userId"] as const) {
      addJunctionWebhookIdentityCandidate(candidates, {
        kind: "external_account_id",
        path: `${path}.${key}`,
        value: container[key],
      });
    }

    for (const key of [JUNCTION_WEBHOOK_ROOT_FIELDS.clientUserId, "clientUserId"] as const) {
      addJunctionWebhookIdentityCandidate(candidates, {
        kind: "client_user_id",
        path: `${path}.${key}`,
        value: container[key],
      });
    }

    if (allowGenericUserId) {
      addJunctionWebhookIdentityCandidate(candidates, {
        kind: "external_account_id",
        path: `${path}.id`,
        value: container.id,
      });
    }

    for (const key of ["data", "payload", "event", "message", "user"] as const) {
      collectCandidates(readPlainObject(container[key]), `${path}.${key}`, depth + 1, key === "user");
    }
  };

  collectCandidates(payload, "$", 0, false);
  collectCandidates(data, "$.data", 0, false);

  return candidates;
}

function addJunctionWebhookIdentityCandidate(
  candidates: JunctionWebhookIdentityCandidate[],
  input: {
    kind: JunctionWebhookIdentityCandidate["kind"];
    path: string;
    value: unknown;
  },
): void {
  const value = normalizeString(input.value);
  if (!value) {
    return;
  }

  candidates.push({
    kind: input.kind,
    path: input.path,
    value,
  });
}

function buildJunctionWebhookExternalAccountDiagnostic(
  selection: JunctionWebhookUserIdSelection,
): DeviceSyncWebhookExternalAccountDiagnostic {
  return {
    selectedPath: selection.selectedPath,
    selectedExternalAccountIdHash: sha256Text(selection.userId),
    candidates: describeJunctionWebhookIdentityCandidateDiagnostics(selection.candidates, selection),
  };
}

function describeJunctionWebhookIdentityCandidateDiagnostics(
  candidates: readonly JunctionWebhookIdentityCandidate[],
  selection: JunctionWebhookUserIdSelection | null,
): DeviceSyncWebhookExternalAccountDiagnostic["candidates"] {
  const seen = new Set<string>();
  const diagnosticCandidates: DeviceSyncWebhookExternalAccountDiagnostic["candidates"][number][] = [];

  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.path}:${candidate.value}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    diagnosticCandidates.push({
      kind: candidate.kind === "external_account_id" ? "external_account_id" : "client_user_id",
      path: candidate.path,
      selected:
        selection !== null
        && candidate.kind === "external_account_id"
        && candidate.path === selection.selectedPath
        && candidate.value === selection.userId,
      valueHash: sha256Text(candidate.value),
    });
  }

  return diagnosticCandidates;
}

async function projectJunctionSources(
  context: ProviderJobContext,
  providers: readonly JunctionProviderConnection[],
): Promise<void> {
  if (!context.upsertConnectionSource) {
    context.logger.warn?.("Junction source projection skipped because the job context does not expose source storage.", {
      provider: "junction",
    });
    return;
  }

  for (const source of projectJunctionSourcesByProviderSlug(
    context.account.id,
    providers,
  )) {
    await context.upsertConnectionSource({
      sourceInstanceKey: source.sourceInstanceKey,
      sourceProviderSlug: source.sourceProviderSlug,
      displayName: null,
      status: source.status,
      resourceAvailabilitySummary: source.resourceAvailabilitySummary,
      // Only assert error fields when this projection saw an errored entry;
      // omitting the keys lets the store preserve existing detail while the
      // status stays "error" and auto-clear it once the status recovers.
      ...(source.lastErrorCode !== null || source.lastErrorMessage !== null
        ? { lastErrorCode: source.lastErrorCode, lastErrorMessage: source.lastErrorMessage }
        : {}),
      lastSeenAt: context.now,
    });
  }
}

interface ProjectedJunctionSource {
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

function projectJunctionSourcesByProviderSlug(
  connectionId: string,
  providers: readonly JunctionProviderConnection[],
): ProjectedJunctionSource[] {
  const projected = new Map<string, ProjectedJunctionSource>();

  for (const provider of providers) {
    const origin = resolveJunctionOrigin(
      {
        sourceProviderSlug: provider.slug,
        source: provider.source
          ? {
              device_id: provider.source.deviceId,
              app_id: provider.source.appId,
            }
          : undefined,
      },
      {
        sourceProviderSlug: provider.origin.sourceProviderSlug,
        sourceInstanceId: provider.origin.sourceInstanceId,
      },
    );
    const sourceProviderSlug =
      normalizeProviderSlug(origin.sourceProviderSlug) ?? normalizeProviderSlug(provider.slug);
    if (!sourceProviderSlug) {
      continue;
    }

    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId,
      sourceProviderSlug,
    });
    if (!sourceInstanceKey) {
      continue;
    }

    const resourceAvailabilitySummary = sanitizeJunctionResourceAvailabilitySummary(provider.resourceAvailability);
    const status = mapJunctionSourceStatus(provider.status);
    const lastErrorCode = status === "error"
      ? truncateJunctionSourceErrorText(provider.errorDetails?.errorType, JUNCTION_SOURCE_ERROR_CODE_MAX_LENGTH)
      : null;
    const lastErrorMessage = status === "error"
      ? truncateJunctionSourceErrorText(provider.errorDetails?.errorMessage, JUNCTION_SOURCE_ERROR_MESSAGE_MAX_LENGTH)
      : null;
    const existing = projected.get(sourceProviderSlug);
    if (existing) {
      mergeJunctionResourceAvailabilitySummary(
        existing.resourceAvailabilitySummary,
        resourceAvailabilitySummary,
      );
      existing.status = mergeJunctionSourceStatus(existing.status, status);
      if (existing.status !== "error") {
        existing.lastErrorCode = null;
        existing.lastErrorMessage = null;
      } else if (existing.lastErrorCode === null && existing.lastErrorMessage === null) {
        existing.lastErrorCode = lastErrorCode;
        existing.lastErrorMessage = lastErrorMessage;
      }
      continue;
    }

    projected.set(sourceProviderSlug, {
      sourceInstanceKey,
      sourceProviderSlug,
      status,
      resourceAvailabilitySummary,
      lastErrorCode,
      lastErrorMessage,
    });
  }

  return [...projected.values()];
}

// device_connection_source bounds (the store rejects longer values).
const JUNCTION_SOURCE_ERROR_CODE_MAX_LENGTH = 80;
const JUNCTION_SOURCE_ERROR_MESSAGE_MAX_LENGTH = 240;

function truncateJunctionSourceErrorText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function mergeJunctionResourceAvailabilitySummary(
  target: Record<string, string | number | boolean | null>,
  source: Record<string, string | number | boolean | null>,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = mergeJunctionResourceAvailabilityValue(target[key], value);
  }
}

function mergeJunctionResourceAvailabilityValue(
  existing: string | number | boolean | null | undefined,
  next: string | number | boolean | null,
): string | number | boolean | null {
  if (existing === undefined || existing === null || existing === false) {
    return next;
  }

  if (typeof existing === "boolean" && typeof next === "boolean") {
    return existing || next;
  }

  return existing;
}

function mergeJunctionSourceStatus(
  existing: DeviceConnectionSourceStatus,
  next: DeviceConnectionSourceStatus,
): DeviceConnectionSourceStatus {
  if (existing === "connected" || next === "connected") {
    return "connected";
  }

  if (existing === "error" || next === "error") {
    return "error";
  }

  if (existing === "unavailable" || next === "unavailable") {
    return "unavailable";
  }

  return "disconnected";
}

// Derive import identity from the stable Junction user id, never from the
// local device-sync account row id: row ids are re-minted whenever the
// machine-local device-sync store is recreated (every hosted cold start), and
// an unstable accountId changes the deterministic event identity of every
// re-imported record.
function buildJunctionImportAccountId(externalAccountId: string): string {
  return `jxn_acct_${
    createHash("sha256")
      .update(JSON.stringify(["junction-import-account", externalAccountId]))
      .digest("hex")
      .slice(0, 32)
  }`;
}

function mapJunctionSourceStatus(status: string): DeviceConnectionSourceStatus {
  const normalized = status.trim().toLowerCase();

  if (["active", "connected", "available", "ok"].includes(normalized)) {
    return "connected";
  }

  if (["error", "failed"].includes(normalized)) {
    return "error";
  }

  if (["disconnected", "revoked", "inactive"].includes(normalized)) {
    return "disconnected";
  }

  return "unavailable";
}

function sanitizeJunctionResourceAvailabilitySummary(
  value: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const summary: Record<string, string | number | boolean | null> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (isBlockedJunctionSourceAvailabilityKey(key)) {
      continue;
    }

    if (typeof rawValue === "string" || typeof rawValue === "boolean" || rawValue === null) {
      summary[key] = rawValue;
      continue;
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      summary[key] = rawValue;
      continue;
    }

    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const record = rawValue as Record<string, unknown>;
      const status = normalizeString(record.status);
      if (status) {
        summary[key] = status;
        continue;
      }

      if (typeof record.available === "boolean") {
        summary[key] = record.available;
      }
    }
  }

  return summary;
}

function isBlockedJunctionSourceAvailabilityKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  return isJunctionRawDirectIdentityKey(key)
    || isJunctionRawDirectIdentityContainerKey(key)
    || normalized.includes("userid")
    || normalized.includes("accountid")
    || normalized.includes("clientuserid")
    || normalized === "owner"
    || normalized === "provider"
    || normalized === "source"
    || normalized === "device"
    || normalized === "app"
    || normalized === "account"
    || normalized === "user"
    || normalized === "client"
    || normalized.includes("providerconnectionid")
    || normalized.includes("connectionid")
    || normalized.includes("sourceid")
    || normalized.includes("sourceinstanceid")
    || normalized.includes("sourcedeviceid")
    || normalized.includes("sourceappid")
    || normalized.includes("deviceid")
    || normalized.includes("appid")
    || normalized.includes("sourcename")
    || normalized.includes("providername")
    || normalized.includes("devicename")
    || normalized.includes("appname")
    || normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("authorization")
    || normalized.includes("raw");
}

function maxIsoTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function minIsoTimestamp(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function toIsoTimestampIfValid(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function base32UrlEncode(input: Buffer): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}
