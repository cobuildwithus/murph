import { createHmac, createHash } from "node:crypto";

import { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR } from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError } from "../errors.ts";
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

import type {
  DeviceConnectionSourceStatus,
  DeviceSyncAccount,
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
  StoredDeviceSyncAccount,
} from "../types.ts";

export { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR };

export interface JunctionDeviceSyncProviderConfig {
  apiKey: string;
  clientUserIdSecret: string;
  environment: JunctionEnvironment;
  region: JunctionRegion;
  baseUrl?: string;
  providerFilter?: string[];
  summaryResources?: string[];
  timeseriesResources?: string[];
  summaryBackfillDays?: number;
  timeseriesBackfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  perAccountConcurrency?: number;
  globalConcurrency?: number;
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
export const JUNCTION_DEFAULT_PROVIDER_FILTER = Object.freeze([
  "oura",
  "fitbit",
  "garmin",
  "whoop",
  "strava",
  "withings",
  "dexcom_v3",
  "freestyle_libre",
  "abbott_libreview",
  "eight_sleep",
  "renpho",
] as const);

export const JUNCTION_BLOCKED_WEB_LINK_PROVIDER_SLUGS = Object.freeze([
  "apple_health",
  "apple_health_kit",
  "apple_healthkit",
  "health_connect",
  "samsung_health",
] as const);

const DEFAULT_SUMMARY_BACKFILL_DAYS = 90;
const DEFAULT_TIMESERIES_BACKFILL_DAYS = 14;
const DEFAULT_RECONCILE_DAYS = 7;
const DEFAULT_RECONCILE_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SETUP_TTL_MS = 30 * 60_000;
const TIMESERIES_CHUNK_MS = 24 * 60 * 60_000;

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
  const providerFilter = normalizeProviderFilter(config.providerFilter);
  const summaryBackfillDays = config.summaryBackfillDays ?? DEFAULT_SUMMARY_BACKFILL_DAYS;
  const timeseriesBackfillDays = config.timeseriesBackfillDays ?? DEFAULT_TIMESERIES_BACKFILL_DAYS;
  const reconcileDays = config.reconcileDays ?? DEFAULT_RECONCILE_DAYS;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;

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

    const clientUserId = buildJunctionClientUserId(config.clientUserIdSecret, ownerId);
    const user = await client.createOrResolveUser(clientUserId);
    const linkToken = await client.createLinkToken({
      userId: user.userId,
      callbackUrl: buildJunctionRedirectUrl(context.callbackUrl, context.state),
      providerFilter,
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

    const providers = await client.listUserProviders(externalAccountId);
    const hasConnectedSource = providers.some((provider) => mapJunctionSourceStatus(provider.status) === "connected");

    return {
      externalAccountId,
      displayName: "Junction",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: JUNCTION_PROVIDER_CONFIG_KEY,
      },
      setupPhase: hasConnectedSource ? "source_confirmed" : "link_returned",
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
    const window = resolveJobWindow(job, context.now, job.kind === "backfill" ? summaryBackfillDays : reconcileDays);
    const sourceProviders = await client.listUserProviders(context.account.externalAccountId);
    await projectJunctionSources(context, sourceProviders);

    const summaries = await fetchSummarySnapshots(context.account, window.windowStart, window.windowEnd);
    const timeseriesWindowStart = job.kind === "backfill"
      ? maxIsoTimestamp(window.windowStart, subtractDays(window.windowEnd, timeseriesBackfillDays))
      : window.windowStart;
    const timeseries = await fetchTimeseriesSnapshots(
      context.account,
      timeseriesWindowStart,
      window.windowEnd,
    );

    await context.importSnapshot({
      provider: "junction",
      accountId: context.account.externalAccountId,
      connectionId: context.account.id,
      importedAt: context.now,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      connections: sourceProviders,
      summaries,
      timeseries,
    });

    return {
      nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
    };
  }

  async function fetchSummarySnapshots(
    account: DeviceSyncAccount,
    windowStart: string,
    windowEnd: string,
  ): Promise<Record<string, unknown[]>> {
    const snapshots: Record<string, unknown[]> = {};

    for (const resource of summaryResources) {
      snapshots[resource] = await client.listSummary({
        resource,
        userId: account.externalAccountId,
        windowStart,
        windowEnd,
      });
    }

    return snapshots;
  }

  async function fetchTimeseriesSnapshots(
    account: DeviceSyncAccount,
    windowStart: string,
    windowEnd: string,
  ): Promise<Record<string, unknown[]>> {
    const snapshots: Record<string, unknown[]> = {};

    for (const resource of timeseriesResources) {
      snapshots[resource] = await fetchTimeseriesResourceInChunks(
        account.externalAccountId,
        resource,
        windowStart,
        windowEnd,
      );
    }

    return snapshots;
  }

  async function fetchTimeseriesResourceInChunks(
    userId: string,
    resource: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<unknown[]> {
    const records: unknown[] = [];
    let chunkStart = Date.parse(windowStart);
    const end = Date.parse(windowEnd);

    while (chunkStart < end) {
      const chunkEnd = Math.min(chunkStart + TIMESERIES_CHUNK_MS, end);
      records.push(...await client.listTimeseries({
        resource,
        userId,
        windowStart: new Date(chunkStart).toISOString(),
        windowEnd: new Date(chunkEnd).toISOString(),
      }));
      chunkStart = chunkEnd;
    }

    return records;
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
    beginConnection,
    completeConnection,
    buildConnectUrl() {
      throw deviceSyncError({
        code: "JUNCTION_LEGACY_CONNECT_UNSUPPORTED",
        message: "Junction uses the provider beginConnection external-link flow.",
        retryable: false,
        httpStatus: 500,
      });
    },
    async exchangeAuthorizationCode() {
      throw deviceSyncError({
        code: "JUNCTION_OAUTH_UNSUPPORTED",
        message: "Junction does not support OAuth authorization-code exchange.",
        retryable: false,
        httpStatus: 500,
      });
    },
    async refreshTokens() {
      throw deviceSyncError({
        code: "JUNCTION_TOKEN_REFRESH_UNSUPPORTED",
        message: "Junction uses provider-config credentials and does not refresh OAuth tokens.",
        retryable: false,
        httpStatus: 409,
      });
    },
    createScheduledJobs,
    executeJob,
  };
}

export function buildJunctionClientUserId(secret: string, ownerId: string): string {
  const normalizedSecret = assertValidJunctionClientUserIdSecret(secret);
  const digest = createHmac("sha256", normalizedSecret).update(ownerId).digest();
  return `murph_${base32UrlEncode(digest)}`.slice(0, 32);
}

export function normalizeJunctionProviderFilter(value: string[] | undefined): string[] {
  return normalizeProviderFilter(value);
}

function toClientConfig(config: JunctionDeviceSyncProviderConfig): JunctionClientConfig {
  return {
    apiKey: config.apiKey,
    environment: config.environment,
    region: config.region,
    baseUrl: config.baseUrl,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImpl: config.fetchImpl,
  };
}

function normalizeProviderFilter(value: string[] | undefined): string[] {
  const requested = value && value.length > 0 ? value : [...JUNCTION_DEFAULT_PROVIDER_FILTER];
  const blocked = new Set<string>(JUNCTION_BLOCKED_WEB_LINK_PROVIDER_SLUGS);
  return [...new Set(
    requested
      .map(normalizeProviderSlug)
      .filter((entry): entry is string => entry !== null && !blocked.has(entry)),
  )];
}

function normalizeResourceList(
  value: string[] | undefined,
  defaults: readonly string[],
  label: string,
): string[] {
  const blockedResources = new Set(["glucose", "cgm", "blood_glucose"]);
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

function buildWindowJob(input: {
  kind: "backfill" | "reconcile";
  now: string;
  windowStart: string;
  priority: number;
}): DeviceSyncJobInput {
  return {
    kind: input.kind,
    payload: {
      windowStart: input.windowStart,
      windowEnd: input.now,
    },
    priority: input.priority,
    dedupeKey: sha256Text(JSON.stringify(["junction", input.kind, input.windowStart, input.now])),
  };
}

async function projectJunctionSources(
  context: ProviderJobContext,
  providers: readonly JunctionProviderConnection[],
): Promise<void> {
  if (!context.upsertConnectionSource) {
    context.logger.warn?.("Junction source projection skipped because the job context does not expose source storage.", {
      provider: "junction",
      accountId: context.account.id,
    });
    return;
  }

  for (const provider of providers) {
    await context.upsertConnectionSource({
      sourceInstanceKey: buildJunctionSourceInstanceKey(context.account.externalAccountId, provider.slug),
      sourceProviderSlug: provider.slug,
      displayName: provider.name,
      status: mapJunctionSourceStatus(provider.status),
      resourceAvailabilitySummary: sanitizeJunctionResourceAvailabilitySummary(provider.resourceAvailability),
      lastSeenAt: context.now,
    });
  }
}

function buildJunctionSourceInstanceKey(userId: string, slug: string): string {
  return `jxn_${createHash("sha256").update(JSON.stringify(["junction-source", userId, slug])).digest("hex").slice(0, 32)}`;
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
