import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
} from "@murphai/importers/device-providers/junction-resources";
import { test } from "vitest";

import { DeviceSyncError } from "../src/errors.ts";
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
} from "../src/providers/junction-connect-sources.ts";
import {
  isAllowedJunctionLinkHost,
  JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS,
  JunctionClient,
} from "../src/providers/junction-client.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

import type {
  DeviceConnectionSourceRecord,
  DeviceSyncAccount,
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
    connectedAt: "2026-04-01T00:00:00.000Z",
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

function createStoredAccount(): StoredDeviceSyncAccount {
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

function createJunctionProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: [],
    fetchImpl,
    ...overrides,
  });
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
      createdAt: input.lastSeenAt,
      updatedAt: input.lastSeenAt,
    }),
    refreshAccountTokens: async () => account,
    logger: {},
    ...overrides,
  };
}

function createEmptyJunctionBackfillProvider() {
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
  });
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

  assert.equal(summaryResources.includes("profile"), true);
  assert.equal(summaryResources.includes("menstrual_cycle"), true);
  assert.equal(summaryResources.includes("electrocardiogram"), true);
  assert.deepEqual(summaryResources, [...JUNCTION_DEFAULT_SUMMARY_RESOURCES]);
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
      !url.includes("heartrate") &&
      !url.includes("steps") &&
      !url.includes("distance") &&
      !url.includes("calories_active") &&
      !url.includes("weight")
    ),
    true,
  );
  assert.equal(importedSnapshots.length, 1);
});

test("Junction stale dense timeseries config is accepted and dropped", async () => {
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
            resource_availability: {
              activity: true,
              steps: true,
              heartrate: true,
            },
          }],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({ data: [] });
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

  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), false);
  assert.equal(importedSnapshots.length, 1);
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
  assert.equal(JUNCTION_CONNECT_SOURCE_TARGETS.length, 32);

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
  ]) {
    assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes(providerSlug), false);
  }

  assert.equal(resolveJunctionTarget("samsung_health")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("freestyle_libre_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("accuchek_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("contour_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("onetouch_ble")?.connectMode, "junction_sdk");

  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom-g6-and-older"), "dexcom");
  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom"), "dexcom_v3");
  assert.equal(resolveJunctionConnectTargetForSourceId("mapmyfitness"), "map_my_fitness");
  assert.equal(resolveJunctionConnectTargetForSourceId("accuchek"), "accuchek_ble");
  assert.equal(resolveJunctionConnectTargetForSourceId("onetouch"), "onetouch_ble");
  assert.equal(resolveJunctionConnectSourceLabel("accuchek_ble"), "Accu-Chek");
});

test("Junction empty historical backfill schedules a bounded same-window retry", async () => {
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
      windowStart: "2026-04-01T12:34:56.000Z",
      windowEnd: "2026-04-03T08:09:10.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 0);
  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T12:34:56.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T08:09:10.000Z",
  });
  assert.equal(result.scheduledJobs?.length, 1);
  const retryJob = result.scheduledJobs?.[0];
  assert.equal(retryJob?.kind, "backfill");
  assert.deepEqual(retryJob?.payload, {
    windowStart: "2026-04-01T12:34:56.000Z",
    windowEnd: "2026-04-03T08:09:10.000Z",
  });
  assert.deepEqual(Object.keys(retryJob?.payload ?? {}).sort(), ["windowEnd", "windowStart"]);
  assert.equal(retryJob?.availableAt, "2026-04-04T00:15:00.000Z");
  assert.equal(
    retryJob?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2026-04-01T12:34:56.000Z",
      "2026-04-03T08:09:10.000Z",
    ),
  );
});

test("Junction empty historical backfill preserves explicit windows", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const context = createJunctionJobContext({
    now: "2026-04-04T00:00:00.000Z",
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2025-01-01T12:34:56.000Z",
      windowEnd: "2026-04-05T08:09:10.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2025-01-01T12:34:56.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-05T08:09:10.000Z",
  });
  const retryJob = result.scheduledJobs?.[0];
  assert.deepEqual(retryJob?.payload, {
    windowStart: "2025-01-01T12:34:56.000Z",
    windowEnd: "2026-04-05T08:09:10.000Z",
  });
  assert.equal(
    retryJob?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2025-01-01T12:34:56.000Z",
      "2026-04-05T08:09:10.000Z",
    ),
  );
});

test("Junction useful summary historical backfill marks the historical window complete", async () => {
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
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }] });
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
      windowStart: "2026-04-01T06:07:08.000Z",
      windowEnd: "2026-04-03T09:10:11.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T06:07:08.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T09:10:11.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction historical backfill should fetch summary completion data.",
  );
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-04-01T06:07:08.000Z",
    "2026-04-03T09:10:11.000Z",
  );
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

  assert.equal(summary.hasUsefulHistoricalRecords, true);
  assert.deepEqual(summary.resources?.map((entry) => [entry.resource, entry.recordCount]), [
    ["activity", 1],
  ]);
  assert.deepEqual(timeseriesProbe.resources?.map((entry) => [entry.resource, entry.recordCount]), [
    ["blood_oxygen", 1],
  ]);
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
  });
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
      junctionHistoricalBackfillStatus: "complete",
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
  test(`Junction ${testCase.label} raw-only summary keeps the historical window retrying`, async () => {
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
        windowEnd: "2026-04-04T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs?.length, 1);
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
      junctionHistoricalBackfillStatus: "complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

test("Junction sleep_cycle stage-count-only historical backfill marks the historical window complete", async () => {
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
    junctionHistoricalBackfillStatus: "complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/sleep_cycle/")),
    "Junction sleep-cycle backfill should fetch REST summary data.",
  );
  assertJunctionWindowQuery(summaryRequest, "2026-04-01", "2026-04-02");
});

for (const summaryResource of ["activity", "sleep", "workouts", "body"] as const) {
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
        windowEnd: "2026-04-04T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs?.length, 1);
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
  workouts: {
    id: "workouts-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T12:00:00",
    endAt: "2026-04-02T13:00:00",
  },
} satisfies Record<"sleep" | "workouts", Record<string, unknown>>;

for (const summaryResource of ["sleep", "workouts"] as const) {
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
        windowEnd: "2026-04-04T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs?.length, 1);
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
      windowEnd: "2026-04-04T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs?.length, 1);
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
      windowEnd: "2026-04-04T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs?.length, 1);
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
    junctionHistoricalBackfillStatus: "complete",
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
      windowEnd: "2026-04-04T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs?.length, 1);
  assert.equal(importedSnapshots.length, 1);
  const timeseriesSnapshot = importedSnapshots[0] as { summaries?: Record<string, unknown[]>; timeseries?: Record<string, unknown[]> };
  assert.deepEqual(timeseriesSnapshot.summaries, {});
  assert.equal(timeseriesSnapshot.timeseries?.blood_oxygen?.length, 1);
});

test("Junction profile-only historical backfill keeps the summary window retrying", async () => {
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
      windowEnd: "2026-04-04T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs?.length, 1);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction empty historical backfill stops retrying after the bounded budget", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "retrying",
        junctionHistoricalBackfillEmptyAttempts: 4,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
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

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "exhausted",
    junctionHistoricalBackfillEmptyAttempts: 5,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction exhausted historical backfill is terminal until the same window has data", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
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

  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction exhausted historical backfill completes when the same window later has data", async () => {
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
        junctionHistoricalBackfillStatus: "exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
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

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
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
        junctionHistoricalBackfillStatus: "retrying",
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

test("Junction provider revokes connected remote provider slugs", async () => {
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

test("Junction beginConnection narrows Link to the requested source provider", async () => {
  const requests: Array<{ body: unknown; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, url });

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
  assert.deepEqual(
    typeof linkBody === "object" && linkBody !== null && "filter_on_providers" in linkBody
      ? linkBody.filter_on_providers
      : null,
    ["fitbit"],
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
    windowStart: "2025-10-05T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const payload = connection.initialJobs?.[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(Array.isArray(payload?.resources), false);
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

  assert.equal(first?.jobs.length, 1);
  assert.deepEqual(first?.jobs[0]?.payload, {
    windowStart: "2026-03-27T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(first?.jobs[0]?.dedupeKey, second?.jobs[0]?.dedupeKey);
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

test("Junction compact timeseries resource jobs fetch the precise hinted window with ISO params", async () => {
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
              start: "2026-04-02T14:30:00.000Z",
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

test("Junction completeConnection drops secret-bearing Link failure reason values entirely", async () => {
  // sanitizeHostedRuntimeDiagnosticText fails closed: a value that still looks
  // unsafe after redaction is dropped from the reason instead of partially
  // surfaced.
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
      assert.ok(!error.message.includes("error_description="));
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

test("Junction completeConnection omits token-shaped Link callback values from failure reasons", async () => {
  // JWT-shaped values are redacted then dropped by the fail-closed check, and
  // long opaque tokens are dropped outright, so neither can leak into the
  // persisted/logged failure message.
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
      assert.equal(error.message, "Junction Link callback reported a failed link outcome.");
      assert.ok(!error.message.includes(jwtDescription));
      assert.ok(!error.message.includes(opaqueState));
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
    account: createAccount(),
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
    junctionHistoricalBackfillStatus: "complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(sources.length, 1);
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
  assert.equal(sources[0]?.resourceAvailabilitySummary.deviceName, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_name, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.user_id, undefined);
  assert.equal(importedSnapshots.length, 2);
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
  assert.deepEqual(summarySnapshot.summaries?.profile, []);
  assert.deepEqual(summarySnapshot.timeseries, {});
  assert.deepEqual(timeseriesSnapshot.summaries, {});
  assert.equal(timeseriesSnapshot.timeseries?.blood_oxygen?.length, 1);
  assert.deepEqual(timeseriesSnapshot.timeseries?.stress_level, []);
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
    junctionSkippedResourceTotal: 12,
    junctionSkippedSummaryTotal: 5,
    junctionSkippedTimeseriesTotal: 7,
    junctionSkippedResourceJobCount: 2,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "timeseries.stress_level.422.unsupported",
  });
});

test("Junction polling fails ambiguous optional resource responses for retry", async () => {
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
        code: "invalid_request",
        message: "The date window is invalid for this request.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  await assert.rejects(
    () => executeJunctionJob(
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
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_OPTIONAL_RESOURCE_RESPONSE_AMBIGUOUS");
      assert.equal(error.retryable, true);
      assert.equal(error.details?.providerOptionalResourceCategory, "summary");
      assert.equal(error.details?.providerOptionalResourceFailureDisposition, "ambiguous");
      assert.equal(error.details?.providerOptionalResourceName, "profile");
      assert.equal(error.details?.providerOptionalResourceStatus, 422);
      assert.equal(error.details?.responseErrorCode, "invalid_request");
      assert.equal(error.details?.responseErrorDescription, undefined);
      assert.equal(error.details?.status, 422);
      assert.equal(JSON.stringify(error).includes("junction-user-1"), false);
      assert.equal(JSON.stringify(error).includes("date window"), false);
      return true;
    },
  );

  assert.equal(importedSnapshots.length, 0);
  assert.deepEqual(warnings, []);
});

test("Junction polling fails ambiguous optional 404 responses for retry", async () => {
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
        error: "not_found",
        message: "Not found.",
      }, 404);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  await assert.rejects(
    () => executeJunctionJob(
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
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_OPTIONAL_RESOURCE_RESPONSE_AMBIGUOUS");
      assert.equal(error.retryable, true);
      assert.equal(error.details?.providerOptionalResourceCategory, "summary");
      assert.equal(error.details?.providerOptionalResourceFailureDisposition, "ambiguous");
      assert.equal(error.details?.providerOptionalResourceName, "profile");
      assert.equal(error.details?.providerOptionalResourceStatus, 404);
      assert.equal(error.details?.responseErrorCode, "not_found");
      assert.equal(error.details?.responseErrorDescription, undefined);
      assert.equal(error.details?.status, 404);
      assert.equal(JSON.stringify(error).includes("Not found"), false);
      return true;
    },
  );

  assert.equal(importedSnapshots.length, 0);
  assert.deepEqual(warnings, []);
});

test("Junction polling fails request-shape optional resource text for retry", async () => {
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

    await assert.rejects(
      () => executeJunctionJob(
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
      ),
      (error) => {
        assert.ok(error instanceof DeviceSyncError);
        assert.equal(error.code, "JUNCTION_OPTIONAL_RESOURCE_RESPONSE_AMBIGUOUS");
        assert.equal(error.retryable, true);
        assert.equal(error.details?.providerOptionalResourceCategory, "summary");
        assert.equal(error.details?.providerOptionalResourceFailureDisposition, "ambiguous");
        assert.equal(error.details?.providerOptionalResourceName, "profile");
        assert.equal(error.details?.providerOptionalResourceStatus, 422);
        assert.equal(error.details?.responseErrorCode, code);
        assert.equal(error.details?.responseErrorDescription, undefined);
        assert.equal(JSON.stringify(error).includes(message), false);
        return true;
      },
    );

    assert.equal(importedSnapshots.length, 0);
    assert.deepEqual(warnings, []);
  }
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

  assert.deepEqual(requests, []);
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

test("Junction resource jobs import direct Garmin sleep webhook payloads without Junction HTTP requests", async () => {
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

  assert.deepEqual(requests, []);
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

test("Junction resource jobs import direct Garmin sleep webhook object data without Junction HTTP requests", async () => {
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

  assert.deepEqual(requests, []);
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

test("Junction resource jobs import direct Garmin sleep-cycle stage payloads without Junction HTTP requests", async () => {
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

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepCycleRecord = snapshot.summaries?.sleep_cycle?.[0];
  const sleepCycleData = sleepCycleRecord?.data as Array<Record<string, unknown>> | undefined;
  const stages = sleepCycleData?.[0]?.stages as Array<Record<string, unknown>> | undefined;
  assert.equal(sleepCycleRecord?.sourceProviderSlug, "garmin");
  assert.equal(stages?.[0]?.stage, "deep");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction direct Garmin sleep-cycle payloads import inline once the usefulness gate is removed", async () => {
  // Pre-P3 these stage-interval-free sleep_cycle payloads were dropped to a REST
  // summary read by the usefulness gate. The gate was removed in P3: a
  // configured summary payload with a single consistent source imports inline,
  // and the normalizer downstream decides meaning (as it does for fetched
  // records). No REST fallback fires.
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
  ];

  for (const testCase of cases) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);

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

    assert.deepEqual(requests, [], testCase.label);
    assert.equal(importedSnapshots.length, 1, testCase.label);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
    };
    assert.equal(snapshot.summaries?.sleep_cycle?.[0]?.id, testCase.directRecord.id, testCase.label);
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

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
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
  });
});

test("Junction timeseries ambiguous later chunk fails instead of preserving partial data", async () => {
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

  await assert.rejects(
    () => executeJunctionJob(
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
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_OPTIONAL_RESOURCE_RESPONSE_AMBIGUOUS");
      assert.equal(error.retryable, true);
      assert.equal(error.details?.providerOptionalResourceCategory, "timeseries");
      assert.equal(error.details?.providerOptionalResourceFailureDisposition, "ambiguous");
      assert.equal(error.details?.providerOptionalResourceName, "blood_oxygen");
      assert.equal(error.details?.providerOptionalResourceStatus, 422);
      assert.equal(error.details?.responseErrorCode, "invalid_request");
      return true;
    },
  );

  assert.equal(timeseriesRequests, 2);
  assert.equal(importedSnapshots.length, 0);
  assert.deepEqual(warnings, []);
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
      timeseriesResources: ["workout_distance"],
    }),
    /Junction timeseries resources include unsupported resource\(s\): workout_distance\./u,
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
