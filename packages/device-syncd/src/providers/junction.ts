import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";
import { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR } from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError, isDeviceSyncError } from "../errors.ts";
import {
  addMilliseconds,
  normalizeString,
  sha256Text,
  subtractDays,
} from "../shared.ts";
import {
  JunctionClient,
  type JunctionClientConfig,
  type JunctionEnvironment,
  type JunctionProviderConnection,
  type JunctionRegion,
} from "./junction-client.ts";
import {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  normalizeJunctionProviderFilter,
} from "./junction-connect-sources.ts";

import type {
  DeviceConnectionSourceStatus,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
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

export { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR };
export {
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  normalizeJunctionProviderFilter,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
} from "./junction-connect-sources.ts";
export type { JunctionConnectSourceTarget } from "./junction-connect-sources.ts";

export interface JunctionDeviceSyncProviderConfig {
  apiKey: string;
  clientUserIdSecret: string;
  environment: JunctionEnvironment;
  region: JunctionRegion;
  allowedLinkHosts?: readonly string[];
  providerFilter?: string[];
  summaryResources?: string[];
  timeseriesResources?: string[];
  summaryBackfillDays?: number;
  timeseriesBackfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  webhookSecret?: string;
  webhookTimestampToleranceMs?: number;
  fetchImpl?: typeof fetch;
}

export const JUNCTION_PROVIDER_CONFIG_KEY = "junction";
export const JUNCTION_DEFAULT_SUMMARY_RESOURCES = Object.freeze([
  "profile",
  "activity",
  "sleep",
  "workouts",
  "body",
] as const);
export const JUNCTION_DEFAULT_TIMESERIES_RESOURCES = Object.freeze([
  "steps",
  "heartrate",
  "hrv",
  "respiratory_rate",
  "blood_oxygen",
  "weight",
] as const);
const JUNCTION_OPT_IN_TIMESERIES_RESOURCES = Object.freeze([
  "distance",
  "glucose",
] as const);
const JUNCTION_TIMESERIES_RESOURCE_NAMES = new Set<string>([
  ...JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  ...JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
]);
const DEFAULT_SUMMARY_BACKFILL_DAYS = 90;
const DEFAULT_TIMESERIES_BACKFILL_DAYS = 14;
const DEFAULT_RECONCILE_DAYS = 7;
const DEFAULT_RECONCILE_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SETUP_TTL_MS = 30 * 60_000;
const DEFAULT_WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;
const TIMESERIES_CHUNK_MS = 24 * 60 * 60_000;
const EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS = Object.freeze([
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const);
const JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS = Object.freeze({
  status: "junctionHistoricalBackfillStatus",
  emptyAttempts: "junctionHistoricalBackfillEmptyAttempts",
  lastEmptyAt: "junctionHistoricalBackfillLastEmptyAt",
  windowStart: "junctionHistoricalBackfillWindowStart",
  windowEnd: "junctionHistoricalBackfillWindowEnd",
} as const);
type JunctionHistoricalBackfillStatus = "complete" | "exhausted" | "retrying";

export function createJunctionDeviceSyncProvider(
  config: JunctionDeviceSyncProviderConfig,
): DeviceSyncProvider {
  assertValidJunctionClientUserIdSecret(config.clientUserIdSecret);
  const client = new JunctionClient(toClientConfig(config));
  const summaryResources = normalizeResourceList(
    config.summaryResources,
    JUNCTION_DEFAULT_SUMMARY_RESOURCES,
    "summary",
  );
  const timeseriesResources = normalizeResourceList(
    config.timeseriesResources,
    JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
    "timeseries",
  );
  const providerFilter = normalizeJunctionProviderFilter(config.providerFilter);
  if (providerFilter.length === 0) {
    throw new TypeError("Junction provider filter must include at least one hosted Link provider.");
  }
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

    const linkProviderFilter = resolveJunctionLinkProviderFilter(
      providerFilter,
      context.sourceProviderSlug,
    );
    const clientUserId = buildJunctionClientUserId(config.clientUserIdSecret, ownerId);
    const user = await client.createOrResolveUser(clientUserId);
    const linkToken = await client.createLinkToken({
      userId: user.userId,
      callbackUrl: buildJunctionRedirectUrl(context.callbackUrl, context.state),
      providerFilter: linkProviderFilter,
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

  function createScheduledJobs(
    _account: StoredDeviceSyncAccount,
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
      ],
      nextReconcileAt: addMilliseconds(now, reconcileIntervalMs),
    };
  }

  async function executeJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
  ): Promise<ProviderJobResult> {
    if (job.kind === "resource") {
      return executeResourceJob(context, job);
    }

    const window = resolveJobWindow(job, context.now, job.kind === "backfill" ? summaryBackfillDays : reconcileDays);
    const sourceProviders = await client.listUserProviders(context.account.externalAccountId);
    await projectJunctionSources(context, sourceProviders);

    const summaryWindow = job.kind === "reconcile" && isCurrentScheduledClosedWindow(window, context.now, reconcileDays)
      ? resolveCurrentSummaryWindow(context.now, reconcileDays)
      : window;
    const summaries = await fetchSummarySnapshots(context, summaryWindow.windowStart, summaryWindow.windowEnd);
    const backfillFollowUp = job.kind === "backfill"
      ? buildHistoricalBackfillFollowUp({
          metadata: context.account.metadata,
          now: context.now,
          summaryHasRecords: hasJunctionSnapshotRecords(summaries),
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
        })
      : {};
    const timeseriesWindowStart = job.kind === "backfill"
      ? maxIsoTimestamp(window.windowStart, subtractDays(window.windowEnd, timeseriesBackfillDays))
      : window.windowStart;
    await context.importSnapshot({
      provider: "junction",
      accountId: buildJunctionImportAccountId(context.account.id),
      connectionId: context.account.id,
      importedAt: summaryWindow.windowEnd,
      windowStart: summaryWindow.windowStart,
      windowEnd: summaryWindow.windowEnd,
      connections: sanitizeJunctionImportConnections(sourceProviders),
      summaries: sanitizeJunctionImportSnapshots(summaries, sourceProviders),
      timeseries: {},
    });
    if (
      job.kind === "backfill"
      || shouldImportClosedTimeseriesForReconcile(context.account.lastSyncCompletedAt, window.windowEnd)
    ) {
      await importTimeseriesDailySnapshots(
        context,
        sourceProviders,
        timeseriesWindowStart,
        window.windowEnd,
      );
    }

    return {
      ...backfillFollowUp,
      nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
    };
  }

  async function executeResourceJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
  ): Promise<ProviderJobResult> {
    const window = resolveJobWindow(job, context.now, reconcileDays);
    const resource = normalizeProviderSlug(job.payload.resource);
    const resourceCategory = normalizeString(job.payload.resourceCategory);
    const sourceProviders = await client.listUserProviders(context.account.externalAccountId);
    await projectJunctionSources(context, sourceProviders);

    const summaries: Record<string, unknown[]> = {};

    if (resource) {
      const inferredCategory = inferJunctionResourceCategory(resourceCategory, resource);
      if (!isConfiguredJunctionResource(inferredCategory, resource)) {
        context.logger.warn?.("Skipping Junction resource webhook job for a resource that is not enabled.", {
          provider: "junction",
          resource,
          resourceCategory: inferredCategory,
        });
      } else if (inferredCategory === "timeseries") {
        await importTimeseriesDailySnapshots(
          context,
          sourceProviders,
          window.windowStart,
          window.windowEnd,
          [resource],
        );
        return {
          nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
        };
      } else {
        summaries[resource] = await fetchOptionalJunctionResourceRecords(
          context,
          "summary",
          resource,
          () => client.listSummary({
            resource,
            userId: context.account.externalAccountId,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
          }),
        );
      }
    }

    await context.importSnapshot({
      provider: "junction",
      accountId: buildJunctionImportAccountId(context.account.id),
      connectionId: context.account.id,
      importedAt: context.now,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      connections: sanitizeJunctionImportConnections(sourceProviders),
      summaries: sanitizeJunctionImportSnapshots(summaries, sourceProviders),
      timeseries: {},
    });

    return {
      nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
    };
  }

  function isConfiguredJunctionResource(
    category: "summary" | "timeseries",
    resource: string,
  ): boolean {
    return category === "timeseries"
      ? timeseriesResources.includes(resource)
      : summaryResources.includes(resource);
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
    const data = readPlainObject(verified.payload.data);
    const externalAccountId = requireJunctionWebhookUserId(verified.payload, data);
    const resource = inferJunctionWebhookResource(eventType, data);
    const sourceProviderSlug = extractJunctionWebhookSourceProviderSlug(data);
    const objectId = extractJunctionWebhookObjectId(data);
    const occurredAt = extractJunctionWebhookOccurredAt(data) ?? context.now;
    const window = buildJunctionWebhookWindow(data, occurredAt, context.now);
    const jobs = buildJunctionWebhookJobs({
      eventType,
      objectId,
      occurredAt,
      resource,
      sourceProviderSlug,
      summaryBackfillDays,
      window,
    });

    return {
      externalAccountId,
      eventType,
      traceId: verified.messageId,
      occurredAt,
      resourceCategory: resource?.category ?? null,
      jobs,
      unknownAccountAction: "retry",
    };
  }

  async function fetchSummarySnapshots(
    context: ProviderJobContext,
    windowStart: string,
    windowEnd: string,
  ): Promise<Record<string, unknown[]>> {
    const snapshots: Record<string, unknown[]> = {};

    for (const resource of summaryResources) {
      snapshots[resource] = await fetchOptionalJunctionResourceRecords(
        context,
        "summary",
        resource,
        () => client.listSummary({
          resource,
          userId: context.account.externalAccountId,
          windowStart,
          windowEnd,
        }),
      );
    }

    return snapshots;
  }

  async function fetchTimeseriesSnapshots(
    context: ProviderJobContext,
    windowStart: string,
    windowEnd: string,
    resources: readonly string[] = timeseriesResources,
  ): Promise<Record<string, unknown[]>> {
    const snapshots: Record<string, unknown[]> = {};

    for (const resource of resources) {
      snapshots[resource] = await fetchTimeseriesResourceInChunks(
        context,
        resource,
        windowStart,
        windowEnd,
      );
    }

    return snapshots;
  }

  async function fetchTimeseriesResourceInChunks(
    context: ProviderJobContext,
    resource: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<unknown[]> {
    const records: unknown[] = [];
    let chunkStart = Date.parse(windowStart);
    const end = Date.parse(windowEnd);
    let optionalFailureLogged = false;

    while (chunkStart < end) {
      const chunkEnd = Math.min(chunkStart + TIMESERIES_CHUNK_MS, end);
      try {
        const chunkRecords = await client.listTimeseries({
          resource,
          userId: context.account.externalAccountId,
          windowStart: new Date(chunkStart).toISOString(),
          windowEnd: new Date(chunkEnd).toISOString(),
        });
        records.push(
          ...filterJunctionTimeseriesRecordsToWindow(
            chunkRecords,
            new Date(chunkStart).toISOString(),
            new Date(chunkEnd).toISOString(),
          ),
        );
      } catch (error) {
        const status = readOptionalJunctionResourceFailureStatus(error);
        if (status === null) {
          throw error;
        }

        if (!optionalFailureLogged) {
          logSkippedOptionalJunctionResource(context, "timeseries", resource, status);
          optionalFailureLogged = true;
        }
        break;
      }
      chunkStart = chunkEnd;
    }

    return dedupeJunctionTimeseriesRecords(resource, records);
  }

  async function importTimeseriesDailySnapshots(
    context: ProviderJobContext,
    sourceProviders: readonly JunctionProviderConnection[],
    windowStart: string,
    windowEnd: string,
    resources?: readonly string[],
  ): Promise<void> {
    for (const window of buildClosedDailyWindows(windowStart, windowEnd)) {
      const timeseries = await fetchTimeseriesSnapshots(
        context,
        window.windowStart,
        window.windowEnd,
        resources,
      );
      if (!hasJunctionSnapshotRecords(timeseries)) {
        continue;
      }

      await context.importSnapshot({
        provider: "junction",
        accountId: buildJunctionImportAccountId(context.account.id),
        connectionId: context.account.id,
        importedAt: window.windowEnd,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        connections: sanitizeJunctionImportConnections(sourceProviders),
        summaries: {},
        timeseries: sanitizeJunctionImportSnapshots(timeseries, sourceProviders),
      });
    }
  }

  async function fetchOptionalJunctionResourceRecords(
    context: ProviderJobContext,
    resourceCategory: "summary" | "timeseries",
    resource: string,
    load: () => Promise<unknown[]>,
  ): Promise<unknown[]> {
    try {
      return await load();
    } catch (error) {
      const status = readOptionalJunctionResourceFailureStatus(error);
      if (status === null) {
        throw error;
      }

      logSkippedOptionalJunctionResource(context, resourceCategory, resource, status);
      return [];
    }
  }

  function logSkippedOptionalJunctionResource(
    context: ProviderJobContext,
    resourceCategory: "summary" | "timeseries",
    resource: string,
    responseStatus: number,
  ): void {
    context.logger.warn?.("Skipping unavailable Junction resource response.", {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      resource,
      resourceCategory,
      responseStatus,
    });
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
    },
    webhookHandler: {
      verifyAndParseWebhook,
    },
    jobExecutor: {
      createScheduledJobs,
      executeJob,
    },
  };
}

function readOptionalJunctionResourceFailureStatus(error: unknown): number | null {
  if (!isDeviceSyncError(error) || error.code !== "JUNCTION_API_REQUEST_FAILED") {
    return null;
  }

  const status = error.details?.status;
  return status === 404 || status === 422 ? status : null;
}

export function buildJunctionClientUserId(secret: string, ownerId: string): string {
  const normalizedSecret = assertValidJunctionClientUserIdSecret(secret);
  const digest = createHmac("sha256", normalizedSecret).update(ownerId).digest();
  return `murph_${base32UrlEncode(digest)}`.slice(0, 32);
}

function resolveJunctionLinkProviderFilter(
  providerFilter: string[],
  sourceProviderSlug: string | null | undefined,
): string[] {
  const requested = normalizeString(sourceProviderSlug);
  if (!requested) {
    return providerFilter;
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

  return [normalizedSource];
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

function normalizeResourceList(
  value: string[] | undefined,
  defaults: readonly string[],
  label: string,
): string[] {
  const blockedResources = new Set(["cgm", "blood_glucose"]);
  const normalized = (value && value.length > 0 ? value : defaults)
    .map(normalizeProviderSlug)
    .filter((entry): entry is string => entry !== null && !blockedResources.has(entry));

  if (normalized.length === 0) {
    throw new TypeError(`Junction ${label} resources must include at least one supported resource.`);
  }

  return [...new Set(normalized)];
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
): Record<string, unknown[]> {
  const sourceReferences = buildJunctionSourceReferenceMap(providers);

  return Object.fromEntries(
    Object.entries(snapshots).map(([resource, records]) => [
      resource,
      records.map((record) => sanitizeJunctionImportSnapshotValue(record, sourceReferences)),
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

function sanitizeJunctionImportSnapshotValue(
  value: unknown,
  sourceReferences: ReadonlyMap<string, Record<string, unknown>>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJunctionImportSnapshotValue(entry, sourceReferences));
  }

  const record = readPlainObject(value);
  if (!record) {
    return value;
  }

  const fallback = readJunctionSourceReference(record, sourceReferences);
  const origin = resolveJunctionOrigin(record, fallback);
  const sanitized = stripJunctionRawSourceIdentityFields(record, sourceReferences);

  return stripUndefined({
    ...sanitized,
    sourceProviderSlug: normalizeProviderSlug(origin.sourceProviderSlug) ?? sanitized.sourceProviderSlug,
    sourceType: origin.sourceType ?? sanitized.sourceType,
    sourceInstanceId: origin.sourceInstanceId ?? sanitized.sourceInstanceId,
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
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (
      isBlockedJunctionImportSourceIdentityKey(key)
      || isBlockedJunctionImportSourceIdentityContainerKey(key)
    ) {
      continue;
    }

    sanitized[key] = sanitizeJunctionImportSnapshotValue(value, sourceReferences);
  }

  return sanitized;
}

function normalizeJunctionImportSourceIdentityKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function isBlockedJunctionImportSourceIdentityKey(key: string): boolean {
  const normalized = normalizeJunctionImportSourceIdentityKey(key);

  return normalized.includes("connectionid")
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

function isBlockedJunctionImportSourceIdentityContainerKey(key: string): boolean {
  const normalized = normalizeJunctionImportSourceIdentityKey(key);

  return normalized === "source"
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
  ]);
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
  const error = normalizeString(query.get("error")) ?? normalizeString(query.get("error_description"));
  if (error) {
    throw deviceSyncError({
      code: "JUNCTION_LINK_FAILED",
      message: "Junction Link callback reported a failed link outcome.",
      retryable: false,
      httpStatus: 400,
    });
  }

  const status = normalizeString(query.get("status"))?.toLowerCase();
  const linkState = normalizeString(query.get("state"))?.toLowerCase();
  if (
    (status && ["cancelled", "canceled", "error", "failed"].includes(status))
    || (linkState && ["cancelled", "canceled", "error", "failed"].includes(linkState))
  ) {
    throw deviceSyncError({
      code: "JUNCTION_LINK_FAILED",
      message: "Junction Link callback reported a failed link state.",
      retryable: false,
      httpStatus: 400,
    });
  }

  const success = normalizeString(query.get("success"))?.toLowerCase();
  if (success && !["1", "true", "yes"].includes(success)) {
    throw deviceSyncError({
      code: "JUNCTION_LINK_FAILED",
      message: "Junction Link callback did not report a successful link outcome.",
      retryable: false,
      httpStatus: 400,
    });
  }
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
  const rawWindowEnd = normalizeString(job.payload.windowEnd) ?? now;
  const windowEnd = minIsoTimestamp(new Date(rawWindowEnd).toISOString(), now);
  const earliestWindowStart = subtractDays(windowEnd, fallbackDays);
  const rawWindowStart = normalizeString(job.payload.windowStart) ?? earliestWindowStart;
  const boundedWindowStart = maxIsoTimestamp(new Date(rawWindowStart).toISOString(), earliestWindowStart);

  return {
    windowStart: Date.parse(boundedWindowStart) > Date.parse(windowEnd) ? windowEnd : boundedWindowStart,
    windowEnd,
  };
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

function buildHistoricalBackfillFollowUp(input: {
  metadata: Record<string, unknown>;
  now: string;
  summaryHasRecords: boolean;
  windowStart: string;
  windowEnd: string;
}): Pick<ProviderJobResult, "metadataPatch" | "scheduledJobs"> {
  if (input.summaryHasRecords) {
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

  const retryJob = buildExactWindowJob({
    kind: "backfill",
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    priority: 30,
  });

  return {
    metadataPatch,
    scheduledJobs: [{
      ...retryJob,
      availableAt: addMilliseconds(input.now, retryDelayMs),
    }],
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
    return [
      {
        kind: "resource",
        payload: {
          eventType: input.eventType,
          objectId: input.objectId ?? "",
          occurredAt: input.occurredAt,
          resource: input.resource.name,
          resourceCategory: input.resource.category,
          sourceProviderSlug: input.sourceProviderSlug ?? "",
          windowStart: input.window.windowStart,
          windowEnd: input.window.windowEnd,
        },
        priority: 65,
        dedupeKey: sha256Text(JSON.stringify([
          "junction-webhook",
          "resource",
          input.sourceProviderSlug,
          input.resource.category,
          input.resource.name,
          input.window.windowStart,
          input.window.windowEnd,
        ])),
      },
    ];
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
    normalizeProviderSlug(data?.resource)
    ?? normalizeProviderSlug(data?.resource_type)
    ?? normalizeProviderSlug(data?.type)
    ?? normalizeProviderSlug(data?.data_type);
  const eventResource = normalizeProviderSlug(readJunctionWebhookResourceFromEventType(eventType));
  const resource = explicitResource ?? eventResource;

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

function extractJunctionWebhookOccurredAt(data: Record<string, unknown> | null): string | null {
  const candidates = [
    data?.occurred_at,
    data?.created_at,
    data?.updated_at,
    data?.timestamp,
    data?.date,
    data?.start_time,
    readPlainObject(data?.data)?.timestamp,
  ];

  for (const candidate of candidates) {
    const iso = toIsoTimestampIfValid(candidate);
    if (iso) {
      return iso;
    }
  }

  return null;
}

function buildJunctionWebhookWindow(
  data: Record<string, unknown> | null,
  occurredAt: string,
  now: string,
): { windowStart: string; windowEnd: string } {
  const explicitStart =
    toIsoTimestampIfValid(data?.window_start)
    ?? toIsoTimestampIfValid(data?.start_date)
    ?? toIsoTimestampIfValid(data?.start)
    ?? toIsoTimestampIfValid(data?.from);
  const explicitEnd =
    toIsoTimestampIfValid(data?.window_end)
    ?? toIsoTimestampIfValid(data?.end_date)
    ?? toIsoTimestampIfValid(data?.end)
    ?? toIsoTimestampIfValid(data?.to);

  if (explicitStart && explicitEnd) {
    return {
      windowStart: explicitStart,
      windowEnd: minIsoTimestamp(explicitEnd, now),
    };
  }

  const occurredAtMs = Date.parse(occurredAt);
  const boundedOccurredAt = Number.isFinite(occurredAtMs) ? occurredAt : now;

  return {
    windowStart: subtractDays(boundedOccurredAt, 1),
    windowEnd: minIsoTimestamp(addMilliseconds(boundedOccurredAt, 24 * 60 * 60_000), now),
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
  const eventType = normalizeString(payload.event_type) ?? normalizeString(payload.eventType);
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

function requireJunctionWebhookUserId(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string {
  const userId = readJunctionWebhookUserId(payload, data);
  if (userId) {
    return userId;
  }

  throw deviceSyncError({
    code: "JUNCTION_WEBHOOK_USER_ID_MISSING",
    message: "Junction webhook user_id is missing.",
    retryable: false,
    httpStatus: 400,
  });
}

function readJunctionWebhookUserId(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string | null {
  const userIds: string[] = [];
  const seenContainers = new Set<Record<string, unknown>>();

  const collectUserIds = (
    container: Record<string, unknown> | null,
    depth: number,
    allowGenericUserId: boolean,
  ): void => {
    if (!container || depth > 5 || seenContainers.has(container)) {
      return;
    }

    seenContainers.add(container);

    for (const key of ["user_id", "userId"] as const) {
      const userId = normalizeString(container[key]);
      if (userId) {
        userIds.push(userId);
      }
    }

    if (allowGenericUserId) {
      const userId = normalizeString(container.id);
      if (userId) {
        userIds.push(userId);
      }
    }

    for (const key of ["data", "payload", "event", "message", "user"] as const) {
      collectUserIds(readPlainObject(container[key]), depth + 1, key === "user");
    }
  };

  collectUserIds(payload, 0, false);
  collectUserIds(data, 0, false);

  const distinctUserIds = new Set(userIds);
  if (distinctUserIds.size > 1) {
    throw deviceSyncError({
      code: "JUNCTION_WEBHOOK_USER_ID_CONFLICT",
      message: "Junction webhook payload contains conflicting user_id values.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return userIds[0] ?? null;
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
      lastSeenAt: context.now,
    });
  }
}

function projectJunctionSourcesByProviderSlug(
  connectionId: string,
  providers: readonly JunctionProviderConnection[],
): Array<{
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
}> {
  const projected = new Map<string, {
    sourceInstanceKey: string;
    sourceProviderSlug: string;
    status: DeviceConnectionSourceStatus;
    resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
  }>();

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
    const existing = projected.get(sourceProviderSlug);
    if (existing) {
      mergeJunctionResourceAvailabilitySummary(
        existing.resourceAvailabilitySummary,
        resourceAvailabilitySummary,
      );
      existing.status = mergeJunctionSourceStatus(
        existing.status,
        mapJunctionSourceStatus(provider.status),
      );
      continue;
    }

    projected.set(sourceProviderSlug, {
      sourceInstanceKey,
      sourceProviderSlug,
      status: mapJunctionSourceStatus(provider.status),
      resourceAvailabilitySummary,
    });
  }

  return [...projected.values()];
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

function buildJunctionImportAccountId(connectionId: string): string {
  return `jxn_acct_${
    createHash("sha256")
      .update(JSON.stringify(["junction-import-account", connectionId]))
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
  return normalized.includes("userid")
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

function assertValidJunctionClientUserIdSecret(secret: string): string {
  const normalizedSecret = normalizeString(secret);

  if (!normalizedSecret || normalizedSecret.length < 16) {
    throw new TypeError("JUNCTION_CLIENT_USER_ID_SECRET must be at least 16 characters.");
  }

  return normalizedSecret;
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
