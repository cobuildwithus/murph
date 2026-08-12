import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { HistoricalPullCompleted as JunctionHistoricalPullCompletedSchema } from "@junction-api/sdk/serialization";
import {
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
} from "@murphai/importers/device-providers/junction-resources";
import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { test } from "vitest";

import { normalizeConfiguredDeviceSyncJobInput } from "../src/provider-job-definitions.ts";

import { DeviceSyncError } from "../src/errors.ts";
import {
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION,
} from "../src/junction-historical-backfill-progress.ts";
import { mergeStoredDeviceSyncMetadataPatch } from "../src/metadata.ts";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";
import {
  buildJunctionClientUserId,
  createJunctionDeviceSyncProvider,
} from "../src/providers/junction.ts";
import {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  normalizeJunctionProviderFilter,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
} from "../src/config/junction-connect-sources.ts";
import { resolveDeviceConnectSourceIdForJunctionProviderSlug } from "../src/config/connect-routes.ts";
import {
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
} from "../src/junction-resources.ts";
import {
  isAllowedJunctionLinkHost,
  JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS,
  JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES,
  JunctionClient,
  parseJunctionHistoricalPullSnapshot,
} from "../src/providers/junction-client.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

import type {
  DeviceConnectionSourceRecord,
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

// A payload comfortably larger than the old 64KB inline cap. The cap was
// removed in P3; large inline payloads now import inline instead of dropping
// to a REST fallback or being chunked into durable jobs.
const DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST = 64_001;

function createAccount(overrides: Partial<Omit<DeviceSyncAccount, "credential">> & {
  credential?: DeviceSyncAccount["credential"];
} = {}): DeviceSyncAccount {
  return {
    id: "acct-junction-1",
    provider: "junction",
    externalAccountId: "junction-user-1",
    disconnectGeneration: 0,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    displayName: "Junction",
    status: "active",
    scopes: [],
    accessTokenExpiresAt: null,
    metadata: {},
    connectedAt: "2026-04-03T00:00:00.000Z",
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function createStoredAccount(
  overrides: Partial<StoredDeviceSyncAccount> = {},
): StoredDeviceSyncAccount {
  const account = createAccount();

  return {
    ...account,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    hostedObservedConnectionRevision: 0,
    hostedObservedTokenRevision: 0,
    hostedObservedTokenVersion: null,
    hostedObservedUpdatedAt: null,
    localConnectionRevision: 0,
    localTokenRevision: 0,
    ...overrides,
  };
}

function createJob(kind: string, payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    id: `job-${kind}`,
    provider: "junction",
    accountId: "acct-junction-1",
    kind,
    payload,
    priority: 50,
    availableAt: "2026-04-03T00:00:00.000Z",
    attempts: 0,
    maxAttempts: 5,
    dedupeKey: null,
    status: "queued",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  };
}

function assertConnectBackfillRetryWake(
  result: {
    nextReconcileAt?: string | null;
    scheduledJobs?: readonly DeviceSyncJobInput[];
  },
  retryAt: string,
): void {
  assert.equal(result.nextReconcileAt, retryAt);
  assert.equal((result.scheduledJobs ?? []).some((job) => job.kind === "backfill"), false);
}

function createJunctionProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
  historicalPullFetchImpl: typeof fetch | null = async () => createJsonResponse({ data: [] }),
) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    pushSourceRecoveryEnabled: true,
    summaryResources: ["activity"],
    summaryBackfillDays: 2,
    timeseriesResources: [],
    fetchImpl: async (input, init) => {
      if (
        historicalPullFetchImpl
        && new URL(readUrl(input)).pathname === "/v2/introspect/historical_pull"
      ) {
        return historicalPullFetchImpl(input, init);
      }

      return fetchImpl(input, init);
    },
    ...overrides,
  });
}

function createHistoricalPullFetch(
  providers: Record<string, unknown>,
): typeof fetch {
  return async () => createJsonResponse({
    data: [{
      provider: providers,
      user_id: "junction-user-1",
    }],
  });
}

function createMixedGarminOuraActivityProvider(
  garminHistoricalStatus: "failure" | "success",
) {
  return createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: { activity: true },
          },
          {
            id: "provider-oura-1",
            slug: "oura",
            name: "Oura",
            status: "connected",
            resource_availability: { activity: true },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [
          { id: "garmin-activity-1", connectionId: "provider-garmin-1", steps: 4321 },
          { id: "oura-activity-1", connectionId: "provider-oura-1", steps: 1234 },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
  }, createHistoricalPullFetch({
    garmin: {
      not_pulled: [],
      pulled: {
        activity: {
          days_with_data: garminHistoricalStatus === "success" ? 1 : 0,
          ...(garminHistoricalStatus === "failure"
            ? { error_details: "Historical pull failed." }
            : {}),
          status: garminHistoricalStatus,
        },
      },
    },
    oura: {
      not_pulled: [],
      pulled: {
        activity: {
          days_with_data: 0,
          error_details: "Historical pull failed.",
          status: "failure",
        },
      },
    },
  }));
}

function executeJunctionJob(
  provider: ReturnType<typeof createJunctionProvider>,
  context: ProviderJobContext,
  job: DeviceSyncJobRecord,
) {
  const executor = provider.jobExecutor;
  assert.ok(executor, "Junction provider should expose a job executor.");
  return executor.executeJob(context, job);
}

function createJunctionJobContext(overrides: Partial<ProviderJobContext> = {}): ProviderJobContext {
  const account = overrides.account ?? createAccount();

  return {
    account,
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async () => ({ imported: true }),
    upsertConnectionSource: (input) => ({
      id: "src-1",
      connectionId: account.id,
      ...input,
      displayName: input.displayName ?? null,
      resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
      lastErrorCode: input.lastErrorCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
      lastDataAt: input.lastDataAt ?? null,
      createdAt: input.lastSeenAt,
      updatedAt: input.lastSeenAt,
    }),
    listConnectionSources: async (input = {}) => (account.sources ?? []).filter((source) =>
      (!input.sourceProviderSlug || source.sourceProviderSlug === input.sourceProviderSlug)
      && (!input.status || source.status === input.status)
    ),
    refreshAccountTokens: async () => account,
    logger: {},
    ...overrides,
  };
}

function createConnectionSource(
  overrides: Omit<Partial<DeviceConnectionSourceRecord>, "firstSeenAt"> & {
    firstSeenAt?: string | null;
  } = {},
): DeviceConnectionSourceRecord {
  const { firstSeenAt, ...sourceOverrides } = overrides;
  return {
    id: "src-garmin",
    connectionId: "acct-junction-1",
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "garmin",
    }), "Garmin source key should be available."),
    sourceProviderSlug: "garmin",
    displayName: null,
    status: "connected",
    resourceAvailabilitySummary: { activity: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    lastDataAt: null,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    ...sourceOverrides,
    firstSeenAt: firstSeenAt ?? "2026-04-03T00:00:00.000Z",
  };
}

function createEmptyJunctionBackfillProvider(
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
  historicalPullFetchImpl?: typeof fetch,
) {
  return createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, overrides, historicalPullFetchImpl);
}

function createHistoricalActivityProvider(
  sourceProviderSlug: string,
  historicalPullFetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
) {
  return createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-source-1",
          name: "Historical source",
          resource_availability: { activity: true },
          slug: sourceProviderSlug,
          status: "connected",
        }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, overrides, historicalPullFetchImpl);
}

test("Junction provider defaults fetch every default summary resource", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: Object.fromEntries([
                ...JUNCTION_DEFAULT_SUMMARY_RESOURCES,
              ].map((resource) => [resource, true])),
            },
          ],
        });
      }

      const summaryResource = new URL(url).pathname.match(/^\/v2\/summary\/([^/]+)\//u)?.[1];
      if (summaryResource) {
        assert.ok(
          (JUNCTION_DEFAULT_SUMMARY_RESOURCES as readonly string[]).includes(summaryResource),
          `Unexpected default summary resource: ${summaryResource}`,
        );
        return createJsonResponse({
          data: summaryResource === "activity"
            ? [{ id: "activity-1", observedAt: "2026-04-02T12:00:00.000Z", steps: 1200 }]
            : [],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        lastSyncCompletedAt: "2026-04-03T12:00:00.000Z",
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const summaryResources = requests
    .map((url) => new URL(url).pathname.match(/^\/v2\/summary\/([^/]+)\//u)?.[1])
    .filter((resource): resource is string => Boolean(resource));
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction default summary sync should fetch the profile current-state summary once.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;

  assert.equal(summaryResources.includes("profile"), true);
  assert.equal(summaryResources.includes("menstrual_cycle"), true);
  assert.equal(summaryResources.includes("electrocardiogram"), true);
  assert.equal(summaryResources.length, JUNCTION_DEFAULT_SUMMARY_RESOURCES.length);
  assert.deepEqual(new Set(summaryResources), new Set([...JUNCTION_DEFAULT_SUMMARY_RESOURCES]));
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction omitted timeseries config defaults to compact resources only", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: Object.fromEntries([
                "activity",
                ...JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
                "heartrate",
                "steps",
                "distance",
                "calories_active",
                "weight",
              ].map((resource) => [resource, true])),
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({ data: [] });
      }

      const timeseriesResource = new URL(url).pathname.match(/^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1];
      if (timeseriesResource) {
        assert.ok(
          (JUNCTION_DEFAULT_TIMESERIES_RESOURCES as readonly string[]).includes(timeseriesResource),
          `Unexpected default timeseries resource: ${timeseriesResource}`,
        );
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                timestamp: "2026-04-02T12:00:00.000Z",
                unit: timeseriesResource === "blood_oxygen" ? "%" : "score",
                value: timeseriesResource === "blood_oxygen" ? 97 : 24,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        lastSyncCompletedAt: "2026-04-03T12:00:00.000Z",
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const requestedTimeseriesResources = requests
    .map((url) => new URL(url).pathname.match(/^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1])
    .filter((resource): resource is string => Boolean(resource));

  assert.deepEqual(
    [...new Set(requestedTimeseriesResources)].sort(),
    [...JUNCTION_DEFAULT_TIMESERIES_RESOURCES].sort(),
  );
  assert.equal(
    requests.every((url) =>
      !url.includes("/heartrate/") &&
      !url.includes("/steps/") &&
      !url.includes("/distance/") &&
      !url.includes("/calories_active/") &&
      !url.includes("/weight/")
    ),
    true,
  );
  assert.equal(importedSnapshots.length, JUNCTION_DEFAULT_TIMESERIES_RESOURCES.length);
});

test("Junction known dense programmatic timeseries config falls back to compact daily defaults", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["steps", "heart_rate"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: Object.fromEntries([
              "activity",
              ...JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
              "steps",
              "heartrate",
            ].map((resource) => [resource, true])),
          }],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({ data: [] });
      }

      const timeseriesResource = new URL(url).pathname.match(/^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1];
      if (timeseriesResource) {
        assert.ok(
          (JUNCTION_DEFAULT_TIMESERIES_RESOURCES as readonly string[]).includes(timeseriesResource),
          `Unexpected default timeseries resource: ${timeseriesResource}`,
        );
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                timestamp: "2026-04-02T12:00:00.000Z",
                unit: timeseriesResource === "blood_oxygen" ? "%" : "count",
                value: timeseriesResource === "blood_oxygen" ? 97 : 24,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        lastSyncCompletedAt: "2026-04-03T12:00:00.000Z",
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const requestedTimeseriesResources = requests
    .map((url) => new URL(url).pathname.match(/^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1])
    .filter((resource): resource is string => Boolean(resource));

  assert.deepEqual(
    [...new Set(requestedTimeseriesResources)].sort(),
    [...JUNCTION_DEFAULT_TIMESERIES_RESOURCES].sort(),
  );
  assert.equal(
    requests.every((url) =>
      !url.includes("/heartrate/") &&
      !url.includes("/steps/") &&
      !url.includes("/distance/") &&
      !url.includes("/calories_active/") &&
      !url.includes("/weight/")
    ),
    true,
  );
  assert.equal(importedSnapshots.length, JUNCTION_DEFAULT_TIMESERIES_RESOURCES.length);
});

function buildExpectedJunctionDedupeKey(
  kind: "backfill" | "reconcile",
  windowStart: string,
  windowEnd: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify(["junction", kind, windowStart, windowEnd]))
    .digest("hex");
}

function sha256ForTest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertJunctionWindowQuery(
  url: string,
  expectedStartDate: string,
  expectedEndDate: string,
): void {
  const searchParams = new URL(url).searchParams;
  assert.equal(searchParams.get("start_date"), expectedStartDate);
  assert.equal(searchParams.get("end_date"), expectedEndDate);
}

function requireJunctionConnectionHandler(provider: ReturnType<typeof createJunctionProvider>) {
  return requireValue(provider.connectionHandler, "Junction provider should expose a connection handler.");
}

function requireJunctionWebhookHandler(provider: ReturnType<typeof createJunctionProvider>) {
  return requireValue(provider.webhookHandler, "Junction provider should expose a webhook handler.");
}

function createJunctionSvixWebhook(input: {
  body: Record<string, unknown>;
  messageId?: string;
  secret?: string;
  signatureHeader?: (signature: string) => string;
  timestamp?: string;
}): { headers: Headers; rawBody: Buffer } {
  const messageId = input.messageId ?? "msg_test_123";
  const timestamp = input.timestamp ?? "1775155200";
  const secret = input.secret ?? "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": messageId,
      "svix-timestamp": timestamp,
      "svix-signature": input.signatureHeader?.(signature) ?? `v1,${signature}`,
    }),
    rawBody,
  };
}

test("Junction client_user_id is deterministic, bounded, and owner-blinded", () => {
  const clientUserId = buildJunctionClientUserId(
    "junction-client-user-id-secret",
    "owner-internal-id-123",
  );

  assert.equal(clientUserId.length, 32);
  assert.ok(clientUserId.startsWith("murph_"));
  assert.doesNotMatch(clientUserId, /owner|internal|123/u);
  assert.equal(
    clientUserId,
    buildJunctionClientUserId("junction-client-user-id-secret", "owner-internal-id-123"),
  );
});

test("Junction provider exposes primitive handlers without OAuth compatibility methods", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  assert.ok(provider.connectionHandler);
  assert.ok(provider.webhookHandler);
  assert.ok(provider.jobExecutor);
  assert.equal("buildConnectUrl" in provider, false);
  assert.equal("exchangeAuthorizationCode" in provider, false);
  assert.equal("refreshTokens" in provider, false);
});

test("Junction default provider filter covers hosted Link connect routes", () => {
  assert.equal(JUNCTION_CONNECT_SOURCE_TARGETS.length, 33);

  assert.deepEqual(
    JUNCTION_LINK_PROVIDER_SLUGS,
    JUNCTION_CONNECT_SOURCE_TARGETS
      .filter((target) => target.connectMode === "junction_link")
      .map((target) => target.providerSlug),
  );
  assert.deepEqual(JUNCTION_DEFAULT_PROVIDER_FILTER, normalizeJunctionProviderFilter(undefined));
  assert.deepEqual(normalizeJunctionProviderFilter(undefined), JUNCTION_DEFAULT_PROVIDER_FILTER);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("map_my_fitness"), true);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("dexcom_v3"), true);
  for (const providerSlug of [
    "samsung_health",
    "freestyle_libre_ble",
    "accuchek_ble",
    "contour_ble",
    "onetouch_ble",
    "apple_health_kit",
  ]) {
    assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes(providerSlug), false);
  }

  assert.equal(resolveJunctionTarget("samsung_health")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("freestyle_libre_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("accuchek_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("contour_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("onetouch_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("apple_health_kit")?.connectMode, "junction_sdk");

  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom-g6-and-older"), "dexcom");
  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom"), "dexcom_v3");
  assert.equal(resolveJunctionConnectTargetForSourceId("mapmyfitness"), "map_my_fitness");
  assert.equal(resolveJunctionConnectTargetForSourceId("accuchek"), "accuchek_ble");
  assert.equal(resolveJunctionConnectTargetForSourceId("onetouch"), "onetouch_ble");
  assert.equal(resolveJunctionConnectTargetForSourceId("apple-health"), "apple_health_kit");
  assert.equal(resolveJunctionConnectSourceLabel("accuchek_ble"), "Accu-Chek");
  for (const providerSlug of ["apple_health_kit", "apple_health", "apple-healthkit"]) {
    assert.equal(resolveDeviceConnectSourceIdForJunctionProviderSlug(providerSlug), "apple-health");
    assert.equal(resolveJunctionConnectSourceLabel(providerSlug), "Apple Health");
  }
});

test("Junction empty historical backfill records progress and stores the retry wake in metadata", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createEmptyJunctionBackfillProvider();
  const context = createJunctionJobContext({
    now: "2026-04-04T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 0);
  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");

  // Retry metadata owns the connect-window wake; the scheduler materializes the
  // exact-window job only when that wake is due.
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");
  const retryingAccount = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
  });
  const beforeDue = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:10:00.000Z");
  const delayedRetryJob = beforeDue?.jobs.find((job) => job.kind === "backfill");
  assert.equal(delayedRetryJob, undefined);
  assert.equal(beforeDue?.nextReconcileAt, "2026-04-04T00:15:00.000Z");

  const due = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:15:00.000Z");
  const retryJob = due?.jobs.find((job) => job.kind === "backfill");
  assert.equal(retryJob?.availableAt, "2026-04-04T00:15:00.000Z");
  assert.equal(retryJob?.priority, 50);
  assert.deepEqual(retryJob?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(
    retryJob?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2026-04-01T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    ),
  );
  assert.equal(due?.nextReconcileAt, "2026-04-04T01:15:00.000Z");
});

test("Junction due historical backfill retry does not make ordinary reconcile own the retry wake", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                activity: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({ data: [] });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
    {
      reconcileIntervalMs: 60 * 60_000,
    },
  );
  const context = createJunctionJobContext({
    now: "2026-04-04T00:15:00.000Z",
    account: createAccount({
      connectedAt: "2026-04-03T00:00:00.000Z",
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
      nextReconcileAt: "2026-04-04T00:15:00.000Z",
    }),
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:15:00.000Z",
      windowEnd: "2026-04-04T00:15:00.000Z",
    }),
  );

  assert.equal(result.nextReconcileAt, "2026-04-04T01:15:00.000Z");
});

test("Junction materialized due historical backfill retry advances normal reconcile after completion", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                activity: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({
          data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
    {
      reconcileIntervalMs: 60 * 60_000,
    },
  );
  const context = createJunctionJobContext({
    now: "2026-04-04T00:15:00.000Z",
    account: createAccount({
      connectedAt: "2026-04-03T00:00:00.000Z",
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
      nextReconcileAt: "2026-04-04T00:15:00.000Z",
    }),
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_complete");
  assert.equal(result.nextReconcileAt, "2026-04-04T01:15:00.000Z");
});

test("Junction exact-window backfill preserves a pending metadata retry before it is due", async () => {
  const provider = createEmptyJunctionBackfillProvider({
    reconcileIntervalMs: 60 * 60_000,
  });
  const metadata = {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  };
  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:05:00.000Z",
      account: createAccount({
        connectedAt: "2026-04-03T00:00:00.000Z",
        metadata,
        nextReconcileAt: "2026-04-04T00:15:00.000Z",
      }),
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
});

test("Junction retrying historical backfill without attempts uses the first retry delay", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");
  const retryingAccount = createStoredAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });

  const beforeDue = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:05:00.000Z");
  const delayedRetryJob = beforeDue?.jobs.find((job) => job.kind === "backfill");
  assert.equal(delayedRetryJob, undefined);
  assert.equal(beforeDue?.nextReconcileAt, "2026-04-04T00:15:00.000Z");

  const due = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:16:00.000Z");
  const retryJob = due?.jobs.find((job) => job.kind === "backfill");
  assert.equal(retryJob?.availableAt, "2026-04-04T00:16:00.000Z");
  assert.deepEqual(retryJob?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(
    retryJob?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2026-04-01T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    ),
  );
  assert.equal(due?.nextReconcileAt, "2026-04-04T01:16:00.000Z");
});

test("Junction non-connect backfill window uses bounded job retry without historical metadata", async () => {
  let activityRecords: unknown[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              sleep: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: activityRecords });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep"],
  });
  const context = createJunctionJobContext({
    now: "2026-04-04T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2025-01-01T12:34:56.000Z",
      windowEnd: "2026-04-05T08:09:10.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.nextReconcileAt, "2026-04-04T01:00:00.000Z");
  const retryJob = requireValue(
    result.scheduledJobs?.[0],
    "Empty non-connect Junction backfill should schedule a delayed exact-window retry.",
  );
  assert.equal(result.scheduledJobs?.length, 1);
  assert.equal(retryJob.availableAt, "2026-04-04T00:15:00.000Z");
  assert.equal(retryJob.kind, "backfill");
  assert.deepEqual(retryJob.payload, {
    windowStart: "2025-01-01T12:34:56.000Z",
    windowEnd: "2026-04-05T08:09:10.000Z",
    emptyBackfillAttempts: 1,
  });
  assert.equal(
    retryJob.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2025-01-01T12:34:56.000Z",
      "2026-04-05T08:09:10.000Z",
    ),
  );
  assert.equal(importedSnapshots.length, 0);

  activityRecords = [{ id: "activity-event-retry-1", connectionId: "provider-garmin-1", steps: 1234 }];
  const retryResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:15:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob(retryJob.kind, retryJob.payload ?? {}),
  );

  assert.equal(retryResult.metadataPatch, undefined);
  assert.equal(retryResult.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction useful daily history completes when an available sparse body resource is empty", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              body: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/body/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "body"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction historical backfill should fetch summary completion data.",
  );
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-04-01T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
});

test("Junction connected sources with only sparse resources have no completion obligations", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              body: true,
              workouts: true,
            },
          },
        ],
      });
    }

    if (
      url.startsWith("https://api.sandbox.us.junction.com/v2/summary/body/junction-user-1")
      || url.startsWith("https://api.sandbox.us.junction.com/v2/summary/workouts/junction-user-1")
    ) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["body", "workouts"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction partial activity history does not complete advertised sleep history", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              sleep: { status: "available" },
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction historical coverage does not let one source satisfy another source", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              body: { status: "unavailable" },
              sleep: { status: "available" },
            },
          },
          {
            id: "provider-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
            status: "connected",
            resource_availability: {
              sleep: "available",
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "sleep-fitbit-1", connectionId: "provider-fitbit-1", duration: 28_800 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/body/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep", "body"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 1);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction Apple Health success completes a 180-day Murph window even with zero days and a short provider range", async () => {
  const provider = createHistoricalActivityProvider(
    "apple_health",
    createHistoricalPullFetch({
      "apple-healthkit": {
        not_pulled: [],
        pulled: {
          activity: {
            days_with_data: 0,
            range_end: "2026-04-03T00:00:00.000Z",
            range_start: "2026-03-04T00:00:00.000Z",
            status: "success",
          },
        },
      },
    }),
    { summaryBackfillDays: 180 },
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("backfill", {
      windowStart: "2025-10-05T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2025-10-05T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
});

test("Junction Apple Health not_pulled resources create no historical obligation", async () => {
  const provider = createHistoricalActivityProvider(
    "apple_health_kit",
    createHistoricalPullFetch({
      apple_health_kit: {
        not_pulled: ["activity"],
        pulled: {},
      },
    }),
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_complete");
});

for (const testCase of [
  { label: "scheduled", notPulled: [] as string[], status: "scheduled" },
  { label: "in progress", notPulled: [] as string[], status: "in_progress" },
  {
    label: "retrying even when malformed not_pulled contradicts it",
    notPulled: ["activity"],
    status: "retrying",
  },
  { label: "unknown future", notPulled: [] as string[], status: "paused_by_provider" },
] as const) {
  test(`Junction Garmin ${testCase.label} historical status stays on the saturated retry without a reset marker`, async () => {
    const provider = createHistoricalActivityProvider(
      "garmin",
      createHistoricalPullFetch({
        garmin: {
          not_pulled: testCase.notPulled,
          pulled: {
            activity: {
              days_with_data: 0,
              status: testCase.status,
            },
          },
        },
      }),
    );
    const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            junctionHistoricalBackfillStatus: "coverage_v3_retrying",
            junctionHistoricalBackfillEmptyAttempts: 4,
            junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
            junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
            junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
          },
        }),
        upsertConnectionSource: (input) => {
          upserts.push(input);
          return createConnectionSource(input);
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
    assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
    assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
    assert.equal(
      upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
      false,
    );
  });
}

test("Junction Oura historical failure stays retrying and never asks for a shared reset", async () => {
  const provider = createHistoricalActivityProvider(
    "oura",
    createHistoricalPullFetch({
      oura: {
        not_pulled: [],
        pulled: {
          activity: {
            days_with_data: 0,
            error_details: "Historical pull failed.",
            status: "failure",
          },
        },
      },
    }),
  );
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(
    upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
    false,
  );
});

test("Junction introspection failure falls back to canonical summaries without failing import", async () => {
  const importedSnapshots: unknown[] = [];
  const warnings: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-oura-1",
          name: "Oura",
          resource_availability: { activity: true },
          slug: "oura",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{
          connectionId: "provider-oura-1",
          date: "2026-04-02",
          id: "oura-activity-1",
          steps: 4321,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {}, async () => createJsonResponse({ error: "unavailable" }, 400));

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn: (message) => warnings.push(message),
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_complete");
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(warnings, [
    "Junction historical-pull introspection was unavailable; using canonical import evidence.",
  ]);
});

test("Junction backfill diagnostic reports redacted provider call counts", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
              sleep: { status: "unavailable" },
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "summary-activity-1",
          provider_connection_id: "provider-garmin-1",
          sourceProviderSlug: "garmin",
          steps: 1234,
          date: "2026-04-02",
        }],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              timestamp: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  assert.ok(provider.diagnostics?.diagnoseBackfill);

  const result = await provider.diagnostics.diagnoseBackfill({
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    timeseriesProbeDays: 2,
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  const diagnostic = result.result;
  const summary = diagnostic.summary as {
    hasUsefulHistoricalRecords?: boolean;
    resources?: Array<{ recordCount?: number; resource?: string }>;
  };
  const timeseriesProbe = diagnostic.timeseriesProbe as {
    resources?: Array<{ recordCount?: number; resource?: string }>;
  };
  const sourceProviders = diagnostic.sourceProviders as {
    sources?: Array<{ resourceCount?: number; resources?: string[]; sourceKey?: string }>;
  };

  assert.equal(summary.hasUsefulHistoricalRecords, true);
  assert.deepEqual(summary.resources?.map((entry) => [entry.resource, entry.recordCount]), [
    ["activity", 1],
  ]);
  assert.deepEqual(timeseriesProbe.resources?.map((entry) => [entry.resource, entry.recordCount]), [
    ["blood_oxygen", 1],
  ]);
  assert.deepEqual(sourceProviders.sources, [{
    resourceCount: 2,
    resources: ["activity", "heartrate"],
    sourceKey: "source_1",
  }]);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction backfill diagnostic should inspect summary data.",
  );
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-04-02T10:15:30.000Z",
    "2026-04-03T11:45:00.000Z",
  );
  const timeseriesRequest = requireValue(
    requests.find((url) => url.includes("/v2/timeseries/")),
    "Junction backfill diagnostic should inspect timeseries probe data.",
  );
  assertJunctionWindowQuery(
    timeseriesRequest,
    "2026-04-02T10:15:30.000Z",
    "2026-04-03T11:45:00.000Z",
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|summary-activity-1|garmin|Garmin/u,
  );
});

test("Junction REST diagnostic probes a compact resource without returning raw records", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              timestamp: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
            provider_connection_id: "provider-garmin-1",
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T12:00:00.000Z",
    resource: "blood_oxygen",
    sourceProviderSlug: "garmin",
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  const probe = result.result as {
    request?: {
      endpoint?: string;
      queryParameterNames?: string[];
      resource?: string;
      sourceFiltered?: boolean;
      window?: Record<string, unknown>;
    };
    response?: { ok?: boolean; recordCount?: number; shape?: Record<string, unknown> };
  };

  assert.equal(result.provider, "junction");
  assert.equal(probe.request?.endpoint, "timeseries");
  assert.equal(probe.request?.resource, "blood_oxygen");
  assert.equal(probe.request?.sourceFiltered, true);
  assert.deepEqual(probe.request?.queryParameterNames, ["end_date", "provider", "start_date"]);
  assert.deepEqual(probe.request?.window, {
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  assert.equal(probe.response?.ok, true);
  assert.equal(probe.response?.recordCount, 1);
  assert.equal(probe.response?.shape?.kind, "object");
  assert.equal(seenUrls.length, 1);
  const seenUrl = requireValue(seenUrls[0], "Junction diagnostic should issue one read request.");
  assert.equal(new URL(seenUrl).pathname, "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
  assert.equal(new URL(seenUrl).searchParams.get("provider"), "garmin");
  assertJunctionWindowQuery(
    seenUrl,
    "2026-04-02T10:15:30.000Z",
    "2026-04-03T11:45:00.000Z",
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|97|garmin/u,
  );
});

test("Junction REST diagnostics dispatch a scoped historical pull trigger", async () => {
  const requests: { body: unknown; method: string; url: string }[] = [];
  const runTrigger = async (respond: () => Response) => {
    const provider = createJunctionProvider(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      return respond();
    });
    const probeRest = provider.diagnostics?.probeRest;
    assert.ok(probeRest);

    return probeRest({
      account: createAccount(),
      endpoint: "trigger_historical_pull",
      now: "2026-07-24T12:00:00.000Z",
      resource: null,
      sourceProviderSlug: "Garmin",
    });
  };
  const readResponse = (result: Awaited<ReturnType<typeof runTrigger>>) =>
    (result.result as { response?: Record<string, unknown> }).response ?? {};

  const accepted = await runTrigger(() => createJsonResponse({ success: true }, 202));
  assert.equal(readResponse(accepted).ok, true);
  assert.equal(readResponse(accepted).accepted, true);
  assert.equal(readResponse(accepted).endpointUnavailable, false);
  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      method: "POST",
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
  // The operator response must never carry the raw Junction user id.
  assert.doesNotMatch(JSON.stringify(accepted), /junction-user-1/u);

  requests.length = 0;
  const gated = await runTrigger(() => createJsonResponse({ detail: "not enabled" }, 403));
  assert.equal(readResponse(gated).ok, true);
  assert.equal(readResponse(gated).accepted, false);
  assert.equal(readResponse(gated).endpointUnavailable, true);

  requests.length = 0;
  const failed = await runTrigger(() => createJsonResponse({ detail: "boom" }, 500));
  assert.equal(readResponse(failed).ok, false);
  assert.equal(readResponse(failed).responseStatus, 500);
});

test("Junction REST diagnostics use date params for date-only summary resources", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/menstrual_cycle/junction-user-1")) {
      return createJsonResponse({ menstrual_cycle: [] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/electrocardiogram/junction-user-1")) {
      return createJsonResponse({ electrocardiogram: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["menstrual_cycle", "electrocardiogram"],
    timeseriesResources: [],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  for (const resource of ["menstrual_cycle", "electrocardiogram"]) {
    await probeRest({
      account: createAccount(),
      endpoint: "summary",
      now: "2026-04-03T12:00:00.000Z",
      resource,
      windowStart: "2026-04-02T10:15:30.000Z",
      windowEnd: "2026-04-03T11:45:00.000Z",
    });
  }

  assert.equal(seenUrls.length, 2);
  for (const url of seenUrls) {
    assertJunctionWindowQuery(
      requireValue(url, "Junction summary diagnostic should issue one read request per resource."),
      "2026-04-02",
      "2026-04-03",
    );
  }
});

test("Junction maps the weight timeseries resource to the documented body_weight endpoint", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.includes("/v2/timeseries/junction-user-1/body_weight/grouped")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: [],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T12:00:00.000Z",
    resource: "weight",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(seenUrls.length, 1);
  const seenUrl = requireValue(seenUrls[0], "Junction diagnostic should issue one read request.");
  assert.equal(new URL(seenUrl).pathname, "/v2/timeseries/junction-user-1/body_weight/grouped");
  assertJunctionWindowQuery(
    seenUrl,
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
});

test("Junction REST diagnostic can force a bounded user data refresh", async () => {
  const seenRequests: Array<{ method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    seenRequests.push({
      method: init?.method ?? "GET",
      url,
    });

    if (url === "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45") {
      return createJsonResponse({
        success: true,
        refreshed_sources: ["garmin.steps", "oura.activity"],
        in_progress_sources: ["garmin.sleep"],
        failed_sources: [
          { provider: "garmin", resource: "weight" },
          { provider: "oura", resource: "hrv" },
        ],
        user_id: "junction-user-1",
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "refresh",
    now: "2026-04-03T12:00:00.000Z",
    timeoutSeconds: 45,
  });
  const probe = result.result as {
    request?: {
      endpoint?: string;
      endpointKind?: string;
      method?: string;
      queryParameterNames?: string[];
      timeoutSeconds?: number | null;
    };
    response?: {
      failedSourceCount?: number;
      failedSources?: string[];
      inProgressSourceCount?: number;
      inProgressSources?: string[];
      ok?: boolean;
      refreshedSourceCount?: number;
      refreshedSources?: string[];
      success?: boolean | null;
    };
  };

  assert.equal(probe.request?.endpoint, "refresh");
  assert.equal(probe.request?.endpointKind, "junction_user_refresh");
  assert.equal(probe.request?.method, "POST");
  assert.deepEqual(probe.request?.queryParameterNames, ["timeout"]);
  assert.equal(probe.request?.timeoutSeconds, 45);
  assert.equal(probe.response?.ok, true);
  assert.equal(probe.response?.success, true);
  assert.equal(probe.response?.refreshedSourceCount, 2);
  assert.deepEqual(probe.response?.refreshedSources, ["source_1.steps", "source_2.activity"]);
  assert.equal(probe.response?.inProgressSourceCount, 1);
  assert.deepEqual(probe.response?.inProgressSources, ["source_1.sleep"]);
  assert.equal(probe.response?.failedSourceCount, 2);
  assert.deepEqual(probe.response?.failedSources, ["source_1.weight", "source_2.hrv"]);
  assert.deepEqual(seenRequests, [{
    method: "POST",
    url: "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45",
  }]);
  assert.doesNotMatch(JSON.stringify(result), /junction-user-1|garmin|oura/u);
});

test("Junction REST diagnostic reports refresh failure details safely", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45") {
      return createJsonResponse({
        error: "invalid_request",
        message: "Refresh requires a connected source.",
        user_id: "junction-user-1",
      }, 400);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "refresh",
    now: "2026-04-03T12:00:00.000Z",
    timeoutSeconds: 45,
  });
  const probe = result.result as {
    response?: {
      diagnostics?: Record<string, unknown>;
      errorCode?: string;
      ok?: boolean;
      responseStatus?: number | null;
      retryable?: boolean;
    };
  };

  assert.equal(probe.response?.ok, false);
  assert.equal(probe.response?.errorCode, "JUNCTION_API_REQUEST_FAILED");
  assert.equal(probe.response?.responseStatus, 400);
  assert.equal(probe.response?.retryable, false);
  assert.equal(probe.response?.diagnostics?.responseErrorCode, "invalid_request");
  assert.equal(probe.response?.diagnostics?.responseErrorDescription, "Refresh requires a connected source.");
  assert.equal(probe.response?.diagnostics?.requestEndpointKind, "junction_user_refresh");
  assert.deepEqual(Object.keys(probe.response?.diagnostics ?? {}).sort().includes("user_id"), false);
  assert.doesNotMatch(JSON.stringify(result), /junction-user-1|sk_us_test_123/u);
});

test("Junction REST diagnostic matrix compares metadata, introspection, and data reads safely", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          source: {
            device_id: "source-device-1",
          },
          resource_availability: {
            steps: true,
          },
        }],
      });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/user/junction-user-1/device") {
      return createJsonResponse([{
        id: "device-row-1",
        user_id: "junction-user-1",
        provider: "garmin",
        source_type: "watch",
        device_id: "source-device-1",
        device_manufacturer: "Garmin",
        device_model: "Fenix",
      }]);
    }

    if (
      url === "https://api.sandbox.us.junction.com/v2/introspect/resources?user_id=junction-user-1&user_limit=1"
      || url === "https://api.sandbox.us.junction.com/v2/introspect/resources?user_id=junction-user-1&user_limit=1&provider=garmin"
    ) {
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              steps: {
                sent_count: 1,
                oldest_data: "2026-04-02T00:00:00+00:00",
                newest_data: "2026-04-02T23:59:59+00:00",
                last_attempt: {
                  status: "success",
                  timestamp: "2026-04-03T00:00:00+00:00",
                },
              },
            },
          },
        }],
      });
    }

    if (
      url === "https://api.sandbox.us.junction.com/v2/introspect/historical_pull?user_id=junction-user-1&user_limit=1"
      || url === "https://api.sandbox.us.junction.com/v2/introspect/historical_pull?user_id=junction-user-1&user_limit=1&provider=garmin"
    ) {
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              not_pulled: [],
              pulled: {
                steps: {
                  days_with_data: 1,
                  range_start: "2026-04-02T00:00:00+00:00",
                  range_end: "2026-04-02T23:59:59+00:00",
                  status: "success",
                  timeline: {
                    scheduled_at: "2026-04-03T00:00:00+00:00",
                    started_at: "2026-04-03T00:00:01+00:00",
                    ended_at: "2026-04-03T00:00:02+00:00",
                  },
                },
              },
            },
          },
        }],
      });
    }

    const parsedUrl = new URL(url);
    if (
      parsedUrl.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
      && parsedUrl.searchParams.get("start_date") === "2026-04-02T00:00:00.000Z"
      && parsedUrl.searchParams.get("end_date") === "2026-04-03T00:00:00.000Z"
      && (
        parsedUrl.searchParams.get("provider") === null
        || parsedUrl.searchParams.get("provider") === "garmin"
      )
    ) {
      return createJsonResponse({
        groups: {
          garmin: [{
            source: {
              provider: "garmin",
              type: "watch",
            },
            data: [{
              end: "2026-04-02T12:05:00+00:00",
              start: "2026-04-02T12:00:00+00:00",
              unit: "%",
              value: 97,
            }],
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  }, null);
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "matrix",
    now: "2026-04-03T12:00:00.000Z",
    resource: "blood_oxygen",
    sourceProviderSlug: "garmin",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const matrix = result.result as {
    devices?: { response?: { deviceCount?: number; devices?: Array<Record<string, unknown>> } };
    historicalPull?: Array<{ response?: { pulledCount?: number; pulled?: Array<Record<string, unknown>> } }>;
    introspection?: Array<{ response?: { resourceCount?: number; resources?: Array<Record<string, unknown>> } }>;
    providers?: { response?: { sourceCount?: number } };
    reads?: Array<{
      request?: { sourceFiltered?: boolean };
      response?: { recordCount?: number };
    }>;
    request?: { resourceCount?: number; resources?: Array<Record<string, unknown>> };
  };

  assert.equal(matrix.request?.resourceCount, 1);
  assert.deepEqual(matrix.request?.resources, [{
    configuredResource: true,
    resource: "blood_oxygen",
    resourceCategory: "timeseries",
  }]);
  assert.equal(matrix.providers?.response?.sourceCount, 1);
  assert.equal(matrix.devices?.response?.deviceCount, 1);
  assert.equal(matrix.devices?.response?.devices?.[0]?.sourceKey, "source_1");
  assert.equal(matrix.devices?.response?.devices?.[0]?.sourceType, "watch");
  assert.equal(matrix.devices?.response?.devices?.[0]?.deviceIdPresent, true);
  assert.equal(matrix.devices?.response?.devices?.[0]?.manufacturerPresent, true);
  assert.equal(matrix.introspection?.[0]?.response?.resourceCount, 1);
  assert.equal(matrix.introspection?.[1]?.response?.resources?.[0]?.sentCount, 1);
  assert.equal(matrix.historicalPull?.[0]?.response?.pulledCount, 1);
  assert.equal(matrix.historicalPull?.[1]?.response?.pulled?.[0]?.daysWithData, 1);
  assert.deepEqual(matrix.reads?.map((entry) => [
    entry.request?.sourceFiltered,
    entry.response?.recordCount,
  ]), [
    [false, 1],
    [true, 1],
  ]);
  const parsedSeenUrls = seenUrls.map((url) => new URL(url));
  assert.deepEqual(parsedSeenUrls.map((url) => url.pathname).sort(), [
    "/v2/introspect/historical_pull",
    "/v2/introspect/historical_pull",
    "/v2/introspect/resources",
    "/v2/introspect/resources",
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
    "/v2/user/junction-user-1/device",
    "/v2/user/providers/junction-user-1",
  ].sort());
  const readUrls = parsedSeenUrls.filter((url) => url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
  assert.equal(readUrls.length, 2);
  const unfilteredReadUrl = requireValue(
    readUrls.find((url) => !url.searchParams.has("provider")),
    "Junction matrix diagnostic should read the unfiltered resource.",
  );
  assertJunctionWindowQuery(
    unfilteredReadUrl.toString(),
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
  const providerReadUrl = requireValue(
    readUrls.find((url) => url.searchParams.get("provider") === "garmin"),
    "Junction matrix diagnostic should read the provider-filtered resource.",
  );
  assertJunctionWindowQuery(
    providerReadUrl.toString(),
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
  const introspectionProviders = parsedSeenUrls
    .filter((url) => url.pathname.startsWith("/v2/introspect/"))
    .map((url) => url.searchParams.get("provider") ?? "")
    .sort();
  assert.deepEqual(introspectionProviders, ["", "", "garmin", "garmin"]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|source-device-1|device-row-1|garmin|Garmin|Fenix|97/u,
  );
});

test("Junction backfill diagnostic rejects malformed requested windows without provider calls", async () => {
  const provider = createJunctionProvider(async () => {
    throw new Error("Junction diagnostic should reject malformed windows before provider calls");
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const diagnoseBackfill = provider.diagnostics?.diagnoseBackfill;
  assert.ok(diagnoseBackfill);

  await assert.rejects(
    () => diagnoseBackfill({
      account: createAccount(),
      now: "2026-04-03T00:00:00.000Z",
      windowStart: "not-a-date",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_DIAGNOSTIC_WINDOW_INVALID");
      return true;
    },
  );
});

const usefulHistoricalSummaryRecordByResource = {
  sleep: {
    id: "sleep-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T01:00:00.000Z",
    endAt: "2026-04-02T08:00:00.000Z",
  },
  workouts: {
    id: "workouts-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T12:00:00.000Z",
    durationMinutes: 45,
  },
  body: {
    id: "body-1",
    connectionId: "provider-garmin-1",
    weightKg: 72,
  },
} satisfies Record<"sleep" | "workouts" | "body", Record<string, unknown>>;

const usefulHistoricalSummaryCompletionCases = [
  {
    label: "activity floors",
    resource: "activity",
    record: {
      id: "activity-floors-1",
      connectionId: "provider-garmin-1",
      floorsClimbed: 8,
    },
  },
  {
    label: "body lean mass",
    resource: "body",
    record: {
      id: "body-lean-1",
      connectionId: "provider-garmin-1",
      leanBodyMassKg: 58.2,
    },
  },
  {
    label: "body waist circumference",
    resource: "body",
    record: {
      id: "body-waist-1",
      connectionId: "provider-garmin-1",
      waistCircumferenceCm: 82,
    },
  },
  {
    label: "meal raw-only",
    resource: "meal",
    record: {
      id: "meal-1",
      sourceProviderSlug: "garmin",
      mealType: "breakfast",
    },
  },
  {
    label: "menstrual cycle raw-only",
    resource: "menstrual_cycle",
    record: {
      id: "cycle-1",
      sourceProviderSlug: "garmin",
      cycleDay: 3,
    },
  },
] as const;

for (const testCase of usefulHistoricalSummaryCompletionCases) {
  test(`Junction ${testCase.label} summary historical backfill marks the historical window complete`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [testCase.resource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${testCase.resource}/junction-user-1`)) {
        return createJsonResponse({ data: [testCase.record] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [testCase.resource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

test("Junction summary reads extract the documented top-level meals envelope", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              meal: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/meal/junction-user-1")) {
      return createJsonResponse({
        meals: [{
          id: "meal-doc-envelope-1",
          mealType: "breakfast",
          sourceProviderSlug: "garmin",
        }],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["meal"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
  };
  const mealRecord = snapshot.summaries?.meal?.[0];
  assert.equal(mealRecord?.id, "meal-doc-envelope-1");
  assert.equal(Object.hasOwn(mealRecord ?? {}, "meals"), false);
});

for (const testCase of [
  {
    label: "meal identity/debug-only",
    resource: "meal",
    record: {
      id: "meal-provenance-only",
      clientId: "provider-client-1",
      debug: true,
      fullName: "Raw Member Name",
      patientName: "Raw Patient Name",
      sourceProviderSlug: "garmin",
      status: "synced",
      items: [
        {
          subjectId: "raw-meal-subject-id",
          subject: {
            id: "raw-meal-nested-subject-id",
          },
        },
      ],
    },
  },
  {
    label: "menstrual cycle identity/contact-only",
    resource: "menstrual_cycle",
    record: {
      addressLine1: "123 Private Street",
      birthDate: "1980-01-01",
      dateOfBirth: "1980-01-01",
      dob: "1980-01-01",
      id: "cycle-identity-only",
      memberName: "Raw Member Name",
      provider_connection_id: "provider-garmin-1",
      sourceProviderSlug: "garmin",
      user: {
        id: "raw-cycle-user-id",
      },
      profile: {
        patient_id: "raw-cycle-patient-id",
      },
      symptoms: [
        {
          subjectId: "raw-cycle-subject-id",
          subjects: [
            {
              id: "raw-cycle-subjects-container-id",
            },
          ],
        },
      ],
    },
  },
] as const) {
  test(`Junction ${testCase.label} raw-only summary does not create a historical obligation`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [testCase.resource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${testCase.resource}/junction-user-1`)) {
        return createJsonResponse({ data: [testCase.record] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [testCase.resource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T00:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

for (const summaryResource of ["sleep", "workouts", "body"] as const) {
  test(`Junction ${summaryResource} summary historical backfill marks the historical window complete`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [usefulHistoricalSummaryRecordByResource[summaryResource]] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

test("Junction sleep_cycle stage-count-only history stays pending without canonical evidence", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              heartrate: true,
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "sleep-cycle-stage-count-only",
          provider_connection_id: "provider-garmin-1",
          stageCount: 4,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-03T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/sleep_cycle/")),
    "Junction sleep-cycle backfill should fetch REST summary data.",
  );
  assertJunctionWindowQuery(summaryRequest, "2026-04-01", "2026-04-02");
});

for (const summaryResource of ["activity", "sleep"] as const) {
  test(`Junction ${summaryResource} id-only historical backfill keeps the summary window retrying`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [{ id: `${summaryResource}-1`, connectionId: "provider-garmin-1" }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T00:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
    assert.equal(importedSnapshots.length, 1);
  });
}

const floatingSessionOnlySummaryRecordByResource = {
  sleep: {
    id: "sleep-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T01:00:00",
    endAt: "2026-04-02T08:00:00",
  },
} satisfies Record<"sleep", Record<string, unknown>>;

for (const summaryResource of ["sleep"] as const) {
  test(`Junction ${summaryResource} floating session-only historical backfill keeps the summary window retrying`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [floatingSessionOnlySummaryRecordByResource[summaryResource]] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T00:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
    assert.equal(importedSnapshots.length, 1);
  });
}

test("Junction useful summary without source linkage keeps the historical window retrying", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 4321 }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction floating-provider metric-only summary keeps the historical window retrying", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "freestyle_libre",
            name: "Freestyle Libre",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", sourceProviderSlug: "freestyle_libre", steps: 4321 }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction source envelope summary historical backfill marks the historical window complete", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{
          sourceProviderSlug: "garmin",
          data: [{ id: "activity-1", steps: 4321 }],
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction compact timeseries-only historical backfill keeps the summary window retrying", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              start: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
  const timeseriesSnapshot = importedSnapshots[0] as { summaries?: Record<string, unknown[]>; timeseries?: Record<string, unknown[]> };
  assert.deepEqual(timeseriesSnapshot.summaries, {});
  assert.equal(timeseriesSnapshot.timeseries?.blood_oxygen?.length, 1);
});

test("Junction yielded connect-window backfills keep owner window and resume with a cursor", async () => {
  const ownerWindowStart = "2026-04-01T00:00:00.000Z";
  const ownerWindowEnd = "2026-04-03T00:00:00.000Z";
  const cursor = "2026-04-02T00:00:00.000Z";
  const createProviderForRequests = (requests: string[]) =>
    createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                activity: true,
                blood_oxygen: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({
          data: [{ id: "activity-1", sourceProviderSlug: "garmin", steps: 4321 }],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                start: new URL(url).searchParams.get("start_date"),
                value: 97,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      timeseriesResources: ["blood_oxygen"],
    });

  const firstRequests: string[] = [];
  const firstImportedSnapshots: unknown[] = [];
  const initialJob = createJob("backfill", {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
  });
  const firstResult = await executeJunctionJob(
    createProviderForRequests(firstRequests),
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        firstImportedSnapshots.push(snapshot);
        return { imported: true };
      },
      shouldYield: () => firstRequests.some((url) => url.includes("/v2/timeseries/")),
    }),
    initialJob,
  );

  const continuation = requireValue(
    firstResult.scheduledJobs?.[0],
    "Yielded Junction backfill should schedule a continuation.",
  );
  assert.equal(firstResult.metadataPatch, undefined);
  assert.deepEqual(continuation.payload, {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
    timeseriesCursor: cursor,
  });
  assert.equal(
    continuation.dedupeKey,
    buildExpectedJunctionDedupeKey("backfill", ownerWindowStart, ownerWindowEnd),
  );
  assert.deepEqual(
    firstRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [["2026-04-01", "2026-04-01"]],
  );

  const secondRequests: string[] = [];
  const secondImportedSnapshots: unknown[] = [];
  const continuationJob = {
    ...createJob("backfill", continuation.payload ?? {}),
    dedupeKey: continuation.dedupeKey ?? null,
    priority: continuation.priority ?? 50,
  };
  const provider = createProviderForRequests(secondRequests);
  const secondResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:05:00.000Z",
      importSnapshot: async (snapshot) => {
        secondImportedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    continuationJob,
  );

  assert.deepEqual(
    secondRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [["2026-04-02", "2026-04-02"]],
  );
  assert.deepEqual(secondResult.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: ownerWindowStart,
    junctionHistoricalBackfillWindowEnd: ownerWindowEnd,
  });
  assert.equal(secondResult.scheduledJobs, undefined);
  assert.equal(secondImportedSnapshots.length, 2);

  const scheduledAfterCompletion = provider.jobExecutor?.createScheduledJobs?.(
    createStoredAccount({
      metadata: secondResult.metadataPatch ?? {},
    }),
    "2026-04-04T00:10:00.000Z",
  );
  assert.equal(
    scheduledAfterCompletion?.jobs.some((job) => job.kind === "backfill"),
    false,
  );
});

test("Junction profile-only historical backfill has no historical completion obligation", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              profile: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "profile-1", email: "person@example.test" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction profile-only backfill should fetch the profile current-state summary.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
});

test("Junction scheduled polling skips profile after the one-shot profile marker", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionProfileSummaryCheckedAt: "2026-04-02T00:00:00.000Z",
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.some((url) => new URL(url).pathname.includes("/v2/summary/profile/")), false);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(result.metadataPatch, undefined);
});

test("Junction unproven historical coverage saturates at a daily retry without a reset marker", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 4,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 4,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.status, "connected");
  assert.equal(
    upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
    false,
  );
});

test("Junction account jobs keep a concurrently fenced connected source out of projection and import", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: { activity: true },
          },
          {
            id: "provider-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
            status: "connected",
            resource_availability: { activity: true },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [
          {
            id: "garmin-activity-1",
            connectionId: "provider-garmin-1",
            steps: 4321,
          },
          {
            id: "fitbit-activity-1",
            connectionId: "provider-fitbit-1",
            steps: 1234,
          },
          {
            id: "fitbit-activity-direct-1",
            sourceProviderSlug: "fitbit",
            steps: 567,
          },
          {
            id: "unresolved-source-activity-1",
            connectionId: "provider-not-listed-1",
            steps: 890,
          },
          {
            id: "legacy-unattributed-activity-1",
            steps: 321,
          },
          {
            id: "legacy-rowless-activity-1",
            sourceProviderSlug: "polar",
            steps: 654,
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              id: "garmin-blood-oxygen-1",
              timestamp: "2026-04-02T14:00:00.000Z",
              unit: "%",
              value: 97,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
          fitbit: [{
            data: [{
              id: "fitbit-blood-oxygen-1",
              timestamp: "2026-04-02T14:00:00.000Z",
              unit: "%",
              value: 91,
            }],
            source: { provider: "fitbit", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const garminSource = createConnectionSource();
  const fitbitSource = createConnectionSource({
    id: "src-fitbit",
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "fitbit",
    }), "Fitbit source key should be available."),
    sourceProviderSlug: "fitbit",
    status: "connected",
    lastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
    lastErrorMessage: "Source disconnect is in progress.",
  });
  let liveSources = [garminSource, fitbitSource];
  const importedSnapshots: Array<{
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, Array<Record<string, unknown>>>;
  }> = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      // Simulate a worker that loaded the established account before the target
      // start committed its disconnected source row.
      account: createAccount({
        sources: [{
          sourceProviderSlug: garminSource.sourceProviderSlug,
          displayName: garminSource.displayName,
          status: garminSource.status,
          resourceCount: Object.keys(garminSource.resourceAvailabilitySummary).length,
          lastErrorCode: garminSource.lastErrorCode,
          lastErrorMessage: garminSource.lastErrorMessage,
          firstSeenAt: garminSource.firstSeenAt,
          lastSeenAt: garminSource.lastSeenAt,
          lastDataAt: garminSource.lastDataAt,
        }],
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot as (typeof importedSnapshots)[number]);
        return { imported: true };
      },
      listConnectionSources: () => liveSources,
      upsertConnectionSource: (input) => {
        upserts.push(input);
        const existing = liveSources.find((source) =>
          source.sourceInstanceKey === input.sourceInstanceKey
        );
        const stored = createConnectionSource({
          ...existing,
          ...input,
          id: existing?.id ?? `src-${input.sourceProviderSlug ?? "unknown"}`,
          firstSeenAt: existing?.firstSeenAt ?? input.lastSeenAt,
        });
        liveSources = [
          ...liveSources.filter((source) => source.sourceInstanceKey !== stored.sourceInstanceKey),
          stored,
        ];
        return stored;
      },
    }),
    createJob("reconcile", {}),
  );

  assert.equal(
    upserts.some((source) =>
      source.sourceProviderSlug === "fitbit" && source.status === "connected"
    ),
    false,
  );
  assert.equal(
    liveSources.find((source) => source.sourceProviderSlug === "fitbit")?.status,
    "connected",
  );
  assert.deepEqual(
    importedSnapshots.flatMap((snapshot) => snapshot.summaries?.activity ?? [])
      .map((record) => record.id),
    [
      "garmin-activity-1",
      "legacy-unattributed-activity-1",
      "legacy-rowless-activity-1",
    ],
  );
  assert.deepEqual(
    importedSnapshots.flatMap((snapshot) => snapshot.timeseries?.blood_oxygen ?? [])
      .map((record) => record.id),
    ["garmin-blood-oxygen-1"],
  );
});

test("Junction non-connected source stays retrying without inventing a historical reset", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "error",
            resource_availability: {},
            error_details: {
              error_type: "provider_temporarily_unavailable",
              error_message: "Temporary provider failure.",
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      listConnectionSources: () => [],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assert.equal(result.scheduledJobs, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(upserts.at(-1)?.sourceProviderSlug, "garmin");
  assert.equal(upserts.at(-1)?.status, "error");
  assert.equal(upserts.at(-1)?.lastErrorCode, "provider_temporarily_unavailable");
  assert.equal(
    upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
    false,
  );
});

test("Junction empty provider list keeps retrying without marking an existing source", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const existingSource = createConnectionSource({
    sourceInstanceKey: "hosted-source-garmin",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      listConnectionSources: () => [existingSource],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assert.equal(result.scheduledJobs, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(upserts.length, 0);
});

test("Junction explicit Garmin failure marks only Garmin when another source succeeds", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              sleep: true,
            },
          },
          {
            id: "provider-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
            status: "connected",
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [
          { id: "garmin-activity-1", connectionId: "provider-garmin-1", steps: 4321 },
          { id: "fitbit-activity-1", connectionId: "provider-fitbit-1", steps: 1234 },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep"],
  }, createHistoricalPullFetch({
    fitbit: {
      not_pulled: [],
      pulled: {
        activity: { days_with_data: 1, status: "success" },
      },
    },
    garmin: {
      not_pulled: [],
      pulled: {
        activity: { days_with_data: 1, status: "success" },
        sleep: {
          days_with_data: 0,
          error_details: "Historical pull failed.",
          status: "failure",
        },
      },
    },
  }));
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      listConnectionSources: () => [],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_exhausted");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 5);
  const erroredSources = upserts.filter((source) => source.status === "error");
  assert.equal(erroredSources.length, 1);
  assert.equal(erroredSources[0]?.sourceProviderSlug, "garmin");
  assert.equal(erroredSources[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
  assert.equal(
    upserts.some((source) => source.sourceProviderSlug === "fitbit" && source.status === "error"),
    false,
  );
});

test("Junction saturated mixed failures mark only Garmin while retrying the other source", async () => {
  const provider = createMixedGarminOuraActivityProvider("failure");
  const importedSnapshots: unknown[] = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      listConnectionSources: () => [],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const importedSnapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
  };
  assert.deepEqual(
    importedSnapshot.summaries?.activity?.map((record) => record.sourceProviderSlug).sort(),
    ["garmin", "oura"],
  );
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  const resetSources = upserts.filter((source) =>
    source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"
  );
  assert.deepEqual(resetSources.map((source) => source.sourceProviderSlug), ["garmin"]);
});

test("Junction saturated mixed failures wait for the due observation before marking Garmin", async () => {
  const provider = createMixedGarminOuraActivityProvider("failure");
  const importedSnapshots: unknown[] = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T12:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      listConnectionSources: () => [],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(result.metadataPatch, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-03T12:00:00.000Z");
  assert.equal(
    upserts.some((source) =>
      source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"
    ),
    false,
  );
});

test("Junction clears Garmin recovery after success while Oura remains retrying", async () => {
  const provider = createMixedGarminOuraActivityProvider("success");
  const importedSnapshots: unknown[] = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  let sources = [createConnectionSource({
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  })];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      listConnectionSources: () => sources,
      upsertConnectionSource: (input) => {
        upserts.push(input);
        const stored = createConnectionSource(input);
        sources = [
          ...sources.filter((source) => source.sourceInstanceKey !== stored.sourceInstanceKey),
          stored,
        ];
        return stored;
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  const garminUpdates = upserts.filter((source) => source.sourceProviderSlug === "garmin");
  assert.equal(garminUpdates[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
  assert.equal(garminUpdates.at(-1)?.status, "connected");
  const garminSource = sources.find((source) => source.sourceProviderSlug === "garmin");
  const ouraSource = sources.find((source) => source.sourceProviderSlug === "oura");
  assert.equal(garminSource?.status, "connected");
  assert.equal(garminSource?.lastErrorCode, null);
  assert.equal(ouraSource?.status, "connected");
  assert.equal(ouraSource?.lastErrorCode, null);
});

test("Junction exhausted historical backfill preserves reconnect-required source health", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const historicalError = createConnectionSource({
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [historicalError],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
});

test("Junction exhausted historical backfill reasserts a missing reconnect marker", async () => {
  const provider = createEmptyJunctionBackfillProvider({}, createHistoricalPullFetch({
    garmin: {
      not_pulled: [],
      pulled: {
        activity: {
          days_with_data: 0,
          error_details: "Historical pull failed.",
          status: "failure",
        },
      },
    },
  }));
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [createConnectionSource({
      status: "error",
      lastErrorCode: "TOKEN_REFRESH_FAILED",
      lastErrorMessage: "Transient provider error.",
    })],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts.at(-1)?.status, "error");
  assert.equal(upserts.at(-1)?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
});

test("Junction exhausted history marker survives a transient upstream provider error", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "error",
            error_details: {
              error_type: "provider_temporarily_unavailable",
              error_message: "Temporary provider failure.",
              errored_at: "2026-04-03T00:00:00.000Z",
            },
            resource_availability: { activity: true },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
          junctionHistoricalBackfillEmptyAttempts: 5,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      listConnectionSources: () => [createConnectionSource({
        status: "error",
        lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
        lastErrorMessage: "Historical data remained incomplete.",
      })],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
  assert.equal(upserts[0]?.lastErrorMessage, "Historical data remained incomplete.");
});

test("Junction source projection clears historical reconnect health after connection metadata resets", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const existingSource = createConnectionSource({
    sourceInstanceKey: "hosted-source-garmin",
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ metadata: {} }),
      listConnectionSources: () => [existingSource],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts[0]?.sourceInstanceKey, existingSource.sourceInstanceKey);
  assert.equal(upserts[0]?.status, "connected");
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorMessage"), false);
});

test("Junction current coverage clears a stale Oura reset marker", async () => {
  const provider = createHistoricalActivityProvider(
    "oura",
    createHistoricalPullFetch({
      oura: {
        not_pulled: [],
        pulled: {
          activity: { days_with_data: 1, status: "success" },
        },
      },
    }),
  );
  const existingSource = createConnectionSource({
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "oura",
    })),
    sourceProviderSlug: "oura",
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
          junctionHistoricalBackfillEmptyAttempts: 5,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      listConnectionSources: () => [existingSource],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts.at(-1)?.sourceProviderSlug, "oura");
  assert.equal(upserts.at(-1)?.status, "connected");
  assert.equal(Object.hasOwn(upserts.at(-1) ?? {}, "lastErrorCode"), false);
});

for (const sourceProviderSlug of ["oura", "apple_health_kit"] as const) {
  test(`Junction retrying coverage clears a stale ${sourceProviderSlug} reset marker`, async () => {
    const provider = createHistoricalActivityProvider(
      sourceProviderSlug,
      createHistoricalPullFetch({
        [sourceProviderSlug]: {
          not_pulled: [],
          pulled: {
            activity: { days_with_data: 1, status: "success" },
          },
        },
      }),
    );
    const sourceInstanceKey = requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug,
    }));
    const existingSource = createConnectionSource({
      sourceInstanceKey,
      sourceProviderSlug,
      status: "error",
      lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
      lastErrorMessage: "Historical data remained incomplete.",
    });
    const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            junctionHistoricalBackfillStatus: "coverage_v3_retrying",
            junctionHistoricalBackfillEmptyAttempts: 4,
            junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
            junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
            junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
          },
        }),
        listConnectionSources: () => [existingSource],
        upsertConnectionSource: (input) => {
          upserts.push(input);
          return createConnectionSource(input);
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    const sourceUpdates = upserts.filter((source) =>
      source.sourceProviderSlug === sourceProviderSlug
    );
    assert.ok(sourceUpdates.length > 0);
    for (const source of sourceUpdates) {
      assert.equal(source.status, "connected");
      assert.equal(Object.hasOwn(source, "lastErrorCode"), false);
      assert.equal(Object.hasOwn(source, "lastErrorMessage"), false);
    }
  });
}

test("Junction queued jobs preserve an Oura reset marker owned by opaque future coverage", async () => {
  const provider = createHistoricalActivityProvider(
    "oura",
    createHistoricalPullFetch({
      oura: {
        not_pulled: [],
        pulled: {
          activity: { days_with_data: 1, status: "success" },
        },
      },
    }),
  );
  const existingSource = createConnectionSource({
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "oura",
    })),
    sourceProviderSlug: "oura",
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Future coverage owns this state.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v4_exhausted",
        },
      }),
      listConnectionSources: () => [existingSource],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(upserts.at(-1)?.sourceProviderSlug, "oura");
  assert.equal(upserts.at(-1)?.status, "error");
  assert.equal(upserts.at(-1)?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
});

test("Junction late historical data queues one connect-window verification after exhaustion", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      now: "2026-04-05T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "late-activity",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "late-activity",
        sourceProviderSlug: "garmin",
        steps: 4321,
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
  );
  assert.equal(result.scheduledJobs?.length, 1);
  assert.equal(result.scheduledJobs?.[0]?.kind, "backfill");
  assert.equal(result.scheduledJobs?.[0]?.availableAt, "2026-04-05T00:00:00.000Z");
  assert.equal(
    result.scheduledJobs?.[0]?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2026-04-01T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    ),
  );
  assert.deepEqual(result.scheduledJobs?.[0]?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const currentResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      now: "2026-04-05T00:00:00.000Z",
      importSnapshot: async () => ({ canonicalEventCount: 1, durableDeliveryAccepted: true }),
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "current-activity",
      occurredAt: "2026-04-04T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-04",
        id: "current-activity",
        sourceProviderSlug: "garmin",
        steps: 1234,
      }),
      windowStart: "2026-04-04T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );
  assert.equal(currentResult.scheduledJobs, undefined);
  assert.equal(currentResult.metadataPatch, undefined);
});

test("Junction direct Apple Health canonical delivery records history despite the Link provider filter", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => ({ canonicalEventCount: 1, durableDeliveryAccepted: true }),
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "apple-health-activity",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "apple_health_kit",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "apple-health-activity",
        sourceProviderSlug: "apple_health_kit",
        steps: 4321,
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|apple_health_kit:1",
  );
  assert.deepEqual(result.scheduledJobs?.map((job) => job.kind), ["backfill"]);
});

test("Junction data webhooks name the delivering source and lifecycle events do not", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    requests.push(url.toString());
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: { blood_pressure: true },
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/blood_pressure/grouped") {
      const timestamp = url.searchParams.get("start_date")
        ?? "2026-03-18T00:00:00.000Z";
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              id: `bp-${timestamp}`,
              timestamp,
              systolic: 120,
              diastolic: 80,
            }],
            source: { provider: "garmin", type: "cuff" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    providerFilter: ["garmin"],
    timeseriesResources: ["blood_pressure"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const parseWebhook = async (input: {
    body: Record<string, unknown>;
    messageId: string;
  }) => {
    const webhook = createJunctionSvixWebhook({
      body: input.body,
      messageId: input.messageId,
      timestamp: "1775174400",
    });

    return requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });
  };

  // The arrival stamp is only as good as the real parser naming the source, so
  // assert it on signed payloads rather than through a fake provider.
  for (const sourceProviderSlug of ["garmin", "oura"]) {
    const parsed = await parseWebhook({
      body: {
        event_type: "daily.data.activity.created",
        user_id: "junction-user-1",
        data: {
          date: "2026-04-03",
          id: `activity-${sourceProviderSlug}`,
          source: {
            provider: sourceProviderSlug,
            type: "watch",
          },
          steps: 1234,
        },
      },
      messageId: `msg_arrival_${sourceProviderSlug}`,
    });

    assert.equal(parsed.dataSourceProviderSlug, sourceProviderSlug);
  }

  // A historical-pull completion is a data-less notification. Accepting its
  // follow-up fetch job proves nothing arrived, and treating it as delivery
  // would refresh the arrival signal and mask a genuinely dead carrier.
  const completionOnly = await parseWebhook({
    body: {
      event_type: "historical.data.sleep.created",
      user_id: "junction-user-1",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        source_provider_slug: "garmin",
      },
    },
    messageId: "msg_arrival_historical_completion",
  });

  assert.equal(completionOnly.dataSourceProviderSlug, null);

  // A connection lifecycle event proves nothing about the data carrier.
  const lifecycle = await parseWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {
        created_at: "2026-03-20T14:30:00.000Z",
        provider: "garmin",
      },
    },
    messageId: "msg_arrival_lifecycle",
  });

  assert.equal(lifecycle.dataSourceProviderSlug, null);
  assert.equal(lifecycle.sourceProviderSlug, "garmin");
  assert.equal(lifecycle.occurredAt, "2026-03-20T14:30:00.000Z");
  assert.deepEqual(lifecycle.jobs.map((job) => job.kind), ["backfill", "reconcile"]);
  const garminSource = {
    displayName: "Garmin",
    firstSeenAt: "2026-03-20T14:30:00.000Z",
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    resourceCount: 1,
    resourceAvailabilitySummary: { blood_pressure: true },
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  };
  const schedulerAccount = createStoredAccount({
    metadata: {
      junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
    },
    nextReconcileAt: "2026-04-03T00:00:00.000Z",
    sources: [garminSource],
  });
  const executor = requireValue(provider.jobExecutor);
  const findScheduledHistoryJob = (now: string) => requireValue(
    executor.createScheduledJobs?.(
      schedulerAccount,
      now,
    ).jobs.find((job) =>
      job.kind === "resource"
      && job.payload?.resource === "blood_pressure"
      && job.payload?.sourceProviderSlug === "garmin"
    ),
  );
  const schedulerJob = findScheduledHistoryJob("2026-04-03T00:00:00.000Z");
  assert.deepEqual(schedulerJob.payload, {
    historicalBackfill: true,
    historicalWindowStart: "2026-03-18T00:00:00.000Z",
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    sourceProviderSlug: "garmin",
    windowEnd: "2026-03-20T00:00:00.000Z",
    windowStart: "2026-03-18T00:00:00.000Z",
  });
  assert.equal(
    findScheduledHistoryJob("2026-04-04T00:00:00.000Z").dedupeKey,
    schedulerJob.dedupeKey,
  );

  const updateCases = [
    {
      data: {
        provider: "garmin",
        updated_at: "2026-04-03T00:00:00.000Z",
      },
      expectedOccurredAt: "2026-04-03T00:00:00.000Z",
      messageId: "msg_lifecycle_update_timestamp",
    },
    {
      data: { provider: "garmin" },
      expectedOccurredAt: undefined,
      messageId: "msg_lifecycle_update_now_fallback",
    },
  ] as const;

  for (const updateCase of updateCases) {
    const update = await parseWebhook({
      body: {
        event_type: "provider.connection.updated",
        user_id: "junction-user-1",
        data: updateCase.data,
      },
      messageId: updateCase.messageId,
    });
    assert.equal(update.occurredAt, updateCase.expectedOccurredAt);
    assert.deepEqual(update.jobs.map((job) => job.kind), ["backfill", "reconcile"]);
  }

  requests.length = 0;
  let scheduledResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
        },
        sources: [garminSource],
      }),
      importSnapshot: async () => ({
        canonicalEventCount: 2,
        durableDeliveryAccepted: true,
      }),
    }),
    {
      ...createJob("resource", schedulerJob.payload ?? {}),
      dedupeKey: schedulerJob.dedupeKey ?? null,
    },
  );
  const scheduledFollowUp = scheduledResult.scheduledJobs?.find((job) =>
    job.kind === "resource" && job.payload?.resource === "blood_pressure"
  );
  if (scheduledFollowUp) {
    scheduledResult = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
          },
          sources: [garminSource],
        }),
        importSnapshot: async () => ({
          canonicalEventCount: 2,
          durableDeliveryAccepted: true,
        }),
      }),
      {
        ...createJob(scheduledFollowUp.kind, scheduledFollowUp.payload ?? {}),
        dedupeKey: scheduledFollowUp.dedupeKey ?? null,
      },
    );
  }

  assert.equal(
    requests.some((request) =>
      new URL(request).searchParams.get("start_date") === "2026-03-18T00:00:00.000Z"
    ),
    true,
  );
  const completedMetadata = mergeStoredDeviceSyncMetadataPatch(
    schedulerAccount.metadata,
    scheduledResult.metadataPatch,
  );
  assert.equal(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
    completedMetadata,
    "garmin",
    "blood_pressure",
    1,
  ), true);
  assert.equal(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
    completedMetadata,
    "omron",
    "blood_pressure",
    1,
  ), true);
  assert.equal(
    Object.hasOwn(completedMetadata, "junctionBloodPressureHistoryBackfillCoverage"),
    false,
  );
});

test("Junction connection-day direct pushes do not prove older historical coverage", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      user_id: "junction-user-1",
      data: {
        date: "2026-04-03",
        id: "connection-day-activity",
        source: {
          provider: "garmin",
          type: "watch",
        },
        steps: 1234,
      },
    },
    messageId: "msg_connection_day_activity_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.jobs.length, 1);

  let importCount = 0;
  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
          junctionHistoricalBackfillEmptyAttempts: 5,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      importSnapshot: async () => {
        importCount += 1;
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", parsed.jobs[0]?.payload ?? {}),
  );

  assert.equal(importCount, 1);
  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction connection-day sleep records do not prove older historical coverage", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["sleep", "sleep_cycle"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const cases = [
    {
      eventType: "daily.data.sleep.created",
      messageId: "msg_connection_day_sleep_1",
      data: {
        bedtime_start: "2026-04-03T01:00:00.000Z",
        bedtime_stop: "2026-04-03T08:00:00.000Z",
        date: "2026-04-03",
        id: "connection-day-sleep",
        score: 88,
        sourceProviderSlug: "garmin",
      },
    },
    {
      eventType: "daily.data.sleep_cycle.created",
      messageId: "msg_connection_day_sleep_cycle_1",
      data: {
        id: "connection-day-sleep-cycle",
        sessionEnd: "2026-04-03T08:00:00.000Z",
        sessionStart: "2026-04-02T23:00:00.000Z",
        sourceProviderSlug: "garmin",
        stages: [{
          endAt: "2026-04-03T08:00:00.000Z",
          stage: "light",
          startAt: "2026-04-02T23:00:00.000Z",
        }],
      },
    },
  ] as const;
  let importCount = 0;

  for (const fixture of cases) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: fixture.eventType,
        user_id: "junction-user-1",
        data: fixture.data,
      },
      messageId: fixture.messageId,
      timestamp: "1775217600",
    });
    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T12:00:00.000Z",
    });
    assert.equal(parsed.jobs.length, 1);

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
            junctionHistoricalBackfillEmptyAttempts: 5,
            junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
            junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
            junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
          },
        }),
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async () => {
          importCount += 1;
          return { canonicalEventCount: 1, durableDeliveryAccepted: true };
        },
      }),
      createJob("resource", parsed.jobs[0]?.payload ?? {}),
    );

    assert.equal(result.metadataPatch, undefined);
    assert.equal(result.scheduledJobs, undefined);
  }

  assert.equal(importCount, cases.length);
});

test("Junction direct pushes without canonical events or from another source do not become history evidence", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
  });
  const basePayload = {
    eventType: "daily.data.activity.created",
    occurredAt: "2026-04-02T00:00:00.000Z",
    resource: "activity",
    resourceCategory: "summary",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  };

  const emptyImportResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async () => ({ canonicalEventCount: 0 }),
    }),
    createJob("resource", {
      ...basePayload,
      objectId: "empty-activity",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        id: "empty-activity",
        sourceProviderSlug: "garmin",
      }),
    }),
  );
  assert.equal(emptyImportResult.metadataPatch, undefined);

  const acceptedIdOnlyImportResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async () => ({
        canonicalEventCount: 0,
        durableDeliveryAccepted: true,
      }),
    }),
    createJob("resource", {
      ...basePayload,
      objectId: "accepted-id-only-activity",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        id: "accepted-id-only-activity",
        sourceProviderSlug: "garmin",
      }),
    }),
  );
  assert.equal(acceptedIdOnlyImportResult.metadataPatch, undefined);

  const otherSourceResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async () => ({ canonicalEventCount: 1, durableDeliveryAccepted: true }),
    }),
    createJob("resource", {
      ...basePayload,
      objectId: "other-source-activity",
      sourceProviderSlug: "oura",
      webhookDataJson: JSON.stringify({
        id: "other-source-activity",
        sourceProviderSlug: "oura",
        steps: 1000,
      }),
    }),
  );
  assert.equal(otherSourceResult.metadataPatch, undefined);
});

test("Junction meaningful raw-only direct delivery proves history after durable acceptance", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["sleep_cycle"],
  });
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });
  const job = createJob("resource", {
    eventType: "daily.data.sleep_cycle.created",
    objectId: "accepted-raw-sleep-cycle",
    occurredAt: "2026-04-02T08:00:00.000Z",
    resource: "sleep_cycle",
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    webhookDataJson: JSON.stringify({
      end: "2026-04-02T08:00:00.000Z",
      id: "accepted-raw-sleep-cycle",
      sourceProviderSlug: "garmin",
      start: "2026-04-02T00:00:00.000Z",
      stages: [{
        endAt: "2026-04-02T08:00:00.000Z",
        stage: "light",
        startAt: "2026-04-02T00:00:00.000Z",
      }],
    }),
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });

  const unaccepted = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => ({
        canonicalEventCount: 0,
        durableDeliveryAccepted: false,
      }),
      now: "2026-04-05T00:00:00.000Z",
    }),
    job,
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => ({
        canonicalEventCount: 0,
        durableDeliveryAccepted: true,
      }),
      now: "2026-04-05T00:00:00.000Z",
    }),
    job,
  );

  assert.equal(unaccepted.metadataPatch, undefined);
  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:4",
  );
});

test("Junction direct pushes preserve opaque future historical evidence after import", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
  });
  const futureStatus = "coverage_v4_exhausted";
  const futureEvidence = "e3|opaque-future-evidence";
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillEvidence: futureEvidence,
      junctionHistoricalBackfillStatus: futureStatus,
    },
  });
  let importCount = 0;

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => {
        importCount += 1;
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "future-evidence-activity",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "future-evidence-activity",
        sourceProviderSlug: "garmin",
        steps: 4321,
      }),
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );
  const metadata = mergeStoredDeviceSyncMetadataPatch(account.metadata, result.metadataPatch);

  assert.equal(importCount, 1);
  assert.equal(metadata.junctionHistoricalBackfillStatus, futureStatus);
  assert.equal(metadata.junctionHistoricalBackfillEvidence, futureEvidence);
});

test("Junction exhausted historical backfill completes when the same window later has data", async () => {
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 4321 }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [createConnectionSource({
      status: "error",
      lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
      lastErrorMessage: "Historical data remained incomplete.",
    })],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[1]?.status, "connected");
  assert.equal(Object.hasOwn(upserts[1] ?? {}, "lastErrorCode"), false);

  const futureVersionUpserts: Array<
    Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]
  > = [];
  const futureVersionResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v4_exhausted",
        },
      }),
      listConnectionSources: () => [createConnectionSource({
        status: "error",
        lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
        lastErrorMessage: "Future coverage owns this state.",
      })],
      upsertConnectionSource: (input) => {
        futureVersionUpserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  assert.equal(futureVersionResult.metadataPatch, undefined);
  assert.equal(futureVersionUpserts.length, 1);
  assert.equal(futureVersionUpserts[0]?.status, "error");
  assert.equal(
    futureVersionUpserts[0]?.lastErrorCode,
    "HISTORICAL_DATA_RECONNECT_REQUIRED",
  );
});

test("Junction connect-window coverage unions fresh REST rows with matching imported push evidence", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: { activity: true, sleep: true },
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ connectionId: "provider-garmin-1", id: "activity-rest-1", steps: 4321 }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["activity", "sleep"],
  });
  const job = createJob("backfill", {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const matchingResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillEvidence:
            "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:2",
        },
      }),
    }),
    job,
  );
  assert.equal(
    matchingResult.metadataPatch?.junctionHistoricalBackfillStatus,
    "coverage_v3_complete",
  );

  for (const evidence of [
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|oura:2",
    "e2|2026-03-31T00:00:00.000Z|2026-04-02T00:00:00.000Z|garmin:2",
  ]) {
    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ metadata: { junctionHistoricalBackfillEvidence: evidence } }),
      }),
      job,
    );
    assert.equal(
      result.metadataPatch?.junctionHistoricalBackfillStatus,
      "coverage_v3_retrying",
      evidence,
    );
  }
});

test("Junction authenticated late sleep pushes recover an exhausted historical window", async () => {
  const windowStart = "2026-04-01T00:00:00.000Z";
  const windowEnd = "2026-04-03T00:00:00.000Z";
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: {
            activity: true,
            sleep: true,
            sleep_cycle: true,
          },
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ connectionId: "provider-garmin-1", id: "activity-rest-1", steps: 4321 }],
      });
    }
    if (
      url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")
      || url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")
    ) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["activity", "sleep", "sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  let metadata: Record<string, unknown> = {
    junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
    junctionHistoricalBackfillEmptyAttempts: 5,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: windowStart,
    junctionHistoricalBackfillWindowEnd: windowEnd,
  };
  let verificationJob: DeviceSyncJobInput | undefined;
  const importedPushResources: string[] = [];

  for (const testCase of [
    {
      data: {
        date: "2026-04-02",
        end_time: "2026-04-02T11:15:00.000Z",
        id: "late-garmin-sleep-1",
        resource: "sleep",
        source: { provider: "garmin" },
        start_time: "2026-04-02T03:30:00.000Z",
        total_sleep_minutes: 420,
      },
      eventType: "historical.data.sleep.created",
      expectedEvidence:
        "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:2",
      expectedResource: "sleep",
      messageId: "msg_late_garmin_sleep_1",
    },
    {
      data: {
        date: "2026-04-02",
        end: "2026-04-02T04:25:00.000Z",
        id: "late-garmin-hypnogram-1",
        resource: "hypnogram",
        source: { provider: "garmin" },
        start: "2026-04-02T04:00:00.000Z",
        stages: [{
          endAt: "2026-04-02T04:25:00.000Z",
          stage: "deep",
          startAt: "2026-04-02T04:00:00.000Z",
        }],
      },
      eventType: "historical.data.hypnogram.created",
      expectedEvidence:
        "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:6",
      expectedResource: "sleep_cycle",
      messageId: "msg_late_garmin_hypnogram_1",
    },
  ] as const) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: "junction-user-1",
        data: testCase.data,
      },
      messageId: testCase.messageId,
      timestamp: "1775174400",
    });
    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });
    const parsedJob = parsed.jobs[0];
    assert.ok(parsedJob);
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsedJob.kind, "resource");
    assert.equal(parsedJob.payload?.resource, testCase.expectedResource);

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ metadata }),
        importSnapshot: async (snapshot) => {
          const summaries = (snapshot as { summaries?: Record<string, unknown[]> }).summaries ?? {};
          importedPushResources.push(...Object.keys(summaries));
          return { canonicalEventCount: 1, durableDeliveryAccepted: true };
        },
        now: "2026-04-03T00:00:00.000Z",
      }),
      createJob(parsedJob.kind, parsedJob.payload ?? {}),
    );

    assert.equal(
      result.metadataPatch?.junctionHistoricalBackfillEvidence,
      testCase.expectedEvidence,
    );
    verificationJob = result.scheduledJobs?.find((job) => job.kind === "backfill");
    assert.deepEqual(verificationJob?.payload, { windowEnd, windowStart });
    metadata = mergeStoredDeviceSyncMetadataPatch(metadata, result.metadataPatch);
  }

  assert.deepEqual(importedPushResources, ["sleep", "sleep_cycle"]);
  assert.equal(
    metadata.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:6",
  );
  assert.ok(verificationJob);

  const existingSource = createConnectionSource({
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  let verificationSnapshot: unknown = null;
  const verificationResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ metadata }),
      importSnapshot: async (snapshot) => {
        verificationSnapshot = snapshot;
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
      listConnectionSources: () => [existingSource],
      now: "2026-04-03T00:01:00.000Z",
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob(verificationJob.kind, verificationJob.payload ?? {}),
  );

  const verificationSummaries = (verificationSnapshot as {
    summaries?: Record<string, unknown[]>;
  }).summaries;
  assert.equal(verificationSummaries?.activity?.length, 1);
  assert.deepEqual(verificationSummaries?.sleep, []);
  assert.deepEqual(verificationSummaries?.sleep_cycle, []);
  assert.equal(
    verificationResult.metadataPatch?.junctionHistoricalBackfillStatus,
    "coverage_v3_complete",
  );
  const completedMetadata = mergeStoredDeviceSyncMetadataPatch(
    metadata,
    verificationResult.metadataPatch,
  );
  assert.equal(completedMetadata.junctionHistoricalBackfillStatus, "coverage_v3_complete");
  assert.equal(
    completedMetadata.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:6",
  );
  assert.ok(requests.some((url) => url.includes("/v2/summary/activity/")));
  assert.ok(requests.some((url) => url.includes("/v2/summary/sleep/")));
  assert.ok(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")));
  assert.equal(upserts.at(-1)?.status, "connected");
  assert.equal(Object.hasOwn(upserts.at(-1) ?? {}, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(upserts.at(-1) ?? {}, "lastErrorMessage"), false);
});

test("Junction coverage ignores errored sources outside the normalized provider filter", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: { activity: true },
          },
          {
            id: "provider-other-1",
            slug: "fitbit",
            name: "Other source",
            status: "error",
            resource_availability: { activity: true },
          },
        ],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ connectionId: "provider-garmin-1", id: "activity-rest-1", steps: 4321 }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    providerFilter: [" GARMIN ", "garmin"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_complete");
});

test("Junction reconcile data does not complete pending historical backfill", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 1234 }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-01-03T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction provider source keys are stable provider-level opaque ids", () => {
  const garminKey = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "Garmin",
  });
  const garminKeyAgain = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "garmin",
  });
  const pelotonKey = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "peloton",
  });

  assert.equal(garminKey, garminKeyAgain);
  assert.notEqual(garminKey, pelotonKey);
  assert.match(garminKey ?? "", /^jxn_src_[a-f0-9]{32}$/u);
  assert.doesNotMatch(garminKey ?? "", /acct|junction|garmin/u);
});

test("Junction provider revokes remote provider slugs unless Junction already reports them disconnected", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const request = {
      method: String(init?.method ?? "GET"),
      url: readUrl(input),
    };
    requests.push(request);

    if (request.url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        data: [
          { slug: "garmin", status: "connected" },
          { slug: "Garmin", status: "active" },
          { slug: "apple_health_kit", status: "error" },
          { slug: "fitbit", status: "revoked" },
          { provider: "Oura", status: "unknown" },
        ],
      });
    }

    if (request.method === "DELETE") {
      return createJsonResponse({ success: true });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const revokeAccess = requireValue(provider.connectionHandler?.revokeAccess);

  await revokeAccess(createAccount());

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/garmin",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/apple_health_kit",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/oura",
    },
  ]);
});

test("Junction provider cleanup deregisters only the requested source", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const request = {
      method: String(init?.method ?? "GET"),
      url: readUrl(input),
    };
    requests.push(request);
    if (request.url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        data: [
          { slug: "garmin", status: "connected" },
          { slug: "fitbit", status: "connected" },
        ],
      });
    }
    if (request.method === "DELETE") {
      return createJsonResponse({ success: true });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const revokeSourceAccess = requireValue(
    provider.connectionHandler?.revokeSourceAccess,
  );
  const isSourceAccessActive = requireValue(
    provider.connectionHandler?.isSourceAccessActive,
  );

  assert.equal(await isSourceAccessActive(createAccount(), "fitbit"), true);
  assert.equal(await isSourceAccessActive(createAccount(), "oura"), false);
  await revokeSourceAccess(createAccount(), "fitbit");

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/fitbit",
    },
  ]);
});

test("Junction provider rejects non-Link routes from hosted web Link", () => {
  assert.deepEqual(normalizeJunctionProviderFilter(["oura", "withings"]), ["oura", "withings"]);

  assert.throws(
    () => normalizeJunctionProviderFilter([
      "oura",
      "apple_health_kit",
      "apple_healthkit",
      "health_connect",
      "samsung_health",
      "accuchek_ble",
      "withings",
    ]),
    /unsupported Junction Link provider slugs: apple_health_kit, apple_healthkit, health_connect, samsung_health, accuchek_ble/u,
  );
});

test("Junction provider rejects explicit filters with no hosted Link providers", () => {
  assert.throws(
    () => createJunctionProvider(async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    }, {
      providerFilter: ["accuchek_ble", "health_connect"],
    }),
    /unsupported Junction Link provider slugs: accuchek_ble, health_connect/u,
  );
});

function resolveJunctionTarget(providerSlug: string) {
  return JUNCTION_CONNECT_SOURCE_TARGETS.find((target) => target.providerSlug === providerSlug);
}

test("Junction createLinkToken accepts documented Link web URL hosts", async () => {
  const linkWebUrl = "https://link.tryvital.io/?token=link-token-1&env=sandbox&region=us";
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      assert.equal(new Headers(init?.headers).get("x-vital-api-key"), "sk_us_test_123");
      return createJsonResponse({ link_web_url: linkWebUrl });
    },
  });

  const token = await client.createLinkToken({
    userId: "junction-user-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
  });

  assert.equal(token.linkWebUrl, linkWebUrl);
  assert.equal(
    isAllowedJunctionLinkHost(new URL(token.linkWebUrl).hostname, JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS),
    true,
  );
});

test("Junction historical-pull introspection matches the exact user without SDK release metadata and preserves future states", () => {
  const snapshot = parseJunctionHistoricalPullSnapshot({
    data: [
      {
        user_id: "junction-user-other",
        provider: {
          garmin: {
            not_pulled: [],
            pulled: {
              activity: {
                days_with_data: 10,
                status: "failure",
              },
            },
          },
        },
      },
      {
        user_id: "junction-user-1",
        provider: {
          oura: {
            not_pulled: ["sleep", "sleep"],
            pulled: {
              activity: {
                days_with_data: 0,
                range_end: "2026-04-03T00:00:00+00:00",
                range_start: "2026-04-03T00:00:00+00:00",
                status: "success",
              },
              sleep_cycle: {
                daysWithData: 3,
                errorDetails: "Provider is preparing this resource.",
                rangeEnd: "2026-04-03T00:00:00+00:00",
                rangeStart: "2026-04-01T00:00:00+00:00",
                status: "paused_by_provider",
              },
            },
          },
        },
      },
    ],
  }, "junction-user-1");

  assert.deepEqual(snapshot, {
    matchedUser: true,
    sources: [{
      notPulledResources: ["sleep"],
      pulledResources: [
        {
          daysWithData: 0,
          errorDetails: null,
          rangeEnd: "2026-04-03T00:00:00+00:00",
          rangeStart: "2026-04-03T00:00:00+00:00",
          resource: "activity",
          status: "success",
        },
        {
          daysWithData: 3,
          errorDetails: "Provider is preparing this resource.",
          rangeEnd: "2026-04-03T00:00:00+00:00",
          rangeStart: "2026-04-01T00:00:00+00:00",
          resource: "sleep_cycle",
          status: "paused_by_provider",
        },
      ],
      sourceProviderSlug: "oura",
    }],
  });

  assert.deepEqual(
    parseJunctionHistoricalPullSnapshot({
      data: [{ user_id: "junction-user-other", provider: {} }],
    }, "junction-user-1"),
    { matchedUser: false, sources: [] },
  );
});

test("Junction historical-pull introspection applies the optional provider filter at both request and parse boundaries", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input) => {
      assert.equal(
        readUrl(input),
        "https://api.sandbox.us.junction.com/v2/introspect/historical_pull?user_id=junction-user-1&user_limit=2&provider=garmin",
      );
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              not_pulled: ["sleep"],
              pulled: {
                activity: {
                  days_with_data: 0,
                  status: "success",
                },
              },
            },
            oura: {
              not_pulled: [],
              pulled: {
                activity: {
                  days_with_data: 1,
                  status: "success",
                },
              },
            },
          },
        }],
      });
    },
  });

  const snapshot = await client.introspectHistoricalPull({
    sourceProviderSlug: "Garmin",
    userId: "junction-user-1",
    userLimit: 2,
  });

  assert.deepEqual(snapshot, {
    matchedUser: true,
    sources: [{
      notPulledResources: ["sleep"],
      pulledResources: [{
        daysWithData: 0,
        errorDetails: null,
        rangeEnd: null,
        rangeStart: null,
        resource: "activity",
        status: "success",
      }],
      sourceProviderSlug: "garmin",
    }],
  });
});

test("Junction historical-pull introspection rejects malformed envelopes as retryable", () => {
  assert.throws(
    () => parseJunctionHistoricalPullSnapshot({ data: {} }, "junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_HISTORICAL_PULL_RESPONSE_INVALID");
      assert.equal(error.httpStatus, 502);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("Junction createLinkToken sends selected OAuth provider for direct Link dispatch", async () => {
  const requests: unknown[] = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      requests.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      return createJsonResponse({
        link_web_url: "https://link.junction.com/session/link-token-1",
      });
    },
  });

  await client.createLinkToken({
    userId: "junction-user-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    provider: "Map-My-Fitness",
    providerFilter: ["garmin", "fitbit"],
  });

  const body = requests[0];
  assert.equal(
    typeof body === "object" && body !== null && "provider" in body
      ? body.provider
      : null,
    "map_my_fitness",
  );
  assert.equal(
    typeof body === "object" && body !== null && "filter_on_providers" in body,
    false,
  );
});

test("Junction client includes safe provider diagnostics for failed API requests", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      assert.equal(new Headers(init?.headers).get("x-vital-api-key"), "sk_us_test_123");
      return createJsonResponse({
        code: "invalid_request",
        message: "The link token request is missing a provider selection.",
      }, 400);
    },
  });

  await assert.rejects(
    () => client.createLinkToken({
      userId: "junction-user-sensitive",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback?code=secret",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.httpStatus, 502);
      assert.equal(error.message, "Junction API request failed for junction_link_token_create.");
      assert.deepEqual(error.details, {
        accountStatus: null,
        requestAuthKind: "provider_config_api_key_header",
        requestAuthPlacement: "headers",
        requestBodyFieldCount: 2,
        requestBodyFieldNames: "redirect_url.user_id",
        requestBodyKind: "json_object",
        requestContentType: "application_json",
        requestCredentialPresent: true,
        requestEndpointKind: "junction_link_token_create",
        requestMethod: "POST",
        requestQueryParameterCount: 0,
        requestQueryParameterNames: null,
        responseErrorCode: "invalid_request",
        responseErrorDescription: "The link token request is missing a provider selection.",
        responseErrorDescriptionFieldPresent: true,
        responseErrorFieldPresent: true,
        responseShapeKind: "json_object",
        retryable: false,
        status: 400,
      });
      const serialized = JSON.stringify(error);
      assert.equal(serialized.includes("sk_us_test_123"), false);
      assert.equal(serialized.includes("junction-user-sensitive"), false);
      assert.equal(serialized.includes("code=secret"), false);
      return true;
    },
  );
});

test("Junction client treats request timeouts as terminal aborts", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "TimeoutError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client wraps generic abort errors caused by request timeouts", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "AbortError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client rethrows caller aborts instead of wrapping them as provider failures", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (_input, init) => {
      requests += 1;
      abortController.abort(abortError);
      const signal = init?.signal;
      assert.ok(signal);

      if (signal.aborted) {
        throw signal.reason;
      }

      throw new Error("request should have been aborted");
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => error === abortError,
  );
  assert.equal(requests, 1);
});

test("Junction client preserves caller abort reasons when fetch reports a generic AbortError", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);

      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
        abortController.abort(abortError);
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => error === abortError,
  );
  assert.equal(requests, 1);
});

test("Junction client does not misclassify request timeouts as late caller aborts", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);

      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            abortController.abort(abortError);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true },
        );
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.notEqual(error.cause, abortError);
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "AbortError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client deregisters provider connections by normalized provider slug", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      requests.push({
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      assert.equal(new Headers(init?.headers).get("x-vital-api-key"), "sk_us_test_123");
      return createJsonResponse({ success: true });
    },
  });

  await client.deregisterProvider({
    providerSlug: "Apple Health",
    userId: "junction-user-1",
  });

  assert.deepEqual(requests, [
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/apple_health",
    },
  ]);
});

test("Junction client rejects provider deregistration without a Junction user id", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      throw new Error("deregisterProvider should not send a request without a user id");
    },
  });

  await assert.rejects(
    () => client.deregisterProvider({
      providerSlug: "garmin",
      userId: "  ",
    }),
    /requires a Junction user id/u,
  );
});

test("automatic recovery stays inert until it is explicitly enabled", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`No request should be made while recovery is disabled: ${readUrl(input)}`);
  }, {
    // The vendor enables the trigger endpoint per team, so shipping the code and
    // switching it on are separate steps. Default-off is what lets this merge
    // before that request lands.
    pushSourceRecoveryEnabled: false,
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const stalledAccount = createStoredAccount({
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-18T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });

  assert.equal(
    executor.createScheduledJobs?.(stalledAccount, "2026-07-20T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("a stalled Garmin source automatically triggers a bounded historical pull", async () => {
  const requests: { body: unknown; url: string }[] = [];
  const provider = createJunctionProvider(async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      url: readUrl(input),
    });
    return createJsonResponse({ success: true }, 202);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const stalledAccount = createStoredAccount({
    sources: [
      {
        displayName: "Garmin",
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        // Junction still lists the source and every resource as available; only
        // the arrival gap shows the carrier is dead.
        lastDataAt: "2026-07-18T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-07-20T00:00:00.000Z",
        resourceCount: 20,
        sourceProviderSlug: "garmin",
        status: "connected",
      },
    ],
  });

  // Detection alone restores nothing, so the scheduled pass must derive the
  // recovery attempt without any operator action.
  const scheduled = executor.createScheduledJobs?.(stalledAccount, "2026-07-20T00:00:00.000Z");
  const recoveryJob = scheduled?.jobs.find((job) => job.kind === "push_source_recovery");
  assert.ok(recoveryJob, "a stalled push-primary source must schedule its own recovery");
  assert.deepEqual(recoveryJob.payload, {
    silentSinceAt: "2026-07-18T00:00:00.000Z",
    sourceProviderSlug: "garmin",
  });

  // Every scheduled job crosses the configured-manifest enqueue boundary before
  // it is queued. An undeclared kind or payload field throws there, which would
  // discard the whole scheduled pass before any recovery ran.
  assert.deepEqual(
    normalizeConfiguredDeviceSyncJobInput("junction", {
      kind: recoveryJob.kind,
      payload: recoveryJob.payload ?? {},
    }, "scheduler"),
    {
      kind: "push_source_recovery",
      payload: {
        silentSinceAt: "2026-07-18T00:00:00.000Z",
        sourceProviderSlug: "garmin",
      },
    },
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: stalledAccount.sources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", recoveryJob.payload ?? {}),
  );

  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionPushSourceRecoveryAttempts: 1,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T00:00:00.000Z",
    junctionPushSourceRecoveryLastFailureCode: null,
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "triggered",
  });

  // A healthy source schedules nothing, and the recorded attempt keeps the
  // ladder from re-firing on the very next hourly pass.
  const healthyAccount = createStoredAccount({
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-19T23:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });
  assert.equal(
    executor.createScheduledJobs?.(healthyAccount, "2026-07-20T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );

  const afterAttempt = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: stalledAccount.sources,
  });
  assert.equal(
    executor.createScheduledJobs?.(afterAttempt, "2026-07-20T01:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("the executor carries prior attempts through to exhaustion", async () => {
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ success: true }, 202);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const staleSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-22T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];
  // Three attempts already spent on this episode.
  const priorMetadata = {
    junctionPushSourceRecoveryAttempts: 3,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T16:00:00.000Z",
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "triggered",
  };

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ metadata: priorMetadata, sources: staleSources }),
      now: "2026-07-22T16:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Losing the prior count would leave every mutation at "attempt 1", so a
  // persistently silent source would trigger provider work forever.
  assert.equal(triggerCalls, 1);
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryAttempts,
    4,
  );
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryStatus,
    "exhausted",
  );

  const exhausted = createStoredAccount({
    metadata: { ...priorMetadata, ...(result.metadataPatch as Record<string, unknown>) },
    sources: staleSources,
  });
  assert.equal(
    executor.createScheduledJobs?.(exhausted, "2026-07-30T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("a failed recovery trigger still burns its attempt instead of retrying forever", async () => {
  const staleGarminSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ detail: "boom" }, 500);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: staleGarminSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Letting the failure escape would leave the episode at zero attempts, so the
  // next scheduled pass would derive the identical attempt again, forever.
  assert.equal(triggerCalls, 1);
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryAttempts,
    1,
  );
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryStatus,
    "triggered",
  );
  // The burned attempt stays diagnosable.
  assert.ok(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryLastFailureCode,
  );

  const afterFailure = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-18T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });

  // The next hourly pass must respect the ladder delay, not re-fire.
  assert.equal(
    executor.createScheduledJobs?.(afterFailure, "2026-07-20T01:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
  assert.ok(
    executor.createScheduledJobs?.(afterFailure, "2026-07-20T06:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
  );
});

test("a recovery job whose episode already ended makes no provider call", async () => {
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ success: true }, 202);
  });
  const recoveredSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    // A webhook landed between scheduling and execution.
    lastDataAt: "2026-07-20T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: recoveredSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Triggering for an ended episode is an avoidable provider mutation, and
  // recording it would let the scheduler immediately fire again for the newer
  // episode.
  assert.equal(triggerCalls, 0);
  assert.deepEqual(result, {});
});

test("a gated recovery trigger pauses the episode and resumes after enablement", async () => {
  const provider = createJunctionProvider(async () =>
    createJsonResponse({ detail: "not enabled" }, 403)
  );
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const staleSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: staleSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // A gated call never reached the recovery mechanism, so it spends no attempt.
  assert.deepEqual(result.metadataPatch, {
    junctionPushSourceRecoveryAttempts: 0,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T00:00:00.000Z",
    junctionPushSourceRecoveryLastFailureCode: null,
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "unavailable",
  });

  const gatedAccount = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: staleSources,
  });

  // Not re-probed immediately...
  assert.equal(
    executor.createScheduledJobs?.(gatedAccount, "2026-07-20T06:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );

  // ...but enablement is a vendor-side change we cannot observe, so a stall
  // seen before enablement must not be abandoned for the rest of its episode.
  assert.ok(
    executor.createScheduledJobs?.(gatedAccount, "2026-07-21T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
  );
});

test("Junction client triggers a historical pull for one source", async () => {
  const requests: { body: unknown; method: string; url: string }[] = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      return createJsonResponse({ success: true }, 202);
    },
  });

  const result = await client.bulkTriggerHistoricalPull({
    sourceProviderSlug: "Garmin",
    userIds: ["junction-user-1", "junction-user-1", "  "],
  });

  assert.deepEqual(result, { accepted: true, endpointUnavailable: false });
  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      method: "POST",
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
});

test("Junction client reports a gated historical pull trigger as unavailable rather than failing", async () => {
  for (const status of [403, 404]) {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => createJsonResponse({ detail: "not enabled" }, status),
    });

    // Link Migration endpoints are disabled per team by default. That is a
    // "ask support to enable it" answer, not a transport failure to retry.
    assert.deepEqual(
      await client.bulkTriggerHistoricalPull({
        sourceProviderSlug: "garmin",
        userIds: ["junction-user-1"],
      }),
      { accepted: false, endpointUnavailable: true },
    );
  }
});

test("Junction client surfaces real historical pull trigger failures", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({ detail: "boom" }, 500),
  });

  await assert.rejects(() => client.bulkTriggerHistoricalPull({
    sourceProviderSlug: "garmin",
    userIds: ["junction-user-1"],
  }));
});

test("Junction client rejects historical pull triggers without a source or user", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      throw new Error("bulkTriggerHistoricalPull should not send an invalid request");
    },
  });

  await assert.rejects(
    () => client.bulkTriggerHistoricalPull({ sourceProviderSlug: " ", userIds: ["u"] }),
    /require a provider slug/u,
  );
  await assert.rejects(
    () => client.bulkTriggerHistoricalPull({ sourceProviderSlug: "garmin", userIds: ["  "] }),
    /require at least one user id/u,
  );
});

test("Junction client derives the API host from environment and region", async () => {
  const requests: string[] = [];
  const client = new JunctionClient({
    apiKey: "pk_eu_test_123",
    environment: "production",
    region: "eu",
    fetchImpl: async (input) => {
      requests.push(readUrl(input));
      return createJsonResponse({ user_id: "junction-user-1" });
    },
  });

  const user = await client.createUser("murph_test_client_user");

  assert.equal(user.userId, "junction-user-1");
  assert.deepEqual(requests, ["https://api.eu.junction.com/v2/user/"]);
});

test("Junction createLinkToken rejects unexpected Link web URL hosts", async () => {
  assert.equal(isAllowedJunctionLinkHost("link.tryvital.io"), true);
  assert.equal(isAllowedJunctionLinkHost("tryvital.io"), true);
  assert.equal(isAllowedJunctionLinkHost(".tryvital.io"), false);
  assert.equal(isAllowedJunctionLinkHost("link.tryvital.io.example.test"), false);

  for (const linkWebUrl of [
    "https://link.example.test/session/link-token-1",
    "https://.tryvital.io/session/link-token-1",
    "https://link.tryvital.io.example.test/session/link-token-1",
    "http://link.tryvital.io/session/link-token-1",
  ]) {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => createJsonResponse({ link_web_url: linkWebUrl }),
    });

    await assert.rejects(
      () => client.createLinkToken({
        userId: "junction-user-1",
        callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      }),
      (error) => error instanceof DeviceSyncError
        && error.code === "JUNCTION_LINK_TOKEN_INVALID",
    );
  }
});

test("Junction createLinkToken honors configured allowed Link hosts", async () => {
  const createClient = (allowedLinkHosts: readonly string[]) => new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    allowedLinkHosts,
    fetchImpl: async () => createJsonResponse({
      link_web_url: "https://link.tryvital.io/?token=link-token-1&env=sandbox&region=us",
    }),
  });

  await assert.doesNotReject(() =>
    createClient(["tryvital.io"]).createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }));

  await assert.rejects(
    () => createClient(["junction.com"]).createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_LINK_TOKEN_INVALID",
  );

  assert.throws(
    () => createClient([]),
    /Junction allowedLinkHosts must include at least one host/u,
  );
});

test("Junction beginConnection resolves or creates a user, returns Link URL, and seeds provider-config credentials", async () => {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, headers, url });

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
      return createJsonResponse({ message: "missing" }, 404);
    }

    if (url === "https://api.sandbox.us.junction.com/v2/user/") {
      return createJsonResponse({ user_id: "junction-user-1" });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
      return createJsonResponse({ link_web_url: "https://link.junction.com/session/link-token-1" });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const started = await requireJunctionConnectionHandler(provider).beginConnection({
    state: "state-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    publicBaseUrl: "https://sync.example.test/device-sync",
    now: "2026-04-03T00:00:00.000Z",
    scopes: [],
    ownerId: "owner-internal-id-123",
  });

  assert.equal(started.authorizationUrl, "https://link.junction.com/session/link-token-1");
  assert.equal(started.connectionSeed?.externalAccountId, "junction-user-1");
  assert.equal(started.connectionSeed?.credential.kind, "provider_config");
  assert.equal(
    started.connectionSeed?.credential.kind === "provider_config"
      ? started.connectionSeed.credential.providerConfigKey
      : null,
    "junction",
  );
  assert.equal(started.connectionSeed?.setupPhase, "pending_link");
  assert.equal(started.connectionSeed?.setupExpiresAt, "2026-04-03T00:30:00.000Z");
  assert.deepEqual(started.connectionSeed?.metadata, undefined);
  assert.deepEqual(started.stateMetadata, undefined);

  const createUserBody = requests.find((request) => request.url.endsWith("/v2/user/"))?.body;
  assert.equal(typeof createUserBody === "object" && createUserBody !== null && "client_user_id" in createUserBody, true);
  assert.doesNotMatch(JSON.stringify(createUserBody), /owner-internal-id-123/u);

  const linkBody = requests.find((request) => request.url.endsWith("/v2/link/token"))?.body;
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "redirect_url" in linkBody
      ? linkBody.redirect_url
      : null,
    "https://sync.example.test/device-sync/connect/junction/callback?murph_state=state-1",
  );
  assert.deepEqual(
    typeof linkBody === "object" && linkBody !== null && "filter_on_providers" in linkBody
      ? linkBody.filter_on_providers
      : null,
    JUNCTION_DEFAULT_PROVIDER_FILTER,
  );
  assert.doesNotMatch(JSON.stringify(linkBody), /apple|health_connect/u);
  assert.equal(requests.every((request) => request.headers.get("x-vital-api-key") === "sk_us_test_123"), true);
});

test("Junction beginConnection dispatches Link directly without mutating the requested source provider", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, method: init?.method ?? "GET", url });

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
      return createJsonResponse({ id: "junction-user-1" });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
      return createJsonResponse({ link_web_url: "https://link.junction.com/session/link-token-1" });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  await requireJunctionConnectionHandler(provider).beginConnection({
    state: "state-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    publicBaseUrl: "https://sync.example.test/device-sync",
    now: "2026-04-03T00:00:00.000Z",
    scopes: [],
    ownerId: "owner-internal-id-123",
    sourceProviderSlug: "fitbit",
  });

  const linkBody = requests.find((request) => request.url.endsWith("/v2/link/token"))?.body;
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "provider" in linkBody
      ? linkBody.provider
      : null,
    "fitbit",
  );
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "filter_on_providers" in linkBody,
    false,
  );
  assert.deepEqual(
    requests.map((request) => {
      const pathname = new URL(request.url).pathname;
      return [
        request.method,
        pathname.startsWith("/v2/user/resolve/") ? "/v2/user/resolve/:clientUserId" : pathname,
      ];
    }),
    [
      ["GET", "/v2/user/resolve/:clientUserId"],
      ["POST", "/v2/link/token"],
    ],
  );
});

test("Junction beginConnection rejects disabled source providers before external calls", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    () => requireJunctionConnectionHandler(provider).beginConnection({
      state: "state-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      publicBaseUrl: "https://sync.example.test/device-sync",
      now: "2026-04-03T00:00:00.000Z",
      scopes: [],
      ownerId: "owner-internal-id-123",
      sourceProviderSlug: "apple_health_kit",
    }),
    /Junction source provider is not enabled/u,
  );
});

test("Junction beginConnection rejects SDK-only source providers before external calls", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    () => requireJunctionConnectionHandler(provider).beginConnection({
      state: "state-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      publicBaseUrl: "https://sync.example.test/device-sync",
      now: "2026-04-03T00:00:00.000Z",
      scopes: [],
      ownerId: "owner-internal-id-123",
      sourceProviderSlug: "accuchek_ble",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_SOURCE_PROVIDER_NOT_CONFIGURED",
  );
});

test("Junction completeConnection treats Link callback as weak and enqueues scalar polling windows", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const connection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-1",
    seededExternalAccountId: "junction-user-1",
    query: new URLSearchParams({
      murph_state: "state-1",
      state: "success",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });

  assert.equal(connection.externalAccountId, "junction-user-1");
  assert.equal(connection.setupPhase, "link_returned");
  assert.deepEqual(connection.initialJobs?.map((job) => job.kind), ["backfill", "reconcile"]);
  assert.deepEqual(connection.initialJobs?.[0]?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const payload = connection.initialJobs?.[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(Array.isArray(payload?.resources), false);

  const sourceConnection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-2",
    seededExternalAccountId: "junction-user-1",
    sourceProviderSlug: "fitbit",
    query: new URLSearchParams({
      murph_state: "state-2",
      state: "success",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });
  assert.deepEqual(sourceConnection.initialJobs?.[0]?.payload, {
    sourceProviderSlug: "fitbit",
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.notEqual(
    sourceConnection.initialJobs?.[0]?.dedupeKey,
    connection.initialJobs?.[0]?.dedupeKey,
  );

  // Every initial job crosses the configured-manifest boundary inside the OAuth
  // callback handler before the connection is persisted. An undeclared payload
  // field throws there, failing the whole Link completion, so the source-scoped
  // payload must round-trip unchanged.
  for (const job of sourceConnection.initialJobs ?? []) {
    assert.deepEqual(
      normalizeConfiguredDeviceSyncJobInput("junction", {
        kind: job.kind,
        payload: job.payload ?? {},
      }, "oauth callback").payload,
      job.payload,
    );
  }
});

test("Junction scheduled polling uses stable closed-day windows", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");

  const first = executor.createScheduledJobs?.(
    createStoredAccount(),
    "2026-04-03T12:34:56.000Z",
  );
  const second = executor.createScheduledJobs?.(
    createStoredAccount(),
    "2026-04-03T23:45:00.000Z",
  );

  assert.equal(first?.jobs.length, 2);
  assert.deepEqual(first?.jobs[0]?.payload, {
    windowStart: "2026-03-27T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(first?.jobs[0]?.dedupeKey, second?.jobs[0]?.dedupeKey);
  // With no recorded historical-backfill outcome, the scheduled pass also
  // re-derives the connect-window backfill until a terminal status lands.
  const derivedBackfill = first?.jobs[1];
  assert.equal(derivedBackfill?.kind, "backfill");
  assert.deepEqual(derivedBackfill?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(derivedBackfill?.dedupeKey, second?.jobs[1]?.dedupeKey);
});

test("Junction scheduled pass repairs legacy coverage and honors current or future terminal status", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");

  const legacyComplete = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "complete",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  const legacyRepairJobs = legacyComplete?.jobs.filter((job) => job.kind === "backfill") ?? [];
  assert.equal(legacyRepairJobs.length, 1);
  assert.deepEqual(legacyRepairJobs[0]?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const priorCoverageVersion = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v1_complete",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  assert.equal(
    priorCoverageVersion?.jobs.filter((job) => job.kind === "backfill").length,
    1,
  );

  const priorCoverageVersionV2 = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v2_complete",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  assert.equal(
    priorCoverageVersionV2?.jobs.filter((job) => job.kind === "backfill").length,
    1,
  );

  for (const metadata of [
    {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
    {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
    {
      junctionHistoricalBackfillStatus: "coverage_v4_complete",
    },
    {
      junctionHistoricalBackfillStatus: "coverage_v4_deferred",
    },
  ] as const) {
    const scheduled = executor.createScheduledJobs?.(
      createStoredAccount({
        metadata,
      }),
      "2026-04-03T12:34:56.000Z",
    );
    assert.equal(
      scheduled?.jobs.some((job) => job.kind === "backfill"),
      false,
      metadata.junctionHistoricalBackfillStatus,
    );
  }

  const completeOtherWindow = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillWindowStart: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  assert.deepEqual(
    completeOtherWindow?.jobs.find((job) => job.kind === "backfill")?.payload,
    {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    },
  );

  const retryingOtherWindow = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-03T12:30:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  const retryingBackfill = retryingOtherWindow?.jobs.find((job) => job.kind === "backfill");
  assert.deepEqual(retryingBackfill?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
});

test("Junction scheduled pass reopens progress overwritten by a legacy runner", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");
  const currentProgress = {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 2,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T12:30:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  };
  const overwrittenByLegacyRunner = mergeStoredDeviceSyncMetadataPatch(currentProgress, {
    junctionHistoricalBackfillStatus: "complete",
  });

  const scheduled = executor.createScheduledJobs?.(
    createStoredAccount({ metadata: overwrittenByLegacyRunner }),
    "2026-04-03T12:34:56.000Z",
  );

  assert.equal(overwrittenByLegacyRunner.junctionHistoricalBackfillStatus, "complete");
  assert.equal(scheduled?.jobs.filter((job) => job.kind === "backfill").length, 1);
});

test("Junction reconcile keeps summaries current while compact timeseries stays on closed days", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount(),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {},
      refreshAccountTokens: async () => createAccount(),
    },
    createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const summarySnapshot = importedSnapshots[0] as { windowEnd?: string };
  assert.equal(summarySnapshot.windowEnd, "2026-04-03T12:00:00.000Z");
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction reconcile should fetch current summary data.",
  );
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-03-27T12:00:00.000Z",
    "2026-04-03T12:00:00.000Z",
  );
  assert.deepEqual(
    requests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [
      ["2026-03-27", "2026-03-27"],
      ["2026-03-28", "2026-03-28"],
      ["2026-03-29", "2026-03-29"],
      ["2026-03-30", "2026-03-30"],
      ["2026-03-31", "2026-03-31"],
      ["2026-04-01", "2026-04-01"],
      ["2026-04-02", "2026-04-02"],
    ],
  );
});

test("Junction daily timeseries imports already-fetched resources then stops at a retryable peer failure", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    const parsed = new URL(url);

    if (parsed.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (parsed.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (parsed.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped") {
      return createJsonResponse({ code: "upstream_unavailable" }, 503);
    }
    if (parsed.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{ start: "2026-04-02T08:00:00.000Z", value: 250 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (parsed.pathname === "/v2/timeseries/junction-user-1/hrv/grouped") {
      throw new Error("Junction should stop before fetching later peers after a retryable failure.");
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["water", "blood_oxygen", "hrv"],
  });

  await assert.rejects(
    () => executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { canonicalEventCount: 1, durableDeliveryAccepted: true };
        },
        now: "2026-04-03T12:00:00.000Z",
      }),
      createJob("reconcile", {
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.retryable, true);
      return true;
    },
  );

  assert.equal(requests.some((url) => url.includes("/blood_oxygen/grouped")), true);
  assert.equal(requests.some((url) => url.includes("/water/grouped")), true);
  assert.equal(requests.some((url) => url.includes("/hrv/grouped")), false);
  const importedTimeseries = importedSnapshots.flatMap((snapshot) =>
    Object.keys((snapshot as { timeseries?: Record<string, unknown[]> }).timeseries ?? {})
  );
  assert.deepEqual(importedTimeseries, ["water"]);
});

test("Junction reconcile keeps same-time Oura notes with different tags", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-oura-1",
          slug: "oura",
          name: "Oura",
          status: "connected",
          resource_availability: { note: true },
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/note/grouped") {
      const first = {
        start: "2026-04-02T18:05:00.000Z",
        end: "2026-04-02T18:10:00.000Z",
        tags: ["sauna"],
        value: "SENSITIVE_VALUE_SENTINEL",
      };
      return createJsonResponse({
        groups: {
          oura: [{
            data: [first, { ...first }, { ...first, tags: ["late meal"] }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    providerFilter: ["oura"],
    summaryResources: ["activity"],
    timeseriesResources: ["note"],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const noteRecords = importedSnapshots.flatMap((snapshot) => {
    const timeseries = (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries;
    return timeseries?.note ?? [];
  });
  assert.equal(noteRecords.length, 2);
  assert.deepEqual(
    noteRecords.map((record) => (record as { tags?: string[] }).tags).sort(),
    [["late meal"], ["sauna"]],
  );
});

test("Junction historical reconcile jobs preserve their summary window", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount(),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {},
      refreshAccountTokens: async () => createAccount(),
    },
    createJob("reconcile", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-02T00:00:00.000Z",
    }),
  );

  const summarySnapshot = importedSnapshots[0] as { windowEnd?: string };
  assert.equal(summarySnapshot.windowEnd, "2026-04-02T00:00:00.000Z");
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction full-day reconcile should fetch summary data.",
  );
  assertJunctionWindowQuery(summaryRequest, "2026-04-01", "2026-04-01");
});

test("Junction skips same closed-day timeseries after a completed reconcile", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount({ lastSyncCompletedAt: "2026-04-03T08:00:00.000Z" }),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {},
      refreshAccountTokens: async () => createAccount(),
    },
    createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), false);
});

test("Junction code-owned compact defaults admit direct timeseries resource jobs", async () => {
  const requests: string[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [] });
      }
      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                start: "2026-04-02T14:30:00.000Z",
                value: 97,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount(),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {},
      refreshAccountTokens: async () => createAccount(),
    },
    createJob("resource", {
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      windowStart: "2026-04-02T12:00:00.000Z",
      windowEnd: "2026-04-03T12:00:00.000Z",
    }),
  );

  assert.deepEqual(
    importedSnapshots.map((snapshot) => {
      const entry = snapshot as { windowEnd?: string; windowStart?: string };
      return [entry.windowStart, entry.windowEnd];
    }),
    [["2026-04-02T12:00:00.000Z", "2026-04-03T12:00:00.000Z"]],
  );
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.deepEqual(snapshot.summaries, {});
  assert.equal(snapshot.timeseries?.blood_oxygen?.length, 1);
  const timeseriesRequest = requireValue(
    requests.find((url) => url.includes("/v2/timeseries/")),
    "Junction resource job should fetch the hinted timeseries resource.",
  );
  assertJunctionWindowQuery(
    timeseriesRequest,
    "2026-04-02T12:00:00.000Z",
    "2026-04-03T12:00:00.000Z",
  );
});

test("Junction compact timeseries resource jobs yield with a precise ISO follow-up window", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              start: new URL(url).searchParams.get("start_date"),
              value: 97,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const importedSnapshots: unknown[] = [];
  const job = createJob("resource", {
    resource: "blood_oxygen",
    resourceCategory: "timeseries",
    windowStart: "2026-04-01T06:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      shouldYield: () => requests.some((url) => url.includes("/v2/timeseries/")),
    }),
    job,
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(
    importedSnapshots.map((snapshot) => {
      const entry = snapshot as { windowEnd?: string; windowStart?: string };
      return [entry.windowStart, entry.windowEnd];
    }),
    [["2026-04-01T06:00:00.000Z", "2026-04-02T06:00:00.000Z"]],
  );
  const timeseriesRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(timeseriesRequests.length, 1);
  assertJunctionWindowQuery(
    requireValue(timeseriesRequests[0], "Junction resource job should fetch its first precise chunk."),
    "2026-04-01T06:00:00.000Z",
    "2026-04-02T06:00:00.000Z",
  );
  assert.deepEqual(result.scheduledJobs, [
    {
      kind: "resource",
      payload: {
        resource: "blood_oxygen",
        resourceCategory: "timeseries",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T06:00:00.000Z",
      },
      priority: job.priority,
      dedupeKey: sha256ForTest(JSON.stringify([
        "junction",
        "yield-follow-up",
        "2026-04-02T06:00:00.000Z",
        "2026-04-03T00:00:00.000Z",
        null,
        null,
        null,
        "blood_oxygen",
        "timeseries",
        null,
      ])),
    },
  ]);
});

test("Junction completeConnection falls back to the callback user_id when no seed is present", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const connection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-1",
    query: new URLSearchParams({
      murph_state: "state-1",
      state: "success",
      user_id: "junction-user-ignored",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });

  assert.equal(connection.externalAccountId, "junction-user-ignored");
  assert.equal(connection.setupPhase, "link_returned");
});

test("Junction completeConnection rejects a callback user_id that differs from the seeded account", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      seededExternalAccountId: "junction-user-seeded",
      query: new URLSearchParams({
        murph_state: "state-1",
        state: "success",
        user_id: "junction-user-other",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_LINK_USER_MISMATCH",
  );
});

test("Junction completeConnection rejects failed Link callbacks", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        state: "failed",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_LINK_FAILED"
      && error.message.includes("state=failed"),
  );
});

test("Junction completeConnection preserves the sanitized Link failure reason", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_type: "provider_credential_error",
        error_description: "User denied access",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(error.message.includes("error_type=provider_credential_error"));
      assert.ok(error.message.includes("error_description=User denied access"));
      return true;
    },
  );
});

test("Junction completeConnection drops JSON-array Link failure descriptions", async () => {
  // A provider-controlled error_description carrying a structured dump must
  // fail closed out of the reason instead of surfacing its entries.
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: '["junction-user-1"]',
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(!error.message.includes("junction-user-1"));
      assert.ok(!error.message.includes("error_description="));
      return true;
    },
  );
});

test("Junction completeConnection drops bracketed comma-list Link failure descriptions", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: "[junction-user-1, Jane Doe]",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(!error.message.includes("junction-user-1"));
      assert.ok(!error.message.includes("Jane"));
      assert.ok(!error.message.includes("Doe"));
      assert.ok(!error.message.includes("error_description="));
      return true;
    },
  );
});

test("Junction completeConnection masks secret-bearing Link failure reason values", async () => {
  // sanitizeHostedRuntimeDiagnosticText masks the secret span so the rest of
  // the provider's explanation stays available for debugging.
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: "User denied access access_token=secret-value-1",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(!error.message.includes("secret-value-1"));
      assert.ok(error.message.includes("error_description=User denied access"));
      assert.ok(!error.message.includes("access_token"));
      return true;
    },
  );
});

test("Junction completeConnection masks colon-form token Link failure reasons", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: "refresh token: abcdefghijklmnopqrst expired",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(error.message.includes("error_description=refresh token: <redacted-token> expired"));
      assert.ok(!error.message.includes("abcdefghijklmnopqrst"));
      return true;
    },
  );
});

test("Junction completeConnection rejects non-truthy success callbacks with the outcome suffix", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        success: "false",
        state: "pending",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("did not report a successful link outcome"));
      assert.ok(error.message.includes("(state=pending, success=false)"));
      return true;
    },
  );
});

test("Junction completeConnection masks token-shaped Link callback values in failure reasons", async () => {
  // JWT-shaped and long opaque token values are masked in place, so the
  // failure reason keeps its shape without leaking either value.
  const jwtDescription = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXBhcnQ";
  const opaqueState = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8";
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error_description: jwtDescription,
        state: opaqueState,
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(!error.message.includes(jwtDescription));
      assert.ok(!error.message.includes(opaqueState));
      assert.ok(error.message.includes("error_description=[redacted.jwt]"));
      assert.ok(error.message.includes("state=<redacted-token>"));
      return true;
    },
  );
});

test("Junction verifies Svix webhooks and maps data events to scalar resource jobs", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      user_id: "junction-user-1",
      client_user_id: "murph_blinded",
      data: {
        id: "activity-1",
        date: "2026-04-02",
        resource: "activity",
        source: {
          provider: "oura",
        },
      },
    },
    messageId: "msg_activity_1",
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.externalAccountId, "junction-user-1");
  assert.deepEqual(parsed.externalAccountDiagnostic, {
    selectedPath: "$.user_id",
    selectedExternalAccountIdHash: sha256ForTest("junction-user-1"),
    candidates: [
      {
        kind: "external_account_id",
        path: "$.user_id",
        selected: true,
        valueHash: sha256ForTest("junction-user-1"),
      },
      {
        kind: "client_user_id",
        path: "$.client_user_id",
        selected: false,
        valueHash: sha256ForTest("murph_blinded"),
      },
    ],
  });
  assert.equal(JSON.stringify(parsed.externalAccountDiagnostic).includes("junction-user-1"), false);
  assert.equal(JSON.stringify(parsed.externalAccountDiagnostic).includes("murph_blinded"), false);
  assert.equal(parsed.eventType, "daily.data.activity.created");
  assert.equal(parsed.acceptanceMode, "durable_webhook_work");
  assert.equal(parsed.traceId, "msg_activity_1");
  assert.equal(parsed.resourceCategory, "summary");
  assert.equal(parsed.unknownAccountAction, "accept");
  const webhookDataJson = parsed.jobs[0]?.payload?.webhookDataJson;
  assert.equal(typeof webhookDataJson, "string");
  const webhookData = JSON.parse(String(webhookDataJson)) as Record<string, unknown>;
  assert.equal(webhookData.sourceProviderSlug, "oura");
  assert.equal(webhookData.resource, "activity");
  assert.equal(webhookData.date, "2026-04-02");
  assert.equal(JSON.stringify(webhookData).includes("junction-user-1"), false);
  assert.deepEqual(parsed.jobs, [
    {
      kind: "resource",
      payload: {
        eventType: "daily.data.activity.created",
        objectId: "activity-1",
        occurredAt: "2026-04-02T00:00:00.000Z",
        resource: "activity",
        resourceCategory: "summary",
        sourceProviderSlug: "oura",
        webhookDataJson,
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      },
      priority: 65,
      dedupeKey: parsed.jobs[0]?.dedupeKey,
    },
  ]);
  assert.equal(typeof parsed.jobs[0]?.dedupeKey, "string");
});

test("Junction signed wearable webhooks create direct import jobs for Oura sleep and Garmin activity", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      summaryResources: ["activity", "sleep"],
      timeseriesResources: [],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  for (const testCase of [
    {
      data: {
        data: {
          bedtime_start: "2026-04-02T03:00:00.000Z",
          bedtime_stop: "2026-04-02T11:00:00.000Z",
          duration: 28_800,
          total: 25_200,
        },
        id: "oura-sleep-1",
        resource: "sleep",
        source: { provider: "oura" },
      },
      eventType: "daily.data.sleep.created",
      messageId: "msg_oura_sleep_fixture_1",
      provider: "oura",
      resource: "sleep",
    },
    {
      data: {
        date: "2026-04-02",
        id: "garmin-activity-1",
        resource: "activity",
        source: { provider: "garmin" },
        steps: 12_345,
      },
      eventType: "daily.data.activity.created",
      messageId: "msg_garmin_activity_fixture_1",
      provider: "garmin",
      resource: "activity",
    },
  ] as const) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data: testCase.data,
      },
      messageId: testCase.messageId,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    assert.equal(parsed.eventType, testCase.eventType);
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsed.resourceCategory, "summary");
    assert.equal(parsed.jobs.length, 1);
    const job = parsed.jobs[0];
    assert.equal(job?.kind, "resource");
    assert.equal(job?.payload?.eventType, testCase.eventType);
    assert.equal(job?.payload?.resource, testCase.resource);
    assert.equal(job?.payload?.resourceCategory, "summary");
    assert.equal(job?.payload?.sourceProviderSlug, testCase.provider);
    assert.equal(typeof job?.payload?.webhookDataJson, "string");
    assert.equal(String(job?.payload?.webhookDataJson).includes("junction-user-1"), false);
    assert.equal(String(job?.payload?.webhookDataJson).includes("murph_blinded"), false);

    await executeJunctionJob(
      provider,
      context,
      createJob(job?.kind ?? "resource", job?.payload ?? {}),
    );
  }

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 2);
  const providers = importedSnapshots.flatMap((snapshot) => {
    const summaries = (snapshot as {
      summaries?: Record<string, Array<{ sourceProviderSlug?: string }>>;
    }).summaries ?? {};
    return Object.values(summaries)
      .flat()
      .flatMap((record) => record.sourceProviderSlug ? [record.sourceProviderSlug] : []);
  });
  assert.deepEqual(providers.sort(), ["garmin", "oura"]);
});

test("Junction record-shaped historical Garmin sleep webhooks preserve inline summary payloads", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      summaryResources: ["sleep", "sleep_cycle"],
      timeseriesResources: [],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );

  for (const testCase of [
    {
      eventType: "historical.data.sleep.created",
      expectedResource: "sleep",
      messageId: "msg_historical_garmin_sleep_1",
      data: {
        id: "garmin-sleep-1",
        date: "2026-04-02",
        resource: "sleep",
        source: { provider: "garmin" },
        start_time: "2026-04-02T03:30:00.000Z",
        end_time: "2026-04-02T11:15:00.000Z",
        total_sleep_minutes: 420,
      },
    },
    {
      eventType: "historical.data.hypnogram.created",
      expectedResource: "sleep_cycle",
      messageId: "msg_historical_garmin_hypnogram_1",
      data: {
        id: "garmin-hypnogram-1",
        date: "2026-04-02",
        resource: "hypnogram",
        source: { provider: "garmin" },
        stages: [
          {
            stage: "deep",
            start_time: "2026-04-02T04:00:00.000Z",
            end_time: "2026-04-02T04:25:00.000Z",
          },
        ],
      },
    },
  ] as const) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data: testCase.data,
      },
      messageId: testCase.messageId,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    assert.equal(parsed.eventType, testCase.eventType);
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsed.resourceCategory, "summary");
    assert.equal(parsed.jobs.length, 1);
    const job = parsed.jobs[0];
    assert.equal(job?.kind, "resource");
    assert.equal(job?.payload?.resource, testCase.expectedResource);
    assert.equal(job?.payload?.resourceCategory, "summary");
    assert.equal(job?.payload?.sourceProviderSlug, "garmin");
    assert.equal(typeof job?.payload?.webhookDataJson, "string");
    assert.equal(String(job?.payload?.webhookDataJson).includes("junction-user-1"), false);
    assert.equal(String(job?.payload?.webhookDataJson).includes("murph_blinded"), false);
  }
});

test("Junction historical sleep completion webhooks fetch the bounded summary window", async () => {
  for (const testCase of [
    {
      label: "sdk",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        provider: "garmin",
      },
    },
    {
      label: "sdk-resource-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        provider: "garmin",
        resource: "sleep",
      },
    },
    {
      label: "sdk-source-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        provider: "garmin",
        source_provider_slug: "garmin",
      },
    },
    {
      label: "documented",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        provider: "garmin",
      },
    },
    {
      label: "documented-resource-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        provider: "garmin",
        resource: "sleep",
      },
    },
    {
      label: "documented-source-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        provider: "garmin",
        source_provider_slug: "garmin",
      },
    },
    {
      label: "documented-source-provider-slug",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        source_provider_slug: "garmin",
      },
    },
    {
      label: "sdk-final-source-provider-slug",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        source_provider_slug: "garmin",
      },
    },
    {
      label: "documented-source-provider-camel",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        sourceProvider: "garmin",
      },
    },
    {
      label: "sdk-final-source-provider-camel",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        isFinal: true,
        sourceProvider: "garmin",
      },
    },
  ] as const) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(
      async (input) => {
        const url = readUrl(input);
        requests.push(url);

        if (url.includes("/v2/user/providers/junction-user-1")) {
          return createJsonResponse({
            providers: [
              {
                slug: "garmin",
                name: "Garmin",
                status: "connected",
                resource_availability: { sleep: true },
              },
            ],
          });
        }

        if (url.includes("/v2/summary/sleep/junction-user-1")) {
          return createJsonResponse({
            data: [
              {
                date: "2026-04-02",
                id: "garmin-sleep-fetched-1",
                source: { provider: "garmin" },
                total_sleep_minutes: 420,
              },
            ],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
      {
        summaryResources: ["sleep"],
        timeseriesResources: [],
        webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
      },
    );
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: "historical.data.sleep.created",
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data: testCase.data,
      },
      messageId: `msg_historical_garmin_sleep_completion_${testCase.label}`,
      timestamp: "1775260800",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-04T00:00:00.000Z",
    });

    assert.equal(parsed.eventType, "historical.data.sleep.created");
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsed.jobs.length, 1);
    const job = parsed.jobs[0];
    assert.equal(job?.kind, "resource");
    assert.equal(job?.payload?.resource, "sleep");
    assert.equal(job?.payload?.resourceCategory, "summary");
    assert.equal(job?.payload?.sourceProviderSlug, "garmin");
    assert.equal(job?.payload?.windowStart, "2026-04-01T00:00:00.000Z");
    assert.equal(job?.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
    assert.equal("webhookDataJson" in (job?.payload ?? {}), false);

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob(job?.kind ?? "resource", job?.payload ?? {}),
    );

    assert.equal(
      requests.some((url) =>
        url.includes("/v2/summary/sleep/junction-user-1")
        && url.includes("provider=garmin")
        && url.includes("start_date=2026-04-01")
        && url.includes("end_date=2026-04-02")
      ),
      true,
      `historical completion webhook should fetch the provider-scoped window; requests=${JSON.stringify(requests)}`,
    );
    assert.equal(importedSnapshots.length, 1);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
    };
    assert.equal(snapshot.summaries?.sleep?.[0]?.id, "garmin-sleep-fetched-1");
    assert.equal(JSON.stringify(parsed.jobs).includes("junction-user-1"), false);
    assert.equal(JSON.stringify(importedSnapshots).includes("murph_blinded"), false);
  }
});

test("Junction completion classification matches the pinned SDK serializer", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      summaryResources: ["sleep"],
      timeseriesResources: [],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );

  const baseData: Record<string, unknown> = {
    user_id: "junction-user-1",
    start_date: "2026-04-01",
    end_date: "2026-04-02",
    is_final: true,
    provider: "garmin",
    resource: "sleep",
    id: "inline-record-if-not-completion",
  };
  const testCases: readonly {
    label: string;
    omit?: readonly string[];
    overrides?: Readonly<Record<string, unknown>>;
  }[] = [
    { label: "calendar-date" },
    {
      label: "week-date",
      overrides: { start_date: "2026-W14-3", end_date: "2026-W14-4" },
    },
    {
      label: "ordinal-date",
      overrides: { start_date: "2026-091", end_date: "2026-092" },
    },
    {
      label: "date-time",
      overrides: {
        start_date: "2026-04-01T12:30:00Z",
        end_date: "2026-04-02T12:30:00+00:00",
      },
    },
    { label: "passthrough-field", overrides: { future_field: "retained" } },
    { label: "malformed-date", overrides: { start_date: "2026-13-40" } },
    { label: "missing-start-date", omit: ["start_date"] },
    { label: "wrong-end-date-type", overrides: { end_date: 17 } },
    { label: "non-final", overrides: { is_final: false } },
    { label: "wrong-final-type", overrides: { is_final: "true" } },
    { label: "missing-provider", omit: ["provider"] },
    { label: "wrong-provider-type", overrides: { provider: 17 } },
    { label: "missing-data-user-id", omit: ["user_id"] },
    { label: "wrong-data-user-id-type", overrides: { user_id: 17 } },
  ];

  for (const testCase of testCases) {
    const data = { ...baseData, ...testCase.overrides };
    for (const field of testCase.omit ?? []) {
      delete data[field];
    }

    const sdkUserId = typeof data.user_id === "string" && data.user_id.trim().length > 0
      ? data.user_id.trim()
      : "junction-user-1";
    const sdkParsed = JunctionHistoricalPullCompletedSchema.parse(
      { ...data, user_id: sdkUserId },
      { unrecognizedObjectKeys: "passthrough" },
    );
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: "historical.data.sleep.created",
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data,
      },
      messageId: `msg_historical_completion_oracle_${testCase.label}`,
      timestamp: "1775260800",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-04T00:00:00.000Z",
    });
    const job = parsed.jobs[0];

    assert.equal(parsed.jobs.length, 1, testCase.label);
    assert.equal(job?.kind, "resource", testCase.label);
    assert.equal(
      "webhookDataJson" in (job?.payload ?? {}),
      !sdkParsed.ok,
      `${testCase.label} should match the pinned SDK completion classification`,
    );
  }
});

test("Junction rejects webhooks with only a client_user_id and no Junction user_id", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      client_user_id: "murph_blinded",
      data: {
        id: "activity-1",
        date: "2026-04-02",
        resource: "activity",
        source: {
          provider: "oura",
        },
      },
    },
    messageId: "msg_client_user_only_1",
    timestamp: "1775174400",
  });

  await assert.rejects(
    () => requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_WEBHOOK_USER_ID_MISSING");
      assert.equal(error.httpStatus, 400);
      assert.equal(JSON.stringify(error.details).includes("murph_blinded"), false);
      assert.deepEqual(error.details, {
        externalAccountCandidates: [
          {
            kind: "client_user_id",
            path: "$.client_user_id",
            selected: false,
            valueHash: sha256ForTest("murph_blinded"),
          },
        ],
      });
      return true;
    },
  );
});

test("Junction webhook jobs dedupe by resource window instead of Svix trace", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const body = {
    event_type: "daily.data.steps.created",
    user_id: "junction-user-1",
    client_user_id: "murph_blinded",
    data: {
      id: "steps-1",
      date: "2026-04-02",
      resource: "steps",
      source: {
        provider: "garmin",
      },
    },
  };

  const firstWebhook = createJunctionSvixWebhook({
    body,
    messageId: "msg_steps_first",
    timestamp: "1775174400",
  });
  const secondWebhook = createJunctionSvixWebhook({
    body,
    messageId: "msg_steps_second",
    timestamp: "1775174400",
  });

  const first = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: firstWebhook.headers,
    rawBody: firstWebhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const second = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: secondWebhook.headers,
    rawBody: secondWebhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.notEqual(first.traceId, second.traceId);
  assert.equal(first.jobs[0]?.kind, "resource");
  assert.equal(first.jobs[0]?.dedupeKey, second.jobs[0]?.dedupeKey);
});

test("Junction webhook source-provider extraction covers documented payload shapes", async () => {
  const cases: Array<{
    label: string;
    eventType: string;
    data: Record<string, unknown>;
    expectedSourceProviderSlug: string;
    expectedResource: string;
  }> = [
    {
      label: "historical data.provider",
      eventType: "historical.data.workouts.created",
      data: {
        id: "workout-zwift-1",
        provider: "zwift",
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "daily data.source.provider",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-2",
        source: {
          provider: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "daily data.source.slug",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-fitbit-1",
        source: {
          slug: "fitbit",
        },
      },
      expectedSourceProviderSlug: "fitbit",
      expectedResource: "steps",
    },
    {
      label: "nested provider slug",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-3",
        provider: {
          slug: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "nested provider provider",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-4",
        provider: {
          provider: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "aggregator provider only",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-aggregator-1",
        provider: "junction",
      },
      expectedSourceProviderSlug: "",
      expectedResource: "steps",
    },
    {
      label: "nested source beats aggregator provider",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-fitbit-2",
        provider: "junction",
        source: {
          provider: "fitbit",
        },
      },
      expectedSourceProviderSlug: "fitbit",
      expectedResource: "steps",
    },
  ];

  for (const testCase of cases) {
    const provider = createJunctionProvider(
      async (input) => {
        throw new Error(`Unexpected request: ${readUrl(input)}`);
      },
      {
        webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
      },
    );
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: `junction-user-${testCase.label.replace(/[^a-z0-9]+/giu, "-")}`,
        data: testCase.data,
      },
      messageId: `msg_${testCase.label.replace(/[^a-z0-9]+/giu, "_")}`,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    const job = parsed.jobs[0];
    assert.ok(job, testCase.label);
    assert.equal(job.kind, "resource", testCase.label);
    const payload = job.payload;
    assert.ok(payload, testCase.label);
    assert.equal(payload.resource, testCase.expectedResource, testCase.label);
    assert.equal(
      payload.sourceProviderSlug,
      testCase.expectedSourceProviderSlug,
      testCase.label,
    );
  }
});

test("Junction accepts nested webhook user ids and comma-delivered Svix signatures", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      data: {
        id: "blood-oxygen-1",
        timestamp: "2026-04-02T12:00:00.000Z",
        sourceProvider: "fitbit",
        user: {
          id: "junction-user-nested",
        },
      },
    },
    messageId: "msg_blood_oxygen_nested",
    signatureHeader: (signature) =>
      `v1,invalid,v1,${signature.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")}`,
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.externalAccountId, "junction-user-nested");
  assert.equal(parsed.resourceCategory, "timeseries");
  assert.equal(parsed.jobs[0]?.kind, "resource");
  assert.deepEqual(parsed.jobs[0]?.payload, {
    eventType: "daily.data.blood_oxygen.created",
    objectId: "blood-oxygen-1",
    occurredAt: "2026-04-02T12:00:00.000Z",
    resource: "blood_oxygen",
    resourceCategory: "timeseries",
    sourceProviderSlug: "fitbit",
    windowStart: "2026-04-01T12:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
});

test("Junction accepts user ids nested inside webhook envelopes", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const cases: Array<{ body: Record<string, unknown>; expectedUserId: string; messageId: string }> = [
    {
      body: {
        event_type: "provider.connection.created",
        data: {},
        payload: {
          user: {
            id: "junction-user-root-payload",
          },
        },
      },
      expectedUserId: "junction-user-root-payload",
      messageId: "msg_root_payload_user",
    },
    {
      body: {
        event_type: "provider.connection.created",
        data: {
          payload: {
            user: {
              id: "junction-user-data-payload",
            },
          },
        },
      },
      expectedUserId: "junction-user-data-payload",
      messageId: "msg_data_payload_user",
    },
    {
      body: {
        event_type: "provider.connection.created",
        data: {
          event: {
            message: {
              user: {
                id: "junction-user-event-message",
              },
            },
          },
        },
      },
      expectedUserId: "junction-user-event-message",
      messageId: "msg_event_message_user",
    },
  ];

  for (const { body, expectedUserId, messageId } of cases) {
    const webhook = createJunctionSvixWebhook({
      body,
      messageId,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    assert.equal(parsed.externalAccountId, expectedUserId);
    assert.deepEqual(parsed.jobs.map((job) => job.kind), ["backfill", "reconcile"]);
  }
});

test("Junction connection-event backfill completion does not write historical metadata for a non-connect window", async () => {
  const provider = createEmptyJunctionBackfillProvider({
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    messageId: "msg_connection_created_backfill",
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const backfillJob = requireValue(
    parsed.jobs.find((job) => job.kind === "backfill"),
    "Junction connection event should derive a backfill job.",
  );
  assert.deepEqual(backfillJob.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ connectedAt: "2026-04-01T00:00:00.000Z" }),
      now: "2026-04-04T00:00:00.000Z",
    }),
    createJob(backfillJob.kind, backfillJob.payload ?? {}),
  );

  assert.equal(
    Object.keys(result.metadataPatch ?? {}).some((key) => key.startsWith("junctionHistoricalBackfill")),
    false,
  );
});

test("Junction rejects webhooks with conflicting signed payload user ids", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-top",
      data: {
        event: {
          message: {
            user: {
              id: "junction-user-deep",
            },
          },
        },
      },
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => {
      if (!(error instanceof DeviceSyncError)) {
        return false;
      }

      assert.equal(error.code, "JUNCTION_WEBHOOK_USER_ID_CONFLICT");
      assert.deepEqual(error.details, {
        externalAccountCandidates: [
          {
            kind: "external_account_id",
            path: "$.user_id",
            selected: false,
            valueHash: sha256ForTest("junction-user-top"),
          },
          {
            kind: "external_account_id",
            path: "$.data.event.message.user.id",
            selected: false,
            valueHash: sha256ForTest("junction-user-deep"),
          },
        ],
      });
      assert.equal(JSON.stringify(error.details).includes("junction-user-top"), false);
      assert.equal(JSON.stringify(error.details).includes("junction-user-deep"), false);
      return true;
    },
  );
});

test("Junction rejects malformed whsec webhook secrets", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_not-base64!",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_WEBHOOK_SECRET_INVALID",
  );
});

test("Junction rejects webhooks with invalid Svix signatures", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: Buffer.from(JSON.stringify({
        event_type: "provider.connection.created",
        user_id: "junction-user-2",
        data: {},
      })),
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_WEBHOOK_SIGNATURE_INVALID",
  );
});

test("Junction polling updates source projection and imports bounded summary/timeseries snapshots", async () => {
  const requests: string[] = [];
  const groupedTimeseriesPayloads: Record<string, unknown> = {
    blood_oxygen: {
      groups: {
        oura: [{
          data: [{
            accountId: "junction-account-timeseries-1",
            account: { id: "nested-account-timeseries-1" },
            app: { id: "nested-app-timeseries-1", name: "Nested Timeseries App" },
            device: { id: "nested-device-timeseries-1", name: "Nested Timeseries Device" },
            timestamp: "2026-04-02T14:30:52+00:00",
            unit: "%",
            user_id: "junction-user-timeseries-1",
            value: 97,
          }],
          source: {
            provider: "oura",
            type: "ring",
            name: "Timeseries Oura Ring",
            device_id: "timeseries-device-oura-ring-1",
            app_id: "timeseries-app-oura-cloud-1",
          },
        }],
      },
    },
    stress_level: {
      groups: {
        oura: [{
          data: [{
            timestamp: "2026-04-02T14:30:52+00:00",
            unit: "score",
            value: 48,
          }],
          source: { provider: "oura", type: "ring" },
        }],
      },
    },
  };
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-connection-oura-ring-1",
            name: "Oura Ring",
            status: "connected",
            source: {
              provider: "oura",
              device_id: "device-oura-ring-1",
              app_id: "app-oura-cloud-1",
            },
            resource_availability: {
              sleep: true,
              connectedSources: ["oura"],
              source: "Oura Ring",
              provider: "oura",
              provider_connection_id: "provider-connection-oura-ring-1",
              provider_name: "Oura Cloud",
              device_id: "device-oura-ring-1",
              deviceName: "Oura Ring",
              app_id: "app-oura-cloud-1",
              app_name: "Oura App",
              user_id: "blocked",
            },
          },
          {
            id: "provider-connection-oura-ring-2",
            slug: "oura",
            name: "Oura Ring 2",
            status: "connected",
            source: {
              device_id: "device-oura-ring-2",
              app_id: "app-oura-cloud-1",
            },
            resource_availability: {
              activity: true,
            },
          },
          {
            id: "provider-connection-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
            status: "connected",
            source: {
              provider: "fitbit",
            },
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      const cursor = new URL(url).searchParams.get("next_cursor");
      if (cursor === "page-2") {
        return createJsonResponse({
          data: [{
            id: "summary-2",
            accountId: "junction-account-raw-2",
            providerConnectionId: "provider-connection-oura-ring-2",
            userId: "junction-user-raw-2",
            steps: 2000,
          }],
        });
      }

      return createJsonResponse({
        data: [{
          id: "summary-1",
          Source: { id: "nested-source-summary-1", name: "Nested Source Summary" },
          account_id: "junction-account-raw-1",
          account: { id: "nested-account-summary-1" },
          app: { id: "nested-app-summary-1", name: "Nested Summary App" },
          client_user_id: "client-user-raw-1",
          device: { id: "nested-device-summary-1", name: "Nested Summary Device" },
          provider_connection_id: "provider-connection-oura-ring-1",
          steps: 1000,
        }],
        next_cursor: "page-2",
      });
    }

    const timeseriesResource = new URL(url).pathname.match(/\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1];
    if (timeseriesResource && timeseriesResource in groupedTimeseriesPayloads) {
      return createJsonResponse(groupedTimeseriesPayloads[timeseriesResource]);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });
  const sources: DeviceConnectionSourceRecord[] = [];
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount({
      sources: [{
        displayName: "Fitbit",
        firstSeenAt: "2026-04-02T00:00:00.000Z",
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-02T00:00:00.000Z",
        resourceCount: 0,
        sourceProviderSlug: "fitbit",
        status: "disconnected",
      }],
    }),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: (input) => {
      const source: DeviceConnectionSourceRecord = {
        id: `src-${sources.length + 1}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      sources.push(source);
      return source;
    },
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.sourceProviderSlug, "oura");
  assert.equal(sources[0]?.status, "connected");
  assert.equal(
    sources[0]?.sourceInstanceKey,
    buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "oura",
    }),
  );
  assert.doesNotMatch(sources[0]?.sourceInstanceKey ?? "", /provider|device|oura|ring|app/u);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sourceInstanceKeyFallback, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sleep, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.activity, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.connectedSources, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.source, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider_connection_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider_name, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.device_id, undefined);
  assert.equal(sources[1]?.sourceProviderSlug, "fitbit");
  assert.equal(sources[1]?.status, "connected");
  assert.equal(sources[0]?.resourceAvailabilitySummary.deviceName, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_name, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.user_id, undefined);
  assert.equal(importedSnapshots.length, 3);
  assert.match(JSON.stringify(importedSnapshots), /"provider":"junction"/u);
  const snapshotJson = JSON.stringify(importedSnapshots);
  assert.doesNotMatch(snapshotJson, /provider-connection-oura-ring|device-oura-ring|app-oura-cloud/u);
  assert.doesNotMatch(snapshotJson, /junction-user-1|junction-account-raw|junction-user-raw|client-user-raw|junction-account-timeseries|junction-user-timeseries/u);
  assert.doesNotMatch(snapshotJson, /nested-(source|account|device|app)-summary|Nested Summary|nested-(account|device|app)-timeseries|Nested Timeseries/u);
  const summarySnapshot = importedSnapshots[0] as {
    accountId?: string;
    connections?: Array<Record<string, unknown>>;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, Array<Record<string, unknown>>>;
    windowEnd?: string;
  };
  assert.match(summarySnapshot.accountId ?? "", /^jxn_acct_[a-f0-9]{32}$/u);
  assert.equal(summarySnapshot.windowEnd, "2026-04-03T00:00:00.000Z");
  const importedConnection = summarySnapshot.connections?.[0] as
    | {
        provider?: unknown;
        source?: unknown;
        sourceInstanceId?: string;
        sourceProviderSlug?: string;
      }
    | undefined;
  assert.match(
    importedConnection?.sourceInstanceId ?? "",
    /^source-[a-f0-9]{24}$/u,
  );
  assert.deepEqual(Object.keys(importedConnection ?? {}).sort(), [
    "sourceInstanceId",
    "sourceProviderSlug",
  ]);
  assert.equal(importedConnection?.sourceProviderSlug, "oura");
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /fitbit/u);
  assert.equal((importedConnection as { source?: unknown } | undefined)?.source, undefined);
  assert.equal((importedConnection as { provider?: unknown } | undefined)?.provider, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.account_id, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.Source, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.account, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.app, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.client_user_id, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.device, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.provider_connection_id, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.accountId, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.providerConnectionId, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.userId, undefined);
  assert.deepEqual(summarySnapshot.timeseries, {});

  const timeseriesSnapshots = importedSnapshots.slice(1) as Array<{
    timeseries?: Record<string, Array<Record<string, unknown>>>;
    windowEnd?: string;
    windowStart?: string;
  }>;
  assert.deepEqual(
    timeseriesSnapshots.map((snapshot) => [snapshot.windowStart, snapshot.windowEnd]),
    [
      ["2026-04-02T00:00:00.000Z", "2026-04-03T00:00:00.000Z"],
      ["2026-04-02T00:00:00.000Z", "2026-04-03T00:00:00.000Z"],
    ],
  );
  const timeseries = timeseriesSnapshots.reduce<Record<string, Array<Record<string, unknown>>>>(
    (merged, snapshot) => {
      for (const [resource, records] of Object.entries(snapshot.timeseries ?? {})) {
        merged[resource] = [...(merged[resource] ?? []), ...records];
      }
      return merged;
    },
    {},
  );

  assert.deepEqual(Object.keys(timeseries).sort(), ["blood_oxygen", "stress_level"]);
  assert.equal(timeseries.blood_oxygen?.length, 1);
  assert.equal(timeseries.stress_level?.length, 1);
  const bloodOxygenRecord = timeseries.blood_oxygen?.[0];
  assert.equal(bloodOxygenRecord?.accountId, undefined);
  assert.equal(bloodOxygenRecord?.account, undefined);
  assert.equal(bloodOxygenRecord?.app, undefined);
  assert.equal(bloodOxygenRecord?.device, undefined);
  assert.equal(bloodOxygenRecord?.sourceProviderSlug, "oura");
  assert.equal(bloodOxygenRecord?.sourceType, "ring");
  assert.equal(bloodOxygenRecord?.sourceName, undefined);
  assert.equal(bloodOxygenRecord?.sourceDeviceId, undefined);
  assert.equal(bloodOxygenRecord?.sourceAppId, undefined);
  assert.equal(bloodOxygenRecord?.user_id, undefined);
  assert.equal((bloodOxygenRecord as { source?: unknown } | undefined)?.source, undefined);
  assert.equal((bloodOxygenRecord as { provider?: unknown } | undefined)?.provider, undefined);
  assert.equal(typeof bloodOxygenRecord?.sourceInstanceId, "string");
  assert.match(String(bloodOxygenRecord?.sourceInstanceId), /^source-[a-f0-9]{24}$/u);
  assert.equal(timeseries.stress_level?.[0]?.sourceType, "ring");
  assert.equal(timeseries.blood_oxygen?.[0]?.junctionResource, "blood_oxygen");
  assert.equal(timeseries.stress_level?.[0]?.unit, "score");
  assert.doesNotMatch(
    JSON.stringify(timeseries),
    /Timeseries Oura Ring|timeseries-device-oura-ring-1|timeseries-app-oura-cloud-1/u,
  );
  assert.equal(requests.filter((url) => url.includes("/v2/summary/")).length, 2);
  assert.equal(requests.some((url) => url.includes("next_cursor=page-2")), true);
  const timeseriesRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(timeseriesRequests.length, 4);
  assert.equal(timeseriesRequests.every((url) => url.includes("/grouped?")), true);
  assert.equal(timeseriesRequests.some((url) => url.includes("/heartrate?")), false);
  assert.equal(
    requests.every((url) => !url.includes("steps") && !url.includes("heartrate") && !url.includes("hrv")),
    true,
  );
  assert.equal(requests.every((url) => !url.includes("glucose") && !url.includes("cgm")), true);
});

test("Junction source projection uses provider-level keys for slug-only sources", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "withings",
            name: "Withings",
            status: "connected",
            resource_availability: {
              body: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const sources: DeviceConnectionSourceRecord[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async () => ({ imported: true }),
    upsertConnectionSource: (input) => {
      const source: DeviceConnectionSourceRecord = {
        id: `src-${sources.length + 1}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      sources.push(source);
      return source;
    },
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(sources.length, 1);
  assert.equal(
    sources[0]?.sourceInstanceKey,
    buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "withings",
    }),
  );
  assert.equal(sources[0]?.resourceAvailabilitySummary.body, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sourceInstanceKeyFallback, undefined);
});

test("Junction source projection persists provider error details for errored sources", async () => {
  const longErrorMessage = `WHOOP rejected the refresh token. ${"detail ".repeat(60)}`;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: {
              error_type: "token_refresh_failed",
              error_message: longErrorMessage,
              errored_at: "2026-04-02T21:28:00+00:00",
            },
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "oura",
            name: "Oura",
            status: "connected",
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
    },
  });

  await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const erroredUpsert = upserts.find((input) => input.sourceProviderSlug === "whoop_v2");
  assert.ok(erroredUpsert, "Errored WHOOP source should be projected.");
  assert.equal(erroredUpsert.status, "error");
  assert.equal(erroredUpsert.lastErrorCode, "token_refresh_failed");
  assert.equal(erroredUpsert.lastErrorMessage?.length, 240);
  assert.match(erroredUpsert.lastErrorMessage ?? "", /^WHOOP rejected the refresh token\./u);

  const connectedUpsert = upserts.find((input) => input.sourceProviderSlug === "oura");
  assert.ok(connectedUpsert, "Connected Oura source should be projected.");
  assert.equal(connectedUpsert.status, "connected");
  // Omitted keys let the store auto-clear stale error detail on recovery.
  assert.equal(Object.hasOwn(connectedUpsert, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(connectedUpsert, "lastErrorMessage"), false);
});

test("Junction source projection drops error details when a sibling source entry is connected", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: {
              error_type: "token_refresh_failed",
              error_message: "WHOOP rejected the refresh token.",
            },
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "connected",
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
    },
  });

  await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.sourceProviderSlug, "whoop_v2");
  assert.equal(upserts[0]?.status, "connected");
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorMessage"), false);
});

test("Junction source projection tolerates malformed error details and reads camelCase fields", async () => {
  const longErrorType = `token_refresh_failed_${"x".repeat(100)}`;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: "token refresh failed",
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "oura",
            name: "Oura",
            status: "error",
            error_details: {
              error_type: "   ",
              error_message: "",
            },
            resource_availability: {
              activity: true,
            },
          },
          {
            slug: "garmin",
            name: "Garmin",
            status: "error",
            errorDetails: {
              errorType: longErrorType,
              errorMessage: "Garmin revoked access.",
            },
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
    },
  });

  await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  // Non-object error_details: errored projection keeps the status but omits
  // the error keys so the store can preserve any previously stored detail.
  const malformedUpsert = upserts.find((input) => input.sourceProviderSlug === "whoop_v2");
  assert.ok(malformedUpsert, "Errored WHOOP source should be projected.");
  assert.equal(malformedUpsert.status, "error");
  assert.equal(Object.hasOwn(malformedUpsert, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(malformedUpsert, "lastErrorMessage"), false);

  // All-blank error detail fields collapse to null details and omit the keys.
  const blankUpsert = upserts.find((input) => input.sourceProviderSlug === "oura");
  assert.ok(blankUpsert, "Errored Oura source should be projected.");
  assert.equal(blankUpsert.status, "error");
  assert.equal(Object.hasOwn(blankUpsert, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(blankUpsert, "lastErrorMessage"), false);

  // camelCase errorDetails parse, and the code truncates to the 80-char bound.
  const camelUpsert = upserts.find((input) => input.sourceProviderSlug === "garmin");
  assert.ok(camelUpsert, "Errored Garmin source should be projected.");
  assert.equal(camelUpsert.status, "error");
  assert.equal(camelUpsert.lastErrorCode?.length, 80);
  assert.match(camelUpsert.lastErrorCode ?? "", /^token_refresh_failed_x/u);
  assert.equal(camelUpsert.lastErrorMessage, "Garmin revoked access.");
});

test("Junction source projection fills error details from a later errored sibling entry", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: {
              error_type: "token_refresh_failed",
              error_message: "WHOOP rejected the refresh token.",
            },
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
    },
  });

  await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.sourceProviderSlug, "whoop_v2");
  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[0]?.lastErrorCode, "token_refresh_failed");
  assert.equal(upserts[0]?.lastErrorMessage, "WHOOP rejected the refresh token.");
});

test("Junction polling skips optional unavailable resource collections", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              activity: true,
              blood_oxygen: true,
              stress_level: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 1200 }] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({ message: "Resource not found." }, 404);
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          oura: [{
            data: [{ timestamp: "2026-04-02T00:00:00Z", unit: "%", value: 97 }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")) {
      return createJsonResponse({ error: "unsupported_resource" }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "profile"],
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });
  const context: ProviderJobContext = {
    account: createAccount({
      metadata: {
        junctionSkippedResourceTotal: 10,
        junctionSkippedSummaryTotal: 4,
        junctionSkippedTimeseriesTotal: 6,
      },
    }),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring",
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {
      warn(_message, context) {
        warnings.push(context ?? {});
      },
    },
  };

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 2);
  const summarySnapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  };
  const timeseriesSnapshot = importedSnapshots[1] as {
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(summarySnapshot.summaries?.activity?.length, 1);
  assert.equal(summarySnapshot.summaries?.profile, undefined);
  assert.deepEqual(summarySnapshot.timeseries, {});
  assert.deepEqual(timeseriesSnapshot.summaries, {});
  assert.equal(timeseriesSnapshot.timeseries?.blood_oxygen?.length, 1);
  assert.equal(timeseriesSnapshot.timeseries?.stress_level, undefined);
  assert.deepEqual(
    warnings.map((warning) => ({
      accountId: warning.accountId,
      reason: warning.reason,
      resource: warning.resource,
      resourceCategory: warning.resourceCategory,
      responseStatus: warning.responseStatus,
    })),
    [
      {
        accountId: undefined,
        reason: "not_found",
        resource: "profile",
        resourceCategory: "summary",
        responseStatus: 404,
      },
      {
        accountId: undefined,
        reason: "unsupported",
        resource: "stress_level",
        resourceCategory: "timeseries",
        responseStatus: 422,
      },
    ],
  );
  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceTotal: 12,
    junctionSkippedSummaryTotal: 5,
    junctionSkippedTimeseriesTotal: 7,
    junctionSkippedResourceJobCount: 2,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "timeseries.stress_level.422.unsupported",
    junctionSkippedResourceLastDetail: null,
  });
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction optional profile skip should come from the current-state profile endpoint.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
});

test("Junction polling skips ambiguous optional resource responses and records the provider detail", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return new Response(JSON.stringify({
        code: "invalid_request",
        message: "The date window is invalid for this request.",
      }), {
        status: 422,
        statusText: "Validation failed at https://api.example.test/users/junction-user-1",
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(warnings, [
    {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      reason: "ambiguous",
      resource: "profile",
      resourceCategory: "summary",
      responseStatus: 422,
      responseDetail: "invalid_request: The date window is invalid for this request.",
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 1,
    junctionSkippedTimeseriesTotal: 0,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "summary.profile.422.ambiguous",
    junctionSkippedResourceLastDetail: "invalid_request: The date window is invalid for this request.",
  });
  assert.equal(JSON.stringify(warnings).includes("junction-user-1"), false);
  assert.equal(JSON.stringify(result.metadataPatch).includes("junction-user-1"), false);
});

test("Junction ambiguous sleep_cycle summary failure still imports the other summaries", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              sleep: true,
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", observedAt: "2026-04-02T12:00:00.000Z", steps: 1200 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "sleep-1", calendar_date: "2026-04-02", score: 82, total: 27000 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "sleep_cycle summaries are not enabled for this team.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep", "sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { summaries?: Record<string, unknown[]> };
  assert.equal(snapshot.summaries?.activity?.length, 1);
  assert.equal(snapshot.summaries?.sleep?.length, 1);
  assert.deepEqual(snapshot.summaries?.sleep_cycle, []);
  assert.deepEqual(warnings, [
    {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      reason: "ambiguous",
      resource: "sleep_cycle",
      resourceCategory: "summary",
      responseStatus: 422,
      responseDetail: "invalid_request: sleep_cycle summaries are not enabled for this team.",
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 1,
    junctionSkippedTimeseriesTotal: 0,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "summary.sleep_cycle.422.ambiguous",
    junctionSkippedResourceLastDetail: "invalid_request: sleep_cycle summaries are not enabled for this team.",
  });
});

test("Junction polling treats missing profile summary as a one-shot optional skip", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        error: "not_found",
        message: "Not found.",
      }, 404);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(warnings.map((warning) => ({
    reason: warning.reason,
    resource: warning.resource,
    resourceCategory: warning.resourceCategory,
    responseStatus: warning.responseStatus,
  })), [{
    reason: "not_found",
    resource: "profile",
    resourceCategory: "summary",
    responseStatus: 404,
  }]);
  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 1,
    junctionSkippedTimeseriesTotal: 0,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "summary.profile.404.not_found",
    junctionSkippedResourceLastDetail: null,
  });
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction missing profile skip should call the current-state profile endpoint.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
});

test("Junction polling skips request-shape optional resource failures as ambiguous", async () => {
  const ambiguousCases = [
    {
      code: "not_found",
      message: "Resource parameters missing.",
    },
    {
      code: "not_found",
      message: "Resource not found for startDate.",
    },
    {
      code: "not_found",
      message: "Resource not found for end_date.",
    },
    {
      code: "resource_not_found",
      message: "Resource not found for startDate.",
    },
  ];

  for (const { code, message } of ambiguousCases) {
    const warnings: Record<string, unknown>[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              slug: "oura",
              name: "Oura Ring",
              status: "connected",
              resource_availability: {
                profile: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
        return createJsonResponse({
          error: code,
          message,
        }, 422);
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["profile"],
      timeseriesResources: [],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
        logger: {
          warn(_message, context) {
            warnings.push(context ?? {});
          },
        },
      }),
      createJob("reconcile", {
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.equal(importedSnapshots.length, 1);
    assert.deepEqual(warnings, [
      {
        errorCode: "JUNCTION_API_REQUEST_FAILED",
        provider: "junction",
        reason: "ambiguous",
        resource: "profile",
        resourceCategory: "summary",
        responseStatus: 422,
        responseDetail: `${code}: ${message}`,
      },
    ]);
    assert.equal(result.metadataPatch?.junctionSkippedResourceLast, "summary.profile.422.ambiguous");
    assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, `${code}: ${message}`);
    assert.equal(JSON.stringify(warnings).includes("junction-user-1"), false);
  }
});

test("Junction ambiguous skip detail redacts the account id from provider error text", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "User Junction-User-1 cannot access this summary.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(
    warnings[0]?.responseDetail,
    "invalid_request: User <redacted-id> cannot access this summary.",
  );
  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "invalid_request: User <redacted-id> cannot access this summary.",
  );
  assert.equal(JSON.stringify(warnings).toLowerCase().includes("junction-user-1"), false);
  assert.equal(JSON.stringify(result.metadataPatch).toLowerCase().includes("junction-user-1"), false);
});

test("Junction ambiguous skip detail truncates unknown assignment tails after user_id prose", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "request rejected for user_id: hbm_abc123, display_name=Jane Doe upstream",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "invalid_request: request rejected for user_id: <redacted-id>";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["display_name", "hbm_abc123", "Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail drops object-shaped display-name diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: {
          type: "resource_misconfigured",
          msg: "display_name: Jane Doe cannot access sleep_cycle",
        },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, "resource_misconfigured");
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "resource_misconfigured");

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["display_name", "Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail drops object-shaped unlabeled user diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: {
          type: "resource_misconfigured",
          msg: "Patient Jane Doe not found",
        },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "resource_misconfigured";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail masks object-shaped credential-label diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: {
          type: "resource_misconfigured",
          msg: "api key secretvalue leaked",
        },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "resource_misconfigured: api key <redacted-token> leaked";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  assert.equal(serializedWarnings.includes("secretvalue"), false);
  assert.equal(serializedMetadata.includes("secretvalue"), false);
});

test("Junction ambiguous skip detail masks slash-bearing identifier phrases", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "user hbm_abc123/Jane-Doe is blocked upstream",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "invalid_request: user <redacted-id> is blocked upstream";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["hbm_abc123", "Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail masks embedded ids from provider prose", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: "Team 00000000-0000-4000-8000-000000000001 is not configured for sleep_cycle.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "Team <redacted-id> is not configured for sleep_cycle.",
  );
  assert.equal(
    warnings[0]?.responseDetail,
    "Team <redacted-id> is not configured for sleep_cycle.",
  );
  assert.equal(
    JSON.stringify(result.metadataPatch).includes("00000000-0000-4000-8000-000000000001"),
    false,
  );
});

test("Junction ambiguous skip detail drops id-shaped provider error codes", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        code: "00000000-0000-4000-8000-000000000002",
        message: "sleep_cycle disabled",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "sleep_cycle disabled");
  assert.equal(warnings[0]?.responseDetail, "sleep_cycle disabled");
  assert.equal(
    JSON.stringify(warnings).includes("00000000-0000-4000-8000-000000000002"),
    false,
  );
  assert.equal(
    JSON.stringify(result.metadataPatch).includes("00000000-0000-4000-8000-000000000002"),
    false,
  );
});

test("Junction ambiguous skip detail reads FastAPI-shaped sleep_cycle validation arrays", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse([
        {
          type: "value_error.date",
          msg: "start_date must be before end_date",
        },
      ], 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "value_error.date: start_date must be before end_date";
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
});

test("Junction ambiguous skip detail keeps safe date validation prose before bracket suffixes", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: "Datetimes provided to dates should have zero time [type=date_from_datetime_inexact]",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const storedDetail = result.metadataPatch?.junctionSkippedResourceLastDetail;
  const warningDetail = warnings[0]?.responseDetail;

  assert.equal(storedDetail, "Datetimes provided to dates should have zero time");
  assert.equal(warningDetail, "Datetimes provided to dates should have zero time");
  assert.equal(storedDetail?.endsWith("zero time"), true);
  assert.equal(warningDetail?.includes("Datetimes provided to dates should have zero time"), true);

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("date_from_datetime_inexact"), false);
    assert.equal(exposed.includes("type="), false);
  }
});

test("Junction ambiguous skip detail ignores top-level primitive arrays", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse(["Jane Doe"], 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, undefined);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, null);

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("Jane"), false);
    assert.equal(exposed.includes("Doe"), false);
  }
});

test("Junction ambiguous skip detail truncates bracketed diagnostics with unknown keys", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "Validation failed [user_id=1234, display_name=Jane Doe]",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, "invalid_request: Validation failed");
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "invalid_request: Validation failed");

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("Jane"), false);
    assert.equal(exposed.includes("Doe"), false);
    assert.equal(exposed.includes("1234"), false);
  }
});

test("Junction ambiguous skip detail keeps safe prefix before nested bracketed diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        message: "Validation failed [context [field] display_name=Jane]",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, "Validation failed");
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "Validation failed");

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("Jane"), false);
    assert.equal(exposed.includes("display_name"), false);
  }
});

test("Junction ambiguous skip detail reads object-shaped provider error bodies", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: { type: "resource_misconfigured", msg: "user hbm_abc123xyz sleep_cycle summaries are disabled." },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "resource_misconfigured: user <redacted-id> sleep_cycle summaries are disabled.",
  );
});

test("Junction ambiguous skip detail is clamped to the stored-metadata string cap", async () => {
  const longMessage = "sleep cycle summaries are disabled for this integration tier. ".repeat(6).trim();
  assert.ok(longMessage.length > 256 && longMessage.length < 512);
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: longMessage,
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const detail = result.metadataPatch?.junctionSkippedResourceLastDetail;
  assert.equal(typeof detail, "string");
  assert.ok(typeof detail === "string" && detail.length > 0 && detail.length <= 256);
  assert.ok(typeof detail === "string" && detail.startsWith("invalid_request: sleep cycle summaries are disabled"));
  assert.equal(warnings[0]?.responseDetail, detail);
});

test("Junction companion HRV jobs import the derived observation without Junction HTTP requests", async () => {
  let fetchCalls = 0;
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Companion HRV jobs must not call Junction.");
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const observation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  } satisfies Parameters<typeof serializeCompanionHrvRmssdObservation>[0];
  const companionObservationJson = serializeCompanionHrvRmssdObservation(observation);
  const companionAdmissionId = createHash("sha256")
    .update(companionObservationJson)
    .digest("hex");

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      companionAdmissionId,
      companionObservationJson,
      resource: COMPANION_HRV_RMSSD_RESOURCE,
      resourceCategory: "derived",
      sourceProviderSlug: "whoop",
    }),
  );

  assert.deepEqual(result, {});
  assert.equal(fetchCalls, 0);
  assert.deepEqual(importedSnapshots, [{
    provider: "junction",
    accountId: `jxn_acct_${createHash("sha256")
      .update(JSON.stringify(["junction-import-account", "junction-user-1"]))
      .digest("hex")
      .slice(0, 32)}`,
    connectionId: "acct-junction-1",
    importedAt: "2026-04-03T00:00:00.000Z",
    companionHrvRmssd: {
      admissionId: companionAdmissionId,
      observation,
    },
  }]);
});

test("Junction companion jobs do not import through a disconnected exact source", async () => {
  let fetchCalls = 0;
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Fenced companion jobs must not call Junction.");
  });
  const hrvObservation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  } satisfies Parameters<typeof serializeCompanionHrvRmssdObservation>[0];
  const hrvJson = serializeCompanionHrvRmssdObservation(hrvObservation);
  const jobs = [
    {
      authoritySourceProviderSlug: "whoop_v2",
      payload: {
        companionAdmissionId: createHash("sha256").update(hrvJson).digest("hex"),
        companionObservationJson: hrvJson,
        resource: COMPANION_HRV_RMSSD_RESOURCE,
        resourceCategory: "derived",
        sourceProviderSlug: "whoop",
      },
    },
    {
      authoritySourceProviderSlug: "apple_health_kit",
      payload: {
        eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
        occurredAt: "2026-04-03T13:00:00.000Z",
        resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
        resourceCategory: "summary",
        sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
        webhookDataJson: JSON.stringify({
          records: [{
            endAt: "2026-04-02T12:00:00-04:00",
            kind: "recovery_score",
            recordId: "a".repeat(64),
            startAt: "2026-04-02T04:00:00-04:00",
            syncVersion: 3,
            value: 72,
          }],
          schemaVersion: 1,
        }),
      },
    },
  ];

  for (const testCase of jobs) {
    const importedSnapshots: unknown[] = [];
    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          sources: [{
            displayName: null,
            firstSeenAt: "2026-04-03T00:00:00.000Z",
            lastDataAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-03T00:00:00.000Z",
            resourceCount: 0,
            sourceProviderSlug: testCase.authoritySourceProviderSlug,
            status: "connected",
          }],
        }),
        listConnectionSources: async () => [{
          displayName: null,
          lastErrorCode: "SOURCE_USER_DISCONNECTED",
          lastErrorMessage: null,
          sourceProviderSlug: testCase.authoritySourceProviderSlug,
          status: "disconnected",
        }],
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", testCase.payload),
    );

    assert.deepEqual(result, {});
    assert.deepEqual(importedSnapshots, []);
  }
  assert.equal(fetchCalls, 0);
});

test("Junction companion import rechecks current source authority at the import boundary", async () => {
  const provider = createJunctionProvider(async () => {
    throw new Error("Companion HRV import must not call Junction.");
  });
  const observation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  } satisfies Parameters<typeof serializeCompanionHrvRmssdObservation>[0];
  const observationJson = serializeCompanionHrvRmssdObservation(observation);
  const job = createJob("resource", {
    companionAdmissionId: createHash("sha256").update(observationJson).digest("hex"),
    companionObservationJson: observationJson,
    resource: COMPANION_HRV_RMSSD_RESOURCE,
    resourceCategory: "derived",
    sourceProviderSlug: "whoop",
  });
  const cachedAccount = createAccount({
    sources: [{
      displayName: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      resourceCount: 0,
      sourceProviderSlug: "whoop_v2",
      status: "connected",
    }],
  });
  let importedCount = 0;
  const connectedSource = {
    displayName: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sourceProviderSlug: "whoop_v2",
    status: "connected" as const,
  };

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: cachedAccount,
        importSnapshot: async () => {
          importedCount += 1;
          return { imported: true };
        },
        listConnectionSources: async () => [{
          ...connectedSource,
          lastErrorCode: "SOURCE_DISCONNECT_IN_PROGRESS",
        }],
      }),
      job,
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_SOURCE_NOT_READY"
      && error.retryable,
  );
  assert.equal(importedCount, 0);

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: cachedAccount,
        importSnapshot: async () => {
          importedCount += 1;
          return { imported: true };
        },
        listConnectionSources: async () => {
          throw new Error("hosted authority unavailable");
        },
      }),
      job,
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_SOURCE_STATE_UNAVAILABLE"
      && error.retryable,
  );
  assert.equal(importedCount, 0);

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: cachedAccount,
      importSnapshot: async () => {
        importedCount += 1;
        return { imported: true };
      },
      listConnectionSources: async () => [connectedSource],
    }),
    job,
  );
  assert.equal(importedCount, 1);
});

test("Junction companion HRV jobs reject malformed derived observations without network access", async () => {
  let fetchCalls = 0;
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Unexpected Junction request.");
  });

  await assert.rejects(
    () => executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        companionObservationJson: JSON.stringify({ rawBleBytes: [1, 2, 3] }),
        resource: COMPANION_HRV_RMSSD_RESOURCE,
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_HRV_OBSERVATION_INVALID",
  );
  assert.equal(fetchCalls, 0);
});

test("Junction companion HRV jobs reject mismatched admission identities without network access", async () => {
  let fetchCalls = 0;
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Unexpected Junction request.");
  });
  const observation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  };

  await assert.rejects(
    () => executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        companionAdmissionId: "f".repeat(64),
        companionObservationJson: JSON.stringify(observation),
        resource: COMPANION_HRV_RMSSD_RESOURCE,
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_HRV_OBSERVATION_INVALID",
  );
  assert.equal(fetchCalls, 0);
});

test("Junction resource jobs import direct daily data webhook payloads without Junction HTTP requests", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "historical.data.activity.created",
      objectId: "activity-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-1",
        memo: "from junction-user-1 payload",
        sourceProviderSlug: "garmin",
        steps: 4321,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
    windowEnd?: string;
    windowStart?: string;
  };
  assert.equal(snapshot.windowStart, "2026-04-01T00:00:00.000Z");
  assert.equal(snapshot.windowEnd, "2026-04-05T00:00:00.000Z");
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 4321);
  assert.equal(snapshot.summaries?.activity?.[0]?.memo, "from [redacted] payload");
  assert.equal(snapshot.summaries?.activity?.[0]?.sourceProviderSlug, "garmin");
  assert.deepEqual(snapshot.timeseries, {});
  assert.doesNotMatch(JSON.stringify(snapshot), /junction-user-1/u);
});

test("Junction imports multiple direct daily payloads via per-job execution without Junction HTTP requests", async () => {
  // Batching was removed (P3); multiple direct webhook records now import as N
  // separate resource jobs, each importing its own payload via executeJob. This
  // guards the data-loss equivalence of that per-job fallback.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const firstJob = createJob("resource", {
    eventType: "daily.data.activity.created",
    objectId: "activity-1",
    occurredAt: "2026-04-02T00:00:00.000Z",
    resource: "activity",
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    webhookDataJson: JSON.stringify({
      date: "2026-04-02",
      id: "activity-1",
      memo: "first from junction-user-1 payload",
      sourceProviderSlug: "garmin",
      steps: 111,
    }),
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-05T00:00:00.000Z",
  });
  const secondJob = createJob("resource", {
    eventType: "daily.data.activity.created",
    objectId: "activity-2",
    occurredAt: "2026-04-02T00:00:00.000Z",
    resource: "activity",
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    webhookDataJson: JSON.stringify({
      date: "2026-04-02",
      id: "activity-2",
      memo: "second from junction-user-1 payload",
      sourceProviderSlug: "garmin",
      steps: 222,
    }),
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-05T00:00:00.000Z",
  });

  await executeJunctionJob(provider, context, firstJob);
  await executeJunctionJob(provider, context, secondJob);

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 2);
  const records = importedSnapshots.flatMap((raw) => {
    const snapshot = raw as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
      windowEnd?: string;
      windowStart?: string;
    };
    assert.equal(snapshot.windowStart, "2026-04-01T00:00:00.000Z");
    assert.equal(snapshot.windowEnd, "2026-04-05T00:00:00.000Z");
    assert.deepEqual(snapshot.timeseries, {});
    assert.doesNotMatch(JSON.stringify(snapshot), /junction-user-1/u);
    return snapshot.summaries?.activity ?? [];
  });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.steps), [111, 222]);
  assert.deepEqual(
    records.map((record) => record.memo),
    ["first from [redacted] payload", "second from [redacted] payload"],
  );
  assert.deepEqual(records.map((record) => record.sourceProviderSlug), ["garmin", "garmin"]);
});

test("Junction resource jobs import direct Garmin sleep webhook payloads without source references", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: [
          {
            average_hrv: 42,
            bedtime_start: "2026-04-02T03:00:00.000Z",
            bedtime_stop: "2026-04-02T11:00:00.000Z",
            deep: 5400,
            duration: 28800,
            efficiency: 0.94,
            hr_average: 54,
            hr_lowest: 43,
            id: "sleep-1",
            light: 12600,
            rem: 7200,
            total: 25200,
          },
        ],
        id: "sleep-webhook-1",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepRecord = snapshot.summaries?.sleep?.[0];
  const sleepData = sleepRecord?.data as Array<Record<string, unknown>> | undefined;
  assert.equal(sleepRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepData?.[0]?.duration, 28800);
  assert.equal(sleepData?.[0]?.total, 25200);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs import direct Garmin sleep webhook object data without source references", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-object-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: {
          average_hrv: 42,
          bedtime_start: "2026-04-02T03:00:00.000Z",
          bedtime_stop: "2026-04-02T11:00:00.000Z",
          deep: 5400,
          duration: 28800,
          efficiency: 0.94,
          hr_average: 54,
          hr_lowest: 43,
          id: "sleep-object-1",
          light: 12600,
          rem: 7200,
          total: 25200,
        },
        id: "sleep-webhook-object-1",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepRecord = snapshot.summaries?.sleep?.[0];
  const sleepData = sleepRecord?.data as Record<string, unknown> | undefined;
  assert.equal(sleepRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepData?.duration, 28800);
  assert.equal(sleepData?.total, 25200);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs resolve direct Garmin sleep provider references before import", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            source: {
              device_id: "garmin-watch-1",
            },
            status: "connected",
            resource_availability: {
              sleep: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      upsertConnectionSource: () => {
        throw new Error("Direct sleep imports should not project Junction source state.");
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-provider-reference-1",
      occurredAt: "2026-04-02T11:00:00.000Z",
      resource: "sleep",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        average_hrv: 42,
        bedtime_start: "2026-04-02T03:00:00.000Z",
        bedtime_stop: "2026-04-02T11:00:00.000Z",
        deep: 5400,
        duration: 28800,
        id: "sleep-provider-reference-1",
        light: 12600,
        provider_connection_id: "provider-garmin-1",
        rem: 7200,
        sourceProviderSlug: "garmin",
        total: 25200,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    connections?: Array<Record<string, unknown>>;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepRecord = snapshot.summaries?.sleep?.[0];
  const sourceInstanceId = snapshot.connections?.[0]?.sourceInstanceId;
  assert.ok(requests.some((url) => url.includes("/v2/user/providers/")));
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep/")), false);
  assert.equal(typeof sourceInstanceId, "string");
  assert.equal(sleepRecord?.sourceInstanceId, sourceInstanceId);
  assert.equal("provider_connection_id" in (sleepRecord ?? {}), false);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs fetch direct Garmin sleep-cycle stage payloads without parent coverage", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "sleep-cycle-fetched-1",
          provider_connection_id: "provider-garmin-1",
          sourceProviderSlug: "garmin",
          start: "2026-04-02T04:45:00.000Z",
          end: "2026-04-02T05:30:00.000Z",
          stages: [
            {
              endAt: "2026-04-02T05:30:00.000Z",
              stage: "deep",
              startAt: "2026-04-02T04:45:00.000Z",
            },
          ],
        }],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep_cycle.created",
      objectId: "sleep-cycle-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep_cycle",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: [
          {
            id: "sleep-cycle-1",
            stages: [
              {
                endAt: "2026-04-02T05:30:00.000Z",
                stage: "deep",
                startAt: "2026-04-02T04:45:00.000Z",
              },
            ],
          },
        ],
        id: "sleep-cycle-webhook-1",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepCycleRecord = snapshot.summaries?.sleep_cycle?.[0];
  const stages = sleepCycleRecord?.stages as Array<Record<string, unknown>> | undefined;
  assert.ok(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")));
  assert.equal(sleepCycleRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepCycleRecord?.id, "sleep-cycle-fetched-1");
  assert.equal(stages?.[0]?.stage, "deep");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs import direct Garmin sleep-cycle stage payloads with parent coverage", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            source: {
              device_id: "garmin-watch-1",
            },
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "sleep-cycle-stale-rest-1",
          sourceProviderSlug: "garmin",
          start: "2026-06-29T04:00:00.000Z",
          end: "2026-06-29T05:00:00.000Z",
          stages: [{
            endAt: "2026-06-29T05:00:00.000Z",
            stage: "awake",
            startAt: "2026-06-29T04:00:00.000Z",
          }],
        }],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });

  const directSleepCycleData = {
    end: "2026-06-30T11:00:00.000Z",
    id: "sleep-cycle-cross-midnight-1",
    provider_connection_id: "provider-garmin-1",
    sourceProviderSlug: "garmin",
    stages: [
      {
        endAt: "2026-06-30T06:30:00.000Z",
        stage: "light",
        startAt: "2026-06-30T03:30:00.000Z",
      },
      {
        endAt: "2026-06-30T11:00:00.000Z",
        stage: "deep",
        startAt: "2026-06-30T06:30:00.000Z",
      },
    ],
    start: "2026-06-30T03:30:00.000Z",
    timeZone: "America/New_York",
  };
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.sleep_cycle.created",
      user_id: "junction-user-1",
      client_user_id: "murph_blinded",
      data: directSleepCycleData,
    },
    messageId: "msg_sleep_cycle_cross_midnight_1",
    timestamp: String(Math.floor(Date.parse("2026-06-30T11:30:00.000Z") / 1000)),
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-06-30T11:31:00.000Z",
  });
  const parsedJob = parsed.jobs[0];
  assert.ok(parsedJob);
  assert.equal(parsedJob.kind, "resource");
  const parsedPayload = parsedJob.payload;
  assert.ok(parsedPayload);
  assert.equal(typeof parsedPayload.webhookDataJson, "string");
  const queuedWebhookData = JSON.parse(String(parsedPayload.webhookDataJson)) as Record<string, unknown>;
  assert.equal(queuedWebhookData.provider_connection_id, "provider-garmin-1");
  assert.equal(JSON.stringify(queuedWebhookData).includes("junction-user-1"), false);
  assert.equal(JSON.stringify(queuedWebhookData).includes("murph_blinded"), false);

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      upsertConnectionSource: () => {
        throw new Error("Direct sleep_cycle imports should not project Junction source state.");
      },
    }),
    createJob(parsedJob.kind, parsedPayload),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    connections?: Array<Record<string, unknown>>;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepCycleRecord = snapshot.summaries?.sleep_cycle?.[0];
  const stages = sleepCycleRecord?.stages as Array<Record<string, unknown>> | undefined;
  const sourceInstanceId = snapshot.connections?.[0]?.sourceInstanceId;
  assert.ok(requests.some((url) => url.includes("/v2/user/providers/")));
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), false);
  assert.equal(typeof sourceInstanceId, "string");
  assert.equal(typeof sourceInstanceId === "string" && sourceInstanceId.startsWith("source-"), true);
  assert.equal(sleepCycleRecord?.sourceInstanceId, sourceInstanceId);
  assert.equal("provider_connection_id" in (sleepCycleRecord ?? {}), false);
  assert.equal(sleepCycleRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepCycleRecord?.id, "sleep-cycle-cross-midnight-1");
  assert.equal(stages?.[0]?.stage, "light");
  assert.equal(stages?.[1]?.stage, "deep");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction direct sleep-cycle payloads without source references import without loading providers", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url.includes("/v2/user/providers/")) {
      throw new Error("Junction provider-list endpoint is unavailable.");
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });

  const directSleepCycleData = {
    end: "2026-06-30T11:00:00.000Z",
    id: "sleep-cycle-no-source-reference-1",
    sourceProviderSlug: "garmin",
    stages: [
      {
        endAt: "2026-06-30T06:30:00.000Z",
        stage: "light",
        startAt: "2026-06-30T03:30:00.000Z",
      },
      {
        endAt: "2026-06-30T11:00:00.000Z",
        stage: "deep",
        startAt: "2026-06-30T06:30:00.000Z",
      },
    ],
    start: "2026-06-30T03:30:00.000Z",
    timeZone: "America/New_York",
  };
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.sleep_cycle.created",
      user_id: "junction-user-1",
      client_user_id: "murph_blinded",
      data: directSleepCycleData,
    },
    messageId: "msg_sleep_cycle_no_source_reference_1",
    timestamp: String(Math.floor(Date.parse("2026-06-30T11:30:00.000Z") / 1000)),
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-06-30T11:31:00.000Z",
  });
  const parsedJob = parsed.jobs[0];
  assert.ok(parsedJob);
  assert.equal(parsedJob.kind, "resource");
  const parsedPayload = parsedJob.payload;
  assert.ok(parsedPayload);

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      upsertConnectionSource: () => {
        throw new Error("Direct sleep_cycle imports should not project Junction source state.");
      },
    }),
    createJob(parsedJob.kind, parsedPayload),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepCycleRecord = snapshot.summaries?.sleep_cycle?.[0];
  const stages = sleepCycleRecord?.stages as Array<Record<string, unknown>> | undefined;
  assert.equal(requests.some((url) => url.includes("/v2/user/providers/")), false);
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), false);
  assert.equal(sleepCycleRecord?.id, "sleep-cycle-no-source-reference-1");
  assert.equal(sleepCycleRecord?.sourceProviderSlug, "garmin");
  assert.equal(stages?.[0]?.stage, "light");
  assert.equal(stages?.[1]?.stage, "deep");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction signed direct sleep-cycle source reference aliases resolve at execution", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            source: {
              device_id: "garmin-watch-1",
            },
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });

  for (const sourceReferenceKey of ["connection_id", "source_id"] as const) {
    const directSleepCycleData: Record<string, unknown> = {
      end: "2026-06-30T11:00:00.000Z",
      id: `sleep-cycle-${sourceReferenceKey}`,
      sourceProviderSlug: "garmin",
      stages: [
        {
          endAt: "2026-06-30T06:30:00.000Z",
          stage: "light",
          startAt: "2026-06-30T03:30:00.000Z",
        },
        {
          endAt: "2026-06-30T11:00:00.000Z",
          stage: "deep",
          startAt: "2026-06-30T06:30:00.000Z",
        },
      ],
      start: "2026-06-30T03:30:00.000Z",
      timeZone: "America/New_York",
      [sourceReferenceKey]: "provider-garmin-1",
    };
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: "daily.data.sleep_cycle.created",
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data: directSleepCycleData,
      },
      messageId: `msg_sleep_cycle_${sourceReferenceKey}`,
      timestamp: String(Math.floor(Date.parse("2026-06-30T11:30:00.000Z") / 1000)),
    });
    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-06-30T11:31:00.000Z",
    });
    const parsedJob = parsed.jobs[0];
    assert.ok(parsedJob);
    assert.equal(parsedJob.kind, "resource");
    const parsedPayload = parsedJob.payload;
    assert.ok(parsedPayload);
    assert.equal(typeof parsedPayload.webhookDataJson, "string");
    const queuedWebhookData = JSON.parse(String(parsedPayload.webhookDataJson)) as Record<string, unknown>;
    assert.equal(queuedWebhookData[sourceReferenceKey], "provider-garmin-1", sourceReferenceKey);
    assert.equal(queuedWebhookData.sourceInstanceId, undefined, sourceReferenceKey);

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
        upsertConnectionSource: () => {
          throw new Error("Direct sleep_cycle imports should not project Junction source state.");
        },
      }),
      createJob(parsedJob.kind, parsedPayload),
    );

    const snapshot = importedSnapshots[importedSnapshots.length - 1] as {
      connections?: Array<Record<string, unknown>>;
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
    } | undefined;
    const sleepCycleRecord = snapshot?.summaries?.sleep_cycle?.[0];
    const sourceInstanceId = snapshot?.connections?.[0]?.sourceInstanceId;
    assert.equal(typeof sourceInstanceId, "string", sourceReferenceKey);
    assert.equal(sleepCycleRecord?.sourceInstanceId, sourceInstanceId, sourceReferenceKey);
    assert.equal(sourceReferenceKey in (sleepCycleRecord ?? {}), false, sourceReferenceKey);
    assert.deepEqual(snapshot?.timeseries, {}, sourceReferenceKey);
  }

  assert.ok(requests.some((url) => url.includes("/v2/user/providers/")));
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), false);
});

test("Junction direct Garmin sleep-cycle payloads without normalizable coverage fall back to fetch", async () => {
  const cases: Array<{ directRecord: Record<string, unknown>; label: string }> = [
    {
      directRecord: {
        data: [
          {
            id: "sleep-cycle-inline-summary-only",
            total: 25200,
          },
        ],
        id: "sleep-cycle-webhook-summary-only",
        sourceProviderSlug: "garmin",
      },
      label: "summary-only",
    },
    {
      directRecord: {
        data: [
          {
            id: "sleep-cycle-inline-stage-count-only",
            stageCount: 4,
          },
        ],
        id: "sleep-cycle-webhook-stage-count-only",
        sourceProviderSlug: "garmin",
      },
      label: "stage-count-only",
    },
    {
      directRecord: {
        data: [
          {
            endAt: "2026-04-02T05:30:00.000Z",
            id: "sleep-cycle-inline-generic-type",
            startAt: "2026-04-02T04:45:00.000Z",
            type: "sleep_cycle",
          },
        ],
        id: "sleep-cycle-webhook-generic-type",
        sourceProviderSlug: "garmin",
      },
      label: "generic-type",
    },
    {
      directRecord: {
        end: "2026-06-30T11:00:00.000Z",
        id: "sleep-cycle-inline-incomplete-parent",
        sourceProviderSlug: "garmin",
        stages: [{
          endAt: "2026-06-30T06:30:00.000Z",
          stage: "light",
          startAt: "2026-06-30T03:30:00.000Z",
        }],
        start: "2026-06-30T03:30:00.000Z",
      },
      label: "incomplete-parent-coverage",
    },
    {
      directRecord: {
        end: "2026-06-30T11:00:00.000Z",
        id: "sleep-cycle-inline-overlapping-parent",
        sourceProviderSlug: "garmin",
        stages: [
          {
            endAt: "2026-06-30T11:00:00.000Z",
            stage: "light",
            startAt: "2026-06-30T03:30:00.000Z",
          },
          {
            endAt: "2026-06-30T07:00:00.000Z",
            stage: "deep",
            startAt: "2026-06-30T06:00:00.000Z",
          },
        ],
        start: "2026-06-30T03:30:00.000Z",
      },
      label: "overlapping-parent-coverage",
    },
    {
      directRecord: {
        data: [
          {
            end: "2026-06-30T11:00:00.000Z",
            id: "sleep-cycle-inline-complete-sibling",
            sourceProviderSlug: "garmin",
            stages: [
              {
                endAt: "2026-06-30T06:30:00.000Z",
                stage: "light",
                startAt: "2026-06-30T03:30:00.000Z",
              },
              {
                endAt: "2026-06-30T11:00:00.000Z",
                stage: "deep",
                startAt: "2026-06-30T06:30:00.000Z",
              },
            ],
            start: "2026-06-30T03:30:00.000Z",
          },
          {
            end: "2026-06-30T11:00:00.000Z",
            id: "sleep-cycle-inline-incomplete-sibling",
            sourceProviderSlug: "garmin",
            stages: [{
              endAt: "2026-06-30T06:30:00.000Z",
              stage: "light",
              startAt: "2026-06-30T03:30:00.000Z",
            }],
            start: "2026-06-30T03:30:00.000Z",
          },
        ],
        id: "sleep-cycle-webhook-mixed-complete-incomplete",
        sourceProviderSlug: "garmin",
      },
      label: "mixed-complete-incomplete-children",
    },
    {
      directRecord: {
        object_id: "sleep-cycle-object-session-only",
        session_end: "2026-06-25T03:00:00.000Z",
        session_start: "2026-06-25T02:00:00.000Z",
        sourceProviderSlug: "garmin",
        stage_end_offset_second: [1800, 3600],
        stage_start_offset_second: [0, 1800],
        stage_type: [2, 1],
      },
      label: "session-offsets-without-normalizer-parent-id",
    },
  ];

  for (const testCase of cases) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                sleep_cycle: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
        return createJsonResponse({
          data: [{
            id: `sleep-cycle-fetched-${testCase.label}`,
            provider_connection_id: "provider-garmin-1",
            sourceProviderSlug: "garmin",
            start: "2026-04-02T04:45:00.000Z",
            end: "2026-04-02T05:30:00.000Z",
            stages: [{
              endAt: "2026-04-02T05:30:00.000Z",
              stage: "deep",
              startAt: "2026-04-02T04:45:00.000Z",
            }],
          }],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["sleep_cycle"],
      timeseriesResources: [],
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", {
        eventType: "daily.data.sleep_cycle.created",
        objectId: `sleep-cycle-${testCase.label}`,
        occurredAt: "2026-04-02T00:00:00.000Z",
        resource: "sleep_cycle",
        resourceCategory: "summary",
        sourceProviderSlug: "garmin",
        webhookDataJson: JSON.stringify(testCase.directRecord),
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-05T00:00:00.000Z",
      }),
    );

    assert.equal(importedSnapshots.length, 1, testCase.label);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
    };
    assert.ok(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), testCase.label);
    assert.equal(snapshot.summaries?.sleep_cycle?.[0]?.id, `sleep-cycle-fetched-${testCase.label}`, testCase.label);
    assert.equal(snapshot.summaries?.sleep_cycle?.[0]?.sourceProviderSlug, "garmin", testCase.label);
    assert.deepEqual(snapshot.timeseries, {}, testCase.label);
  }
});

test("Junction queued large direct resource payloads import inline without REST fallback", async () => {
  // The 64KB inline-payload size cap was removed (P3). A large direct summary
  // payload now imports inline rather than dropping to a REST summary read; the
  // normalizer downstream decides meaning. No Junction HTTP request is made.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "historical.data.activity.created",
      objectId: "activity-queued-oversized",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-inline-large",
        memo: "x".repeat(DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST),
        sourceProviderSlug: "garmin",
        steps: 9999,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 9999);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction accepted inline summaries import before runner resource configuration fallback", async () => {
  for (const testCase of [
    {
      eventType: "daily.data.meal.created",
      label: "no configured event fallback",
    },
    {
      eventType: "daily.data.sleep.created",
      label: "different configured event fallback",
    },
  ]) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    // Model independent Web/runner configuration authorities: Web already
    // admitted a meal carrier, while this runner enables only sleep.
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["sleep"],
      timeseriesResources: [],
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", {
        eventType: testCase.eventType,
        objectId: `meal-${testCase.label}`,
        occurredAt: "2026-04-02T12:00:00.000Z",
        resource: "meal",
        resourceCategory: "summary",
        sourceProviderSlug: "garmin",
        webhookDataJson: JSON.stringify({
          calories: 640,
          date: "2026-04-02",
          id: `meal-inline-${testCase.label}`,
          sourceProviderSlug: "garmin",
        }),
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(requests, [], testCase.label);
    assert.equal(importedSnapshots.length, 1, testCase.label);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
    };
    assert.equal(
      snapshot.summaries?.meal?.[0]?.id,
      `meal-inline-${testCase.label}`,
      testCase.label,
    );
    assert.equal(snapshot.summaries?.sleep, undefined, testCase.label);
  }
});

test("Junction companion health metadata jobs import one closed unverified HealthKit observation batch", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    requests.push(readUrl(input));
    throw new Error("Companion metadata must not call the Junction API.");
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: "2026-04-03T13:00:00.000Z",
      resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            recordId: "a".repeat(64),
            kind: "recovery_score",
            value: 72,
            startAt: "2026-04-02T04:00:00-04:00",
            endAt: "2026-04-02T12:00:00-04:00",
            syncVersion: 3,
          },
          {
            recordId: "b".repeat(64),
            kind: "workout_strain",
            value: 11.3,
            startAt: "2026-04-02T17:00:00-04:00",
            endAt: "2026-04-02T17:45:00-04:00",
            syncVersion: 4,
          },
        ],
      }),
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    connectionId?: string;
    importedAt?: string;
    windowStart?: string;
    windowEnd?: string;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.connectionId, undefined);
  assert.equal(snapshot.importedAt, undefined);
  assert.equal(snapshot.windowStart, "2026-04-02T08:00:00.000Z");
  assert.equal(snapshot.windowEnd, "2026-04-02T21:45:00.000Z");
  assert.deepEqual(snapshot.summaries?.sleep, [{
    id: "a".repeat(64),
    date: "2026-04-02T16:00:00.000Z",
    companionStartAt: "2026-04-02T08:00:00.000Z",
    companionEndAt: "2026-04-02T16:00:00.000Z",
    companionSyncVersion: 3,
    recovery_readiness_score: 72,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "companion-whoop-metadata-unverified",
  }]);
  assert.deepEqual(snapshot.summaries?.activity, [{
    id: "b".repeat(64),
    date: "2026-04-02T21:45:00.000Z",
    companionStartAt: "2026-04-02T21:00:00.000Z",
    companionEndAt: "2026-04-02T21:45:00.000Z",
    companionSyncVersion: 4,
    workout_strain: 11.3,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "companion-whoop-metadata-unverified",
  }]);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction companion health metadata jobs accept exact closed parser boundaries", async () => {
  const importedSnapshots: unknown[] = [];
  const receivedAt = new Date("2026-04-03T13:00:00.000Z");
  const provider = createJunctionProvider(async () => {
    throw new Error("Companion metadata must not call the Junction API.");
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: receivedAt.toISOString(),
      resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            recordId: "c".repeat(64),
            kind: "recovery_score",
            value: 0,
            startAt: new Date(
              receivedAt.getTime() - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
            ).toISOString(),
            endAt: new Date(
              receivedAt.getTime() - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS + 1,
            ).toISOString(),
            syncVersion: Number.MAX_SAFE_INTEGER,
          },
          {
            recordId: "d".repeat(64),
            kind: "workout_strain",
            value: 21,
            startAt: new Date(
              receivedAt.getTime() + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS - 1,
            ).toISOString(),
            endAt: new Date(
              receivedAt.getTime() + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
            ).toISOString(),
            syncVersion: 0,
          },
        ],
      }),
    }),
  );

  assert.equal(importedSnapshots.length, 1);
});

test("Junction companion health metadata jobs reject malformed or broadened batches", async () => {
  const record = {
    recordId: "a".repeat(64),
    kind: "recovery_score",
    value: 72,
    startAt: "2026-04-02T08:00:00.000Z",
    endAt: "2026-04-02T16:00:00.000Z",
    syncVersion: 1,
  };
  const cases: Array<{ label: string; payload: Record<string, unknown> }> = [
    {
      label: "wrong event type",
      payload: { eventType: "daily.data.sleep.created" },
    },
    {
      label: "wrong resource category",
      payload: { resourceCategory: "timeseries" },
    },
    {
      label: "wrong transport source",
      payload: { sourceProviderSlug: "whoop" },
    },
    {
      label: "unsupported schema version",
      payload: {
        webhookDataJson: JSON.stringify({ schemaVersion: 2, records: [record] }),
      },
    },
    {
      label: "empty batch",
      payload: {
        webhookDataJson: JSON.stringify({ schemaVersion: 1, records: [] }),
      },
    },
    {
      label: "too many records",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: Array.from(
            { length: JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS + 1 },
            () => record,
          ),
        }),
      },
    },
    {
      label: "malformed record identity",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, recordId: "not-a-hash" }],
        }),
      },
    },
    {
      label: "unknown record kind",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, kind: "sleep_stage" }],
        }),
      },
    },
    {
      label: "out-of-range value",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, value: 101 }],
        }),
      },
    },
    {
      label: "unexpected record field",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, arbitraryMetric: 1 }],
        }),
      },
    },
    {
      label: "unexpected batch field",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [record],
          arbitraryMetric: 1,
        }),
      },
    },
    {
      label: "invalid interval",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, endAt: record.startAt }],
        }),
      },
    },
    {
      label: "non-ISO timestamp",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, startAt: "April 2, 2026 08:00:00 UTC" }],
        }),
      },
    },
    {
      label: "missing receipt timestamp",
      payload: { occurredAt: undefined },
    },
    {
      label: "history older than the server horizon",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{
            ...record,
            startAt: "2025-04-01T08:00:00.000Z",
            endAt: "2025-04-01T16:00:00.000Z",
          }],
        }),
      },
    },
    {
      label: "timestamp beyond the future skew",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{
            ...record,
            startAt: "2026-04-04T12:30:00.000Z",
            endAt: "2026-04-04T13:00:00.001Z",
          }],
        }),
      },
    },
    {
      label: "missing sync version",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, syncVersion: undefined }],
        }),
      },
    },
    {
      label: "invalid sync version",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, syncVersion: -1 }],
        }),
      },
    },
    {
      label: "duplicate record identity",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [record, record],
        }),
      },
    },
    {
      label: "oversized batch",
      payload: {
        webhookDataJson: "x".repeat(JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES + 1),
      },
    },
  ];

  for (const testCase of cases) {
    let imported = false;
    const provider = createJunctionProvider(async () => {
      throw new Error("Invalid companion metadata must not call the Junction API.");
    });
    const payload = {
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: "2026-04-03T13:00:00.000Z",
      resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: JSON.stringify({ schemaVersion: 1, records: [record] }),
      ...testCase.payload,
    };

    await assert.rejects(
      executeJunctionJob(
        provider,
        createJunctionJobContext({
          importSnapshot: async () => {
            imported = true;
            return { imported: true };
          },
        }),
        createJob("resource", payload),
      ),
      (error: unknown) => error instanceof DeviceSyncError
        && error.code === "DEVICE_SYNC_JOB_PAYLOAD_INVALID"
        && error.retryable === false,
      testCase.label,
    );
    assert.equal(imported, false, testCase.label);
  }
});

test("Junction direct resource jobs import the payload under its own resolved source provenance", async () => {
  // The usefulness gate (which also enforced job-tag/record-source equality)
  // was removed in P3. A self-consistent payload imports inline under its own
  // resolved source provenance, even when the routing job tag differs. The
  // record's source is single and unambiguous; the merge keys on the record's
  // own resourceId, so importing it inline is additive and overlap-free.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "activity-source-mismatch",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-inline-source-mismatch",
        sourceProviderSlug: "fitbit",
        steps: 9999,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 9999);
  assert.equal(snapshot.summaries?.activity?.[0]?.sourceProviderSlug, "fitbit");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction direct resource jobs fall back when payload source is missing or ambiguous", async () => {
  const cases: Array<{
    label: string;
    directRecord: Record<string, unknown>;
    restSteps: number;
  }> = [
    {
      label: "missing-source",
      directRecord: {
        date: "2026-04-02",
        id: "activity-inline-missing-source",
        steps: 9999,
      },
      restSteps: 2222,
    },
    {
      label: "ambiguous-source",
      directRecord: {
        data: [
          {
            sourceProviderSlug: "fitbit",
            steps: 9999,
          },
        ],
        date: "2026-04-02",
        id: "activity-inline-ambiguous-source",
        sourceProviderSlug: "garmin",
      },
      restSteps: 3333,
    },
    {
      label: "records-source-mismatch",
      directRecord: {
        date: "2026-04-02",
        id: "activity-inline-records-source-mismatch",
        records: [
          {
            sourceProviderSlug: "fitbit",
            steps: 9999,
          },
        ],
        sourceProviderSlug: "garmin",
      },
      restSteps: 4444,
    },
  ];

  for (const testCase of cases) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                activity: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({
          data: [
            {
              date: "2026-04-02",
              id: `activity-rest-${testCase.label}`,
              provider_connection_id: "provider-garmin-1",
              steps: testCase.restSteps,
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["activity"],
      timeseriesResources: [],
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", {
        eventType: "daily.data.activity.created",
        objectId: `activity-${testCase.label}`,
        occurredAt: "2026-04-02T00:00:00.000Z",
        resource: "activity",
        resourceCategory: "summary",
        sourceProviderSlug: "garmin",
        webhookDataJson: JSON.stringify(testCase.directRecord),
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-05T00:00:00.000Z",
      }),
    );

    assert.equal(
      requests.some((url) => url.includes("/v2/summary/activity/")),
      true,
      testCase.label,
    );
    assert.equal(importedSnapshots.length, 1, testCase.label);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
    };
    assert.equal(snapshot.summaries?.activity?.[0]?.steps, testCase.restSteps, testCase.label);
    assert.notEqual(snapshot.summaries?.activity?.[0]?.steps, 9999, testCase.label);
    assert.deepEqual(snapshot.timeseries, {}, testCase.label);
  }
});

test("Junction imports a metric-free direct payload inline once the usefulness gate is removed", async () => {
  // The usefulness gate was removed in P3: a configured summary payload with a
  // single, consistent source provider imports inline even when it carries no
  // recognized metric fields (e.g. an identifier-only record). The downstream
  // normalizer decides meaning, as it already does for fetched records. No REST
  // fallback fires.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "activity-identifier-only",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-inline-identifier-only",
        resource: "activity",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.id, "activity-inline-identifier-only");
  assert.equal(snapshot.summaries?.activity?.[0]?.sourceProviderSlug, "garmin");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction large daily summary webhook payloads import inline without REST fallback", async () => {
  // The 64KB inline-payload size cap was removed in P3. A large daily summary
  // webhook now attaches its inline payload to the resource job and imports it
  // inline instead of stripping `webhookDataJson` and falling back to REST.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      user_id: "junction-user-1",
      data: {
        end_date: "2026-04-02",
        date: "2026-04-02",
        id: "activity-inline-large",
        memo: "x".repeat(DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST),
        source: {
          provider: "garmin",
          type: "watch",
        },
        start_date: "2026-04-02",
        steps: 9999,
        user_id: "junction-user-1",
      },
    },
    messageId: "msg_large_activity_payload_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.acceptanceMode, "durable_webhook_work");
  assert.equal(parsed.jobs[0]?.kind, "resource");
  assert.equal("webhookDataJson" in (parsed.jobs[0]?.payload ?? {}), true);
  assert.equal(parsed.jobs[0]?.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(parsed.jobs[0]?.payload?.windowEnd, "2026-04-03T00:00:00.000Z");

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", parsed.jobs[0]?.payload ?? {}),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 9999);
  assert.deepEqual(snapshot.timeseries, {});
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /junction-user-1/u);
  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
  );
});

test("Junction nested compact timeseries webhooks use sample timestamps for stable jobs", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    webhookTimestampToleranceMs: 3 * 24 * 60 * 60_000,
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      user_id: "junction-user-1",
      data: {
        data: [
          {
            end: "2026-04-02T14:30:00.000Z",
            start: "2026-04-02T14:00:00.000Z",
            unit: "%",
            value: 97,
          },
        ],
        source: {
          provider: "garmin",
          type: "watch",
        },
      },
    },
    messageId: "msg_blood_oxygen_stable_nested_payload_1",
    timestamp: "1775174400",
  });

  const firstParse = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const secondParse = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-04T00:00:00.000Z",
  });

  assert.equal(firstParse.jobs[0]?.dedupeKey, secondParse.jobs[0]?.dedupeKey);
  assert.equal(firstParse.providerSentAt, "2026-04-03T00:00:00.000Z");
  assert.equal(firstParse.jobs[0]?.payload?.occurredAt, "2026-04-02T14:30:00.000Z");
  assert.equal(firstParse.jobs[0]?.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(firstParse.jobs[0]?.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
  assert.equal("webhookDataJson" in (firstParse.jobs[0]?.payload ?? {}), false);
});

test("Junction signed daily timeseries webhooks omit direct sample payload jobs", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      user_id: "junction-user-1",
      data: {
        data: [
          {
            end: "2026-04-02T14:30:00.000Z",
            start: "2026-04-02T14:00:00.000Z",
            unit: "%",
            value: 97,
          },
        ],
        source: {
          provider: "garmin",
          type: "watch",
        },
        user_id: "junction-user-1",
      },
    },
    messageId: "msg_blood_oxygen_payload_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0]?.kind, "resource");
  assert.equal("webhookDataJson" in (parsed.jobs[0]?.payload ?? {}), false);
  assert.equal(parsed.jobs[0]?.payload?.resource, "blood_oxygen");
  assert.equal(parsed.jobs[0]?.payload?.resourceCategory, "timeseries");
});

test("Junction legacy direct dense timeseries payload jobs do not import queued samples", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        assert.deepEqual(requests, []);
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("resource", {
      eventType: "daily.data.steps.created",
      objectId: "steps-1",
      occurredAt: "2026-04-02T14:00:00.000Z",
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: [
          {
            end: "2026-04-02T14:30:00.000Z",
            start: "2026-04-02T14:00:00.000Z",
            unit: "count",
            value: 321,
          },
        ],
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.deepEqual(importedSnapshots, []);
  assert.equal(warnings[0]?.resource, "steps");
  assert.equal(warnings[0]?.resourceCategory, "timeseries");
});

test("Junction legacy direct compact timeseries payloads fetch instead of importing queued samples", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{ timestamp: "2026-04-02T14:00:00.000Z", unit: "%", value: 97 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.blood_oxygen.created",
      objectId: "blood-oxygen-group-source-mismatch",
      occurredAt: "2026-04-02T14:00:00.000Z",
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        groups: {
          fitbit: [{
            data: [{ timestamp: "2026-04-02T14:00:00.000Z", unit: "%", value: 9999 }],
            source: { provider: "fitbit", type: "watch" },
          }],
        },
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), true);
  assert.equal(importedSnapshots.length, 1);
  assert.match(JSON.stringify(importedSnapshots), /97/u);
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /9999/u);
});

test("Junction does not chunk oversized daily timeseries webhook samples into durable jobs", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const samples = Array.from({ length: 48 }, (_, index) => ({
    end: `2026-04-02T${String(index % 24).padStart(2, "0")}:30:00.000Z`,
    sampleMemo: "x".repeat(2048),
    start: `2026-04-02T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    unit: "%",
    value: 90 + (index % 10),
  }));
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      user_id: "junction-user-1",
      data: {
        data: samples,
        source: {
          provider: "garmin",
          type: "watch",
        },
        user_id: "junction-user-1",
      },
    },
    messageId: "msg_large_blood_oxygen_payload_1",
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.acceptanceMode, "durable_webhook_work");
  assert.equal(parsed.jobs.every((job) => job.kind === "resource"), true);
  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0]?.payload?.resource, "blood_oxygen");
  assert.equal(parsed.jobs[0]?.payload?.resourceCategory, "timeseries");
  assert.equal("webhookDataJson" in (parsed.jobs[0]?.payload ?? {}), false);
  assert.doesNotMatch(JSON.stringify(parsed.jobs), /sampleMemo|junction-user-1/u);
});

test("Junction timeseries optional later chunk preserves earlier chunk records", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  let timeseriesRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      timeseriesRequests += 1;
      if (timeseriesRequests === 1) {
        return createJsonResponse({
          groups: {
            oura: [{
              data: [{ timestamp: "2026-04-01T12:00:00Z", unit: "%", value: 97 }],
              source: { provider: "oura", type: "ring" },
            }],
          },
        });
      }

      return createJsonResponse({ error: "unsupported_resource" }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "oura",
      displayName: null,
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {
      warn(_message, context) {
        warnings.push(context ?? {});
      },
    },
  };

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "daily.data.blood_oxygen.created",
      objectId: "blood-oxygen-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "blood_oxygen",
      sourceProviderSlug: "oura",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(timeseriesRequests, 2);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    timeseries?: Record<string, unknown[]>;
    windowEnd?: string;
    windowStart?: string;
  };
  assert.equal(snapshot.windowStart, "2026-04-01T00:00:00.000Z");
  assert.equal(snapshot.windowEnd, "2026-04-02T00:00:00.000Z");
  assert.equal(snapshot.timeseries?.blood_oxygen?.length, 1);
  assert.deepEqual(warnings.map((warning) => ({
    reason: warning.reason,
    resource: warning.resource,
    resourceCategory: warning.resourceCategory,
    responseStatus: warning.responseStatus,
  })), [
    {
      reason: "unsupported",
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      responseStatus: 422,
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 0,
    junctionSkippedTimeseriesTotal: 1,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "timeseries.blood_oxygen.422.unsupported",
    junctionSkippedResourceLastDetail: null,
  });
});

test("Junction timeseries ambiguous later chunk preserves fetched data and skips the rest", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  let timeseriesRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      timeseriesRequests += 1;
      if (timeseriesRequests === 1) {
        return createJsonResponse({
          groups: {
            oura: [{
              data: [{ timestamp: "2026-04-01T12:00:00Z", unit: "%", value: 97 }],
              source: { provider: "oura", type: "ring" },
            }],
          },
        });
      }

      return createJsonResponse({
        code: "invalid_request",
        message: "The date window is invalid for this request.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("resource", {
      eventType: "daily.data.blood_oxygen.created",
      objectId: "blood-oxygen-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "blood_oxygen",
      sourceProviderSlug: "oura",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(timeseriesRequests, 2);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, unknown[]> };
  assert.equal(snapshot.timeseries?.blood_oxygen?.length, 1);
  assert.deepEqual(warnings, [
    {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      reason: "ambiguous",
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      responseStatus: 422,
      responseDetail: "invalid_request: The date window is invalid for this request.",
    },
  ]);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLast, "timeseries.blood_oxygen.422.ambiguous");
  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "invalid_request: The date window is invalid for this request.",
  );
});

test("Junction resource jobs fetch only the hinted resource window", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 1200 }] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring",
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "historical.data.activity.created",
      objectId: "activity-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "oura",
      windowStart: "2026-04-01T06:07:08.000Z",
      windowEnd: "2026-04-03T09:10:11.000Z",
    }),
  );

  assert.equal(requests.filter((url) => url.includes("/v2/summary/activity/")).length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction resource job should fetch the hinted summary resource.",
  );
  assert.equal(new URL(summaryRequest).searchParams.get("provider"), "oura");
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-04-01T06:07:08.000Z",
    "2026-04-03T09:10:11.000Z",
  );
  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), false);
  assert.equal(importedSnapshots.length, 1);
  assert.match(JSON.stringify(importedSnapshots[0]), /"activity"/u);
});

test("Junction resource jobs skip unsupported glucose when it is not configured", async () => {
  const requests: string[] = [];
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "dexcom_v3",
            name: "Dexcom",
            status: "connected",
            resource_availability: {
              glucose: true,
            },
          },
        ],
      });
    }

    if (url.includes("glucose")) {
      throw new Error(`Unexpected glucose request: ${url}`);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "dexcom_v3",
      displayName: null,
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {
      warn(_message, context) {
        warnings.push(context ?? {});
      },
    },
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "daily.data.glucose.created",
      objectId: "glucose-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "glucose",
      sourceProviderSlug: "dexcom_v3",
      webhookDataJson: JSON.stringify({
        data: [{ timestamp: "2026-04-02T00:00:00.000Z", value: 101 }],
        sourceProviderSlug: "dexcom_v3",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.filter((url) => url.includes("glucose")).length, 0);
  assert.deepEqual(importedSnapshots, []);
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /101/u);
  assert.equal(warnings[0]?.resource, "glucose");
  assert.equal(warnings[0]?.resourceCategory, "timeseries");
});

test("Junction provider accepts glucose timeseries configuration", () => {
  assert.doesNotThrow(() => createJunctionProvider(async () => createJsonResponse({}), {
    timeseriesResources: ["glucose"],
  }));
});

test("Junction provider rejects unsupported configured resources", () => {
  assert.doesNotThrow(() => createJunctionProvider(async () => createJsonResponse({}), {
    summaryResources: ["meal", "menstrual_cycle", "electrocardiogram", "profile"],
  }));
  assert.throws(
    () => createJunctionProvider(async () => createJsonResponse({}), {
      summaryResources: ["clinical_note"],
    }),
    /Junction summary resources include unsupported resource\(s\): clinical_note\./u,
  );
  assert.throws(
    () => createJunctionProvider(async () => createJsonResponse({}), {
      timeseriesResources: [
        "electrocardiogram_voltage",
        "workout_distance",
        "workout_swimming_stroke",
      ],
    }),
    /Junction timeseries resources include unsupported resource\(s\): electrocardiogram_voltage, workout_distance, workout_swimming_stroke\./u,
  );
});

test("Junction resource job with a hijacked resource name falls back to the event-type resource fetch", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(
    async (input) => {
      const url = readUrl(input);
      requests.push(url);
      if (url.includes("/v2/summary/sleep/junction-user-1")) {
        return createJsonResponse({
          data: [{ id: "sleep-1", date: "2026-04-02", source: { provider: "whoop_v2" } }],
        });
      }
      if (url.includes("/v2/user/providers/junction-user-1")) {
        return createJsonResponse({ providers: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    { summaryResources: ["activity", "sleep"], timeseriesResources: [] },
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ nextReconcileAt: "2026-04-03T00:30:00.000Z" }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep_v2",
      resourceCategory: "summary",
      sourceProviderSlug: "whoop_v2",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.ok(
    requests.some((url) => url.includes("/v2/summary/sleep/junction-user-1")),
    `hijacked sleep job should fetch the event-type resource; requests=${JSON.stringify(requests)}`,
  );
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    result.nextReconcileAt,
    "2026-04-03T00:30:00.000Z",
    "webhook job completion must preserve an earlier scheduled reconcile",
  );
});

test("Junction resource job with an unresolvable resource records an observable skip and preserves the reconcile schedule", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ nextReconcileAt: "2026-04-03T00:30:00.000Z" }),
    }),
    createJob("resource", {
      eventType: "provider.connection.updated",
      resource: "mystery_records",
      resourceCategory: "summary",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.nextReconcileAt, "2026-04-03T00:30:00.000Z");
  const metadataPatch = result.metadataPatch ?? {};
  assert.equal(metadataPatch.junctionSkippedResourceLast, "summary.mystery_records.0.unsupported");
  assert.equal(metadataPatch.junctionSkippedResourceJobCount, 1);
});

test("Junction import accountId is stable across local account row re-registration", async () => {
  const importedAccountIds: string[] = [];
  const provider = createEmptyJunctionBackfillProvider();

  const runReconcileWithAccountRowId = async (rowId: string) => {
    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ id: rowId }),
        importSnapshot: async (snapshot) => {
          const accountId = (snapshot as { accountId?: string }).accountId;
          if (accountId) {
            importedAccountIds.push(accountId);
          }
          return { imported: true };
        },
      }),
      createJob("reconcile", {
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );
  };

  // Hosted cold starts recreate the machine-local device-sync store, so the
  // same Junction user is re-registered under a fresh local row id. Import
  // identity must follow the stable Junction user, not the local row.
  await runReconcileWithAccountRowId("dsa_cold_start_row_a");
  await runReconcileWithAccountRowId("dsa_cold_start_row_b");

  assert.ok(importedAccountIds.length >= 2, "expected reconcile runs to import snapshots");
  assert.match(importedAccountIds[0] ?? "", /^jxn_acct_[a-f0-9]{32}$/u);
  assert.equal(new Set(importedAccountIds).size, 1);
});

test("Junction client fetches an exact workout stream with bounded bytes and three GET attempts", async () => {
  const requests: string[] = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input) => {
      requests.push(readUrl(input));
      return createJsonResponse({ distance: [0, 1_000], time: [1_776_859_200, 1_776_859_260] });
    },
  });

  assert.deepEqual(await client.getWorkoutStream("workout/id 1"), {
    distance: [0, 1_000],
    time: [1_776_859_200, 1_776_859_260],
  });
  assert.deepEqual(requests, [
    "https://api.sandbox.us.junction.com/v2/timeseries/workouts/workout%2Fid%201/stream",
  ]);

  let oversizedAttempts = 0;
  const oversizedClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      oversizedAttempts += 1;
      return new Response("{}", {
        headers: { "content-length": String(JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES + 1) },
      });
    },
  });
  await assert.rejects(
    () => oversizedClient.getWorkoutStream("workout-over-limit"),
    (error: unknown) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_WORKOUT_STREAM_RESPONSE_LIMIT"
      && error.retryable === false,
  );
  assert.equal(oversizedAttempts, 1);

  let streamedOversizedAttempts = 0;
  const streamedOversizedClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      streamedOversizedAttempts += 1;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }));
    },
  });
  await assert.rejects(
    () => streamedOversizedClient.getWorkoutStream("workout-streamed-over-limit"),
    (error: unknown) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_WORKOUT_STREAM_RESPONSE_LIMIT"
      && error.retryable === false,
  );
  assert.equal(streamedOversizedAttempts, 1);

  let retryAttempts = 0;
  const retryClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      retryAttempts += 1;
      return createJsonResponse({ detail: "temporary" }, 503);
    },
  });
  await assert.rejects(() => retryClient.getWorkoutStream("workout-retry-limit"));
  assert.equal(retryAttempts, 3);
});

test("Junction shallow workout stream webhook imports only a bounded feature envelope", async () => {
  const requests: string[] = [];
  const importedSnapshots: Array<Record<string, unknown>> = [];
  const localAuthorityCheckPhases: string[] = [];
  let streamFetched = false;
  let sourceCatalogMutations = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-synthetic",
          slug: "garmin",
          status: "connected",
          source: { device_id: "device-synthetic-1" },
          resource_availability: { workouts: true },
        }],
      });
    }
    if (url === "https://api.sandbox.us.junction.com/v2/timeseries/workouts/workout-stream-1/stream") {
      streamFetched = true;
      return createJsonResponse({
        altitude: [10, 11, 12],
        cadence: [80, 82, 84],
        distance: [0, 500, 1_000],
        heartrate: [120, 130, 140],
        lat: [40, 40.001, 40.002],
        lng: [-73, -73.001, -73.002],
        power: [180, 200, 220],
        time: [1_776_859_200, 1_776_859_210, 1_776_859_220],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.workout_stream.created",
      user_id: "junction-user-1",
      data: {
        message: "Workout stream is ready.",
        workout_id: "workout-stream-1",
        source_id: "source-synthetic-1",
        source: { provider: "garmin", type: "watch" },
        sport: { slug: "running" },
      },
    },
    messageId: "msg_workout_stream_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const job = requireValue(parsed.jobs[0], "Workout stream webhook should enqueue one resource job.");
  const jobPayload = job.payload ?? {};
  const account = createAccount({
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastDataAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      resourceCount: 1,
      resourceAvailabilitySummary: { workouts: true },
      sourceProviderSlug: "garmin",
      status: "connected" as const,
    }],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      listConnectionSources: async () => {
        localAuthorityCheckPhases.push(streamFetched ? "after-fetch" : "before-fetch");
        return account.sources ?? [];
      },
      upsertConnectionSource: (input) => {
        sourceCatalogMutations += 1;
        return createConnectionSource(input);
      },
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot as Record<string, unknown>);
        return { imported: true };
      },
    }),
    createJob(job.kind, jobPayload),
  );

  assert.equal(jobPayload.objectId, "workout-stream-1");
  assert.equal(jobPayload.resource, "workout_stream");
  assert.equal(jobPayload.resourceCategory, "timeseries");
  assert.equal(job.maxAttempts, 1);
  assert.equal(jobPayload.sourceInstanceId, "source-774aa2ab0133069118cf5c1e");
  assert.equal(jobPayload.sourceType, "watch");
  assert.equal(jobPayload.sport, "running");
  assert.equal(Object.hasOwn(jobPayload, "webhookDataJson"), false);
  assert.equal(
    requests.filter((url) => url.includes("/v2/timeseries/workouts/workout-stream-1/stream")).length,
    1,
  );
  assert.equal(requests.some((url) => url.includes("/v2/summary/workout_stream/")), false);
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(localAuthorityCheckPhases, ["before-fetch", "after-fetch"]);
  assert.equal(sourceCatalogMutations, 0);
  const importedConnections = importedSnapshots[0]?.connections as Array<Record<string, unknown>> | undefined;
  const importedWorkoutFeatures = importedSnapshots[0]?.workoutFeatures as Array<Record<string, unknown>> | undefined;
  assert.equal(importedWorkoutFeatures?.[0]?.sourceUpdatedAt, "2026-04-03T00:00:00.000Z");
  assert.equal(importedWorkoutFeatures?.[0]?.sourceInstanceId, importedConnections?.[0]?.sourceInstanceId);
  assert.notEqual(importedWorkoutFeatures?.[0]?.sourceInstanceId, jobPayload.sourceInstanceId);
  const importedText = JSON.stringify(importedSnapshots[0]);
  assert.match(importedText, /junction\.workout_features\.v1/u);
  assert.doesNotMatch(importedText, /"lat"|"lng"|"time"\s*:\s*\[|"cadence"\s*:\s*\[/u);

  const updatedWebhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.workout_stream.updated",
      user_id: "junction-user-1",
      data: {
        workout_id: "workout-stream-1",
        source: { provider: "garmin", type: "watch" },
        sport: { slug: "running" },
      },
    },
    messageId: "msg_workout_stream_1_updated",
    timestamp: "1775174401",
  });
  const parsedUpdate = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: updatedWebhook.headers,
    rawBody: updatedWebhook.rawBody,
    now: "2026-04-03T00:00:01.000Z",
  });
  assert.equal(parsedUpdate.jobs[0]?.maxAttempts, 1);
  assert.notEqual(parsedUpdate.jobs[0]?.dedupeKey, job.dedupeKey);
});

test("Junction workout stream rejects shallow-source mismatch before import", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url.endsWith("/v2/user/providers/junction-user-1")) {
      return createJsonResponse({ providers: [{
        id: "provider-garmin-mismatch",
        slug: "garmin",
        status: "connected",
        resource_availability: { workouts: true },
      }] });
    }
    if (url.endsWith("/v2/timeseries/workouts/workout-source-mismatch/stream")) {
      return createJsonResponse({
        distance: [0, 1_000],
        source: { provider: "fitbit", type: "watch" },
        time: [1_776_859_200, 1_776_859_260],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const account = createAccount({ sources: [{
    displayName: "Garmin",
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    resourceCount: 1,
    resourceAvailabilitySummary: { workouts: true },
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }] });

  await assert.rejects(
    () => executeJunctionJob(
      provider,
      createJunctionJobContext({
        account,
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", {
        objectId: "workout-source-mismatch",
        resource: "workout_stream",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    ),
    (error: unknown) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_WORKOUT_STREAM_SOURCE_MISMATCH"
      && error.retryable === false,
  );
  assert.deepEqual(requests.map((url) => new URL(url).pathname), [
    "/v2/user/providers/junction-user-1",
    "/v2/timeseries/workouts/workout-source-mismatch/stream",
  ]);
  assert.equal(importedSnapshots.length, 0);
});

test("Junction workout stream fences an import when its source disconnects after fetch", async () => {
  const requests: string[] = [];
  const projectedStatuses: string[] = [];
  const importedSnapshots: unknown[] = [];
  let providerListCount = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url.endsWith("/v2/user/providers/junction-user-1")) {
      providerListCount += 1;
      return createJsonResponse({ providers: [{
        id: "provider-garmin-revoked",
        slug: "garmin",
        status: providerListCount === 1 ? "connected" : "disconnected",
        resource_availability: { workouts: true },
      }] });
    }
    if (url.endsWith("/v2/timeseries/workouts/workout-post-fetch-revoked/stream")) {
      return createJsonResponse({
        distance: [0, 1_000],
        time: [1_776_859_200, 1_776_859_260],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const account = createAccount({ sources: [{
    displayName: "Garmin",
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    resourceCount: 1,
    resourceAvailabilitySummary: { workouts: true },
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }] });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      upsertConnectionSource: (input) => {
        projectedStatuses.push(input.status);
        return createConnectionSource({
          status: input.status,
          lastSeenAt: input.lastSeenAt,
        });
      },
    }),
    createJob("resource", {
      objectId: "workout-post-fetch-revoked",
      resource: "workout_stream",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result, {});
  assert.deepEqual(requests.map((url) => new URL(url).pathname), [
    "/v2/user/providers/junction-user-1",
    "/v2/timeseries/workouts/workout-post-fetch-revoked/stream",
    "/v2/user/providers/junction-user-1",
  ]);
  assert.deepEqual(projectedStatuses, []);
  assert.equal(importedSnapshots.length, 0);
});

test("Junction source-less workout stream uses fetched identity for final local authority", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const localAuthorityCheckPhases: string[] = [];
  let streamFetched = false;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url.endsWith("/v2/user/providers/junction-user-1")) {
      return createJsonResponse({ providers: [{
        id: "provider-garmin-locally-revoked",
        slug: "garmin",
        status: "connected",
        resource_availability: { workouts: true },
      }] });
    }
    if (url.endsWith("/v2/timeseries/workouts/workout-locally-revoked/stream")) {
      streamFetched = true;
      return createJsonResponse({
        distance: [0, 1_000],
        source: { provider: "garmin", type: "watch" },
        time: [1_776_859_200, 1_776_859_260],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const account = createAccount({ sources: [{
    displayName: "Garmin",
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    resourceCount: 1,
    resourceAvailabilitySummary: { workouts: true },
    sourceProviderSlug: "garmin",
    status: "disconnected" as const,
  }] });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      listConnectionSources: async () => {
        localAuthorityCheckPhases.push(streamFetched ? "after-fetch" : "before-fetch");
        return [createConnectionSource({
          sourceProviderSlug: "garmin",
          status: "disconnected",
          lastErrorCode: DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
        })];
      },
    }),
    createJob("resource", {
      objectId: "workout-locally-revoked",
      resource: "workout_stream",
      resourceCategory: "timeseries",
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result, {});
  assert.deepEqual(localAuthorityCheckPhases, ["after-fetch"]);
  assert.deepEqual(requests.map((url) => new URL(url).pathname), [
    "/v2/timeseries/workouts/workout-locally-revoked/stream",
    "/v2/user/providers/junction-user-1",
  ]);
  assert.equal(importedSnapshots.length, 0);
});

test("Junction rejects a shallow workout stream webhook without workout_id before any fetch", async () => {
  let fetched = false;
  const provider = createJunctionProvider(async () => {
    fetched = true;
    return createJsonResponse({});
  }, {
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.workout_stream.created",
      user_id: "junction-user-1",
      data: {
        source: { provider: "garmin", type: "watch" },
      },
    },
    messageId: "msg_workout_stream_missing_id",
    timestamp: "1775174400",
  });

  await assert.rejects(
    () => requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error: unknown) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_WORKOUT_STREAM_WEBHOOK_INVALID"
      && error.retryable === false,
  );
  assert.equal(fetched, false);
});

test("Junction sparse-history scheduling caps global fanout and rotates across every pair", () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      reconcileIntervalMs: 60 * 60_000,
      timeseriesResources: [...JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES],
    },
  );
  const executor = requireValue(provider.jobExecutor);
  const availability = Object.fromEntries(
    JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES.map((resource) => [resource, true]),
  );
  const sources = JUNCTION_CONNECT_SOURCE_TARGETS.map((target) => ({
    sourceProviderSlug: target.providerSlug,
    displayName: null,
    status: "connected" as const,
    resourceCount: JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES.length,
    resourceAvailabilitySummary: availability,
    lastErrorCode: null,
    lastErrorMessage: null,
    firstSeenAt: "2026-04-03T00:00:00.000Z",
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    lastDataAt: null,
  }));
  const account = createStoredAccount({ sources });
  const observedPairs = new Set<string>();
  const candidateCount =
    JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES.length * sources.length;
  const pageCount = Math.ceil(candidateCount / 8);
  const baseAt = Date.parse("2026-08-11T00:00:00.000Z");
  const scheduledPageSizes: number[] = [];

  for (let offset = 0; offset < pageCount; offset += 1) {
    const now = new Date(baseAt + offset * 60 * 60_000).toISOString();
    const scheduled = executor.createScheduledJobs?.(account, now);
    const historyJobs = (scheduled?.jobs ?? []).filter((job) =>
      job.kind === "resource" && job.payload?.historicalBackfill === true
    );
    scheduledPageSizes.push(historyJobs.length);
    assert.ok(historyJobs.length <= 8);
    for (const job of historyJobs) {
      observedPairs.add(`${job.payload?.resource}:${job.payload?.sourceProviderSlug}`);
    }
  }

  assert.equal(JUNCTION_CONNECT_SOURCE_TARGETS.length, 33);
  assert.equal(candidateCount, 363);
  assert.equal(candidateCount % 8, 3);
  assert.equal(scheduledPageSizes.filter((size) => size === 8).length, pageCount - 1);
  assert.equal(scheduledPageSizes.filter((size) => size === 3).length, 1);
  assert.equal(observedPairs.size, candidateCount);
});

test("Junction sparse-history policy keeps schedule-time retry identity stable across UTC days", () => {
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["blood_pressure", "caffeine"],
    fetchImpl: async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
  });
  const source = {
    sourceProviderSlug: "garmin",
    displayName: null,
    status: "connected" as const,
    resourceCount: 2,
    resourceAvailabilitySummary: { blood_pressure: true, caffeine: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    firstSeenAt: "2026-04-03T12:00:00.000Z",
    lastSeenAt: "2026-08-11T12:00:00.000Z",
    lastDataAt: null,
  };
  const firstJobs = provider.jobExecutor?.createScheduledJobs?.(
    createStoredAccount({ sources: [source] }),
    "2026-08-11T12:00:00.000Z",
  ).jobs ?? [];
  const secondJobs = provider.jobExecutor?.createScheduledJobs?.(
    createStoredAccount({ sources: [source] }),
    "2026-08-12T12:00:00.000Z",
  ).jobs ?? [];
  const bloodPressure = requireValue(firstJobs.find((job) =>
    job.payload?.resource === "blood_pressure"
  ));
  const secondBloodPressure = requireValue(secondJobs.find((job) =>
    job.payload?.resource === "blood_pressure"
  ));
  const caffeine = requireValue(firstJobs.find((job) => job.payload?.resource === "caffeine"));
  const secondCaffeine = requireValue(secondJobs.find((job) =>
    job.payload?.resource === "caffeine"
  ));
  const earlierSource = {
    ...source,
    firstSeenAt: "2026-03-01T12:00:00.000Z",
  };
  const earlierJobs = provider.jobExecutor?.createScheduledJobs?.(
    createStoredAccount({ sources: [earlierSource] }),
    "2026-08-12T12:00:00.000Z",
  ).jobs ?? [];
  const earlierBloodPressure = requireValue(earlierJobs.find((job) =>
    job.payload?.resource === "blood_pressure"
  ));
  const earlierCaffeine = requireValue(earlierJobs.find((job) =>
    job.payload?.resource === "caffeine"
  ));
  const expectedCaffeineDedupeKey = createHash("sha256")
    .update(JSON.stringify([
      "junction",
      "extended-timeseries-backfill",
      "garmin",
      "caffeine",
      JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION,
    ]))
    .digest("hex");
  const nextPolicyVersionDedupeKey = createHash("sha256")
    .update(JSON.stringify([
      "junction",
      "extended-timeseries-backfill",
      "garmin",
      "caffeine",
      JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION + 1,
    ]))
    .digest("hex");

  assert.equal(bloodPressure.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
  assert.equal(secondBloodPressure.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
  assert.equal(bloodPressure.dedupeKey, secondBloodPressure.dedupeKey);
  assert.equal(earlierBloodPressure.payload?.windowEnd, "2026-03-01T00:00:00.000Z");
  assert.notEqual(earlierBloodPressure.dedupeKey, bloodPressure.dedupeKey);
  assert.equal(caffeine.payload?.windowEnd, "2026-08-11T00:00:00.000Z");
  assert.equal(secondCaffeine.payload?.windowEnd, "2026-08-12T00:00:00.000Z");
  assert.equal(caffeine.dedupeKey, secondCaffeine.dedupeKey);
  assert.equal(caffeine.dedupeKey, earlierCaffeine.dedupeKey);
  assert.equal(caffeine.dedupeKey, expectedCaffeineDedupeKey);
  assert.notEqual(caffeine.dedupeKey, nextPolicyVersionDedupeKey);
});

test("Junction sparse-history scheduling and live admission honor raw availability aliases", async () => {
  const requests: string[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["vo2_max"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [{
          id: "provider-garmin-alias",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: { vo2max: true },
        }] });
      }
      if (parsed.pathname === "/v2/timeseries/junction-user-1/vo2_max/grouped") {
        return createJsonResponse({ groups: {} });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const source = {
    sourceProviderSlug: "garmin",
    displayName: null,
    status: "connected" as const,
    resourceCount: 1,
    resourceAvailabilitySummary: { vo2max: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    firstSeenAt: "2026-04-03T00:00:00.000Z",
    lastSeenAt: "2026-08-11T00:00:00.000Z",
    lastDataAt: null,
  };
  const scheduled = requireValue(provider.jobExecutor).createScheduledJobs?.(
    createStoredAccount({ sources: [source] }),
    "2026-08-11T12:00:00.000Z",
  );
  const job = requireValue(scheduled?.jobs.find((candidate) =>
    candidate.payload?.resource === "vo2_max"
  ));

  await executeJunctionJob(
    provider,
    createJunctionJobContext({ account: createAccount({ sources: [source] }) }),
    {
      ...createJob("resource", job.payload ?? {}),
      dedupeKey: job.dedupeKey ?? null,
    },
  );

  assert.equal(requests.some((url) => url.includes("/vo2_max/grouped")), true);
});

test("Junction sparse-history continuation fetches one bounded 30-day window", async () => {
  const timeseriesRequests: URL[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["vo2_max"],
    fetchImpl: async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-policy",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: { vo2_max: true },
          }],
        });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/vo2_max/grouped") {
        timeseriesRequests.push(url);
        return createJsonResponse({ groups: {} });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    },
  });
  const source = {
    sourceProviderSlug: "garmin",
    displayName: null,
    status: "connected" as const,
    resourceCount: 1,
    resourceAvailabilitySummary: { vo2_max: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    firstSeenAt: "2026-04-03T00:00:00.000Z",
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    lastDataAt: null,
  };
  const storedAccount = createStoredAccount({ sources: [source] });
  const scheduled = requireValue(provider.jobExecutor).createScheduledJobs?.(
    storedAccount,
    "2026-08-11T12:00:00.000Z",
  );
  const job = requireValue(
    scheduled?.jobs.find((candidate) =>
      candidate.kind === "resource" && candidate.payload?.resource === "vo2_max"
    ),
  );
  const historicalWindowStart = job.payload?.historicalWindowStart;
  const historicalWindowEnd = job.payload?.windowEnd;
  if (typeof historicalWindowStart !== "string" || typeof historicalWindowEnd !== "string") {
    throw new TypeError("Expected a string sparse-history window.");
  }
  assert.equal(
    (Date.parse(historicalWindowEnd) - Date.parse(historicalWindowStart))
      / (24 * 60 * 60_000),
    180,
  );
  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: [source] }),
      now: "2026-08-11T12:00:00.000Z",
    }),
    {
      ...createJob("resource", job.payload ?? {}),
      dedupeKey: job.dedupeKey ?? null,
    },
  );

  assert.equal(timeseriesRequests.length, 1);
  const request = requireValue(timeseriesRequests[0]);
  const requestStart = requireValue(request.searchParams.get("start_date"));
  const requestEnd = requireValue(request.searchParams.get("end_date"));
  assert.equal(
    (Date.parse(requestEnd) - Date.parse(requestStart)) / (24 * 60 * 60_000),
    30,
  );
  const continuation = requireValue(
    result.scheduledJobs?.find((candidate) =>
      candidate.kind === "resource" && candidate.payload?.resource === "vo2_max"
    ),
  );
  assert.equal(continuation.payload?.windowStart, requestEnd);
  assert.equal(continuation.payload?.windowEnd, job.payload?.windowEnd);
});

test.each([
  { canonicalEventCount: 1, label: "same-day aggregate rows", malformed: false },
  { canonicalEventCount: 0, label: "malformed aggregate rows", malformed: true },
])("Junction $label complete sparse history after bounded chunking", async ({
  canonicalEventCount,
  malformed,
}) => {
  let timeseriesRequestCount = 0;
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["caffeine"],
    fetchImpl: async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [{
          id: "provider-garmin-policy",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: { caffeine: true },
        }] });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/caffeine/grouped") {
        timeseriesRequestCount += 1;
        return createJsonResponse({
          groups: {
            garmin: [{
              data: malformed
                ? [{ start: url.searchParams.get("start_date"), value: "not-a-number" }]
                : [
                  { start: url.searchParams.get("start_date"), value: 0.095 },
                  { start: url.searchParams.get("start_date"), value: 0.063 },
                ],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    },
  });
  const source = {
    sourceProviderSlug: "garmin",
    displayName: null,
    status: "connected" as const,
    resourceCount: 1,
    resourceAvailabilitySummary: { caffeine: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    firstSeenAt: "2026-08-11T00:00:00.000Z",
    lastSeenAt: "2026-08-11T00:00:00.000Z",
    lastDataAt: null,
  };
  const executor = requireValue(provider.jobExecutor);
  const initialJob = requireValue(executor.createScheduledJobs?.(
    createStoredAccount({ sources: [source] }),
    "2026-08-11T12:00:00.000Z",
  ).jobs.find((candidate) => candidate.payload?.resource === "caffeine"));
  let job: DeviceSyncJobRecord = {
    ...createJob("resource", initialJob.payload ?? {}),
    dedupeKey: initialJob.dedupeKey ?? null,
  };
  let metadata: Record<string, unknown> = {};

  const expectedScanCount = malformed ? 5 : 1;
  const expectedRequestCount = expectedScanCount * 6;
  for (let chunkIndex = 0; chunkIndex < expectedRequestCount; chunkIndex += 1) {
    const now = new Date(
      Date.parse("2026-08-11T12:00:00.000Z") + chunkIndex * 24 * 60 * 60_000,
    ).toISOString();
    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ metadata, sources: [source] }),
        importSnapshot: async () => ({
          canonicalEventCount,
          durableDeliveryAccepted: true,
        }),
        now,
      }),
      job,
    );
    metadata = mergeStoredDeviceSyncMetadataPatch(metadata, result.metadataPatch);
    const continuation = result.scheduledJobs?.find((candidate) =>
      candidate.payload?.resource === "caffeine"
    );
    if (chunkIndex < expectedRequestCount - 1) {
      const requiredContinuation = requireValue(continuation);
      job = {
        ...createJob("resource", requiredContinuation.payload ?? {}),
        dedupeKey: requiredContinuation.dedupeKey ?? null,
      };
    } else {
      assert.equal(continuation, undefined);
    }
  }

  assert.equal(timeseriesRequestCount, expectedRequestCount);
  assert.equal(
    executor.createScheduledJobs?.(
      createStoredAccount({ metadata, sources: [source] }),
      "2026-08-20T12:00:00.000Z",
    ).jobs.some((candidate) => candidate.payload?.resource === "caffeine"),
    false,
  );
});

test("Junction sparse aggregate import failures remain retryable without coverage", async () => {
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["caffeine"],
    fetchImpl: async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [{
          id: "provider-garmin-import-retry",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: { caffeine: true },
        }] });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/caffeine/grouped") {
        return createJsonResponse({ groups: { garmin: [{
          data: [{ start: "2026-08-10T08:00:00.000Z", value: 0.095 }],
          source: { provider: "garmin", type: "watch" },
        }] } });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    },
  });
  const source = {
    sourceProviderSlug: "garmin",
    displayName: null,
    status: "connected" as const,
    resourceCount: 1,
    resourceAvailabilitySummary: { caffeine: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    firstSeenAt: "2026-08-11T00:00:00.000Z",
    lastSeenAt: "2026-08-11T00:00:00.000Z",
    lastDataAt: null,
  };
  const initial = requireValue(provider.jobExecutor?.createScheduledJobs?.(
    createStoredAccount({ sources: [source] }),
    "2026-08-11T12:00:00.000Z",
  ).jobs.find((job) => job.payload?.resource === "caffeine"));
  const failed = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: [source] }),
      importSnapshot: async () => {
        throw new DeviceSyncError({
          code: "HOSTED_DEVICE_SYNC_ARTIFACT_WRITE_FAILED",
          httpStatus: 503,
          message: "Temporary canonical import failure.",
          retryable: true,
        });
      },
    }),
    {
      ...createJob("resource", initial.payload ?? {}),
      dedupeKey: initial.dedupeKey ?? null,
    },
  );
  const metadata = mergeStoredDeviceSyncMetadataPatch({}, failed.metadataPatch);
  assert.equal(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
    metadata,
    "garmin",
    "caffeine",
    1,
  ), false);
  const retry = requireValue(failed.scheduledJobs?.find((job) =>
    job.payload?.resource === "caffeine"
  ));
  assert.equal(retry.payload?.historicalProviderRecordsSeen, false);
  assert.equal(retry.payload?.historicalRecordsSeen, false);
});
