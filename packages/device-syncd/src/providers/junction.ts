import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import type { Junction } from "@junction-api/sdk";
import type * as JunctionSerialization from "@junction-api/sdk/serialization";
import {
  COMPANION_HRV_RMSSD_RESOURCE,
  parseCompanionHrvRmssdAdmissionId,
  parseSerializedCompanionHrvRmssdObservation,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import {
  canNormalizeJunctionSleepCycleRecordToCompactStages,
  classifyJunctionSummaryNormalizationEvidence,
  identifyJunctionBloodPressureProviderRecords,
  type JunctionSummaryNormalizationEvidence,
} from "@murphai/importers/device-providers/junction";
import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  isJunctionRawDirectIdentityContainerKey,
  isJunctionRawDirectIdentityKey,
  normalizeJunctionResourceName,
} from "@murphai/importers/device-providers/junction-resources";
import { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR } from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError, isDeviceSyncError, type DeviceSyncError } from "../errors.ts";
import type { JunctionDeviceSyncJobPayloads } from "../config/provider-manifests.ts";
import {
  isHostedRuntimeIdShapedDiagnosticToken,
  sanitizeHostedRuntimeDiagnosticText,
} from "../hosted-runtime.ts";
import {
  isJunctionCredentialIndependentInlineImportJob,
  resolveDeviceSyncJunctionInlineSourceProviderSlug,
} from "../junction-inline-authority.ts";
import {
  addJunctionBloodPressureHistoryBackfillCoverage,
  addJunctionHistoricalBackfillEvidence,
  canCurrentRuntimeMutateJunctionBloodPressureHistoryBackfillCoverage,
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  encodeJunctionHistoricalBackfillStatus,
  hasJunctionBloodPressureHistoryBackfillCoverage,
  hasJunctionHistoricalBackfillEvidence,
  JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION,
  JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS,
  readJunctionHistoricalBackfillEvidence,
  readJunctionHistoricalBackfillStatus,
  type JunctionHistoricalBackfillEvidence,
  type JunctionHistoricalBackfillEvidenceResource,
  type JunctionHistoricalBackfillStatus,
} from "../junction-historical-backfill-progress.ts";
import { DEVICE_SYNC_METADATA_MAX_STRING_LENGTH } from "../metadata.ts";
import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
  isDeviceSyncSourceAdmitted,
  isDeviceSyncSourceDisconnectFenced,
  isJunctionHistoricalResetProviderSlug,
  requiresHistoricalResetDeviceSyncSource,
} from "../public-account.ts";
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
  JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE,
  JUNCTION_COMPANION_HRV_SOURCE_PROVIDER,
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE,
  JunctionCompanionHealthMetadataParseError,
  parseJunctionCompanionHealthMetadataBatch,
  type JunctionCompanionHealthMetadataRecord,
} from "../junction-resources.ts";
import {
  JunctionClient,
  type JunctionClientConfig,
  type JunctionDateQueryFormat,
  type JunctionBulkTriggerHistoricalPullResult,
  type JunctionHistoricalPullSnapshot,
  type JunctionProviderConnection,
  type JunctionWindowInput,
} from "./junction-client.ts";
import { resolveJunctionDeviceConnectRouteByProviderSlug } from "../config/connect-routes.ts";
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
import { evaluatePushPrimarySourceStaleness } from "../source-staleness.ts";
import {
  JUNCTION_PUSH_SOURCE_RECOVERY_JOB_KIND,
  JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS,
  buildJunctionPushSourceRecoveryMetadataPatch,
  readJunctionPushSourceRecoveryState,
  resolveJunctionPushSourceRecoveryAttempts,
  resolveJunctionPushSourceRecoveryStatus,
  selectDueJunctionPushSourceRecovery,
} from "../junction-push-source-recovery.ts";

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

interface JunctionPreciseTimeseriesImportResult extends JunctionTimeseriesImportResult {
  canonicalProviderRecordIdentities: readonly string[];
  canonicalEventCount: number;
  fetchComplete: boolean;
  postFetchSourceAdmission?: JunctionCurrentSourceAdmission;
  providerRecordCount: number;
  unresolvedProviderRecordIdentities: readonly string[];
  unresolvedProviderRecordCount: number;
  unresolvedProviderRecordsWithoutStableIdentity: boolean;
}

interface JunctionPreciseTimeseriesImportOptions {
  historicalProviderRecordsSeen?: boolean;
  preservePartialRetryableFailure?: boolean;
  sourceStatusRequirement?: JunctionImportSourceStatusRequirement;
}

interface JunctionDirectSummaryImportResult {
  durableDeliveryAccepted: boolean;
  normalizationEvidence: readonly JunctionSummaryNormalizationEvidence[];
}

interface JunctionImportAdmissionSource {
  lastErrorCode?: string | null;
  sourceProviderSlug: string;
  status: DeviceConnectionSourceStatus;
}

type JunctionImportSourceStatusRequirement = "connected" | "not_disconnected";
type JunctionCurrentSourceAdmission = "admitted" | "fenced" | "pending";

interface JunctionHistoricalUnresolvedProviderRecords {
  identities: readonly string[];
  withoutStableIdentity: boolean;
}

interface PreparedJunctionImportSnapshot {
  connections: Array<Record<string, unknown>>;
  sourceProviders: readonly JunctionProviderConnection[];
  snapshots: Record<string, unknown[]>;
}

interface JunctionHistoricalBackfillCoverage {
  complete: boolean;
  pendingProviderSlugs: string[];
  reconnectProviderSlugs: string[];
}

type JunctionHistoricalBackfillFollowUp = Pick<ProviderJobResult, "metadataPatch" | "nextReconcileAt" | "scheduledJobs">;

type JunctionResourceCategory = "summary" | "timeseries";

interface JunctionDirectResourceJobInput {
  record: Record<string, unknown>;
  resource: string;
  resourceCategory: "summary";
  sourceProviderSlug: string;
  windowEnd: string;
  windowStart: string;
}

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

// Mirrors the pinned Junction SDK's `serialization.date()` wire validation.
// Keeping this predicate local avoids loading the SDK's generated runtime tree
// merely to identify one five-field completion envelope.
const JUNCTION_SDK_ISO_8601_DATE_PATTERN = /^([+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-2])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24:?00)([.,]\d+(?!:))?)?(\17[0-5]\d([.,]\d+)?)?([zZ]|([+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$/;

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
// Resource availability describes permission/capability, not whether the
// member should have a row. Limit connect-window obligations to high-signal
// daily families; sparse sessions such as workouts and body measurements still
// count as useful data, but their absence is not evidence of a failed export.
const JUNCTION_HISTORICAL_BACKFILL_REQUIRED_SUMMARY_RESOURCES = Object.freeze([
  "activity",
  "sleep",
  "sleep_cycle",
] as const satisfies readonly JunctionHistoricalBackfillEvidenceResource[]);
const JUNCTION_HISTORICAL_BACKFILL_REQUIRED_SUMMARY_RESOURCE_SET = new Set<string>(
  JUNCTION_HISTORICAL_BACKFILL_REQUIRED_SUMMARY_RESOURCES,
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

const JUNCTION_WEBHOOK_NESTED_RECORD_KEYS = Object.freeze([
  "data",
  "results",
  "items",
  "records",
] as const);
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
// Sparse paired readings are cheap enough to backfill across the full
// summary-history window. Dense timeseries retain the bounded default
// below, and an explicit timeseriesBackfillDays override still wins.
const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES = Object.freeze([
  "blood_pressure",
] as const);
const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES = Object.freeze({
  blood_pressure: {
    metadataKey: JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
    version: 1,
  },
} as const satisfies Record<
  (typeof JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES)[number],
  { metadataKey: string; version: number }
>);
const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET = new Set<string>(
  JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES,
);
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
const JUNCTION_HISTORICAL_UNRESOLVED_PROVIDER_RECORD_IDENTITIES_VERSION = 1;
const JUNCTION_BLOOD_PRESSURE_PROVIDER_RECORD_IDENTITY_PATTERN =
  /^blood-pressure-[0-9a-f]{16}$/u;
const JUNCTION_SCHEDULED_RECONCILE_PRIORITY = 40;
const JUNCTION_HISTORICAL_BACKFILL_PRIORITY = 30;
const JUNCTION_HISTORICAL_BACKFILL_RETRY_PRIORITY = 50;

export function createJunctionDeviceSyncProvider(
  config: JunctionDeviceSyncProviderConfig,
): DeviceSyncProvider {
  const runtimeConfig = normalizeJunctionDeviceSyncRuntimeConfig(config);
  const client = new JunctionClient(toClientConfig(config));
  const { providerFilter, summaryResources, timeseriesResources } = runtimeConfig;
  const summaryBackfillDays = config.summaryBackfillDays ?? DEFAULT_SUMMARY_BACKFILL_DAYS;
  const timeseriesBackfillDays = config.timeseriesBackfillDays ?? DEFAULT_TIMESERIES_BACKFILL_DAYS;
  const extendedTimeseriesBackfillDays = config.timeseriesBackfillDays ?? summaryBackfillDays;
  const extendedBackfillTimeseriesResources = timeseriesResources.filter(
    (resource) => JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET.has(resource),
  );
  const reconcileDays = config.reconcileDays ?? DEFAULT_RECONCILE_DAYS;
  const pushSourceRecoveryEnabled = config.pushSourceRecoveryEnabled === true;
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
      initialJobs: buildInitialJobs(context.now, context.sourceProviderSlug),
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
          .filter((provider) => mapJunctionSourceStatus(provider.status) !== "disconnected")
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
        message: "Junction provider deregistration failed for one or more sources.",
        retryable: true,
        httpStatus: 503,
        details: {
          providerSlugs: failedProviderSlugs,
        },
      });
    }
  }

  async function revokeSourceAccess(
    account: DeviceSyncAccount,
    sourceProviderSlug: string,
  ): Promise<void> {
    const userId = normalizeString(account.externalAccountId);
    const targetProviderSlug = normalizeProviderSlug(sourceProviderSlug);
    if (!userId || !targetProviderSlug) {
      throw deviceSyncError({
        code: "JUNCTION_SOURCE_DEREGISTER_INPUT_INVALID",
        message: "Junction source cleanup requires a stored user and provider slug.",
        retryable: false,
        httpStatus: 409,
      });
    }

    const providers = await client.listUserProviders(userId);
    const targetIsRegistered = providers.some((provider) =>
      mapJunctionSourceStatus(provider.status) !== "disconnected"
      && (
        normalizeProviderSlug(provider.origin.sourceProviderSlug)
        ?? normalizeProviderSlug(provider.slug)
      ) === targetProviderSlug
    );
    if (!targetIsRegistered) {
      return;
    }

    await client.deregisterProvider({
      providerSlug: targetProviderSlug,
      userId,
    });
  }

  async function isSourceAccessActive(
    account: DeviceSyncAccount,
    sourceProviderSlug: string,
  ): Promise<boolean> {
    const userId = normalizeString(account.externalAccountId);
    const targetProviderSlug = normalizeProviderSlug(sourceProviderSlug);
    if (!userId || !targetProviderSlug) {
      throw deviceSyncError({
        code: "JUNCTION_SOURCE_STATUS_INPUT_INVALID",
        message: "Junction source status requires a stored user and provider slug.",
        retryable: false,
        httpStatus: 409,
      });
    }

    return (await client.listUserProviders(userId)).some((provider) =>
      mapJunctionSourceStatus(provider.status) !== "disconnected"
      && (
        normalizeProviderSlug(provider.origin.sourceProviderSlug)
        ?? normalizeProviderSlug(provider.slug)
      ) === targetProviderSlug
    );
  }

  function createScheduledJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): ProviderScheduleResult {
    const scheduledHistoricalBackfillJobs = buildScheduledHistoricalBackfillJobs(account, now);
    const scheduledExtendedTimeseriesBackfillJobs =
      buildScheduledExtendedTimeseriesBackfillJobs(account, now);
    const nextReconcileAt = resolveJunctionNextReconcileAt(
      account,
      now,
      addMilliseconds(now, reconcileIntervalMs),
    );

    return {
      jobs: [
        buildWindowJob({
          kind: "reconcile",
          now,
          windowStart: subtractDays(now, reconcileDays),
          priority: JUNCTION_SCHEDULED_RECONCILE_PRIORITY,
        }),
        ...scheduledHistoricalBackfillJobs,
        ...scheduledExtendedTimeseriesBackfillJobs,
        ...buildPushSourceRecoveryJobs(account, now),
      ],
      nextReconcileAt,
    };
  }

  function buildScheduledExtendedTimeseriesBackfillJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): DeviceSyncJobInput[] {
    return extendedBackfillTimeseriesResources.flatMap((resource) => {
      const policy = resolveJunctionExtendedTimeseriesBackfillPolicy(resource);
      if (!policy) {
        return [];
      }
      const storedCoverage = account.metadata[policy.metadataKey];
      if (!canCurrentRuntimeMutateJunctionBloodPressureHistoryBackfillCoverage(
        storedCoverage,
        policy.version,
      )) {
        return [];
      }

      const scheduledSources = new Map<string, string>();
      for (const source of account.sources ?? []) {
        const sourceProviderSlug = normalizeProviderSlug(source.sourceProviderSlug);
        if (
          !sourceProviderSlug
          || !isDeviceSyncSourceAdmitted(account.sources ?? [], sourceProviderSlug)
          || !isJunctionResourceAdvertisedAvailable(
            source.resourceAvailabilitySummary?.[resource],
          )
          || hasJunctionBloodPressureHistoryBackfillCoverage(
            storedCoverage,
            sourceProviderSlug,
            policy.version,
          )
        ) {
          continue;
        }
        const existingFirstSeenAt = scheduledSources.get(sourceProviderSlug);
        if (!existingFirstSeenAt || Date.parse(source.firstSeenAt) < Date.parse(existingFirstSeenAt)) {
          scheduledSources.set(sourceProviderSlug, source.firstSeenAt);
        }
      }

      return [...scheduledSources.entries()].map(([sourceProviderSlug, firstSeenAt]) => {
        const window = buildExtendedTimeseriesBackfillWindow(firstSeenAt);
        return buildExtendedTimeseriesBackfillJob({
          availableAt: now,
          historicalWindowStart: window.windowStart,
          resource,
          sourceProviderSlug,
          windowEnd: window.windowEnd,
          windowStart: window.windowStart,
        });
      });
    });
  }

  /**
   * A dead push carrier cannot recover on its own and no pull can rediscover
   * its data, so the scheduler turns a detected stall into a bounded recovery
   * attempt. Like the historical-backfill ladder above, the retry state lives in
   * connection metadata and the job queue holds no second retry identity.
   */
  function buildPushSourceRecoveryJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): DeviceSyncJobInput[] {
    // Off until the vendor enables the trigger endpoint for this team. Shipping
    // the code and switching it on are separate steps so the rollout does not
    // depend on a support request landing first, and so it can be switched off
    // again without a deploy if the endpoint misbehaves.
    if (!pushSourceRecoveryEnabled) {
      return [];
    }

    const stale = evaluatePushPrimarySourceStaleness({
      now,
      sources: (account.sources ?? []).map((source) => ({
        firstSeenAt: source.firstSeenAt,
        lastDataAt: source.lastDataAt,
        sourceProviderSlug: source.sourceProviderSlug,
        status: source.status,
      })),
    });
    const due = selectDueJunctionPushSourceRecovery({
      metadata: account.metadata,
      now,
      stale,
    });

    if (!due) {
      return [];
    }

    return [{
      kind: JUNCTION_PUSH_SOURCE_RECOVERY_JOB_KIND,
      payload: {
        silentSinceAt: due.silentSinceAt,
        sourceProviderSlug: due.sourceProviderSlug,
      } satisfies JunctionDeviceSyncJobPayloads["push_source_recovery"],
      priority: JUNCTION_HISTORICAL_BACKFILL_RETRY_PRIORITY,
      availableAt: now,
      // One attempt per episode may be queued at a time.
      dedupeKey: sha256Text(JSON.stringify([
        "junction-push-source-recovery",
        due.sourceProviderSlug,
        due.silentSinceAt,
        readJunctionPushSourceRecoveryState(account.metadata).attempts,
      ])),
    }];
  }

  // Connect-time retry state is owned by metadata. The scheduler materializes
  // one due backfill job from that state instead of storing a second retry
  // identity in the job queue.
  function buildScheduledHistoricalBackfillJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): DeviceSyncJobInput[] {
    const metadata = account.metadata;
    if (!canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(metadata)) {
      return [];
    }

    const statusState = readHistoricalBackfillStatus(metadata);
    const status = statusState?.status ?? null;
    const connectWindow = buildConnectHistoricalBackfillWindow(account, summaryBackfillDays);
    const metadataWindowStart = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]);
    const metadataWindowEnd = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]);
    const metadataMatchesConnectWindow =
      metadataWindowStart === connectWindow.windowStart
      && metadataWindowEnd === connectWindow.windowEnd;
    const coverageVersion = statusState?.coverageVersion ?? 0;
    const hasCurrentCoverageSemantics =
      coverageVersion >= JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION;

    if (
      hasCurrentCoverageSemantics
      && (status === "complete" || status === "exhausted")
      && metadataMatchesConnectWindow
    ) {
      return [];
    }

    if (hasCurrentCoverageSemantics && status === "retrying" && metadataMatchesConnectWindow) {
      const retryAt = readPendingConnectHistoricalBackfillRetryAt(account);
      const retryAtMs = retryAt ? Date.parse(retryAt) : NaN;
      if (retryAt && Number.isFinite(retryAtMs) && Date.parse(now) < retryAtMs) {
        return [];
      }

      return [buildExactWindowJob({
        kind: "backfill",
        windowStart: connectWindow.windowStart,
        windowEnd: connectWindow.windowEnd,
        availableAt: now,
        priority: JUNCTION_HISTORICAL_BACKFILL_RETRY_PRIORITY,
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
      availableAt: now,
      priority: JUNCTION_HISTORICAL_BACKFILL_PRIORITY,
    })];
  }

  function isConnectHistoricalBackfillWindow(
    account: Pick<DeviceSyncAccount, "connectedAt">,
    window: { windowEnd: string; windowStart: string },
  ): boolean {
    const connectHistoricalWindow = buildConnectHistoricalBackfillWindow(
      account,
      summaryBackfillDays,
    );
    return (
      window.windowStart === connectHistoricalWindow.windowStart
      && window.windowEnd === connectHistoricalWindow.windowEnd
    );
  }

  function readPendingConnectHistoricalBackfillRetryAt(
    account: Pick<DeviceSyncAccount, "connectedAt" | "metadata">,
  ): string | null {
    const connectWindow = buildConnectHistoricalBackfillWindow(account, summaryBackfillDays);
    return readPendingHistoricalBackfillRetryAt(
      account.metadata,
      connectWindow.windowStart,
      connectWindow.windowEnd,
    );
  }

  function resolveJunctionNextReconcileAt(
    account: Pick<DeviceSyncAccount, "connectedAt" | "metadata">,
    now: string,
    fallbackNextReconcileAt: string,
  ): string {
    const retryAt = readPendingConnectHistoricalBackfillRetryAt(account);
    if (!retryAt) {
      return fallbackNextReconcileAt;
    }

    const retryAtMs = Date.parse(retryAt);
    if (!Number.isFinite(retryAtMs) || Date.parse(now) >= retryAtMs) {
      return fallbackNextReconcileAt;
    }

    const fallbackMs = Date.parse(fallbackNextReconcileAt);
    return Number.isFinite(fallbackMs) && fallbackMs <= retryAtMs
      ? fallbackNextReconcileAt
      : retryAt;
  }

  async function loadJunctionHistoricalPullSnapshot(
    context: ProviderJobContext,
  ): Promise<JunctionHistoricalPullSnapshot | null> {
    try {
      return await client.introspectHistoricalPull({
        signal: context.signal ?? null,
        userId: context.account.externalAccountId,
        userLimit: 1,
      });
    } catch (error) {
      if (context.signal?.aborted) {
        throw error;
      }

      context.logger.warn?.("Junction historical-pull introspection was unavailable; using canonical import evidence.", {
        provider: "junction",
        errorCode: isDeviceSyncError(error) ? error.code : "JUNCTION_HISTORICAL_PULL_INTROSPECTION_FAILED",
      });
      return null;
    }
  }

  /**
   * Asks Junction to re-run the provider's historical pull for one stalled
   * source. Junction gates this endpoint per team, so a gated answer records a
   * terminal `unavailable` rather than burning the ladder on retries that
   * cannot succeed.
   */
  async function executePushSourceRecoveryJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
  ): Promise<ProviderJobResult> {
    const sourceProviderSlug = normalizeProviderSlug(job.payload.sourceProviderSlug);
    const silentSinceAt = normalizeString(job.payload.silentSinceAt);

    if (!sourceProviderSlug || !silentSinceAt) {
      return {};
    }

    // Scheduling and execution are separate phases. Between them a webhook can
    // land, the source can disconnect, or a newer stall episode can replace this
    // one. Triggering anyway would be an avoidable provider mutation against an
    // episode that already ended, and would let the scheduler immediately fire
    // again for the newer episode, so an obsolete job completes untouched.
    const stillStale = evaluatePushPrimarySourceStaleness({
      now: context.now,
      sources: (context.account.sources ?? []).map((source) => ({
        firstSeenAt: source.firstSeenAt,
        lastDataAt: source.lastDataAt,
        sourceProviderSlug: source.sourceProviderSlug,
        status: source.status,
      })),
    }).some((entry) =>
      entry.sourceProviderSlug === sourceProviderSlug
      && entry.silentSinceAt === silentSinceAt
    );

    if (!stillStale) {
      return {};
    }

    const state = readJunctionPushSourceRecoveryState(context.account.metadata);
    const isRecordedEpisode = state.silentSinceAt === silentSinceAt
      && state.sourceProviderSlug === sourceProviderSlug;
    const priorAttempts = isRecordedEpisode ? state.attempts : 0;

    // This is a one-shot external mutation, so once it can be dispatched the
    // attempt must be consumed no matter how the pass ends. Deliberately not
    // cancellable: a foreground yield mid-flight would release the job back to
    // the queue without its metadata patch, and the remote trigger may already
    // have been accepted, so the next run would re-send it without advancing
    // the ladder. Every other Junction job is a replay-safe read; this one is
    // not. The call is a single POST already bounded by the client timeout.
    //
    // Known residual window: the attempt is recorded through the job's metadata
    // patch, which commits after this returns. If the worker dies or loses its
    // lease between the provider accepting the POST and that commit, the
    // reclaimed job re-sends one trigger. Closing it needs either a provider
    // idempotency key (Junction documents none) or a durable claim written
    // before the send, which today would mean a second metadata-write owner on
    // the job context. The bounded consequence -- one extra historical-pull
    // request per crash, re-delivering data rather than corrupting it -- does
    // not justify that, so it is accepted and recorded here rather than hidden.
    //
    // A failure is recorded rather than thrown for the same reason: letting the
    // error escape would leave the episode at its previous count and the next
    // scheduled pass would derive the identical attempt again, indefinitely.
    let endpointUnavailable = false;
    let failureCode: string | null = null;

    try {
      ({ endpointUnavailable } = await client.bulkTriggerHistoricalPull({
        sourceProviderSlug,
        userIds: [context.account.externalAccountId],
      }));
    } catch (error) {
      failureCode = isDeviceSyncError(error)
        ? error.code
        : "JUNCTION_PUSH_SOURCE_RECOVERY_TRIGGER_FAILED";
    }

    const attempts = resolveJunctionPushSourceRecoveryAttempts({
      endpointUnavailable,
      priorAttempts,
    });

    return {
      metadataPatch: {
        ...buildJunctionPushSourceRecoveryMetadataPatch({
          attempts,
          now: context.now,
          silentSinceAt,
          sourceProviderSlug,
          status: resolveJunctionPushSourceRecoveryStatus({
            attempts,
            endpointUnavailable,
          }),
        }),
        // Kept so a burned attempt stays diagnosable without a second owner.
        [JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.lastFailureCode]: failureCode,
      },
    };
  }

  async function executeJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
  ): Promise<ProviderJobResult> {
    const skippedOptionalResources: JunctionSkippedOptionalResource[] = [];

    if (job.kind === "resource") {
      return executeResourceJob(context, job, skippedOptionalResources);
    }

    if (job.kind === JUNCTION_PUSH_SOURCE_RECOVERY_JOB_KIND) {
      return executePushSourceRecoveryJob(context, job);
    }

    const window = resolveJobWindow(job, context.now, job.kind === "backfill" ? summaryBackfillDays : reconcileDays);
    const isConnectHistoricalBackfill = isConnectHistoricalBackfillWindow(context.account, window);
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
    const summaryHasFetchedRecords = hasJunctionSnapshotRecords(summaries);
    const preparedSummaryImport =
      job.kind === "backfill"
      && !summaryHasFetchedRecords
      && context.shouldYield?.() === true
        ? prepareJunctionImportSnapshotForSources(
            summaries,
            sourceProviders,
            context.account.sources ?? [],
          )
        : await prepareJunctionImportSnapshot(
            context,
            summaries,
            sourceProviders,
          );
    const importConnections = preparedSummaryImport.connections;
    const importSummaries = preparedSummaryImport.snapshots;
    const summaryNormalizationEvidence = classifyJunctionSummaryNormalizationEvidence({
      connections: importConnections,
      importedAt: summaryWindow.windowEnd,
      summaries: importSummaries,
      windowEnd: summaryWindow.windowEnd,
      windowStart: summaryWindow.windowStart,
    });
    const historicalSummaryHasRecords = hasJunctionHistoricalBackfillSummaryRecords(
      summaryNormalizationEvidence,
    );
    const jobTimeseriesResources = timeseriesResources;
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
        connections: importConnections,
        summaries: importSummaries,
        timeseries: {},
      });
    }
    // Current records are durable before the optional historical-status probe.
    // An unavailable introspection endpoint must not hold fresh ingestion hostage.
    const historicalPullSnapshot = isConnectHistoricalBackfill && !context.shouldYield?.()
      ? await loadJunctionHistoricalPullSnapshot(context)
      : null;
    const historicalSummaryCoverage = evaluateJunctionHistoricalBackfillCoverage(
      summaryNormalizationEvidence,
      preparedSummaryImport.sourceProviders,
      summaryResources,
      providerFilter,
      historicalPullSnapshot,
      isConnectHistoricalBackfill
        ? readJunctionHistoricalBackfillEvidence(
            context.account.metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
          )
        : null,
      window,
    );
    if (
      jobTimeseriesResources.length > 0
      && (
        job.kind === "backfill"
        || shouldImportClosedTimeseriesForReconcile(context.account.lastSyncCompletedAt, window.windowEnd)
      )
    ) {
      const timeseriesImport = await importTimeseriesDailySnapshots(
        context,
        sourceProviders,
        timeseriesWindowStart,
        window.windowEnd,
        skippedOptionalResources,
        jobTimeseriesResources,
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

    const backfillFollowUp = job.kind === "backfill"
      ? isConnectHistoricalBackfill
        ? buildHistoricalBackfillFollowUp({
            coverageComplete: historicalSummaryCoverage.complete,
            terminalFailure:
              historicalSummaryCoverage.pendingProviderSlugs.length > 0
              && historicalSummaryCoverage.pendingProviderSlugs.every((providerSlug) =>
                historicalSummaryCoverage.reconnectProviderSlugs.includes(providerSlug)
              ),
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
    const historicalStatusAfterJob = readJunctionHistoricalBackfillStatus(
      backfillFollowUp.metadataPatch?.[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status],
    ) ?? readHistoricalBackfillStatus(context.account.metadata);
    const historicalStatusBeforeJob = readHistoricalBackfillStatus(context.account.metadata);
    const saturatedRetryObserved =
      backfillFollowUp.metadataPatch !== undefined
      && historicalStatusBeforeJob?.coverageVersion
        === JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION
      && historicalStatusBeforeJob.status === "retrying"
      && readHistoricalBackfillEmptyAttempts(
        context.account.metadata,
        window.windowStart,
        window.windowEnd,
      ) >= EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS.length;
    if (
      isConnectHistoricalBackfill
      && (
        !historicalStatusBeforeJob
        || historicalStatusBeforeJob.coverageVersion
          <= JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION
      )
      && (
        historicalStatusAfterJob?.status === "exhausted"
        || saturatedRetryObserved
        || (
          historicalSummaryCoverage.complete
          && historicalStatusBeforeJob?.status === "exhausted"
        )
      )
    ) {
      const pendingProviderSlugs = new Set(historicalSummaryCoverage.pendingProviderSlugs);
      const hasCoveredProvider = preparedSummaryImport.sourceProviders.some((provider) => {
        const providerSlug = resolveJunctionHistoricalCoverageProviderSlug(
          provider.origin.sourceProviderSlug ?? provider.slug,
          providerFilter,
        );
        return providerSlug !== null
          && mapJunctionSourceStatus(provider.status) !== "disconnected"
          && !pendingProviderSlugs.has(providerSlug);
      });
      if (historicalSummaryCoverage.complete || hasCoveredProvider) {
        await projectJunctionSources(context, sourceProviders, {
          preserveHistoricalReconnectProviderSlugs:
            historicalSummaryCoverage.pendingProviderSlugs,
        });
      }
      if (!historicalSummaryCoverage.complete) {
        await markJunctionHistoricalReconnectRequired(
          context,
          historicalSummaryCoverage.reconnectProviderSlugs,
        );
      }
    }
    const nextReconcileAt = backfillFollowUp.nextReconcileAt ?? resolveJunctionNextReconcileAt(
      context.account,
      context.now,
      addMilliseconds(context.now, reconcileIntervalMs),
    );
    return withJunctionSkippedResourceMetadata(
      context,
      withJunctionMetadataPatch(
        {
          ...backfillFollowUp,
          nextReconcileAt,
        },
        profileMetadataPatch,
      ),
      skippedOptionalResources,
    );
  }

  async function markJunctionHistoricalReconnectRequired(
    context: ProviderJobContext,
    pendingProviderSlugs: readonly string[],
  ): Promise<void> {
    if (!context.upsertConnectionSource) {
      return;
    }

    const existingSources = context.listConnectionSources
      ? await context.listConnectionSources()
      : [];
    const existingByInstanceKey = new Map(
      existingSources.map((source) => [source.sourceInstanceKey, source] as const),
    );
    const recoveryProviderSlugs = new Set(
      pendingProviderSlugs
        .map(normalizeProviderSlug)
        .filter((providerSlug): providerSlug is string => providerSlug !== null),
    );

    for (const providerSlug of recoveryProviderSlugs) {
      if (!isJunctionHistoricalResetProviderSlug(providerSlug)) {
        continue;
      }

      const projectedSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: context.account.id,
        sourceProviderSlug: providerSlug,
      });
      if (!projectedSourceInstanceKey) {
        continue;
      }

      const existing = existingByInstanceKey.get(projectedSourceInstanceKey) ?? existingSources.find(
        (source) =>
          normalizeProviderSlug(source.sourceProviderSlug) === providerSlug,
      );
      if (
        existing?.status === "error"
        && existing.lastErrorCode === DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE
      ) {
        continue;
      }
      await context.upsertConnectionSource({
        sourceInstanceKey: existing?.sourceInstanceKey ?? projectedSourceInstanceKey,
        sourceProviderSlug: providerSlug,
        displayName: existing?.displayName ?? null,
        status: "error",
        ...(existing
          ? { resourceAvailabilitySummary: existing.resourceAvailabilitySummary }
          : {}),
        lastErrorCode: DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
        lastErrorMessage:
          "Historical data remained incomplete after bounded observation. A member-confirmed connection reset is required to restart its history export.",
        lastSeenAt: context.now,
      });
    }
  }

  function readJunctionDirectResourceJobInput(
    job: DeviceSyncJobRecord,
    window: { windowEnd: string; windowStart: string },
  ): JunctionDirectResourceJobInput | null {
    if (job.kind !== "resource") {
      return null;
    }

    const webhookDataJson = normalizeString(job.payload.webhookDataJson);
    if (!webhookDataJson) {
      return null;
    }
    if (!isJunctionCredentialIndependentInlineImportJob({
      kind: job.kind,
      payload: job.payload,
    })) {
      return null;
    }

    const resource = normalizeJunctionResourceName(job.payload.resource);
    if (!resource) {
      throw invalidJunctionDirectResourceClassification();
    }

    const resourceCategory = inferJunctionResourceJobCategory(
      normalizeString(job.payload.resourceCategory),
      resource,
    );
    if (resourceCategory !== "summary") {
      throw invalidJunctionDirectResourceClassification();
    }
    const record = parseJunctionWebhookDataJobRecord(webhookDataJson);
    if (!record) {
      throw invalidJunctionDirectResourceClassification();
    }

    // Provenance check only: a configured summary resource with a parseable
    // inline payload and a single, consistent source provider imports inline.
    // The downstream normalizer decides meaning (as it already does for
    // fetched records); there is no usefulness gate here.
    const sourceProviderSlug = resolveDeviceSyncJunctionInlineSourceProviderSlug(record);
    if (!sourceProviderSlug) {
      throw invalidJunctionDirectResourceClassification();
    }
    if (
      resource === "sleep_cycle"
      && !canNormalizeJunctionSleepCycleRecordToCompactStages(record, sourceProviderSlug)
    ) {
      throw invalidJunctionDirectResourceClassification();
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

  function invalidJunctionDirectResourceClassification(): DeviceSyncError {
    return deviceSyncError({
      code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
      message: "Junction direct resource authority classification was inconsistent.",
      retryable: false,
    });
  }

  function shouldLoadJunctionDirectResourceSourceProviders(input: JunctionDirectResourceJobInput): boolean {
    return (input.resource === "sleep_cycle" || input.resource === "sleep")
      && hasJunctionSourceReferenceIdentity(input.record);
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

    const summaryNormalizationEvidence = providerSnapshot.ok
      ? classifyJunctionSummaryNormalizationEvidence({
          connections: sanitizeJunctionImportConnections(sourceProviders),
          importedAt: window.windowEnd,
          summaries: sanitizeJunctionImportSnapshots(summaries, sourceProviders),
          windowEnd: window.windowEnd,
          windowStart: window.windowStart,
        })
      : [];

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
          hasUsefulHistoricalRecords: hasJunctionHistoricalBackfillSummaryRecords(
            summaryNormalizationEvidence,
          ),
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

    if (endpoint === "trigger_historical_pull") {
      const sourceProviderSlug = normalizeProviderSlug(context.sourceProviderSlug);
      if (!sourceProviderSlug) {
        throw deviceSyncError({
          code: "JUNCTION_TRIGGER_HISTORICAL_PULL_SOURCE_REQUIRED",
          message: "Junction historical pull triggers require a source provider slug.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const payloadResult = await runJunctionDiagnosticPayloadCall(() =>
        client.bulkTriggerHistoricalPull({
          sourceProviderSlug,
          userIds: [context.account.externalAccountId],
        })
      );

      return {
        generatedAt: context.now,
        provider: "junction",
        result: {
          request: {
            endpoint: "trigger_historical_pull",
            endpointKind: "junction_bulk_trigger_historical_pull",
            method: "POST",
            sourceProviderSlug,
          },
          response: describeJunctionBulkTriggerHistoricalPull(payloadResult),
        },
      };
    }

    if (endpoint === "introspect_resources" || endpoint === "historical_pull") {
      const sourceProviderSlug = normalizeProviderSlug(context.sourceProviderSlug);
      const response = endpoint === "introspect_resources"
        ? describeJunctionIntrospectionResources(
            await runJunctionDiagnosticPayloadCall(() => client.introspectResources({
              sourceProviderSlug,
              userId: context.account.externalAccountId,
              userLimit: 1,
            })),
            sourceProviderSlug,
          )
        : describeJunctionIntrospectionHistoricalPull(
            await runJunctionDiagnosticPayloadCall(() => client.introspectHistoricalPull({
              sourceProviderSlug,
              userId: context.account.externalAccountId,
              userLimit: 1,
            })),
            sourceProviderSlug,
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
          response,
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
    const resourceName = normalizeString(job.payload.resource);

    if (resourceName === COMPANION_HRV_RMSSD_RESOURCE) {
      let observation;
      let admissionId;
      try {
        observation = parseSerializedCompanionHrvRmssdObservation(
          job.payload.companionObservationJson,
        );
        admissionId = parseCompanionHrvRmssdAdmissionId(
          job.payload.companionAdmissionId,
        );
        const expectedAdmissionId = createHash("sha256")
          .update(serializeCompanionHrvRmssdObservation(observation))
          .digest("hex");
        if (admissionId !== expectedAdmissionId) {
          throw new TypeError("Companion HRV admission identity did not match its observation.");
        }
      } catch {
        throw deviceSyncError({
          code: JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE,
          message: "Companion HRV observation payload was invalid.",
          retryable: false,
        });
      }

      if (!await isJunctionCompanionSourceCurrentlyAdmitted(
        context,
        JUNCTION_COMPANION_HRV_SOURCE_PROVIDER,
      )) {
        return {};
      }
      await context.importSnapshot({
        provider: "junction",
        accountId: buildJunctionImportAccountId(context.account.externalAccountId),
        connectionId: context.account.id,
        importedAt: context.now,
        companionHrvRmssd: { admissionId, observation },
      });
      return {};
    }

    const window = resolveJobWindow(job, context.now, reconcileDays);
    if (normalizeString(job.payload.resource) === JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE) {
      const records = parseJunctionCompanionHealthMetadataJob(job);
      if (!await isJunctionCompanionSourceCurrentlyAdmitted(
        context,
        JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      )) {
        return {};
      }
      await importJunctionCompanionHealthMetadataSnapshot(context, records);
      return {
        nextReconcileAt: clampWebhookJobNextReconcileAt(context),
      };
    }

    const resource = normalizeJunctionResourceName(job.payload.resource);
    const resourceCategory = normalizeString(job.payload.resourceCategory);
    const sourceProviderSlug = normalizeProviderSlug(job.payload.sourceProviderSlug);
    if (
      sourceProviderSlug
      && !isJunctionSourceAdmittedForImport(
        context.account.sources ?? [],
        sourceProviderSlug,
      )
      && (
        resource === null
        || !isJunctionExtendedTimeseriesBackfillJob(job, resource)
        || isJunctionSourceProjectionFenced(
          context.account.sources ?? [],
          sourceProviderSlug,
        )
      )
    ) {
      return {};
    }
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
      const directInput = readJunctionDirectResourceJobInput(job, window);
      if (directInput) {
        if (
          !isJunctionSourceAdmittedForImport(
            context.account.sources ?? [],
            directInput.sourceProviderSlug,
          )
        ) {
          return {};
        }
        // This lookup uses the stable provider-config authority, not the
        // replaceable per-connection credential epoch. It resolves source
        // provenance only; the accepted inline payload remains the data
        // carrier and the floor remains the sole projection owner.
        const sourceProviders = shouldLoadJunctionDirectResourceSourceProviders(directInput)
          ? await loadSourceProviders()
          : [];
        const connectHistoricalWindow = buildConnectHistoricalBackfillWindow(
          context.account,
          summaryBackfillDays,
        );
        const importResult = await importJunctionDirectResourceSnapshot(
          context,
          sourceProviders,
          directInput.windowStart,
          directInput.windowEnd,
          directInput.resource,
          [directInput.record],
          connectHistoricalWindow,
        );
        const directHistoricalWindow = readJunctionDirectHistoricalEvidenceWindow(
          directInput,
          connectHistoricalWindow,
          importResult.normalizationEvidence,
          providerFilter,
        );
        return withJunctionHistoricalCoverageVerification(
          context,
          job,
          directHistoricalWindow,
          withJunctionDirectHistoricalBackfillEvidence(
            context,
            job,
            directInput,
            directHistoricalWindow,
            importResult,
            { nextReconcileAt: clampWebhookJobNextReconcileAt(context) },
          ),
        );
      }

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

      if (inferredCategory === "timeseries") {
        const extendedHistoricalBackfill =
          isJunctionExtendedTimeseriesBackfillJob(job, effectiveResource);
        let sourceProviders: readonly JunctionProviderConnection[];
        let currentSourceAdmission: "admitted" | "fenced" | "pending" = "admitted";
        try {
          sourceProviders = await loadAndProjectSourceProviders();
          if (extendedHistoricalBackfill && sourceProviderSlug) {
            currentSourceAdmission = await resolveJunctionCurrentSourceAdmission(
              context,
              sourceProviderSlug,
            );
          }
        } catch (error) {
          if (
            extendedHistoricalBackfill
            && (
              job.payload.historicalProviderRecordsSeen === true
              || job.payload.historicalRecordsSeen === true
            )
            && isRetryableDeviceSyncFailure(error)
          ) {
            return withJunctionExtendedTimeseriesBackfillFollowUp({
              context,
              importResult: {
                canonicalProviderRecordIdentities: [],
                canonicalEventCount: 0,
                fetchComplete: false,
                providerRecordCount: 0,
                unresolvedProviderRecordIdentities: [],
                unresolvedProviderRecordCount: 0,
                unresolvedProviderRecordsWithoutStableIdentity: false,
                yieldedAt: null,
              },
              job,
              resource: effectiveResource,
              result: {
                nextReconcileAt: clampWebhookJobNextReconcileAt(context),
              },
              window,
            });
          }
          throw error;
        }
        if (currentSourceAdmission === "fenced") {
          return {};
        }
        if (
          extendedHistoricalBackfill
          && (
            currentSourceAdmission !== "admitted"
            || !isJunctionSourceResourceCurrentlyAvailable({
              connectionId: context.account.id,
              providers: sourceProviders,
              resource: effectiveResource,
              sourceProviderSlug,
            })
          )
        ) {
          const result = {
            nextReconcileAt: clampWebhookJobNextReconcileAt(context),
          };
          if (
            job.payload.historicalProviderRecordsSeen !== true
            && job.payload.historicalRecordsSeen !== true
          ) {
            return result;
          }
          return withJunctionExtendedTimeseriesBackfillFollowUp({
            context,
            importResult: {
              canonicalProviderRecordIdentities: [],
              canonicalEventCount: 0,
              fetchComplete: false,
              providerRecordCount: 0,
              unresolvedProviderRecordIdentities: [],
              unresolvedProviderRecordCount: 0,
              unresolvedProviderRecordsWithoutStableIdentity: false,
              yieldedAt: null,
            },
            job,
            resource: effectiveResource,
            result,
            window,
          });
        }
        const timeseriesImport = await importTimeseriesPreciseSnapshots(
          context,
          sourceProviders,
          window.windowStart,
          window.windowEnd,
          skippedOptionalResources,
          [effectiveResource],
          sourceProviderSlug,
          {
            historicalProviderRecordsSeen:
              job.payload.historicalProviderRecordsSeen === true,
            preservePartialRetryableFailure: extendedHistoricalBackfill,
            sourceStatusRequirement: extendedHistoricalBackfill
              ? "connected"
              : undefined,
          },
        );
        if (
          extendedHistoricalBackfill
          && timeseriesImport.postFetchSourceAdmission === "fenced"
        ) {
          return {};
        }
        if (
          extendedHistoricalBackfill
          && timeseriesImport.postFetchSourceAdmission === "pending"
          && job.payload.historicalProviderRecordsSeen !== true
          && job.payload.historicalRecordsSeen !== true
          && timeseriesImport.providerRecordCount === 0
        ) {
          return withJunctionSkippedResourceMetadata(
            context,
            {
              nextReconcileAt: clampWebhookJobNextReconcileAt(context),
            },
            skippedOptionalResources,
          );
        }
        const historicalRecordsSeen = extendedHistoricalBackfill
          ? job.payload.historicalRecordsSeen === true
            || timeseriesImport.canonicalEventCount > 0
          : undefined;
        const historicalUnresolvedProviderRecords = extendedHistoricalBackfill
          ? resolveJunctionHistoricalUnresolvedProviderRecords(
              job,
              timeseriesImport,
            )
          : undefined;
        const historicalUnresolvedProviderRecordCount =
          historicalUnresolvedProviderRecords === undefined
            ? undefined
            : countJunctionHistoricalUnresolvedProviderRecords(
                historicalUnresolvedProviderRecords,
              );
        const historicalUnresolvedProviderRecordIdentitiesJson =
          historicalUnresolvedProviderRecords === undefined
            ? undefined
            : encodeJunctionHistoricalUnresolvedProviderRecords(
                historicalUnresolvedProviderRecords,
              );
        const historicalProviderRecordsSeen =
          historicalUnresolvedProviderRecordCount === undefined
            ? undefined
            : historicalUnresolvedProviderRecordCount > 0;
        if (timeseriesImport.yieldedAt) {
          return withJunctionSkippedResourceMetadata(
            context,
            buildYieldedJunctionJobResult({
              context,
              historicalProviderRecordsSeen,
              historicalRecordsSeen,
              historicalUnresolvedProviderRecordIdentitiesJson,
              historicalUnresolvedProviderRecordCount,
              job,
              windowEnd: window.windowEnd,
              windowStart: timeseriesImport.yieldedAt,
            }),
            skippedOptionalResources,
          );
        }

        const result = withJunctionSkippedResourceMetadata(
          context,
          {
            nextReconcileAt: clampWebhookJobNextReconcileAt(context),
          },
          skippedOptionalResources,
        );
        return withJunctionHistoricalCoverageVerification(
          context,
          job,
          window,
          withJunctionExtendedTimeseriesBackfillFollowUp({
            context,
            importResult: timeseriesImport,
            job,
            resource: effectiveResource,
            result,
            window,
          }),
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
    const preparedImport = await prepareJunctionImportSnapshot(
      context,
      summaries,
      sourceProviders,
    );
    await context.importSnapshot({
      provider: "junction",
      accountId: buildJunctionImportAccountId(context.account.externalAccountId),
      connectionId: context.account.id,
      importedAt: context.now,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      connections: preparedImport.connections,
      summaries: preparedImport.snapshots,
      timeseries: {},
    });

    return withJunctionHistoricalCoverageVerification(
      context,
      job,
      window,
      withJunctionSkippedResourceMetadata(
        context,
        {
          nextReconcileAt: clampWebhookJobNextReconcileAt(context),
        },
        skippedOptionalResources,
      ),
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

  function withJunctionExtendedTimeseriesBackfillFollowUp(input: {
    context: ProviderJobContext;
    importResult: JunctionPreciseTimeseriesImportResult;
    job: DeviceSyncJobRecord;
    resource: string;
    result: ProviderJobResult;
    window: { windowEnd: string; windowStart: string };
  }): ProviderJobResult {
    if (!isJunctionExtendedTimeseriesBackfillJob(input.job, input.resource)) {
      return input.result;
    }

    const sourceProviderSlug = normalizeProviderSlug(input.job.payload.sourceProviderSlug);
    const historicalWindowStart =
      toIsoTimestampIfValid(normalizeString(input.job.payload.historicalWindowStart))
      ?? input.window.windowStart;
    const recordsSeen =
      input.job.payload.historicalRecordsSeen === true
      || input.importResult.canonicalEventCount > 0;
    const unresolvedProviderRecords =
      resolveJunctionHistoricalUnresolvedProviderRecords(
        input.job,
        input.importResult,
      );
    const unresolvedProviderRecordCount =
      countJunctionHistoricalUnresolvedProviderRecords(unresolvedProviderRecords);
    const unresolvedProviderRecordIdentitiesJson =
      encodeJunctionHistoricalUnresolvedProviderRecords(unresolvedProviderRecords);
    const unresolvedProviderRecordsSeen = unresolvedProviderRecordCount > 0;

    if (
      input.importResult.fetchComplete
      && recordsSeen
      && unresolvedProviderRecordCount === 0
    ) {
      return withJunctionMetadataPatch(
        input.result,
        buildJunctionExtendedTimeseriesBackfillCompletionMetadataPatch(
          input.context,
          input.resource,
          sourceProviderSlug,
        ),
      );
    }

    let emptyBackfillAttempts =
      readHistoricalBackfillJobEmptyAttempts(input.job) + 1;
    let retryDelayMs =
      EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyBackfillAttempts - 1]
      ?? null;
    if (
      retryDelayMs === null
      && (!input.importResult.fetchComplete || unresolvedProviderRecordsSeen)
    ) {
      emptyBackfillAttempts = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS.length;
      retryDelayMs =
        EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyBackfillAttempts - 1]
        ?? null;
    }
    if (retryDelayMs === null) {
      return withJunctionMetadataPatch(
        input.result,
        buildJunctionExtendedTimeseriesBackfillCompletionMetadataPatch(
          input.context,
          input.resource,
          sourceProviderSlug,
        ),
      );
    }

    return {
      ...input.result,
      scheduledJobs: [
        ...(input.result.scheduledJobs ?? []),
        buildExtendedTimeseriesBackfillJob({
          availableAt: addMilliseconds(input.context.now, retryDelayMs),
          dedupeKey: input.job.dedupeKey,
          emptyBackfillAttempts,
          historicalProviderRecordsSeen: unresolvedProviderRecordsSeen,
          historicalRecordsSeen: recordsSeen,
          historicalUnresolvedProviderRecordIdentitiesJson:
            unresolvedProviderRecordIdentitiesJson,
          historicalUnresolvedProviderRecordCount: unresolvedProviderRecordCount,
          historicalWindowStart,
          resource: input.resource,
          sourceProviderSlug,
          windowEnd: input.window.windowEnd,
          windowStart: input.importResult.fetchComplete
            ? historicalWindowStart
            : input.window.windowStart,
        }),
      ],
    };
  }

  function buildJunctionExtendedTimeseriesBackfillCompletionMetadataPatch(
    context: ProviderJobContext,
    resource: string,
    sourceProviderSlug: string | null,
  ): Record<string, unknown> {
    if (!sourceProviderSlug) {
      return {};
    }

    const policy = resolveJunctionExtendedTimeseriesBackfillPolicy(resource);
    if (!policy) {
      return {};
    }

    const coverage = addJunctionBloodPressureHistoryBackfillCoverage({
      existingValue: context.account.metadata[policy.metadataKey],
      providerSlug: sourceProviderSlug,
      version: policy.version,
    });
    return coverage ? { [policy.metadataKey]: coverage } : {};
  }

  function isJunctionExtendedTimeseriesBackfillJob(
    job: DeviceSyncJobRecord,
    resource: string,
  ): boolean {
    return job.kind === "resource"
      && job.payload.historicalBackfill === true
      && JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET.has(resource);
  }

  function withJunctionHistoricalCoverageVerification(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
    resourceWindow: { windowEnd: string; windowStart: string } | null,
    result: ProviderJobResult,
  ): ProviderJobResult {
    const historicalState = readHistoricalBackfillStatus(context.account.metadata);
    const eventType = normalizeString(job.payload.eventType);
    if (
      !historicalState
      || !resourceWindow
      || historicalState.coverageVersion > JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION
      || historicalState.status !== "exhausted"
      || !eventType
      || !isJunctionDataEvent(eventType)
    ) {
      return result;
    }

    const connectWindow = buildConnectHistoricalBackfillWindow(
      context.account,
      summaryBackfillDays,
    );
    if (
      Date.parse(resourceWindow.windowStart) >= Date.parse(connectWindow.windowEnd)
      || Date.parse(resourceWindow.windowEnd) <= Date.parse(connectWindow.windowStart)
    ) {
      return result;
    }

    return {
      ...result,
      scheduledJobs: [
        ...(result.scheduledJobs ?? []),
        buildExactWindowJob({
          availableAt: context.now,
          kind: "backfill",
          priority: JUNCTION_HISTORICAL_BACKFILL_RETRY_PRIORITY,
          windowEnd: connectWindow.windowEnd,
          windowStart: connectWindow.windowStart,
        }),
      ],
    };
  }

  function withJunctionDirectHistoricalBackfillEvidence(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
    directInput: JunctionDirectResourceJobInput,
    directHistoricalWindow: { windowEnd: string; windowStart: string } | null,
    importResult: JunctionDirectSummaryImportResult,
    result: ProviderJobResult,
  ): ProviderJobResult {
    const eventType = normalizeString(job.payload.eventType);
    const providerSlug = resolveJunctionHistoricalCoverageProviderSlug(
      directInput.sourceProviderSlug,
      providerFilter,
    );
    const acceptedCanonicalDelivery = importResult.durableDeliveryAccepted
      && providerSlug !== null
      && importResult.normalizationEvidence.some((entry) =>
        entry.resource === directInput.resource
        && canonicalizeJunctionHistoricalProviderSlug(entry.sourceProviderSlug) === providerSlug
      );
    if (
      !canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(context.account.metadata)
      || !directHistoricalWindow
      || !acceptedCanonicalDelivery
      || !eventType
      || !isJunctionDataEvent(eventType)
      || !providerSlug
      || !isJunctionHistoricalBackfillRequiredSummaryResource(directInput.resource)
    ) {
      return result;
    }

    const connectWindow = buildConnectHistoricalBackfillWindow(
      context.account,
      summaryBackfillDays,
    );
    const evidence = addJunctionHistoricalBackfillEvidence({
      existingValue:
        context.account.metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
      providerSlug,
      resource: directInput.resource,
      windowEnd: connectWindow.windowEnd,
      windowStart: connectWindow.windowStart,
    });
    if (!evidence) {
      context.logger.warn?.("Junction historical push evidence exceeded bounded metadata limits.", {
        provider: "junction",
        resource: directInput.resource,
      });
      return result;
    }

    return {
      ...result,
      metadataPatch: {
        ...(result.metadataPatch ?? {}),
        [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence]: evidence,
      },
    };
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
    const eventOccurredAt = extractJunctionWebhookOccurredAt(data);
    const occurredAt = eventOccurredAt ?? context.now;
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
      ...(eventOccurredAt ? { occurredAt: eventOccurredAt } : {}),
      providerSentAt: verified.providerSentAt,
      resourceCategory: resource?.category ?? null,
      sourceProviderSlug,
      // A historical-pull completion is a data-less notification, so accepting
      // its fetch job proves nothing arrived. Treating it as delivery would
      // refresh the arrival signal and hide the very stall this detects.
      dataSourceProviderSlug: isJunctionDataEvent(eventType)
          && !(
            isJunctionHistoricalDataEvent(eventType)
            && data !== null
            && isJunctionHistoricalPullCompletedWebhookData(data, externalAccountSelection.userId)
          )
        ? sourceProviderSlug
        : null,
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

      const request: JunctionWindowInput = {
        resource,
        signal: context.signal ?? null,
        userId: context.account.externalAccountId,
        windowStart,
        windowEnd,
      };
      if (options.dateQueryFormat) {
        request.dateQueryFormat = options.dateQueryFormat;
      }
      snapshots[resource] = await fetchOptionalJunctionResourceRecords(
        context,
        "summary",
        resource,
        skippedOptionalResources,
        () => client.listSummary(request),
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
        const request: JunctionWindowInput = {
          resource,
          signal: context.signal ?? null,
          sourceProviderSlug,
          userId: context.account.externalAccountId,
          windowStart: chunkWindowStart,
          windowEnd: chunkWindowEnd,
        };
        if (options.dateQueryFormat) {
          request.dateQueryFormat = options.dateQueryFormat;
        }
        const chunkRecords = await client.listTimeseries(request);
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
    options: JunctionPreciseTimeseriesImportOptions = {},
  ): Promise<JunctionPreciseTimeseriesImportResult> {
    const accumulatedTimeseries: Record<string, unknown[]> = {};
    let executionWindowEnd: string | null = null;
    let executionWindowStart: string | null = null;
    let fetchComplete = true;
    let yieldedAt: string | null = null;
    let canonicalProviderRecordIdentities: readonly string[] = [];
    let canonicalEventCount = 0;
    let postFetchSourceAdmission: JunctionCurrentSourceAdmission | undefined;

    const preciseWindows = buildPreciseTimeseriesWindows(windowStart, windowEnd);
    for (const [index, window] of preciseWindows.entries()) {
      if (context.shouldYield?.()) {
        fetchComplete = false;
        yieldedAt = window.windowStart;
        break;
      }

      const skippedResourceCountBeforeFetch = skippedOptionalResources.length;
      let timeseries: Record<string, unknown[]>;
      try {
        timeseries = await fetchTimeseriesSnapshots(
          context,
          window.windowStart,
          window.windowEnd,
          skippedOptionalResources,
          resources,
          sourceProviderSlug,
          { dateQueryFormat: "datetime" },
        );
      } catch (error) {
        if (
          options.preservePartialRetryableFailure === true
          && (
            options.historicalProviderRecordsSeen === true
            || hasJunctionSnapshotRecords(accumulatedTimeseries)
          )
          && (
            isRetryableDeviceSyncFailure(error)
            || isJunctionJobSignalAbort(error, context.signal)
          )
        ) {
          fetchComplete = false;
          break;
        }
        throw error;
      }

      if (skippedOptionalResources.length > skippedResourceCountBeforeFetch) {
        fetchComplete = false;
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
      if (
        options.preservePartialRetryableFailure === true
        && index < preciseWindows.length - 1
      ) {
        fetchComplete = false;
        yieldedAt = window.windowEnd;
        break;
      }
    }

    const dedupedTimeseries = dedupeJunctionTimeseriesSnapshotRecords(accumulatedTimeseries);
    const providerRecordCount = countJunctionSnapshotRecords(dedupedTimeseries);
    let unresolvedProviderRecordIdentities: readonly string[] = [];
    let unresolvedProviderRecordCount = providerRecordCount;
    let unresolvedProviderRecordsWithoutStableIdentity = providerRecordCount > 0;
    const fetchedProviderRecordIdentityEvidence =
      executionWindowStart && executionWindowEnd && providerRecordCount > 0
        ? identifyJunctionBloodPressureProviderRecords({
          connections: sanitizeJunctionImportConnections(sourceProviders),
          importedAt: executionWindowEnd,
          timeseries: sanitizeJunctionImportSnapshots(
            dedupedTimeseries,
            sourceProviders,
          ),
          windowStart: executionWindowStart,
          windowEnd: executionWindowEnd,
        })
        : null;
    if (fetchedProviderRecordIdentityEvidence) {
      unresolvedProviderRecordIdentities = uniqueJunctionProviderRecordIdentities(
        fetchedProviderRecordIdentityEvidence.repairStableExternalRefResourceIds,
      );
      unresolvedProviderRecordsWithoutStableIdentity =
        fetchedProviderRecordIdentityEvidence.providerRecordCount !== providerRecordCount
        || fetchedProviderRecordIdentityEvidence.repairStableExternalRefResourceIds.some(
          (identity) => identity === null,
        );
      unresolvedProviderRecordCount =
        unresolvedProviderRecordIdentities.length
        + (unresolvedProviderRecordsWithoutStableIdentity ? 1 : 0);
    }

    if (executionWindowStart && executionWindowEnd) {
      try {
        if (
          sourceProviderSlug
          && options.sourceStatusRequirement === "connected"
        ) {
          postFetchSourceAdmission = await resolveJunctionCurrentSourceAdmission(
            context,
            sourceProviderSlug,
          );
          if (postFetchSourceAdmission !== "admitted") {
            return {
              canonicalProviderRecordIdentities: [],
              canonicalEventCount: 0,
              fetchComplete: false,
              postFetchSourceAdmission,
              providerRecordCount,
              unresolvedProviderRecordIdentities,
              unresolvedProviderRecordCount,
              unresolvedProviderRecordsWithoutStableIdentity,
              yieldedAt: null,
            };
          }
        }
        if (fetchedProviderRecordIdentityEvidence) {
          const preparedImport = await prepareJunctionImportSnapshot(
            context,
            dedupedTimeseries,
            sourceProviders,
            {},
            options.sourceStatusRequirement,
          );
          if (hasJunctionSnapshotRecords(preparedImport.snapshots)) {
            const receipt = await context.importSnapshot({
              provider: "junction",
              accountId: buildJunctionImportAccountId(context.account.externalAccountId),
              connectionId: context.account.id,
              importedAt: executionWindowEnd,
              windowStart: executionWindowStart,
              windowEnd: executionWindowEnd,
              connections: preparedImport.connections,
              summaries: {},
              timeseries: preparedImport.snapshots,
            });
            canonicalEventCount = readProviderSnapshotCanonicalEventCount(receipt);
            const resolutionEvidence =
              resolveJunctionBloodPressureProviderRecordResolutionEvidence({
                canonicalEventCount,
                canonicalEventExternalRefResourceIds:
                  readProviderSnapshotCanonicalEventExternalRefResourceIds(receipt),
                providerRecordCount,
                providerRecordIdentityEvidence: fetchedProviderRecordIdentityEvidence,
              });
            canonicalProviderRecordIdentities =
              resolutionEvidence.canonicalProviderRecordIdentities;
            unresolvedProviderRecordIdentities =
              resolutionEvidence.unresolvedProviderRecordIdentities;
            unresolvedProviderRecordsWithoutStableIdentity =
              resolutionEvidence.unresolvedProviderRecordsWithoutStableIdentity;
            unresolvedProviderRecordCount =
              unresolvedProviderRecordIdentities.length
              + (unresolvedProviderRecordsWithoutStableIdentity ? 1 : 0);
          }
        }
      } catch (error) {
        if (
          options.preservePartialRetryableFailure === true
          && (
            options.historicalProviderRecordsSeen === true
            || providerRecordCount > 0
          )
          && (
            isRetryableDeviceSyncFailure(error)
            || isJunctionJobSignalAbort(error, context.signal)
          )
        ) {
          return {
            canonicalProviderRecordIdentities: [],
            canonicalEventCount: 0,
            fetchComplete: false,
            providerRecordCount,
            unresolvedProviderRecordIdentities,
            unresolvedProviderRecordCount,
            unresolvedProviderRecordsWithoutStableIdentity,
            yieldedAt: null,
          };
        }
        throw error;
      }
    }

    return {
      canonicalProviderRecordIdentities,
      canonicalEventCount,
      fetchComplete,
      ...(postFetchSourceAdmission === undefined
        ? {}
        : { postFetchSourceAdmission }),
      providerRecordCount,
      unresolvedProviderRecordIdentities,
      unresolvedProviderRecordCount,
      unresolvedProviderRecordsWithoutStableIdentity,
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

      const preparedImport = await prepareJunctionImportSnapshot(
        context,
        timeseries,
        sourceProviders,
      );
      if (hasJunctionSnapshotRecords(preparedImport.snapshots)) {
        await context.importSnapshot({
          provider: "junction",
          accountId: buildJunctionImportAccountId(context.account.externalAccountId),
          connectionId: context.account.id,
          importedAt: window.windowEnd,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          connections: preparedImport.connections,
          summaries: {},
          timeseries: preparedImport.snapshots,
        });
      }
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
    historicalEvidenceWindow: { windowEnd: string; windowStart: string },
  ): Promise<JunctionDirectSummaryImportResult> {
    const snapshots: Record<string, unknown[]> = { [resource]: [...records] };
    const preparedImport = await prepareJunctionImportSnapshot(
      context,
      snapshots,
      sourceProviders,
      {
        blockedStringValues: [context.account.externalAccountId],
      },
    );
    const connections = preparedImport.connections;
    const summaries = preparedImport.snapshots;
    const normalizationEvidence = classifyJunctionSummaryNormalizationEvidence({
      connections,
      importedAt: context.now,
      summaries,
      windowEnd,
      windowStart,
    }, historicalEvidenceWindow);

    if (!hasJunctionSnapshotRecords(summaries)) {
      return {
        durableDeliveryAccepted: false,
        normalizationEvidence,
      };
    }

    const receipt = await context.importSnapshot({
      provider: "junction",
      accountId: buildJunctionImportAccountId(context.account.externalAccountId),
      connectionId: context.account.id,
      importedAt: context.now,
      windowStart,
      windowEnd,
      connections,
      summaries,
      timeseries: {},
    });
    return {
      durableDeliveryAccepted: readProviderSnapshotDurableDeliveryAccepted(receipt),
      normalizationEvidence,
    };
  }

  async function importJunctionCompanionHealthMetadataSnapshot(
    context: ProviderJobContext,
    records: readonly JunctionCompanionHealthMetadataRecord[],
  ): Promise<void> {
    const summaries: Record<string, unknown[]> = {};
    const sleep = records
      .filter((record) => record.kind === "recovery_score")
      .map(buildJunctionCompanionRecoverySummary);
    const activity = records
      .filter((record) => record.kind === "workout_strain")
      .map(buildJunctionCompanionWorkoutStrainSummary);

    if (sleep.length > 0) {
      summaries.sleep = sleep;
    }
    if (activity.length > 0) {
      summaries.activity = activity;
    }

    await context.importSnapshot({
      provider: "junction",
      accountId: buildJunctionImportAccountId(context.account.externalAccountId),
      windowStart: records.reduce(
        (earliest, record) => minIsoTimestamp(earliest, record.startAt),
        records[0]!.startAt,
      ),
      windowEnd: records.reduce(
        (latest, record) => maxIsoTimestamp(latest, record.endAt),
        records[0]!.endAt,
      ),
      connections: [],
      summaries: sanitizeJunctionImportSnapshots(summaries, []),
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
    historicalProviderRecordsSeen?: boolean;
    historicalRecordsSeen?: boolean;
    historicalUnresolvedProviderRecordIdentitiesJson?: string;
    historicalUnresolvedProviderRecordCount?: number;
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
    historicalProviderRecordsSeen?: boolean;
    historicalRecordsSeen?: boolean;
    historicalUnresolvedProviderRecordIdentitiesJson?: string;
    historicalUnresolvedProviderRecordCount?: number;
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
      const emptyBackfillAttempts = readHistoricalBackfillJobEmptyAttempts(input.job);
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

    const payload: Record<string, unknown> = stripUndefined({
      ...input.job.payload,
      ...(input.historicalProviderRecordsSeen === undefined
        ? {}
        : { historicalProviderRecordsSeen: input.historicalProviderRecordsSeen }),
      ...(input.historicalRecordsSeen === undefined
        ? {}
        : { historicalRecordsSeen: input.historicalRecordsSeen }),
      historicalUnresolvedProviderRecordIdentitiesJson:
        input.historicalUnresolvedProviderRecordIdentitiesJson === undefined
          ? input.job.payload.historicalUnresolvedProviderRecordIdentitiesJson
          : input.historicalUnresolvedProviderRecordIdentitiesJson,
      historicalUnresolvedProviderRecordCount:
        input.historicalUnresolvedProviderRecordCount === undefined
          ? input.job.payload.historicalUnresolvedProviderRecordCount
          : input.historicalUnresolvedProviderRecordCount > 0
            ? input.historicalUnresolvedProviderRecordCount
            : undefined,
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    });
    return {
      kind: "resource",
      payload,
      priority: input.job.priority,
      dedupeKey: input.job.dedupeKey
        ?? buildJunctionExtendedTimeseriesBackfillDedupeKey(payload)
        ?? sha256Text(JSON.stringify([
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

  function buildExtendedTimeseriesBackfillWindow(
    anchorAt: string,
  ): { windowEnd: string; windowStart: string } {
    const windowEnd = floorUtcDayTimestamp(anchorAt);
    return {
      windowEnd,
      windowStart: floorUtcDayTimestamp(
        subtractDays(windowEnd, extendedTimeseriesBackfillDays),
      ),
    };
  }

  function resolveJunctionExtendedTimeseriesBackfillPolicy(
    resource: string,
  ): { metadataKey: string; version: number } | null {
    if (
      !Object.prototype.hasOwnProperty.call(
        JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES,
        resource,
      )
    ) {
      return null;
    }

    return JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES[
      resource as keyof typeof JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES
    ];
  }

  function buildInitialJobs(
    now: string,
    sourceProviderSlug?: string | null,
  ): DeviceSyncJobInput[] {
    const normalizedSourceProviderSlug = normalizeProviderSlug(sourceProviderSlug);
    const payload = normalizedSourceProviderSlug
      ? { sourceProviderSlug: normalizedSourceProviderSlug }
      : undefined;
    return [
      buildWindowJob({
        kind: "backfill",
        now,
        payload,
        windowStart: subtractDays(now, summaryBackfillDays),
        priority: JUNCTION_HISTORICAL_BACKFILL_PRIORITY,
      }),
      buildWindowJob({
        kind: "reconcile",
        now,
        payload,
        windowStart: subtractDays(now, reconcileDays),
        priority: JUNCTION_SCHEDULED_RECONCILE_PRIORITY,
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
      isSourceAccessActive,
      revokeAccess,
      revokeSourceAccess,
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

function isRetryableDeviceSyncFailure(error: unknown): boolean {
  return isDeviceSyncError(error) && error.retryable;
}

function isJunctionJobSignalAbort(
  error: unknown,
  signal: AbortSignal | undefined,
  depth = 0,
): boolean {
  if (!signal?.aborted) {
    return false;
  }
  if (error === signal.reason) {
    return true;
  }
  if (depth >= 4 || typeof error !== "object" || error === null) {
    return false;
  }

  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  return cause !== undefined && isJunctionJobSignalAbort(cause, signal, depth + 1);
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
  return /^[A-Za-z0-9_.:-]{1,128}$/u.test(token) && !isHostedRuntimeIdShapedDiagnosticToken(token)
    ? token
    : null;
}

interface JunctionDiagnosticCallResult {
  ok: boolean;
  records?: unknown[];
  errorDetails?: Record<string, unknown>;
  errorCode?: string;
  responseStatus?: number | null;
  retryable?: boolean;
}

interface JunctionDiagnosticPayloadResult<Payload = unknown> {
  ok: boolean;
  payload?: Payload;
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

async function runJunctionDiagnosticPayloadCall<Payload>(
  load: () => Promise<Payload>,
): Promise<JunctionDiagnosticPayloadResult<Payload>> {
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
  result: JunctionDiagnosticPayloadResult<JunctionHistoricalPullSnapshot>,
  requestedSourceProviderSlug: string | null,
): Record<string, unknown> {
  if (!result.ok) {
    return describeJunctionDiagnosticPayloadFailure(result, "JUNCTION_INTROSPECT_HISTORICAL_PULL_FAILED");
  }

  const sourceProviders = (result.payload?.sources ?? []).filter((source) =>
    !requestedSourceProviderSlug
    || normalizeProviderSlug(source.sourceProviderSlug) === requestedSourceProviderSlug
  );
  const sourceKeyMap = buildJunctionDiagnosticSourceKeyMap(sourceProviders);
  const pulled = [];
  const notPulled = [];

  for (const sourceProvider of sourceProviders) {
    for (const resource of sourceProvider.notPulledResources) {
      notPulled.push({
        resource,
        sourceKey: readJunctionDiagnosticSourceKey(sourceKeyMap, sourceProvider.sourceProviderSlug),
      });
    }

    for (const historicalResource of sourceProvider.pulledResources) {
      pulled.push({
        resource: historicalResource.resource,
        sourceKey: readJunctionDiagnosticSourceKey(sourceKeyMap, sourceProvider.sourceProviderSlug),
        status: historicalResource.status,
        daysWithData: historicalResource.daysWithData,
        rangeStart: historicalResource.rangeStart,
        rangeEnd: historicalResource.rangeEnd,
        hasErrorDetails: historicalResource.errorDetails !== null,
      });
    }
  }

  pulled.sort(compareJunctionDiagnosticSourceResourceEntries);
  notPulled.sort(compareJunctionDiagnosticSourceResourceEntries);

  return {
    ok: true,
    responseStatus: result.responseStatus ?? 200,
    matchedUser: result.payload?.matchedUser ?? false,
    sourceProviderCount: sourceProviders.length,
    pulledCount: pulled.length,
    notPulledCount: notPulled.length,
    pulled,
    notPulled,
  };
}

function describeJunctionBulkTriggerHistoricalPull(
  result: JunctionDiagnosticPayloadResult<JunctionBulkTriggerHistoricalPullResult>,
): Record<string, unknown> {
  if (!result.ok || !result.payload) {
    return describeJunctionDiagnosticPayloadFailure(
      result,
      "JUNCTION_TRIGGER_HISTORICAL_PULL_FAILED",
    );
  }

  return {
    ok: true,
    accepted: result.payload.accepted,
    // Link Migration endpoints are disabled per team by default, so this is the
    // expected answer until Junction support enables them.
    endpointUnavailable: result.payload.endpointUnavailable,
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
      if (normalizeProviderSlug(key) && isJunctionResourceAdvertisedAvailable(value)) {
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
  const statusState = readHistoricalBackfillStatus(metadata);
  return {
    coverageVersion: statusState?.coverageVersion ?? 0,
    status: statusState?.status ?? null,
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
    apiBaseUrl: config.apiBaseUrl,
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

async function prepareJunctionImportSnapshot(
  context: ProviderJobContext,
  snapshots: Record<string, unknown[]>,
  providers: readonly JunctionProviderConnection[],
  options: JunctionImportSnapshotSanitizeOptions = {},
  sourceStatusRequirement: JunctionImportSourceStatusRequirement = "not_disconnected",
): Promise<PreparedJunctionImportSnapshot> {
  const currentSources: readonly JunctionImportAdmissionSource[] =
    context.listConnectionSources
      ? await context.listConnectionSources()
      : context.account.sources ?? [];

  return prepareJunctionImportSnapshotForSources(
    snapshots,
    providers,
    currentSources,
    options,
    {
      allowUnlistedSources: context.connectionSourceAdmissionMode !== "listed_only",
      sourceStatusRequirement,
    },
  );
}

function prepareJunctionImportSnapshotForSources(
  snapshots: Record<string, unknown[]>,
  providers: readonly JunctionProviderConnection[],
  currentSources: readonly JunctionImportAdmissionSource[],
  options: JunctionImportSnapshotSanitizeOptions = {},
  admission: {
    allowUnlistedSources?: boolean;
    sourceStatusRequirement?: JunctionImportSourceStatusRequirement;
  } = {},
): PreparedJunctionImportSnapshot {
  const allowUnlistedSources = admission.allowUnlistedSources ?? true;
  const sourceStatusRequirement =
    admission.sourceStatusRequirement ?? "not_disconnected";
  const sourceProviders = providers.filter((provider) =>
    isJunctionSourceAdmittedForImport(
      currentSources,
      provider.origin.sourceProviderSlug ?? provider.slug,
      allowUnlistedSources,
      sourceStatusRequirement,
    )
  );

  return {
    connections: sanitizeJunctionImportConnections(sourceProviders),
    sourceProviders,
    snapshots: sanitizeJunctionImportSnapshots(
      filterJunctionImportSnapshots(
        snapshots,
        providers,
        currentSources,
        allowUnlistedSources,
        sourceStatusRequirement,
      ),
      providers,
      options,
    ),
  };
}

function filterJunctionImportSnapshots(
  snapshots: Record<string, unknown[]>,
  providers: readonly JunctionProviderConnection[],
  sources: readonly JunctionImportAdmissionSource[],
  allowUnlistedSources = true,
  sourceStatusRequirement: JunctionImportSourceStatusRequirement = "not_disconnected",
): Record<string, unknown[]> {
  const sourceReferences = buildJunctionSourceReferenceMap(providers);
  const hasPendingSourceAdmission = sources.some((source) =>
    sourceStatusRequirement === "connected"
      ? !isDeviceSyncSourceAdmitted([source], source.sourceProviderSlug)
      : source.status === "disconnected" || isDeviceSyncSourceDisconnectFenced(source)
  );

  return Object.fromEntries(
    Object.entries(snapshots).map(([resource, records]) => [
      resource,
      records.filter((record) =>
        isJunctionImportRecordAdmitted(
          record,
          sourceReferences,
          sources,
          hasPendingSourceAdmission,
          allowUnlistedSources,
          sourceStatusRequirement,
        )
      ),
    ]),
  );
}

function isJunctionImportRecordAdmitted(
  value: unknown,
  sourceReferences: ReadonlyMap<string, Record<string, unknown>>,
  sources: readonly JunctionImportAdmissionSource[],
  hasPendingSourceAdmission: boolean,
  allowUnlistedSources: boolean,
  sourceStatusRequirement: JunctionImportSourceStatusRequirement,
): boolean {
  const record = readPlainObject(value);
  if (!record) {
    return true;
  }

  const fallback = readJunctionSourceReference(record, sourceReferences);
  const sourceProviderSlug = normalizeProviderSlug(
    resolveJunctionOrigin(record, fallback).sourceProviderSlug,
  );
  if (sourceProviderSlug) {
    return isJunctionSourceAdmittedForImport(
      sources,
      sourceProviderSlug,
      allowUnlistedSources,
      sourceStatusRequirement,
    );
  }

  return !hasPendingSourceAdmission || !hasJunctionSourceReferenceIdentity(record);
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
  if (resource !== "blood_pressure" && resource !== "note") {
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

  if (resource === "note") {
    return [
      ...(Array.isArray(entry.tags) ? entry.tags : [])
        .flatMap((tag) => {
          const normalized = normalizeString(tag);
          return normalized ? [normalized] : [];
        })
        .sort(),
    ];
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

function countJunctionSnapshotRecords(snapshot: Record<string, unknown[]>): number {
  return Object.values(snapshot).reduce(
    (recordCount, records) => recordCount + records.length,
    0,
  );
}

function hasJunctionHistoricalBackfillSummaryRecords(
  evidence: readonly JunctionSummaryNormalizationEvidence[],
): boolean {
  return evidence.some(({ resource }) =>
    isJunctionHistoricalBackfillCompletionSummaryResource(resource)
  );
}

function evaluateJunctionHistoricalBackfillCoverage(
  summaryEvidence: readonly JunctionSummaryNormalizationEvidence[],
  sourceProviders: readonly JunctionProviderConnection[],
  configuredSummaryResources: readonly string[],
  providerFilter: readonly string[],
  historicalPullSnapshot: JunctionHistoricalPullSnapshot | null,
  historicalPushEvidence: JunctionHistoricalBackfillEvidence | null,
  window: { windowEnd: string; windowStart: string },
): JunctionHistoricalBackfillCoverage {
  const configuredResources = new Set<string>(
    configuredSummaryResources.filter((resource) =>
      JUNCTION_HISTORICAL_BACKFILL_REQUIRED_SUMMARY_RESOURCE_SET.has(resource)
    ),
  );
  const advertisedResourcesByProvider = new Map<string, Set<string>>();
  const connectedProviderSlugs = new Set<string>();
  const pendingProviderSlugs = new Set<string>();
  const reconnectProviderSlugs = new Set<string>();
  const providerStatusBySlug = new Map<string, DeviceConnectionSourceStatus>();

  for (const provider of sourceProviders) {
    const providerSlug = resolveJunctionHistoricalCoverageProviderSlug(
      provider.origin.sourceProviderSlug ?? provider.slug,
      providerFilter,
    );
    if (!providerSlug) {
      continue;
    }
    const status = mapJunctionSourceStatus(provider.status);
    const existingStatus = providerStatusBySlug.get(providerSlug);
    providerStatusBySlug.set(
      providerSlug,
      existingStatus ? mergeJunctionSourceStatus(existingStatus, status) : status,
    );

    for (const [rawResource, availability] of Object.entries(provider.resourceAvailability)) {
      const resource = normalizeJunctionResourceName(rawResource);
      if (
        !resource
        || !configuredResources.has(resource)
        || !isJunctionResourceAdvertisedAvailable(availability)
      ) {
        continue;
      }

      const advertisedResources = advertisedResourcesByProvider.get(providerSlug) ?? new Set<string>();
      advertisedResources.add(resource);
      advertisedResourcesByProvider.set(providerSlug, advertisedResources);
    }
  }

  const historicalSourcesByProvider = new Map(
    historicalPullSnapshot?.matchedUser
      ? historicalPullSnapshot.sources.flatMap((source) => {
          const providerSlug = resolveJunctionHistoricalCoverageProviderSlug(
            source.sourceProviderSlug,
            providerFilter,
          );
          return providerSlug ? [[providerSlug, source] as const] : [];
        })
      : [],
  );

  for (const [providerSlug, status] of providerStatusBySlug.entries()) {
    if (status === "disconnected") {
      continue;
    }

    const historicalSource = historicalSourcesByProvider.get(providerSlug);
    const notPulledResources = new Set(
      historicalSource?.notPulledResources.flatMap((value) => {
        const resource = normalizeJunctionResourceName(value);
        return resource ? [resource] : [];
      }) ?? [],
    );
    const historicalResources = new Map(
      historicalSource?.pulledResources.flatMap((entry) => {
        const resource = normalizeJunctionResourceName(entry.resource);
        return resource && configuredResources.has(resource)
          ? [[resource, entry] as const]
          : [];
      }) ?? [],
    );
    const requiredResources = new Set([
      ...(advertisedResourcesByProvider.get(providerSlug) ?? []),
      ...historicalResources.keys(),
    ].filter((resource) =>
      !notPulledResources.has(resource) || historicalResources.has(resource)
    ));

    if (status === "connected") {
      connectedProviderSlugs.add(providerSlug);
    }
    if (requiredResources.size === 0) {
      continue;
    }
    if (status !== "connected") {
      pendingProviderSlugs.add(providerSlug);
      continue;
    }

    let hasPendingResource = false;
    let everyPendingResourceFailed = true;
    for (const resource of requiredResources) {
      if (!isJunctionHistoricalBackfillRequiredSummaryResource(resource)) {
        continue;
      }

      const historicalResource = historicalResources.get(resource);
      if (historicalSource) {
        if (historicalResource?.status === "success") {
          continue;
        }
        hasPendingResource = true;
        if (historicalResource?.status !== "failure") {
          everyPendingResourceFailed = false;
        }
        continue;
      }

      const coveredBySummary = summaryEvidence.some((entry) =>
        entry.resource === resource
        && canonicalizeJunctionHistoricalProviderSlug(entry.sourceProviderSlug) === providerSlug
      );
      const coveredByPush = hasJunctionHistoricalBackfillEvidence(
        historicalPushEvidence,
        providerSlug,
        resource,
        window.windowStart,
        window.windowEnd,
      );
      if (!coveredBySummary && !coveredByPush) {
        hasPendingResource = true;
        everyPendingResourceFailed = false;
      }
    }

    if (hasPendingResource) {
      pendingProviderSlugs.add(providerSlug);
      if (
        everyPendingResourceFailed
        && isJunctionHistoricalResetProviderSlug(providerSlug)
      ) {
        reconnectProviderSlugs.add(providerSlug);
      }
    }
  }

  const sortedPendingProviderSlugs = [...pendingProviderSlugs]
    .sort((left, right) => left.localeCompare(right));

  return {
    complete: connectedProviderSlugs.size > 0 && sortedPendingProviderSlugs.length === 0,
    pendingProviderSlugs: sortedPendingProviderSlugs,
    reconnectProviderSlugs: [...reconnectProviderSlugs]
      .sort((left, right) => left.localeCompare(right)),
  };
}

function canonicalizeJunctionHistoricalProviderSlug(value: unknown): string | null {
  const providerSlug = normalizeProviderSlug(value);
  if (!providerSlug) {
    return null;
  }

  return resolveJunctionDeviceConnectRouteByProviderSlug(providerSlug)?.route.sourceProviderSlug
    ?? null;
}

function resolveJunctionHistoricalCoverageProviderSlug(
  value: unknown,
  providerFilter: readonly string[],
): string | null {
  const providerSlug = canonicalizeJunctionHistoricalProviderSlug(value);
  if (!providerSlug) {
    return null;
  }

  const route = resolveJunctionDeviceConnectRouteByProviderSlug(providerSlug)?.route;
  if (!route) {
    return null;
  }

  return route.kind === "junction_sdk" || providerFilter.includes(providerSlug)
    ? providerSlug
    : null;
}

function isJunctionHistoricalBackfillRequiredSummaryResource(
  resource: string,
): resource is JunctionHistoricalBackfillEvidenceResource {
  return JUNCTION_HISTORICAL_BACKFILL_REQUIRED_SUMMARY_RESOURCE_SET.has(resource);
}

function readJunctionDirectHistoricalEvidenceWindow(
  input: JunctionDirectResourceJobInput,
  connectWindow: { windowEnd: string; windowStart: string },
  evidence: readonly JunctionSummaryNormalizationEvidence[],
  providerFilter: readonly string[],
): { windowEnd: string; windowStart: string } | null {
  const providerSlug = resolveJunctionHistoricalCoverageProviderSlug(
    input.sourceProviderSlug,
    providerFilter,
  );
  if (
    !providerSlug
    || !isJunctionHistoricalBackfillRequiredSummaryResource(input.resource)
    || !evidence.some((entry) =>
      entry.resource === input.resource
      && canonicalizeJunctionHistoricalProviderSlug(entry.sourceProviderSlug) === providerSlug
    )
  ) {
    return null;
  }

  return connectWindow;
}

function isJunctionResourceAdvertisedAvailable(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase() === "available";
  }

  const record = readPlainObject(value);
  if (!record) {
    return false;
  }

  return record.available === true
    || normalizeString(record.status)?.toLowerCase() === "available";
}

function isJunctionSourceResourceCurrentlyAvailable(input: {
  connectionId: string;
  providers: readonly JunctionProviderConnection[];
  resource: string;
  sourceProviderSlug: string | null;
}): boolean {
  if (!input.sourceProviderSlug) {
    return false;
  }

  return projectJunctionSourcesByProviderSlug(
    input.connectionId,
    input.providers,
  ).some((source) =>
    source.sourceProviderSlug === input.sourceProviderSlug
    && source.status === "connected"
    && isJunctionResourceAdvertisedAvailable(
      source.resourceAvailabilitySummary[input.resource],
    )
  );
}

function isJunctionHistoricalBackfillCompletionSummaryResource(
  resource: string,
): resource is JunctionHistoricalBackfillCompletionSummaryResource {
  return JUNCTION_HISTORICAL_BACKFILL_COMPLETION_SUMMARY_RESOURCE_SET.has(resource);
}

function readJunctionRecordArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildHistoricalBackfillFollowUp(input: {
  coverageComplete: boolean;
  metadata: Record<string, unknown>;
  now: string;
  terminalFailure: boolean;
  windowStart: string;
  windowEnd: string;
}): JunctionHistoricalBackfillFollowUp {
  if (!canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(input.metadata)) {
    return {};
  }

  if (input.coverageComplete) {
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

  const pendingRetryAt = readPendingHistoricalBackfillRetryAt(
    input.metadata,
    input.windowStart,
    input.windowEnd,
  );
  const pendingRetryAtMs = pendingRetryAt ? Date.parse(pendingRetryAt) : NaN;
  if (pendingRetryAt && Number.isFinite(pendingRetryAtMs) && Date.parse(input.now) < pendingRetryAtMs) {
    return { nextReconcileAt: pendingRetryAt };
  }

  const previousEmptyAttempts = readHistoricalBackfillEmptyAttempts(
    input.metadata,
    input.windowStart,
    input.windowEnd,
  );
  let emptyAttempts = previousEmptyAttempts + 1;
  let retryDelayMs = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyAttempts - 1] ?? null;
  if (retryDelayMs === null && !input.terminalFailure) {
    emptyAttempts = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS.length;
    retryDelayMs = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyAttempts - 1] ?? null;
  }
  const status: JunctionHistoricalBackfillStatus = retryDelayMs === null ? "exhausted" : "retrying";

  const metadataPatch = buildHistoricalBackfillMetadataPatch({
    status,
    emptyAttempts,
    lastEmptyAt: input.now,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });

  if (retryDelayMs === null) {
    return { metadataPatch };
  }

  const retryAt = addMilliseconds(input.now, retryDelayMs);
  return {
    metadataPatch,
    nextReconcileAt: retryAt,
  };
}

function readPendingHistoricalBackfillRetryAt(
  metadata: Record<string, unknown>,
  windowStart: string,
  windowEnd: string,
): string | null {
  if (
    readHistoricalBackfillCoverageVersion(metadata)
      !== JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION
  ) {
    return null;
  }

  const status = readHistoricalBackfillStatus(metadata)?.status ?? null;

  if (status !== "retrying") {
    return null;
  }

  const metadataWindowStart = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]);
  const metadataWindowEnd = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]);

  if (metadataWindowStart !== windowStart || metadataWindowEnd !== windowEnd) {
    return null;
  }

  const emptyAttempts = Math.max(
    1,
    readHistoricalBackfillEmptyAttempts(metadata, windowStart, windowEnd),
  );
  const retryDelayMs = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyAttempts - 1] ?? null;
  const lastEmptyAt = normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt]);

  if (retryDelayMs === null || !lastEmptyAt || !Number.isFinite(Date.parse(lastEmptyAt))) {
    return null;
  }

  return addMilliseconds(lastEmptyAt, retryDelayMs);
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

  const emptyAttempts = readHistoricalBackfillJobEmptyAttempts(input.job) + 1;
  const retryDelayMs = EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyAttempts - 1] ?? null;
  if (retryDelayMs === null) {
    return {};
  }

  const retryAt = addMilliseconds(input.now, retryDelayMs);
  const retryJob = buildExactWindowJob({
    kind: "backfill",
    priority: Math.max(input.job.priority, JUNCTION_HISTORICAL_BACKFILL_RETRY_PRIORITY),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });

  return {
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
    [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status]:
      encodeJunctionHistoricalBackfillStatus(input.status),
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
  return readHistoricalBackfillCoverageVersion(metadata)
      === JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION
    && readHistoricalBackfillStatus(metadata)?.status === status
    && normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]) === windowStart
    && normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]) === windowEnd;
}

function readHistoricalBackfillEmptyAttempts(
  metadata: Record<string, unknown>,
  windowStart: string,
  windowEnd: string,
): number {
  if (
    readHistoricalBackfillCoverageVersion(metadata)
      !== JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION
    || normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]) !== windowStart
    || normalizeString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]) !== windowEnd
  ) {
    return 0;
  }

  const rawAttempts = metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts];
  return typeof rawAttempts === "number" && Number.isInteger(rawAttempts) && rawAttempts >= 0
    ? rawAttempts
    : 0;
}

function readHistoricalBackfillStatus(metadata: Record<string, unknown>): {
  coverageVersion: number;
  status: JunctionHistoricalBackfillStatus;
} | null {
  return readJunctionHistoricalBackfillStatus(
    metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status],
  );
}

function readHistoricalBackfillCoverageVersion(metadata: Record<string, unknown>): number {
  return readHistoricalBackfillStatus(metadata)?.coverageVersion ?? 0;
}

function readHistoricalBackfillJobEmptyAttempts(job: DeviceSyncJobRecord): number {
  const rawAttempts = job.payload.emptyBackfillAttempts;
  return typeof rawAttempts === "number" && Number.isInteger(rawAttempts) && rawAttempts > 0 ? rawAttempts : 0;
}

function readJunctionHistoricalUnresolvedProviderRecords(
  job: DeviceSyncJobRecord,
): JunctionHistoricalUnresolvedProviderRecords {
  const encoded = job.payload.historicalUnresolvedProviderRecordIdentitiesJson;
  if (typeof encoded === "string") {
    try {
      const parsed = readPlainObject(JSON.parse(encoded));
      const rawIdentities = parsed?.i;
      const version = parsed?.v;
      if (
        version !== JUNCTION_HISTORICAL_UNRESOLVED_PROVIDER_RECORD_IDENTITIES_VERSION
        || !Array.isArray(rawIdentities)
      ) {
        return { identities: [], withoutStableIdentity: true };
      }

      const validIdentities = rawIdentities.filter((identity): identity is string =>
        typeof identity === "string"
        && JUNCTION_BLOOD_PRESSURE_PROVIDER_RECORD_IDENTITY_PATTERN.test(identity)
      );
      const identities = [...new Set(validIdentities)].sort();
      return {
        identities,
        withoutStableIdentity:
          parsed?.u === true
          || validIdentities.length !== rawIdentities.length,
      };
    } catch {
      return { identities: [], withoutStableIdentity: true };
    }
  }

  const legacyUnresolvedEvidence =
    job.payload.historicalProviderRecordsSeen === true
    || (
      typeof job.payload.historicalUnresolvedProviderRecordCount === "number"
      && Number.isSafeInteger(job.payload.historicalUnresolvedProviderRecordCount)
      && job.payload.historicalUnresolvedProviderRecordCount > 0
    );
  return {
    identities: [],
    withoutStableIdentity: legacyUnresolvedEvidence,
  };
}

function resolveJunctionHistoricalUnresolvedProviderRecords(
  job: DeviceSyncJobRecord,
  importResult: JunctionPreciseTimeseriesImportResult,
): JunctionHistoricalUnresolvedProviderRecords {
  const carried = readJunctionHistoricalUnresolvedProviderRecords(job);
  const identities = new Set(carried.identities);
  for (const identity of importResult.canonicalProviderRecordIdentities) {
    identities.delete(identity);
  }
  for (const identity of importResult.unresolvedProviderRecordIdentities) {
    identities.add(identity);
  }

  return {
    identities: [...identities].sort(),
    withoutStableIdentity:
      carried.withoutStableIdentity
      || importResult.unresolvedProviderRecordsWithoutStableIdentity,
  };
}

function countJunctionHistoricalUnresolvedProviderRecords(
  unresolved: JunctionHistoricalUnresolvedProviderRecords,
): number {
  return unresolved.identities.length + (unresolved.withoutStableIdentity ? 1 : 0);
}

function encodeJunctionHistoricalUnresolvedProviderRecords(
  unresolved: JunctionHistoricalUnresolvedProviderRecords,
): string {
  return JSON.stringify({
    v: JUNCTION_HISTORICAL_UNRESOLVED_PROVIDER_RECORD_IDENTITIES_VERSION,
    i: unresolved.identities,
    ...(unresolved.withoutStableIdentity ? { u: true } : {}),
  });
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

type JunctionWindowJobPayload<Kind extends "backfill" | "reconcile"> = Omit<
  JunctionDeviceSyncJobPayloads[Kind],
  "windowStart" | "windowEnd"
>;

function buildWindowJob<Kind extends "backfill" | "reconcile">(input: {
  kind: Kind;
  now: string;
  payload?: JunctionWindowJobPayload<Kind>;
  windowStart: string;
  priority: number;
}): DeviceSyncJobInput {
  const windowEnd = floorUtcDayTimestamp(input.now);
  const windowStart = floorUtcDayTimestamp(input.windowStart);

  return buildExactWindowJob({
    kind: input.kind,
    payload: input.payload,
    windowStart,
    windowEnd,
    availableAt: input.now,
    priority: input.priority,
  });
}

function buildExactWindowJob<Kind extends "backfill" | "reconcile">(input: {
  availableAt?: string;
  kind: Kind;
  payload?: JunctionWindowJobPayload<Kind>;
  windowStart: string;
  windowEnd: string;
  priority: number;
}): DeviceSyncJobInput {
  const windowPayload: { sourceProviderSlug?: string } | undefined = input.payload;
  const sourceProviderSlug = normalizeString(windowPayload?.sourceProviderSlug);
  const dedupeIdentity = [
    "junction",
    input.kind,
    input.windowStart,
    input.windowEnd,
    ...(sourceProviderSlug ? [sourceProviderSlug] : []),
  ];
  return {
    kind: input.kind,
    payload: {
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      ...(input.payload ?? {}),
    },
    priority: input.priority,
    ...(input.availableAt ? { availableAt: input.availableAt } : {}),
    dedupeKey: sha256Text(JSON.stringify(dedupeIdentity)),
  };
}

function buildJunctionExtendedTimeseriesBackfillDedupeKey(
  payload: Record<string, unknown>,
): string | null {
  if (payload.historicalBackfill !== true) {
    return null;
  }

  const historicalWindowStart =
    toIsoTimestampIfValid(normalizeString(payload.historicalWindowStart));
  const resource = normalizeJunctionResourceName(payload.resource);
  const windowEnd = toIsoTimestampIfValid(normalizeString(payload.windowEnd));
  if (
    !historicalWindowStart
    || !resource
    || !windowEnd
    || !JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET.has(resource)
  ) {
    return null;
  }

  return sha256Text(JSON.stringify([
    "junction",
    "extended-timeseries-backfill",
    normalizeProviderSlug(payload.sourceProviderSlug),
    resource,
    historicalWindowStart,
    windowEnd,
  ]));
}

function buildExtendedTimeseriesBackfillJob(input: {
  availableAt: string;
  dedupeKey?: string | null;
  emptyBackfillAttempts?: number;
  historicalProviderRecordsSeen?: boolean;
  historicalRecordsSeen?: boolean;
  historicalUnresolvedProviderRecordIdentitiesJson?: string;
  historicalUnresolvedProviderRecordCount?: number;
  historicalWindowStart: string;
  resource: string;
  sourceProviderSlug: string | null;
  windowEnd: string;
  windowStart: string;
}): DeviceSyncJobInput {
  const payload = {
    ...(input.emptyBackfillAttempts && input.emptyBackfillAttempts > 0
      ? { emptyBackfillAttempts: input.emptyBackfillAttempts }
      : {}),
    historicalBackfill: true,
    ...(input.historicalProviderRecordsSeen
      ? { historicalProviderRecordsSeen: true }
      : {}),
    ...(input.historicalRecordsSeen
      ? { historicalRecordsSeen: true }
      : {}),
    ...(input.historicalUnresolvedProviderRecordIdentitiesJson
      ? {
          historicalUnresolvedProviderRecordIdentitiesJson:
            input.historicalUnresolvedProviderRecordIdentitiesJson,
        }
      : {}),
    ...(input.historicalUnresolvedProviderRecordCount
        && input.historicalUnresolvedProviderRecordCount > 0
      ? {
          historicalUnresolvedProviderRecordCount:
            input.historicalUnresolvedProviderRecordCount,
        }
      : {}),
    historicalWindowStart: input.historicalWindowStart,
    resource: input.resource,
    resourceCategory: "timeseries",
    ...(input.sourceProviderSlug
      ? { sourceProviderSlug: input.sourceProviderSlug }
      : {}),
    windowEnd: input.windowEnd,
    windowStart: input.windowStart,
  } satisfies JunctionDeviceSyncJobPayloads["resource"];
  const dedupeKey = input.dedupeKey
    ?? buildJunctionExtendedTimeseriesBackfillDedupeKey(payload);
  if (!dedupeKey) {
    throw new TypeError("Junction extended timeseries backfill identity was invalid.");
  }

  return {
    kind: "resource",
    payload,
    availableAt: input.availableAt,
    priority: JUNCTION_HISTORICAL_BACKFILL_PRIORITY,
    dedupeKey,
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
      buildExactWindowJob({
        kind: "backfill",
        windowStart: backfillWindowStart,
        windowEnd: input.window.windowEnd,
        priority: 35,
      }),
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
      } satisfies JunctionDeviceSyncJobPayloads["resource"],
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
  if (isJunctionSdkHistoricalPullCompletedWebhookData(data, externalAccountId)) {
    return true;
  }

  if (hasJunctionHistoricalInlineRecordCarrierFields(data)) {
    return false;
  }

  return isDocumentedJunctionHistoricalPullCompletedWebhookData(data, externalAccountId);
}

function isJunctionSdkHistoricalPullCompletedWebhookData(
  data: Record<string, unknown>,
  externalAccountId: string,
): boolean {
  const userId = normalizeString(data[JUNCTION_WEBHOOK_ROOT_FIELDS.userId])
    ?? externalAccountId;
  const startDate = data.start_date;
  const endDate = data.end_date;

  return typeof userId === "string"
    && typeof startDate === "string"
    && JUNCTION_SDK_ISO_8601_DATE_PATTERN.test(startDate)
    && typeof endDate === "string"
    && JUNCTION_SDK_ISO_8601_DATE_PATTERN.test(endDate)
    && data.is_final === true
    && typeof data.provider === "string"
    && normalizeJunctionWebhookSourceProviderCandidate(data.provider) !== null;
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

const JUNCTION_COMPANION_HEALTH_METADATA_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function parseJunctionCompanionHealthMetadataJob(
  job: DeviceSyncJobRecord,
): JunctionCompanionHealthMetadataRecord[] {
  if (job.payload.resource !== JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE) {
    throw invalidJunctionCompanionHealthMetadataJob("resource is invalid");
  }
  if (job.payload.eventType !== JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE) {
    throw invalidJunctionCompanionHealthMetadataJob("eventType is invalid");
  }
  if (job.payload.resourceCategory !== "summary") {
    throw invalidJunctionCompanionHealthMetadataJob("resourceCategory is invalid");
  }
  if (job.payload.sourceProviderSlug !== JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER) {
    throw invalidJunctionCompanionHealthMetadataJob("sourceProviderSlug is invalid");
  }
  const receivedAt = toJunctionCompanionHealthMetadataIsoTimestamp(job.payload.occurredAt);
  if (!receivedAt) {
    throw invalidJunctionCompanionHealthMetadataJob("occurredAt is invalid");
  }
  const receivedAtMs = Date.parse(receivedAt);

  const json = typeof job.payload.webhookDataJson === "string"
    ? job.payload.webhookDataJson
    : null;
  if (!json || Buffer.byteLength(json, "utf8") > JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES) {
    throw invalidJunctionCompanionHealthMetadataJob("batch JSON is missing or too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalidJunctionCompanionHealthMetadataJob("batch JSON is invalid");
  }

  try {
    return parseJunctionCompanionHealthMetadataBatch(parsed, receivedAtMs).records;
  } catch (error) {
    if (error instanceof JunctionCompanionHealthMetadataParseError) {
      throw invalidJunctionCompanionHealthMetadataJob(error.message);
    }
    throw error;
  }
}

function invalidJunctionCompanionHealthMetadataJob(reason: string): DeviceSyncError {
  return deviceSyncError({
    code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
    message: `Junction companion health metadata ${reason}.`,
    retryable: false,
  });
}

function buildJunctionCompanionRecoverySummary(
  record: JunctionCompanionHealthMetadataRecord,
): Record<string, unknown> {
  return stripUndefined({
    id: record.recordId,
    date: record.endAt,
    companionStartAt: record.startAt,
    companionEndAt: record.endAt,
    companionSyncVersion: record.syncVersion,
    recovery_readiness_score: record.value,
    source: {
      provider: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      type: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE,
    },
  });
}

function buildJunctionCompanionWorkoutStrainSummary(
  record: JunctionCompanionHealthMetadataRecord,
): Record<string, unknown> {
  return stripUndefined({
    id: record.recordId,
    date: record.endAt,
    companionStartAt: record.startAt,
    companionEndAt: record.endAt,
    companionSyncVersion: record.syncVersion,
    workout_strain: record.value,
    source: {
      provider: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      type: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE,
    },
  });
}

function toJunctionCompanionHealthMetadataIsoTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length > 64
    || !JUNCTION_COMPANION_HEALTH_METADATA_TIMESTAMP_PATTERN.test(value)
  ) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
}): { messageId: string; payload: Record<string, unknown>; providerSentAt: string } {
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
    providerSentAt: new Date(timestampMs).toISOString(),
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
  options: {
    preserveHistoricalReconnect?: boolean;
    preserveHistoricalReconnectProviderSlugs?: readonly string[];
  } = {},
): Promise<void> {
  if (!context.upsertConnectionSource) {
    context.logger.warn?.("Junction source projection skipped because the job context does not expose source storage.", {
      provider: "junction",
    });
    return;
  }

  const historicalState = readHistoricalBackfillStatus(context.account.metadata);
  const preserveOpaqueHistoricalReconnect =
    !canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(context.account.metadata);
  const preserveHistoricalReconnect = options.preserveHistoricalReconnect ?? (
    options.preserveHistoricalReconnectProviderSlugs !== undefined
    || preserveOpaqueHistoricalReconnect
    || (
      historicalState !== null
      && historicalState.coverageVersion >= JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION
      && historicalState.status !== "complete"
    )
  );
  const preserveHistoricalReconnectProviderSlugs =
    options.preserveHistoricalReconnectProviderSlugs === undefined
      ? null
      : new Set(options.preserveHistoricalReconnectProviderSlugs);
  for (const source of projectJunctionSourcesByProviderSlug(
    context.account.id,
    providers,
  )) {
    const existingSources = context.listConnectionSources
      ? await context.listConnectionSources()
      : [];
    const admissionSources: readonly JunctionImportAdmissionSource[] =
      context.listConnectionSources
        ? existingSources
        : context.account.sources ?? [];
    const listedOnly = context.connectionSourceAdmissionMode === "listed_only";
    if (
      (
        listedOnly
        && !hasJunctionSourceListing(
          admissionSources,
          source.sourceProviderSlug,
        )
      )
      || isJunctionSourceProjectionFenced(
        admissionSources,
        source.sourceProviderSlug,
      )
    ) {
      continue;
    }
    const existingByInstanceKey = new Map(
      existingSources.map((existingSource) => [
        existingSource.sourceInstanceKey,
        existingSource,
      ] as const),
    );
    const existing = existingByInstanceKey.get(source.sourceInstanceKey) ?? existingSources.find(
      (candidate) =>
        normalizeProviderSlug(candidate.sourceProviderSlug) === source.sourceProviderSlug,
    );
    const keepHistoricalReconnect =
      preserveHistoricalReconnect
      && (
        preserveHistoricalReconnectProviderSlugs === null
        || preserveHistoricalReconnectProviderSlugs.has(source.sourceProviderSlug)
      )
      && source.status !== "disconnected"
      && existing !== undefined
      && (
        preserveOpaqueHistoricalReconnect
          ? existing.status === "error"
            && existing.lastErrorCode === DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE
          : requiresHistoricalResetDeviceSyncSource(existing)
      );
    const historicalReconnectError = keepHistoricalReconnect ? existing : null;
    await context.upsertConnectionSource({
      sourceInstanceKey: existing?.sourceInstanceKey ?? source.sourceInstanceKey,
      sourceProviderSlug: source.sourceProviderSlug,
      displayName: existing?.displayName ?? null,
      ...(existing?.firstSeenAt ? { firstSeenAt: existing.firstSeenAt } : {}),
      status: keepHistoricalReconnect
        ? "error"
        : source.status,
      resourceAvailabilitySummary: source.resourceAvailabilitySummary,
      // Only assert error fields when this projection saw an errored entry;
      // omitting the keys lets the store preserve existing detail while the
      // status stays "error" and auto-clear it once the status recovers.
      ...(historicalReconnectError
        ? {
            lastErrorCode: historicalReconnectError.lastErrorCode,
            lastErrorMessage: historicalReconnectError.lastErrorMessage,
          }
        : source.lastErrorCode !== null || source.lastErrorMessage !== null
        ? { lastErrorCode: source.lastErrorCode, lastErrorMessage: source.lastErrorMessage }
        : {}),
      lastSeenAt: context.now,
    });
  }
}

function isJunctionSourceAdmittedForImport(
  sources: readonly JunctionImportAdmissionSource[],
  sourceProviderSlug: string | null | undefined,
  allowUnlistedSources = true,
  sourceStatusRequirement: JunctionImportSourceStatusRequirement = "not_disconnected",
): boolean {
  const normalizedSourceProviderSlug = normalizeProviderSlug(sourceProviderSlug);
  if (!normalizedSourceProviderSlug) {
    return true;
  }

  const matchingSources = sources.filter((source) =>
    normalizeProviderSlug(source.sourceProviderSlug) === normalizedSourceProviderSlug
  );
  return matchingSources.length === 0
    ? allowUnlistedSources
    : matchingSources.some((source) =>
      sourceStatusRequirement === "connected"
        ? isDeviceSyncSourceAdmitted([source], source.sourceProviderSlug)
        : source.status !== "disconnected" && !isDeviceSyncSourceDisconnectFenced(source)
    );
}

function isJunctionSourceProjectionFenced(
  sources: readonly JunctionImportAdmissionSource[],
  sourceProviderSlug: string | null | undefined,
): boolean {
  const normalizedSourceProviderSlug = normalizeProviderSlug(sourceProviderSlug);
  if (!normalizedSourceProviderSlug) {
    return false;
  }

  return sources.some((source) =>
    normalizeProviderSlug(source.sourceProviderSlug) === normalizedSourceProviderSlug
    && isDeviceSyncSourceDisconnectFenced(source)
  );
}

function hasJunctionSourceListing(
  sources: readonly JunctionImportAdmissionSource[],
  sourceProviderSlug: string | null | undefined,
): boolean {
  const normalizedSourceProviderSlug = normalizeProviderSlug(sourceProviderSlug);
  if (!normalizedSourceProviderSlug) {
    return true;
  }

  return sources.some((source) =>
    normalizeProviderSlug(source.sourceProviderSlug) === normalizedSourceProviderSlug
  );
}

async function resolveJunctionCurrentSourceAdmission(
  context: ProviderJobContext,
  sourceProviderSlug: string,
): Promise<"admitted" | "fenced" | "pending"> {
  const sources = context.listConnectionSources
    ? await context.listConnectionSources({ sourceProviderSlug })
    : context.account.sources ?? [];
  if (isJunctionSourceProjectionFenced(sources, sourceProviderSlug)) {
    return "fenced";
  }
  return isJunctionSourceAdmittedForImport(
    sources,
    sourceProviderSlug,
    context.connectionSourceAdmissionMode !== "listed_only",
    "connected",
  )
    ? "admitted"
    : "pending";
}

async function isJunctionCompanionSourceCurrentlyAdmitted(
  context: ProviderJobContext,
  sourceProviderSlug: string,
): Promise<boolean> {
  const normalizedSourceProviderSlug = normalizeProviderSlug(sourceProviderSlug);
  if (!context.listConnectionSources) {
    throw junctionCompanionSourceStateUnavailableError();
  }
  if (!normalizedSourceProviderSlug) {
    throw junctionCompanionSourceStateUnavailableError();
  }

  let sources;
  try {
    sources = await context.listConnectionSources({
      sourceProviderSlug: normalizedSourceProviderSlug,
    });
  } catch (error) {
    if (isDeviceSyncError(error) && error.retryable) {
      throw error;
    }
    throw junctionCompanionSourceStateUnavailableError(error);
  }

  if (isDeviceSyncSourceAdmitted(sources, normalizedSourceProviderSlug)) {
    return true;
  }
  if (sources.some(
    (source) => source.lastErrorCode === DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
  )) {
    return false;
  }

  throw deviceSyncError({
    code: "JUNCTION_COMPANION_SOURCE_NOT_READY",
    message: "Current companion source authorization is not ready. Retry shortly.",
    retryable: true,
    httpStatus: 503,
  });
}

function junctionCompanionSourceStateUnavailableError(cause?: unknown): DeviceSyncError {
  return deviceSyncError({
    code: "JUNCTION_COMPANION_SOURCE_STATE_UNAVAILABLE",
    message: "Current companion source authorization is unavailable. Retry shortly.",
    retryable: true,
    httpStatus: 503,
    ...(cause === undefined ? {} : { cause }),
  });
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

function readProviderSnapshotDurableDeliveryAccepted(value: unknown): boolean {
  return readPlainObject(value)?.durableDeliveryAccepted === true;
}

function readProviderSnapshotCanonicalEventCount(value: unknown): number {
  const canonicalEventCount = readPlainObject(value)?.canonicalEventCount;
  return typeof canonicalEventCount === "number"
      && Number.isSafeInteger(canonicalEventCount)
      && canonicalEventCount >= 0
    ? canonicalEventCount
    : 0;
}

function readProviderSnapshotCanonicalEventExternalRefResourceIds(
  value: unknown,
): readonly string[] | null {
  const record = readPlainObject(value);
  if (!record || !("canonicalEventExternalRefResourceIds" in record)) {
    return null;
  }
  const resourceIds = record.canonicalEventExternalRefResourceIds;
  return Array.isArray(resourceIds)
      && resourceIds.every((resourceId) => typeof resourceId === "string")
    ? resourceIds
    : null;
}

function uniqueJunctionProviderRecordIdentities(
  identities: readonly (string | null)[],
): string[] {
  return [...new Set(identities.filter((identity): identity is string =>
    identity !== null && JUNCTION_BLOOD_PRESSURE_PROVIDER_RECORD_IDENTITY_PATTERN.test(identity)
  ))].sort();
}

function resolveJunctionBloodPressureProviderRecordResolutionEvidence(input: {
  canonicalEventCount: number;
  canonicalEventExternalRefResourceIds: readonly string[] | null;
  providerRecordCount: number;
  providerRecordIdentityEvidence: ReturnType<
    typeof identifyJunctionBloodPressureProviderRecords
  >;
}): {
  canonicalProviderRecordIdentities: readonly string[];
  unresolvedProviderRecordIdentities: readonly string[];
  unresolvedProviderRecordsWithoutStableIdentity: boolean;
} {
  const rawIdentities =
    input.providerRecordIdentityEvidence.repairStableExternalRefResourceIds;
  const stableIdentities = uniqueJunctionProviderRecordIdentities(rawIdentities);
  const identityEvidenceIncomplete =
    input.providerRecordIdentityEvidence.providerRecordCount !== input.providerRecordCount
    || rawIdentities.some((identity) =>
      identity !== null
      && !JUNCTION_BLOOD_PRESSURE_PROVIDER_RECORD_IDENTITY_PATTERN.test(identity)
    );

  // Older unit seams may only expose the aggregate count. They can prove an
  // all-canonical current scan, but never clear an exact carried obligation.
  if (input.canonicalEventExternalRefResourceIds === null) {
    const allCurrentRecordsCanonical =
      !identityEvidenceIncomplete
      && input.canonicalEventCount >= input.providerRecordCount;
    return {
      canonicalProviderRecordIdentities: [],
      unresolvedProviderRecordIdentities: allCurrentRecordsCanonical
        ? []
        : stableIdentities,
      unresolvedProviderRecordsWithoutStableIdentity:
        !allCurrentRecordsCanonical
        && (
          identityEvidenceIncomplete
          || rawIdentities.some((identity) => identity === null)
        ),
    };
  }

  const canonicalResourceIds = new Set(
    input.canonicalEventExternalRefResourceIds.filter((resourceId) =>
      JUNCTION_BLOOD_PRESSURE_PROVIDER_RECORD_IDENTITY_PATTERN.test(resourceId)
    ),
  );
  const stableIdentitySet = new Set(stableIdentities);
  const canonicalProviderRecordIdentities = stableIdentities.filter((identity) =>
    canonicalResourceIds.has(identity)
  );
  const unresolvedProviderRecordIdentities = stableIdentities.filter((identity) =>
    !canonicalResourceIds.has(identity)
  );
  const providerRecordsWithoutStableIdentity = rawIdentities.filter(
    (identity) => identity === null,
  ).length;
  const canonicalRecordsWithoutStableIdentity =
    input.canonicalEventExternalRefResourceIds.filter((resourceId) =>
      !stableIdentitySet.has(resourceId)
    ).length;

  return {
    canonicalProviderRecordIdentities,
    unresolvedProviderRecordIdentities,
    unresolvedProviderRecordsWithoutStableIdentity:
      identityEvidenceIncomplete
      || input.canonicalEventExternalRefResourceIds.length !== input.canonicalEventCount
      || canonicalRecordsWithoutStableIdentity < providerRecordsWithoutStableIdentity,
  };
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
