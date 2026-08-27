import {
  assertJunctionWindowQuery,
  createAccount,
  createConnectionSource,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  createStoredAccount,
  executeFullJobTimeseriesContinuations,
  executeJunctionFullJob,
  executeJunctionJob,
  requireJunctionConnectionHandler,
  sha256ForTest,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import {
  buildJunctionDailyTimeseriesAggregateResourceId,
  deriveJunctionCanonicalCoverageEvidence,
  normalizeJunctionSnapshot,
  type JunctionSnapshotInput,
} from "@murphai/importers/device-providers/junction";
import { test, vi } from "vitest";
import { normalizeConfiguredDeviceSyncJobInput } from "../src/provider-job-definitions.ts";
import { DeviceSyncError } from "../src/errors.ts";
import { isGoogleHealthFitbitMigrationCutoverReady } from "../src/fitbit-migration.ts";
import { HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT } from "../src/hosted-runtime.ts";
import { mergeStoredDeviceSyncMetadataPatch } from "../src/metadata.ts";
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
import {
  areJunctionDeviceConnectProviderSlugsEquivalent,
  resolveDeviceConnectSourceIdForJunctionProviderSlug,
} from "../src/config/connect-routes.ts";
import { createJsonResponse, makeTempDirectory, readUrl, requireValue } from "./helpers.ts";
import type {
  DeviceConnectionSourceRecord,
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

test("Junction beginConnection resolves or creates a namespaced user, returns Link URL, and seeds provider-config credentials", async () => {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, headers, url });

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
      return createJsonResponse({ message: "missing" }, 404);
    }

    if (url === "https://api.sandbox.us.junction.com/v2/user") {
      return createJsonResponse({ user_id: "junction-user-1" });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
      return createJsonResponse({ link_web_url: "https://link.junction.com/session/link-token-1" });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, { clientUserIdNamespace: "e2e" });

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

  const createUserBody = requests.find((request) => request.url.endsWith("/v2/user"))?.body;
  assert.deepEqual(createUserBody, {
    client_user_id: "murph_e2e_jnqpm4zu2il556kgyffrxn",
  });
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

test("Junction maps legacy Fitbit and Google Health status identities to one visible source", () => {
  assert.equal(resolveDeviceConnectSourceIdForJunctionProviderSlug("fitbit"), "fitbit");
  assert.equal(resolveDeviceConnectSourceIdForJunctionProviderSlug("google_health"), "fitbit");
});

test("Junction beginConnection dispatches Fitbit through Google Health", async () => {
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
    sourceProviderSlug: "google_health",
  });

  const linkBody = requests.find((request) => request.url.endsWith("/v2/link/token"))?.body;
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "provider" in linkBody
      ? linkBody.provider
      : null,
    "google_health",
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
    historicalProofFirstSeenAt: "2026-04-03T00:00:00.000Z",
    historicalProofSourceProviderSlug: "fitbit",
    sourceProviderSlug: "fitbit",
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.notEqual(
    sourceConnection.initialJobs?.[0]?.dedupeKey,
    connection.initialJobs?.[0]?.dedupeKey,
  );
  const sourceRecoveryWork = requireJunctionConnectionHandler(provider)
    .buildSourceConnectionWork?.({
      historicalProofAuthorization: {
        firstSeenAt: "2026-04-03T00:00:00.000Z",
        sourceProviderSlug: "fitbit",
      },
      now: "2026-04-03T00:00:00.000Z",
      sourceProviderSlug: "fitbit",
    });
  assert.deepEqual(sourceRecoveryWork, {
    initialJobs: sourceConnection.initialJobs,
    nextReconcileAt: sourceConnection.nextReconcileAt,
  });

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

test("Junction source history identity follows the authorizing source epoch", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const handler = requireJunctionConnectionHandler(provider);
  const buildWork = (firstSeenAt: string) => requireValue(
    handler.buildSourceConnectionWork?.({
      historicalProofAuthorization: {
        firstSeenAt,
        sourceProviderSlug: "google_health",
      },
      now: firstSeenAt,
      sourceProviderSlug: "fitbit",
    }),
    "Junction source connection work should be available.",
  );
  const sameDayFirst = buildWork("2026-04-03T01:00:00.000Z");
  const sameDaySecond = buildWork("2026-04-03T02:00:00.000Z");
  const crossDay = buildWork("2026-04-04T01:00:00.000Z");
  const backfills = [sameDayFirst, sameDaySecond, crossDay].map((work) =>
    requireValue(
      work.initialJobs?.find((job) => job.kind === "backfill"),
      "Source work should include one exact backfill.",
    )
  );

  assert.deepEqual(backfills.map((job) => job.payload), [
    {
      historicalProofFirstSeenAt: "2026-04-03T01:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: "fitbit",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    },
    {
      historicalProofFirstSeenAt: "2026-04-03T02:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: "fitbit",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    },
    {
      historicalProofFirstSeenAt: "2026-04-04T01:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: "fitbit",
      windowEnd: "2026-04-04T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    },
  ]);
  assert.equal(new Set(backfills.map((job) => job.dedupeKey)).size, 3);
});

test("Junction supersedes every stale authorization-bound history job shape", async () => {
  let importCount = 0;
  let providerRequestCount = 0;
  let sourceWriteCount = 0;
  const provider = createJunctionProvider(async (input) => {
    providerRequestCount += 1;
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const currentGoogleEpoch = "2026-04-03T02:00:00.000Z";
  const staleGoogleEpoch = "2026-04-03T01:00:00.000Z";
  const sources = [
    createConnectionSource({
      firstSeenAt: currentGoogleEpoch,
      id: "source-google-health",
      sourceProviderSlug: "google_health",
    }),
    createConnectionSource({
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      id: "source-fitbit",
      sourceProviderSlug: "fitbit",
    }),
  ];
  const context = createJunctionJobContext({
    account: createAccount({
      sources: sources.map((source) => ({
        ...source,
        resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
      })),
    }),
    importSnapshot: async () => {
      importCount += 1;
      return { canonicalEventCount: 1, durableDeliveryAccepted: true };
    },
    listConnectionSources: async () => sources,
    upsertConnectionSource: (input) => {
      sourceWriteCount += 1;
      return createConnectionSource(input);
    },
  });
  const basePayload = {
    historicalProofFirstSeenAt: staleGoogleEpoch,
    historicalProofSourceProviderSlug: "google_health",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-01T00:00:00.000Z",
  };
  const jobs = [
    createJob("backfill", {
      ...basePayload,
      sourceProviderSlug: "google_health",
    }),
    {
      ...createJob("backfill", {
        ...basePayload,
        sourceProviderSlug: "fitbit",
      }),
      leaseExpiresAt: "2026-04-03T02:05:00.000Z",
      leaseOwner: "worker-1",
      status: "running" as const,
    },
    createJob("backfill", {
      ...basePayload,
      emptyBackfillAttempts: 1,
      historicalProviderRecordsSeen: true,
      historicalRecordsSeen: true,
      sourceProviderSlug: "google_health",
    }),
    createJob("backfill", {
      ...basePayload,
      historicalProviderRecordsSeen: true,
      historicalRecordsSeen: true,
      sourceProviderSlug: "fitbit",
      timeseriesCursor: "2026-04-01T00:00:00.000Z",
      timeseriesResourceCursor: "steps",
    }),
    createJob("backfill", {
      ...basePayload,
      historicalProviderRecordsSeen: true,
      historicalRecordsSeen: true,
      sourceProviderSlug: "google_health",
      timeseriesCursor: "2026-04-01T00:00:00.000Z",
      timeseriesResourceCursor: "workout_stream",
      workoutStreamCursor: JSON.stringify({ i: ["workout-1"], v: 1 }),
    }),
  ];

  for (const job of jobs) {
    const result = await executeJunctionJob(provider, context, job);
    assert.equal(result.scheduledJobs?.length ?? 0, 0);
  }
  assert.equal(importCount, 0);
  assert.equal(providerRequestCount, 0);
  assert.equal(sourceWriteCount, 0);
});

test("Junction repeated authorization accepts only the current exact history proof", async () => {
  const firstEpoch = "2026-04-03T01:00:00.000Z";
  const currentEpoch = "2026-04-03T02:00:00.000Z";
  const completedAtKey = "historicalBackfillCompletedAt";
  let reauthorizeOnProviderRead = true;
  let liveSources = [
    createConnectionSource({
      firstSeenAt: firstEpoch,
      id: "source-google-health",
      lastDataAt: null,
      sourceProviderSlug: "google_health",
    }),
    createConnectionSource({
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      id: "source-fitbit",
      sourceProviderSlug: "fitbit",
    }),
  ];
  const providers = [{
    id: "provider-google-health-1",
    name: "Google Health",
    resource_availability: { activity: true },
    slug: "google_health",
    status: "connected",
  }, {
    id: "provider-fitbit-1",
    name: "Fitbit",
    resource_availability: { activity: true },
    slug: "fitbit",
    status: "connected",
  }];
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      if (reauthorizeOnProviderRead) {
        reauthorizeOnProviderRead = false;
        liveSources = liveSources.map((source) =>
          source.sourceProviderSlug === "google_health"
            ? createConnectionSource({
                ...source,
                firstSeenAt: currentEpoch,
                lastDataAt: "2026-04-03T02:05:00.000Z",
                resourceAvailabilitySummary: { activity: true },
              })
            : source
        );
      }
      return createJsonResponse({ providers });
    }
    if (url.pathname.startsWith("/v2/summary/")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: [],
  });
  let completionWrites = 0;
  const context = createJunctionJobContext({
    account: createAccount({
      sources: liveSources.map((source) => ({
        ...source,
        resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
      })),
    }),
    connectionSourceAdmissionMode: "listed_only",
    listConnectionSources: async () => liveSources,
    now: "2026-04-03T03:00:00.000Z",
    upsertConnectionSource: async (update) => {
      const existingIndex = liveSources.findIndex((source) =>
        source.sourceProviderSlug === update.sourceProviderSlug
      );
      const existing = liveSources[existingIndex];
      const next = createConnectionSource({
        ...(existing ?? {}),
        ...update,
        firstSeenAt: update.firstSeenAt ?? existing?.firstSeenAt ?? update.lastSeenAt,
        id: existing?.id ?? `source-${update.sourceProviderSlug}`,
        lastDataAt: update.lastDataAt === undefined
          ? existing?.lastDataAt ?? null
          : update.lastDataAt,
        resourceAvailabilitySummary: update.resourceAvailabilitySummary
          ?? existing?.resourceAvailabilitySummary
          ?? {},
      });
      if (
        typeof existing?.resourceAvailabilitySummary?.[completedAtKey] !== "string"
        && typeof next.resourceAvailabilitySummary?.[completedAtKey] === "string"
      ) {
        completionWrites += 1;
      }
      liveSources = existingIndex < 0
        ? [...liveSources, next]
        : liveSources.map((source, index) => index === existingIndex ? next : source);
      return next;
    },
  });
  const job = (
    sourceProviderSlug: "fitbit" | "google_health",
    historicalProofFirstSeenAt?: string,
  ) => createJob("backfill", {
    ...(historicalProofFirstSeenAt
      ? {
          historicalProofFirstSeenAt,
          historicalProofSourceProviderSlug: "google_health",
        }
      : {}),
    sourceProviderSlug,
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-01T00:00:00.000Z",
  });

  await executeJunctionJob(provider, context, job("google_health", firstEpoch));
  await executeJunctionJob(provider, context, job("fitbit", firstEpoch));
  await executeJunctionJob(provider, context, job("google_health"));
  assert.equal(completionWrites, 0);
  assert.equal(isGoogleHealthFitbitMigrationCutoverReady({ sources: liveSources }), false);

  await executeJunctionJob(provider, context, job("google_health", currentEpoch));
  assert.equal(isGoogleHealthFitbitMigrationCutoverReady({ sources: liveSources }), false);
  await executeJunctionJob(provider, context, job("fitbit", currentEpoch));
  assert.equal(completionWrites, 2);
  assert.equal(isGoogleHealthFitbitMigrationCutoverReady({ sources: liveSources }), true);
});

test("Junction source-scoped history completes only after terminal admitted work", async () => {
  const completedAtKey = "historicalBackfillCompletedAt";

  const runScenario = async (input: {
    days: number;
    failFirstTimeseriesPass?: boolean;
    jobSourceProviderSlug?: "fitbit" | "google_health";
    now?: string;
    summaryRecordOnlyFirstAttempt?: boolean;
    summaryRecordSource?: "fitbit" | "google_health" | null;
    timeseriesRecordSource?: "fitbit" | "google_health" | null;
    timeseriesResources: readonly string[];
  }) => {
    const requests: Array<{ method: string; url: URL }> = [];
    let failTimeseries = input.failFirstTimeseriesPass === true;
    let summaryRequestCount = 0;
    const providers = [
      {
        id: "provider-fitbit-1",
        slug: "fitbit",
        name: "Fitbit",
        status: "connected",
        resource_availability: {
          activity: true,
          blood_oxygen: true,
          blood_pressure: true,
        },
      },
      {
        id: "provider-google-health-1",
        slug: "google_health",
        name: "Google Health",
        status: "connected",
        resource_availability: {
          activity: true,
          heartrate: true,
          steps: true,
        },
      },
    ];
    const provider = createJunctionProvider(async (request, init) => {
      const url = new URL(readUrl(request));
      requests.push({ method: String(init?.method ?? "GET"), url });
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers });
      }
      if (url.pathname === "/v2/summary/activity/junction-user-1") {
        summaryRequestCount += 1;
        const includeRecord = Boolean(input.summaryRecordSource)
          && (!input.summaryRecordOnlyFirstAttempt || summaryRequestCount === 1);
        return createJsonResponse({
          data: includeRecord
            ? [{
                connectionId: input.summaryRecordSource === "fitbit"
                  ? "provider-fitbit-1"
                  : "provider-google-health-1",
                date: "2026-04-02",
                id: `activity-${input.summaryRecordSource}`,
                sourceProviderSlug: input.summaryRecordSource,
                steps: 4321,
              }]
            : [],
        });
      }
      if (url.pathname === "/v2/summary/sleep/junction-user-1") {
        return createJsonResponse({ data: [] });
      }
      if (url.pathname === "/v2/summary/workouts/junction-user-1") {
        return createJsonResponse({ data: [] });
      }
      if (url.pathname.startsWith("/v2/timeseries/")) {
        if (failTimeseries) {
          return new Response(JSON.stringify({ error: "temporary failure" }), {
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
            status: 500,
          });
        }
        if (
          input.timeseriesRecordSource
          && url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
        ) {
          return createJsonResponse({
            groups: {
              [input.timeseriesRecordSource]: [{
                data: [{
                  end: "2026-04-02T12:05:00.000Z",
                  start: "2026-04-02T12:00:00.000Z",
                  unit: "%",
                  value: 97,
                }],
                source: {
                  provider: input.timeseriesRecordSource,
                  type: "watch",
                },
              }],
            },
          });
        }
        if (
          input.timeseriesRecordSource
          && url.pathname === "/v2/timeseries/junction-user-1/blood_pressure/grouped"
        ) {
          return createJsonResponse({
            groups: {
              [input.timeseriesRecordSource]: [{
                data: [{
                  diastolic: 80,
                  systolic: 120,
                  timestamp: "2026-04-02T12:00:00.000Z",
                }],
                source: {
                  provider: input.timeseriesRecordSource,
                  type: "cuff",
                },
              }],
            },
          });
        }
        return createJsonResponse({ data: [] });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryBackfillDays: input.days,
      summaryResources: ["activity", "sleep"],
      timeseriesBackfillDays: input.days,
      timeseriesResources: [...input.timeseriesResources],
    });

    let liveSources = [
      createConnectionSource({
        id: "source-fitbit",
        sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
          connectionId: "acct-junction-1",
          sourceProviderSlug: "fitbit",
        }), "Fitbit source key should be available."),
        sourceProviderSlug: "fitbit",
      }),
      createConnectionSource({
        id: "source-google-health",
        sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
          connectionId: "acct-junction-1",
          sourceProviderSlug: "google_health",
        }), "Google Health source key should be available."),
        sourceProviderSlug: "google_health",
      }),
    ];
    const importedSnapshots: unknown[] = [];
    let completionWrites = 0;
    const makeContext = (): ProviderJobContext => createJunctionJobContext({
      account: createAccount({
        sources: liveSources.map((source) => ({
          ...source,
          resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
        })),
      }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        const junctionSnapshot = snapshot as Parameters<typeof normalizeJunctionSnapshot>[0];
        const normalized = normalizeJunctionSnapshot(junctionSnapshot, {
          defaultTimeZone: "UTC",
        });
        const events = normalized.events ?? [];
        if (events.length > 0) {
          importedSnapshots.push(snapshot);
        }
        return {
          canonicalEventCount: events.length,
          durableDeliveryAccepted: events.length > 0,
          junctionCanonicalCoverage: deriveJunctionCanonicalCoverageEvidence(events, {
            providerPulledAt: junctionSnapshot.canonicalCoverageProviderPulledAt,
          }),
        };
      },
      listConnectionSources: async (filter = {}) => liveSources.filter((source) =>
        (!filter.sourceProviderSlug
          || source.sourceProviderSlug === filter.sourceProviderSlug)
        && (!filter.status || source.status === filter.status)
      ),
      ...(input.now ? { now: input.now } : {}),
      upsertConnectionSource: async (update) => {
        const existingIndex = liveSources.findIndex((source) =>
          source.sourceProviderSlug === update.sourceProviderSlug
        );
        const existing = liveSources[existingIndex];
        const next = createConnectionSource({
          ...(existing ?? {}),
          ...update,
          id: existing?.id ?? `source-${update.sourceProviderSlug}`,
          connectionId: "acct-junction-1",
          displayName: update.displayName ?? existing?.displayName ?? null,
          firstSeenAt: update.firstSeenAt ?? existing?.firstSeenAt ?? update.lastSeenAt,
          lastDataAt: update.lastDataAt === undefined
            ? existing?.lastDataAt ?? null
            : update.lastDataAt,
          resourceAvailabilitySummary: update.resourceAvailabilitySummary
            ?? existing?.resourceAvailabilitySummary
            ?? {},
        });
        const wasComplete = existing?.resourceAvailabilitySummary?.[completedAtKey];
        const isComplete = next.resourceAvailabilitySummary?.[completedAtKey];
        if (!wasComplete && typeof isComplete === "string") {
          completionWrites += 1;
        }
        if (existingIndex < 0) {
          liveSources = [...liveSources, next];
        } else {
          liveSources = liveSources.map((source, index) =>
            index === existingIndex ? next : source
          );
        }
        return next;
      },
    });

    const windowEnd = "2026-04-03T00:00:00.000Z";
    const windowStart = new Date(
      Date.parse(windowEnd) - input.days * 24 * 60 * 60_000,
    ).toISOString();
    const jobSourceProviderSlug = input.jobSourceProviderSlug ?? "google_health";
    let job = createJob("backfill", {
      historicalProofFirstSeenAt: "2026-04-03T00:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: jobSourceProviderSlug,
      windowEnd,
      windowStart,
    });
    let processedJobs = 0;
    let failedExecutions = 0;
    let markerBeforePassBoundary = false;
    let terminalJob = job;

    for (let index = 0; index < 2_000; index += 1) {
      assert.equal(job.payload.sourceProviderSlug, jobSourceProviderSlug);
      let result: Awaited<ReturnType<typeof executeJunctionJob>>;
      try {
        result = await executeJunctionJob(provider, makeContext(), job);
      } catch (error) {
        if (!failTimeseries) {
          throw error;
        }
        failedExecutions += 1;
        failTimeseries = false;
        assert.equal(
          liveSources.find((source) => source.sourceProviderSlug === "google_health")
            ?.resourceAvailabilitySummary?.[completedAtKey],
          undefined,
        );
        // A fresh context models process restart before retrying the same durable job.
        continue;
      }
      processedJobs += 1;
      terminalJob = job;
      if (processedJobs === HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT) {
        markerBeforePassBoundary = liveSources.some((source) =>
          typeof source.resourceAvailabilitySummary?.[completedAtKey] === "string"
        );
      }
      const next = result.scheduledJobs?.find((candidate) =>
        candidate.kind === "backfill"
        && candidate.payload?.sourceProviderSlug === jobSourceProviderSlug
      );
      if (!next) {
        return {
          completionWrites,
          failedExecutions,
          importedSnapshots,
          liveSources,
          markerBeforePassBoundary,
          processedJobs,
          providerRequests: requests.filter(({ url }) =>
            url.pathname.includes("/summary/") || url.pathname.includes("/timeseries/")
          ),
          replayTerminal: async () =>
            executeJunctionJob(provider, makeContext(), terminalJob),
          requests,
        };
      }
      assert.equal(
        next.payload?.historicalProofFirstSeenAt,
        "2026-04-03T00:00:00.000Z",
      );
      assert.equal(
        next.payload?.historicalProofSourceProviderSlug,
        "google_health",
      );
      job = createJobFromInput(next, index);
    }
    throw new Error("Source-scoped Junction backfill did not terminate.");
  };

  const rejected = await runScenario({
    days: 2,
    summaryRecordOnlyFirstAttempt: true,
    summaryRecordSource: "fitbit",
    timeseriesResources: [],
  });
  const rejectedGoogle = rejected.liveSources.find((source) =>
    source.sourceProviderSlug === "google_health"
  );
  assert.equal(
    rejectedGoogle?.resourceAvailabilitySummary?.[completedAtKey],
    undefined,
  );
  assert.equal(
    rejected.liveSources.find((source) => source.sourceProviderSlug === "fitbit")
      ?.status,
    "connected",
  );
  assert.equal(rejected.importedSnapshots.length, 0);
  assert.equal(rejected.completionWrites, 0);

  const empty = await runScenario({
    days: 2,
    summaryRecordSource: null,
    timeseriesResources: [],
  });
  assert.equal(
    typeof empty.liveSources.find((source) =>
      source.sourceProviderSlug === "google_health"
    )?.resourceAvailabilitySummary?.[completedAtKey],
    "string",
  );
  assert.equal(empty.importedSnapshots.length, 0);
  assert.equal(empty.completionWrites, 1);

  const rebuiltLegacy = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    summaryRecordSource: "fitbit",
    timeseriesResources: [],
  });
  const rebuiltLegacySummary = rebuiltLegacy.liveSources.find((source) =>
    source.sourceProviderSlug === "fitbit"
  )?.resourceAvailabilitySummary;
  assert.equal(typeof rebuiltLegacySummary?.[completedAtKey], "string");
  assert.equal(
    rebuiltLegacySummary?.canonicalCoverageBoundary_activity,
    "2026-04-02",
  );
  assert.equal(
    rebuiltLegacySummary?.canonicalCoverageFinalizedAt_activity,
    null,
  );

  const rebuiltLegacyClosed = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    now: "2026-04-03T12:00:00.000Z",
    summaryRecordSource: "fitbit",
    timeseriesResources: [],
  });
  const rebuiltLegacyClosedSummary = rebuiltLegacyClosed.liveSources.find((source) =>
    source.sourceProviderSlug === "fitbit"
  )?.resourceAvailabilitySummary;
  assert.equal(
    rebuiltLegacyClosedSummary?.canonicalCoverageFinalizedAt_activity,
    "2026-04-03T12:00:00.000Z",
  );

  const rebuiltLegacyTimeseries = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    now: "2026-04-03T12:00:00.000Z",
    summaryRecordSource: null,
    timeseriesRecordSource: "fitbit",
    timeseriesResources: ["blood_oxygen"],
  });
  const rebuiltLegacyTimeseriesSummary = rebuiltLegacyTimeseries.liveSources.find(
    (source) => source.sourceProviderSlug === "fitbit",
  )?.resourceAvailabilitySummary;
  assert.equal(typeof rebuiltLegacyTimeseriesSummary?.[completedAtKey], "string");
  assert.equal(
    rebuiltLegacyTimeseriesSummary?.canonicalCoverageBoundary_blood_oxygen,
    "2026-04-02",
  );
  assert.equal(
    rebuiltLegacyTimeseriesSummary?.canonicalCoverageFinalizedAt_blood_oxygen,
    "2026-04-03T12:00:00.000Z",
  );

  const rebuiltLegacyInterval = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    summaryRecordSource: null,
    timeseriesRecordSource: "fitbit",
    timeseriesResources: ["blood_pressure"],
  });
  const rebuiltLegacyIntervalSummary = rebuiltLegacyInterval.liveSources.find(
    (source) => source.sourceProviderSlug === "fitbit",
  )?.resourceAvailabilitySummary;
  assert.equal(typeof rebuiltLegacyIntervalSummary?.[completedAtKey], "string");
  assert.equal(
    rebuiltLegacyIntervalSummary?.canonicalCoverageBoundary_blood_pressure,
    "2026-04-02T12:00:00.000Z",
  );

  const long = await runScenario({
    days: 60,
    failFirstTimeseriesPass: true,
    summaryRecordSource: "google_health",
    timeseriesResources: ["steps", "heartrate"],
  });
  assert.ok(
    long.processedJobs > HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT,
  );
  assert.equal(long.markerBeforePassBoundary, false);
  assert.equal(long.failedExecutions, 1);
  assert.equal(long.completionWrites, 1);
  assert.equal(long.importedSnapshots.length, 0);
  assert.equal(
    long.liveSources.find((source) => source.sourceProviderSlug === "fitbit")
      ?.status,
    "connected",
  );
  assert.ok(
    long.providerRequests.length > HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT,
  );
  for (const { url } of long.providerRequests) {
    assert.equal(url.searchParams.get("provider"), "google_health");
  }
  assert.equal(long.requests.some(({ method }) => method === "DELETE"), false);
  const stableKeys = long.liveSources.map((source) => source.sourceInstanceKey);
  await long.replayTerminal();
  assert.deepEqual(
    long.liveSources.map((source) => source.sourceInstanceKey),
    stableKeys,
  );
  assert.equal(long.importedSnapshots.length, 0);
});

test("Junction hosted bounded summaries finalize accepted Fitbit daily coverage", async () => {
  const now = "2026-04-03T12:00:00.000Z";
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-fitbit-1",
          slug: "fitbit",
          name: "Fitbit",
          status: "connected",
          resource_availability: { activity: true },
        }, {
          id: "provider-google-health-1",
          slug: "google_health",
          name: "Google Health",
          status: "connected",
          resource_availability: { activity: true },
        }],
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({
        data: [{
          connectionId: "provider-fitbit-1",
          date: "2026-04-02",
          id: "activity-fitbit-closed-day",
          sourceProviderSlug: "fitbit",
          steps: 4_321,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  let liveSources = [
    createConnectionSource({
      id: "source-fitbit",
      resourceAvailabilitySummary: {
        activity: true,
        canonicalCoverageBoundary_activity: "2026-04-02",
      },
      sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
        connectionId: "acct-junction-1",
        sourceProviderSlug: "fitbit",
      }), "Fitbit source key should be available."),
      sourceProviderSlug: "fitbit",
    }),
    createConnectionSource({
      id: "source-google-health",
      sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
        connectionId: "acct-junction-1",
        sourceProviderSlug: "google_health",
      }), "Google Health source key should be available."),
      sourceProviderSlug: "google_health",
    }),
  ];
  const context = createJunctionJobContext({
    account: createAccount({
      sources: liveSources.map((source) => ({
        ...source,
        resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
      })),
    }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const junctionSnapshot = snapshot as Parameters<typeof normalizeJunctionSnapshot>[0];
      const events = normalizeJunctionSnapshot(junctionSnapshot, {
        defaultTimeZone: "UTC",
      }).events ?? [];
      return {
        canonicalEventCount: events.length,
        durableDeliveryAccepted: events.length > 0,
        junctionCanonicalCoverage: deriveJunctionCanonicalCoverageEvidence(events, {
          providerPulledAt: junctionSnapshot.canonicalCoverageProviderPulledAt,
        }),
      };
    },
    listConnectionSources: async (filter = {}) => liveSources.filter((source) =>
      (!filter.sourceProviderSlug || source.sourceProviderSlug === filter.sourceProviderSlug)
      && (!filter.status || source.status === filter.status)
    ),
    now,
    shouldYield: () => false,
    upsertConnectionSource: async (update) => {
      const existingIndex = liveSources.findIndex((source) =>
        source.sourceProviderSlug === update.sourceProviderSlug
      );
      const existing = liveSources[existingIndex];
      const next = createConnectionSource({
        ...(existing ?? {}),
        ...update,
        id: existing?.id ?? `source-${update.sourceProviderSlug}`,
        connectionId: "acct-junction-1",
        displayName: update.displayName ?? existing?.displayName ?? null,
        firstSeenAt: update.firstSeenAt ?? existing?.firstSeenAt ?? update.lastSeenAt,
        resourceAvailabilitySummary: update.resourceAvailabilitySummary
          ?? existing?.resourceAvailabilitySummary
          ?? {},
      });
      liveSources = existingIndex < 0
        ? [...liveSources, next]
        : liveSources.map((source, index) => index === existingIndex ? next : source);
      return next;
    },
  });

  await executeJunctionJob(provider, context, createJob("reconcile", {
    sourceProviderSlug: "fitbit",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  }));

  const legacySummary = liveSources.find((source) =>
    source.sourceProviderSlug === "fitbit"
  )?.resourceAvailabilitySummary;
  assert.equal(legacySummary?.canonicalCoverageBoundary_activity, "2026-04-02");
  assert.equal(legacySummary?.canonicalCoverageFinalizedAt_activity, now);
});

test("Junction hosted bounded summaries enforce terminal Fitbit coverage on Google", async () => {
  const now = "2026-04-03T12:00:00.000Z";
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-google-health-1",
          slug: "google_health",
          name: "Google Health",
          status: "connected",
          resource_availability: { activity: true },
        }],
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({
        data: [{
          connectionId: "provider-google-health-1",
          date: "2026-04-02",
          id: "activity-google-overlap",
          sourceProviderSlug: "google_health",
          steps: 4_321,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const sources = [
    createConnectionSource({
      id: "source-fitbit",
      lastErrorCode: null,
      resourceAvailabilitySummary: {
        activity: true,
        canonicalCoverageBoundary_activity: "2026-04-02",
      },
      sourceProviderSlug: "fitbit",
      status: "disconnected",
    }),
    createConnectionSource({
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      id: "source-google-health",
      lastDataAt: "2026-04-03T01:00:00.000Z",
      resourceAvailabilitySummary: {
        activity: true,
        historicalBackfillCompletedAt: "2026-04-03T00:30:00.000Z",
      },
      sourceProviderSlug: "google_health",
    }),
  ];
  const importedSnapshots: JunctionSnapshotInput[] = [];
  let canonicalEventCount = -1;
  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        sources: sources.map((source) => ({
          ...source,
          resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
        })),
      }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        const importedSnapshot = snapshot as Parameters<typeof normalizeJunctionSnapshot>[0];
        importedSnapshots.push(importedSnapshot);
        canonicalEventCount = normalizeJunctionSnapshot(importedSnapshot, {
          defaultTimeZone: "UTC",
        }).events?.length ?? 0;
        return {
          canonicalEventCount,
          durableDeliveryAccepted: canonicalEventCount > 0,
        };
      },
      listConnectionSources: async (filter = {}) => sources.filter((source) =>
        (!filter.sourceProviderSlug || source.sourceProviderSlug === filter.sourceProviderSlug)
        && (!filter.status || source.status === filter.status)
      ),
      now,
      shouldYield: () => false,
    }),
    createJob("reconcile", {
      sourceProviderSlug: "google_health",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  const importedSnapshot = requireValue(
    importedSnapshots[0],
    "Bounded Google summary should reach the canonical importer.",
  );
  assert.deepEqual(importedSnapshot.canonicalCoverageFence, {
    coverageBoundaryByResource: { activity: "2026-04-02" },
    sourceProviderSlug: "google_health",
  });
  assert.equal(importedSnapshot.canonicalCoverageProviderPulledAt, now);
  assert.equal(canonicalEventCount, 0);
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

test("Junction reconcile cadence cannot schedule faster than once per minute", () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    { reconcileIntervalMs: 1 },
  );
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );

  const scheduled = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v4_complete",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );

  assert.equal(scheduled?.nextReconcileAt, "2026-04-03T12:35:56.000Z");
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
      vaultTimeZone: "UTC",
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
      ["2026-04-01T00:00:00.000Z", "2026-04-02T00:00:00.000Z"],
    ],
  );
});

test("Junction one-day reconcile still imports the newest lag-complete temporal day", async () => {
  const requestedWindows: Array<[string | null, string | null]> = [];
  const authority: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped") {
      requestedWindows.push([
        url.searchParams.get("start_date"),
        url.searchParams.get("end_date"),
      ]);
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    reconcileDays: 1,
    timeseriesResources: ["blood_oxygen"],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T00:00:00.000Z",
      importSnapshot: async (_snapshot, options) => {
        if (options) {
          authority.push(options);
        }
        return { canonicalEventCount: 0, durableDeliveryAccepted: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requestedWindows, [[
    "2026-04-01T00:00:00.000Z",
    "2026-04-02T00:00:00.000Z",
  ]]);
  assert.deepEqual(
    (authority[0] as { completeSourceDay?: unknown })?.completeSourceDay,
    {
      connectionId: "jxn_acct_27cc43a25baa9a976e1d67c7cdc72208",
      dayKey: "2026-04-01",
      resources: ["blood_oxygen"],
      revisionAt: "2026-04-03T00:00:00.000Z",
      timeZone: "UTC",
    },
  );
});

test("Junction reconcile schedules the remaining temporal horizon newest-first as stable day jobs", async () => {
  const requestedWindows: Array<[string, string | null, string | null]> = [];
  const imports: Array<{ options: unknown; snapshot: unknown }> = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    const resource = url.pathname.match(
      /^\/v2\/timeseries\/junction-user-1\/(blood_oxygen|stress_level)\/grouped$/u,
    )?.[1];
    if (resource) {
      requestedWindows.push([
        resource,
        url.searchParams.get("start_date"),
        url.searchParams.get("end_date"),
      ]);
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    reconcileDays: 3,
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });
  const context = createJunctionJobContext({
    now: "2026-04-06T00:00:00.000Z",
    importSnapshot: async (snapshot, options) => {
      imports.push({ options, snapshot });
      return { canonicalEventCount: 0, durableDeliveryAccepted: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-03T00:00:00.000Z",
      windowEnd: "2026-04-06T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requestedWindows, [
    ["blood_oxygen", "2026-04-04T00:00:00.000Z", "2026-04-05T00:00:00.000Z"],
    ["stress_level", "2026-04-04T00:00:00.000Z", "2026-04-05T00:00:00.000Z"],
  ]);
  const catchUpJobs = result.scheduledJobs ?? [];
  assert.equal(catchUpJobs.length, 5);
  const ordinaryContinuation = requireValue(
    catchUpJobs.at(-1),
    "Expected the ordinary timeseries continuation after temporal catch-up jobs.",
  );
  assert.equal(ordinaryContinuation.payload?.temporalAuthorityTimeZone, undefined);
  assert.equal(ordinaryContinuation.payload?.timeseriesResourceCursor, "blood_oxygen");
  assert.deepEqual(
    catchUpJobs.slice(0, 4).map((job) => ({
      availableAt: job.availableAt,
      dayKey: String(job.payload?.windowStart ?? "").slice(0, 10),
      priority: job.priority,
      resource: job.payload?.resource,
      windowEnd: job.payload?.windowEnd,
      windowStart: job.payload?.windowStart,
    })),
    [
      {
        availableAt: "2026-04-06T00:00:00.000Z",
        dayKey: "2026-04-03",
        priority: 30,
        resource: "blood_oxygen",
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-03T00:00:00.000Z",
      },
      {
        availableAt: "2026-04-06T00:00:00.000Z",
        dayKey: "2026-04-03",
        priority: 30,
        resource: "stress_level",
        windowEnd: "2026-04-04T00:00:00.000Z",
        windowStart: "2026-04-03T00:00:00.000Z",
      },
      {
        availableAt: "2026-04-06T00:00:00.001Z",
        dayKey: "2026-04-02",
        priority: 30,
        resource: "blood_oxygen",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      },
      {
        availableAt: "2026-04-06T00:00:00.001Z",
        dayKey: "2026-04-02",
        priority: 30,
        resource: "stress_level",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      },
    ],
  );
  assert.equal(new Set(catchUpJobs.map((job) => job.dedupeKey)).size, 5);

  const firstCatchUp = requireValue(catchUpJobs[0], "Expected the newest blood-oxygen catch-up job.");
  const firstCatchUpPayload = requireValue(
    firstCatchUp.payload,
    "Expected the temporal catch-up payload.",
  );
  await executeJunctionJob(
    provider,
    context,
    {
      ...createJob("resource", firstCatchUpPayload),
      dedupeKey: firstCatchUp.dedupeKey ?? null,
      priority: firstCatchUp.priority ?? 0,
    },
  );
  assert.deepEqual(requestedWindows.at(-1), [
    "blood_oxygen",
    "2026-04-03T00:00:00.000Z",
    "2026-04-04T00:00:00.000Z",
  ]);
  assert.deepEqual(
    (imports.at(-1)?.options as { completeSourceDay?: unknown })?.completeSourceDay,
    {
      connectionId: "jxn_acct_27cc43a25baa9a976e1d67c7cdc72208",
      dayKey: "2026-04-03",
      resources: ["blood_oxygen"],
      revisionAt: "2026-04-06T00:00:00.000Z",
      timeZone: "UTC",
    },
  );
  assert.deepEqual(
    (imports.at(-1)?.snapshot as { timeseries?: unknown }).timeseries,
    { blood_oxygen: [] },
  );
});

test("Junction reconcile preserves healthy temporal work and the older backlog when one newest fetch fails", async () => {
  const requestedResources: string[] = [];
  const importedAuthority: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    const resource = url.pathname.match(
      /^\/v2\/timeseries\/junction-user-1\/(blood_oxygen|stress_level)\/grouped$/u,
    )?.[1];
    if (resource) {
      requestedResources.push(resource);
      return resource === "blood_oxygen"
        ? createJsonResponse({ code: "upstream_unavailable" }, 503)
        : createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    reconcileDays: 3,
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-06T00:00:00.000Z",
      importSnapshot: async (_snapshot, options) => {
        if (options) {
          importedAuthority.push(options);
        }
        return { canonicalEventCount: 0, durableDeliveryAccepted: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-03T00:00:00.000Z",
      windowEnd: "2026-04-06T00:00:00.000Z",
    }),
  );

  assert.equal(requestedResources.filter((resource) => resource === "blood_oxygen").length, 3);
  assert.equal(requestedResources.filter((resource) => resource === "stress_level").length, 1);
  assert.deepEqual(
    (importedAuthority[0] as { completeSourceDay?: unknown })?.completeSourceDay,
    {
      connectionId: "jxn_acct_27cc43a25baa9a976e1d67c7cdc72208",
      dayKey: "2026-04-04",
      resources: ["stress_level"],
      revisionAt: "2026-04-06T00:00:00.000Z",
      timeZone: "UTC",
    },
  );
  assert.deepEqual(
    (result.scheduledJobs ?? []).map((job) => [
      job.payload?.temporalAuthorityTimeZone === undefined
        ? undefined
        : String(job.payload?.windowStart ?? "").slice(0, 10),
      job.payload?.temporalAuthorityTimeZone === undefined
        ? undefined
        : job.payload?.resource,
    ]),
    [
      ["2026-04-04", "blood_oxygen"],
      ["2026-04-03", "blood_oxygen"],
      ["2026-04-03", "stress_level"],
      ["2026-04-02", "blood_oxygen"],
      ["2026-04-02", "stress_level"],
      [undefined, undefined],
    ],
  );
  assert.equal(new Set((result.scheduledJobs ?? []).map((job) => job.dedupeKey)).size, 6);
});

test("Junction reconcile durably schedules yielded temporal work and the older backlog", async () => {
  const requestedResources: string[] = [];
  let yieldChecks = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    const resource = url.pathname.match(
      /^\/v2\/timeseries\/junction-user-1\/(blood_oxygen|stress_level)\/grouped$/u,
    )?.[1];
    if (resource) {
      requestedResources.push(resource);
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    reconcileDays: 3,
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-06T00:00:00.000Z",
      shouldYield: () => {
        yieldChecks += 1;
        return yieldChecks > 1;
      },
    }),
    createJob("reconcile", {
      summaryPhaseComplete: true,
      windowStart: "2026-04-03T00:00:00.000Z",
      windowEnd: "2026-04-06T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requestedResources, ["blood_oxygen"]);
  assert.deepEqual(
    (result.scheduledJobs ?? [])
      .filter((job) => job.payload?.temporalAuthorityTimeZone)
      .map((job) => [String(job.payload?.windowStart ?? "").slice(0, 10), job.payload?.resource]),
    [
      ["2026-04-04", "stress_level"],
      ["2026-04-03", "blood_oxygen"],
      ["2026-04-03", "stress_level"],
      ["2026-04-02", "blood_oxygen"],
      ["2026-04-02", "stress_level"],
    ],
  );
});

test("Junction reconcile keeps provider-date and vault-local daily windows separate", async () => {
  const dayMs = 24 * 60 * 60_000;
  const windowEnd = "2026-04-20T00:00:00.000Z";
  const temporalWindowByTimeZone = {
    "America/Los_Angeles": [
      "2026-04-18T07:00:00.000Z",
      "2026-04-19T07:00:00.000Z",
    ],
    "Asia/Tokyo": [
      "2026-04-17T15:00:00.000Z",
      "2026-04-18T15:00:00.000Z",
    ],
    UTC: [
      "2026-04-18T00:00:00.000Z",
      "2026-04-19T00:00:00.000Z",
    ],
  } as const;

  for (const [timeZone, expectedTemporalWindow] of Object.entries(
    temporalWindowByTimeZone,
  )) {
    for (const horizonDays of [1, 7, 14]) {
      const requestedWindows: Array<{
        end: string | null;
        resource: string;
        start: string | null;
      }> = [];
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [] });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        const resource = url.pathname.match(
          /^\/v2\/timeseries\/junction-user-1\/(hrv|stress_level)\/grouped$/u,
        )?.[1];
        if (resource) {
          requestedWindows.push({
            end: url.searchParams.get("end_date"),
            resource,
            start: url.searchParams.get("start_date"),
          });
          return createJsonResponse({ groups: {} });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, {
        reconcileDays: horizonDays,
        timeseriesResources: ["hrv", "stress_level"],
      });
      const windowStart = new Date(Date.parse(windowEnd) - horizonDays * dayMs).toISOString();

      const initialResult = await executeJunctionJob(
        provider,
        createJunctionJobContext({
          now: "2026-04-20T12:00:00.000Z",
          vaultTimeZone: timeZone,
        }),
        createJob("reconcile", { windowEnd, windowStart }),
      );
      await executeFullJobTimeseriesContinuations({
        context: createJunctionJobContext({
          now: "2026-04-20T12:00:00.000Z",
          vaultTimeZone: timeZone,
        }),
        initialResult,
        provider,
      });

      const expectedProviderDates = Array.from({ length: horizonDays }, (_, index) =>
        new Date(Date.parse(windowStart) + index * dayMs).toISOString().slice(0, 10)
      );
      assert.deepEqual(
        requestedWindows
          .filter(({ resource }) => resource === "hrv")
          .map(({ end, start }) => [start, end]),
        expectedProviderDates.map((date) => [date, date]),
      );
      assert.deepEqual(
        requestedWindows
          .filter(({ resource }) => resource === "stress_level")
          .map(({ end, start }) => [start, end]),
        [expectedTemporalWindow, ...expectedProviderDates.map((date) => [date, date])],
      );
    }
  }
});

test("Junction temporal recovery clamps its composed horizon to fourteen days", async () => {
  let temporalRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (url.pathname.startsWith("/v2/timeseries/junction-user-1/")) {
      temporalRequests += 1;
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    reconcileDays: 99,
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({ now: "2026-04-20T00:00:00.000Z" }),
    createJob("reconcile", {
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-04-20T00:00:00.000Z",
    }),
  );

  assert.equal(temporalRequests, 2);
  assert.equal(result.scheduledJobs?.length, 27);
  assert.deepEqual(
    result.scheduledJobs?.slice(0, 2).map((job) => String(job.payload?.windowStart ?? "").slice(0, 10)),
    ["2026-04-17", "2026-04-17"],
  );
  assert.deepEqual(
    result.scheduledJobs?.slice(-3).map((job) =>
      job.payload?.temporalAuthorityTimeZone === undefined
        ? undefined
        : String(job.payload?.windowStart ?? "").slice(0, 10)),
    ["2026-04-05", "2026-04-05", undefined],
  );
});

test("Junction yielded temporal recovery caps at twenty-eight children and one ordinary owner", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request after yield: ${url.toString()}`);
  }, {
    reconcileDays: 99,
    timeseriesResources: ["blood_oxygen", "stress_level", "hrv"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-20T00:00:00.000Z",
      shouldYield: () => true,
    }),
    createJob("reconcile", {
      summaryPhaseComplete: true,
      windowStart: "2026-04-06T00:00:00.000Z",
      windowEnd: "2026-04-20T00:00:00.000Z",
    }),
  );
  const scheduledJobs = result.scheduledJobs ?? [];

  assert.equal(scheduledJobs.length, 29);
  assert.equal(scheduledJobs.filter((job) => job.kind === "resource").length, 28);
  assert.equal(scheduledJobs.filter((job) => job.kind === "reconcile").length, 1);
});

test("Junction temporal catch-up yields and upstream failures remain retryable", async () => {
  const payload = {
    resource: "stress_level",
    resourceCategory: "timeseries",
    temporalAuthorityDayKey: "2026-04-03",
    temporalAuthorityTimeZone: "UTC",
    windowEnd: "2026-04-04T00:00:00.000Z",
    windowStart: "2026-04-03T00:00:00.000Z",
  };
  const yieldedProvider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    throw new Error(`Unexpected request after yield: ${url.toString()}`);
  }, { timeseriesResources: ["stress_level"] });

  await assert.rejects(
    () => executeJunctionJob(
      yieldedProvider,
      createJunctionJobContext({
        now: "2026-04-06T00:00:00.000Z",
        shouldYield: () => true,
      }),
      createJob("resource", payload),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_TEMPORAL_AUTHORITY_JOB_YIELDED");
      assert.equal(error.retryable, true);
      return true;
    },
  );

  const failedProvider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      return createJsonResponse({ code: "upstream_unavailable" }, 503);
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { timeseriesResources: ["stress_level"] });
  await assert.rejects(
    () => executeJunctionJob(
      failedProvider,
      createJunctionJobContext({ now: "2026-04-06T00:00:00.000Z" }),
      createJob("resource", payload),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.retryable, true);
      return true;
    },
  );

  const completedProvider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { timeseriesResources: ["stress_level"] });
  const completedResult = await executeJunctionJob(
    completedProvider,
    createJunctionJobContext({ now: "2026-04-06T00:00:00.000Z" }),
    createJob("resource", payload),
  );
  assert.equal(completedResult.nextReconcileAt, "2026-04-06T01:00:00.000Z");

  const staleTimeZoneResult = await executeJunctionJob(
    completedProvider,
    createJunctionJobContext({
      now: "2026-04-06T00:00:00.000Z",
      vaultTimeZone: "America/Los_Angeles",
    }),
    createJob("resource", payload),
  );
  assert.deepEqual(staleTimeZoneResult, {});
});

test("Junction closed daily timeseries imports carry the exclusive temporal source-day proof", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      assert.equal(url.searchParams.get("start_date"), "2026-04-22T00:00:00.000Z");
      assert.equal(url.searchParams.get("end_date"), "2026-04-23T00:00:00.000Z");
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [
              {
                start: "2026-04-22T12:00:00.000Z",
                timezone_offset: -18_000,
                value: 20,
              },
              {
                start: "2026-04-23T00:05:00.000Z",
                timezone_offset: -18_000,
                value: 30,
              },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    timeseriesResources: ["stress_level"],
  });
  const importedSnapshots: unknown[] = [];
  const importOptions: unknown[] = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-24T12:00:00.000Z",
      importSnapshot: async (snapshot, options) => {
        importedSnapshots.push(snapshot);
        importOptions.push(options);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-23T00:00:00.000Z",
    }),
  );

  const dailySnapshotIndex = importedSnapshots.findIndex((snapshot) =>
    Boolean((snapshot as { timeseries?: Record<string, unknown> }).timeseries?.stress_level)
  );
  assert.deepEqual(
    (importOptions[dailySnapshotIndex] as { completeSourceDay?: unknown })?.completeSourceDay,
    {
      connectionId: "jxn_acct_27cc43a25baa9a976e1d67c7cdc72208",
      dayKey: "2026-04-22",
      resources: ["stress_level"],
      revisionAt: "2026-04-24T12:00:00.000Z",
      timeZone: "UTC",
    },
  );
  const dailySnapshot = importedSnapshots[dailySnapshotIndex] as {
    timeseries?: { stress_level?: Array<{ start?: string }> };
  };
  assert.equal(dailySnapshot.timeseries?.stress_level?.length, 1);
  assert.equal(dailySnapshot.timeseries?.stress_level?.[0]?.start, "2026-04-22T12:00:00.000Z");
});

test("Junction temporal authority fetches reject structurally incomplete responses", async () => {
  const malformedPayloads: unknown[] = [
    { groups: { garmin: null } },
    { groups: { garmin: [null] } },
    { groups: { garmin: [{ data: [null], source: { provider: "garmin", type: "watch" } }] } },
    // Schema-drifted singletons: a source group or data value that is an
    // object instead of an array cannot certify a complete collection.
    { groups: { garmin: { data: [], source: { provider: "garmin", type: "watch" } } } },
    {
      groups: {
        garmin: [{
          data: { timestamp: "2026-04-22T07:00:00.000Z", value: 40 },
          source: { provider: "garmin", type: "watch" },
        }],
      },
    },
    // Generic and legacy transport envelopes parse for ordinary ingestion but
    // carry no grouped proof, so they can never certify a complete source day.
    [],
    { data: [] },
    { results: [] },
    { stress_level: [] },
    // The SDK parse-error fallback returns the raw successful body text.
    "[]",
  ];
  for (const malformedPayload of malformedPayloads) {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [] });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
        return createJsonResponse(malformedPayload);
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, { timeseriesResources: ["stress_level"] });

    await assert.rejects(
      executeJunctionJob(
        provider,
        createJunctionJobContext({
          now: "2026-04-24T12:00:00.000Z",
          importSnapshot: async (snapshot) => {
            importedSnapshots.push(snapshot);
            return { imported: true };
          },
        }),
        createJob("resource", {
          resource: "stress_level",
          resourceCategory: "timeseries",
          temporalAuthorityDayKey: "2026-04-22",
          temporalAuthorityTimeZone: "UTC",
          windowStart: "2026-04-22T00:00:00.000Z",
          windowEnd: "2026-04-23T00:00:00.000Z",
        }),
      ),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code
          === "JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION"
        && (error as { retryable?: boolean }).retryable === true,
    );
    assert.equal(importedSnapshots.length, 0);
  }

  const emptyPayloads: unknown[] = [
    { groups: {} },
    { groups: { garmin: [] } },
    { groups: { garmin: [{ data: [], source: { provider: "garmin", type: "watch" } }] } },
  ];
  for (const emptyPayload of emptyPayloads) {
    const emptyImports: Array<{ options: unknown }> = [];
    const emptyProvider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [] });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
        return createJsonResponse(emptyPayload);
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, { timeseriesResources: ["stress_level"] });
    await executeJunctionJob(
      emptyProvider,
      createJunctionJobContext({
        now: "2026-04-24T12:00:00.000Z",
        importSnapshot: async (_snapshot, options) => {
          emptyImports.push({ options });
          return { imported: true };
        },
      }),
      createJob("resource", {
        resource: "stress_level",
        resourceCategory: "timeseries",
        temporalAuthorityDayKey: "2026-04-22",
        temporalAuthorityTimeZone: "UTC",
        windowStart: "2026-04-22T00:00:00.000Z",
        windowEnd: "2026-04-23T00:00:00.000Z",
      }),
    );
    assert.equal(emptyImports.length, 1);
    assert.deepEqual(
      (emptyImports[0]?.options as { completeSourceDay?: { dayKey?: string } })
        ?.completeSourceDay?.dayKey,
      "2026-04-22",
    );
  }
});

test("Junction authorized-day filtering retains contradictory absolute-marked-floating rows for the importer", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [
              // Semantically agreed adjacent-day overlap is still excluded.
              { timestamp: "2026-04-21T23:30:00.000Z", value: 10 },
              { timestamp: "2026-04-22T07:00:00.000Z", value: 40 },
              // Parser-valid absolute raws explicitly marked floating are
              // contradictory input the importer must see, never adjacent-day
              // overlap the filter may discard: one dated on the previous
              // day, one dated on the authorized day with an instant that
              // maps outside it.
              { timestamp: "2026-04-21T23:45:00Z", timestampSemantics: "floating", value: 50 },
              { timestamp: "2026-04-22T23:30:00-05:00", timestampSemantics: "floating", value: 60 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { timeseriesResources: ["stress_level"] });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-24T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      resource: "stress_level",
      resourceCategory: "timeseries",
      temporalAuthorityDayKey: "2026-04-22",
      temporalAuthorityTimeZone: "UTC",
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-23T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const rows = (importedSnapshots[0] as {
    timeseries?: { stress_level?: Array<{ timestamp?: string }> };
  }).timeseries?.stress_level ?? [];
  assert.deepEqual(
    rows.map((row) => row.timestamp),
    [
      "2026-04-22T07:00:00.000Z",
      "2026-04-21T23:45:00Z",
      "2026-04-22T23:30:00-05:00",
    ],
  );
});

test("Junction successful-empty temporal days still carry authoritative replacement proof", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { timeseriesResources: ["stress_level"] });
  const imports: Array<{ options: unknown; snapshot: unknown }> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-24T12:00:00.000Z",
      importSnapshot: async (snapshot, options) => {
        imports.push({ options, snapshot });
        return { canonicalEventCount: 0, durableDeliveryAccepted: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-23T00:00:00.000Z",
    }),
  );

  const authoritativeImport = imports.find(({ options }) =>
    Boolean((options as { completeSourceDay?: unknown } | undefined)?.completeSourceDay)
  );
  assert.deepEqual(
    (authoritativeImport?.options as { completeSourceDay?: unknown })?.completeSourceDay,
    {
      connectionId: "jxn_acct_27cc43a25baa9a976e1d67c7cdc72208",
      dayKey: "2026-04-22",
      resources: ["stress_level"],
      revisionAt: "2026-04-24T12:00:00.000Z",
      timeZone: "UTC",
    },
  );
  assert.deepEqual(
    (authoritativeImport?.snapshot as { timeseries?: unknown })?.timeseries,
    { stress_level: [] },
  );
});

test.each([
  {
    timeZone: "America/Los_Angeles",
    targetDay: "2026-04-22",
    now: "2026-04-25T06:00:00.000Z",
    jobWindowStart: "2026-04-22T00:00:00.000Z",
    jobWindowEnd: "2026-04-24T00:00:00.000Z",
    dayStart: "2026-04-22T07:00:00.000Z",
    dayEnd: "2026-04-23T07:00:00.000Z",
    beforeDay: "2026-04-22T06:59:59.000Z",
    insideLate: "2026-04-23T06:59:59.000Z",
  },
  {
    timeZone: "Asia/Tokyo",
    targetDay: "2026-04-22",
    now: "2026-04-24T14:00:00.000Z",
    jobWindowStart: "2026-04-21T00:00:00.000Z",
    jobWindowEnd: "2026-04-23T00:00:00.000Z",
    dayStart: "2026-04-21T15:00:00.000Z",
    dayEnd: "2026-04-22T15:00:00.000Z",
    beforeDay: "2026-04-21T14:59:59.000Z",
    insideLate: "2026-04-22T14:59:59.000Z",
  },
])("Junction complete $timeZone days filter absolute instants and floating raw days before import", async ({
  beforeDay,
  dayEnd,
  dayStart,
  insideLate,
  jobWindowEnd,
  jobWindowStart,
  now,
  targetDay,
  timeZone,
}) => {
  const importedByProcessTimeZone: string[][] = [];
  const originalProcessTimeZone = process.env.TZ;
  try {
    for (const processTimeZone of ["UTC", "Pacific/Auckland"]) {
      process.env.TZ = processTimeZone;
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [{
            id: "provider-garmin-temporal-boundary",
            slug: "garmin",
            status: "connected",
          }] });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
          if (url.searchParams.get("next_cursor") === "page-2") {
            return createJsonResponse({
              groups: { garmin: [{
                data: [
                  { timestamp: `${targetDay}T23:59:00`, value: 60 },
                  {
                    timestamp: `${targetDay}T12:00:00Z`,
                    timestampSemantics: "floating",
                    value: 70,
                  },
                ],
                source: { provider: "garmin", type: "watch" },
              }] },
            });
          }
          return createJsonResponse({
            next_cursor: "page-2",
            groups: { garmin: [{
              data: [
                { timestamp: beforeDay, value: 10 },
                { timestamp: dayStart, value: 20 },
                { timestamp: insideLate, value: 30 },
                { timestamp: dayEnd, value: 40 },
                { timestamp: `${targetDay}T00:01:00`, value: 50 },
                { timestamp: "2026-04-21T23:59:00", value: 80 },
                { timestamp: "2026-04-23T00:00:00", value: 90 },
              ],
              source: { provider: "garmin", type: "watch" },
            }] },
          });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, { timeseriesResources: ["stress_level"] });
      const imported: string[] = [];

      await executeJunctionJob(
        provider,
        createJunctionJobContext({
          now,
          vaultTimeZone: timeZone,
          importSnapshot: async (snapshot) => {
            imported.push(
              ...((snapshot as { timeseries?: { stress_level?: Array<{ timestamp?: string }> } })
                .timeseries?.stress_level ?? []).flatMap((record) =>
                  typeof record.timestamp === "string" ? [record.timestamp] : []
                ),
            );
            return { canonicalEventCount: 0, durableDeliveryAccepted: true };
          },
        }),
        createJob("reconcile", {
          windowStart: jobWindowStart,
          windowEnd: jobWindowEnd,
        }),
      );
      importedByProcessTimeZone.push(imported);
    }
  } finally {
    if (originalProcessTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalProcessTimeZone;
    }
  }

  const expected = [
    dayStart,
    insideLate,
    `${targetDay}T00:01:00`,
    `${targetDay}T23:59:00`,
    `${targetDay}T12:00:00Z`,
  ];
  assert.deepEqual(importedByProcessTimeZone[0], expected);
  assert.deepEqual(importedByProcessTimeZone[1], expected);
});

test("Junction temporal authority waits for a closed vault-local day plus the safety lag", async () => {
  const requestedWindows: Array<[string | null, string | null]> = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      const requestWindow: [string | null, string | null] = [
        url.searchParams.get("start_date"),
        url.searchParams.get("end_date"),
      ];
      requestedWindows.push(requestWindow);
      return requestWindow[0] === "2026-04-22T07:00:00.000Z"
        ? createJsonResponse({
            groups: {
              garmin: [{
                data: [
                  { start: "2026-04-23T01:00:00.000Z", value: 20 },
                  { start: "2026-04-23T01:05:00.000Z", value: 80 },
                ],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          })
        : createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { timeseriesResources: ["stress_level"] });
  const imports: Array<{ options: unknown; snapshot: unknown }> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-25T06:00:00.000Z",
      vaultTimeZone: "America/Los_Angeles",
      importSnapshot: async (snapshot, options) => {
        imports.push({ options, snapshot });
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-25T00:00:00.000Z",
    }),
  );

  assert.equal(requestedWindows.some(([start, end]) =>
    start === "2026-04-22T07:00:00.000Z" && end === "2026-04-23T07:00:00.000Z"
  ), true);
  const target = imports.find(({ snapshot }) =>
    (snapshot as { windowStart?: string }).windowStart === "2026-04-22T07:00:00.000Z"
  );
  assert.deepEqual(
    (target?.options as { completeSourceDay?: unknown })?.completeSourceDay,
    {
      connectionId: "jxn_acct_27cc43a25baa9a976e1d67c7cdc72208",
      dayKey: "2026-04-22",
      resources: ["stress_level"],
      revisionAt: "2026-04-25T06:00:00.000Z",
      timeZone: "America/Los_Angeles",
    },
  );
  assert.equal(
    ((target?.snapshot as { timeseries?: { stress_level?: unknown[] } })
      .timeseries?.stress_level?.length ?? 0),
    2,
  );
  const stillInsideLag = imports.find(({ snapshot }) =>
    (snapshot as { windowStart?: string }).windowStart === "2026-04-23T07:00:00.000Z"
  );
  assert.equal(
    (stillInsideLag?.options as { completeSourceDay?: unknown })?.completeSourceDay,
    undefined,
  );
});

test("Junction daily timeseries continues healthy peers and queues a failed temporal resource", async () => {
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
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{ start: "2026-04-02T08:00:00.000Z", value: 42 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["water", "hrv", "blood_oxygen"],
  });

  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { canonicalEventCount: 1, durableDeliveryAccepted: true };
    },
    now: "2026-04-04T12:00:00.000Z",
  });
  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  await assert.rejects(
    executeFullJobTimeseriesContinuations({
      context,
      initialResult: result,
      provider,
    }),
    /junction_timeseries_collection/u,
  );

  assert.equal(requests.some((url) => url.includes("/blood_oxygen/grouped")), true);
  assert.equal(requests.some((url) => url.includes("/water/grouped")), true);
  assert.equal(requests.some((url) => url.includes("/hrv/grouped")), true);
  const importedTimeseries = importedSnapshots.flatMap((snapshot) =>
    Object.keys((snapshot as { timeseries?: Record<string, unknown[]> }).timeseries ?? {})
  );
  assert.deepEqual(importedTimeseries, ["water", "hrv"]);
  assert.equal((result.scheduledJobs ?? []).some((job) =>
    job.payload?.temporalAuthorityTimeZone !== undefined
    && String(job.payload?.windowStart ?? "").startsWith("2026-04-02")
    && job.payload?.resource === "blood_oxygen"
  ), true);
});

test("Junction dense jobs retain complete offset days in either transport order", async () => {
  for (const versioned of [false, true]) {
    for (const order of [["resource", "reconcile"], ["reconcile", "resource"]] as const) {
      const requests: URL[] = [];
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        requests.push(url);
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [] });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-1/glucose/grouped") {
          const requestedDate = url.searchParams.get("start_date");
          const revision = versioned ? { updatedAt: "2026-04-03T10:00:00.000Z" } : {};
          const records = [
            { providerDay: "2026-04-01", record: { id: "day-1-early", timestamp: "2026-04-01T04:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 5, ...revision } },
            { providerDay: "2026-04-01", record: { id: "day-1-late", timestamp: "2026-04-02T03:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 6, ...revision } },
            { providerDay: "2026-04-02", record: { id: "day-2-early", timestamp: "2026-04-02T04:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 7, ...revision } },
            { providerDay: "2026-04-02", record: { id: "day-2-late", timestamp: "2026-04-03T03:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 8, ...revision } },
          ];
          return createJsonResponse({
            groups: {
              dexcom: [{
                data: records
                  .filter((record) => record.providerDay === requestedDate)
                  .map((record) => record.record),
                source: { provider: "dexcom", type: "cgm" },
              }],
            },
          });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, {
        summaryResources: ["activity"],
        timeseriesResources: ["glucose"],
      });
      const importedSnapshots: unknown[] = [];
      const context = createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
        now: "2026-04-03T12:00:00.000Z",
      });
      const jobs = {
        reconcile: createJob("reconcile", {
          windowStart: "2026-04-01T00:00:00.000Z",
          windowEnd: "2026-04-03T00:00:00.000Z",
        }),
        resource: createJob("resource", {
          resource: "glucose",
          resourceCategory: "timeseries",
          windowStart: "2026-04-01T12:00:00.000Z",
          windowEnd: "2026-04-03T12:00:00.000Z",
        }),
      };

      for (const kind of order) {
        if (kind === "reconcile") {
          await executeJunctionFullJob(provider, context, jobs[kind]);
        } else {
          await executeJunctionJob(provider, context, jobs[kind]);
        }
      }

      const glucoseSnapshots = importedSnapshots.flatMap((snapshot) => {
        const entry = snapshot as {
          timeseries?: Record<string, unknown[]>;
          timeseriesWindowKind?: string;
          windowEnd?: string;
          windowStart?: string;
        };
        const records = entry.timeseries?.glucose;
        return records
          ? [{
            records,
            snapshot,
            timeseriesWindowKind: entry.timeseriesWindowKind,
            windowEnd: entry.windowEnd,
            windowStart: entry.windowStart,
            }]
          : [];
      });
      assert.deepEqual(
        glucoseSnapshots.map(({ records, timeseriesWindowKind, windowEnd, windowStart }) => ({
          dates: records.map((record) => (record as { timestamp?: string }).timestamp?.slice(0, 10)),
          timeseriesWindowKind,
          windowEnd,
          windowStart,
        })),
        [
          {
            dates: ["2026-04-01", "2026-04-02"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-02T00:00:00.000Z",
            windowStart: "2026-04-01T00:00:00.000Z",
          },
          {
            dates: ["2026-04-02", "2026-04-03"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-03T00:00:00.000Z",
            windowStart: "2026-04-02T00:00:00.000Z",
          },
          {
            dates: ["2026-04-01", "2026-04-02"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-02T00:00:00.000Z",
            windowStart: "2026-04-01T00:00:00.000Z",
          },
          {
            dates: ["2026-04-02", "2026-04-03"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-03T00:00:00.000Z",
            windowStart: "2026-04-02T00:00:00.000Z",
          },
        ],
      );
      assert.deepEqual(
        glucoseSnapshots.map(({ snapshot }) => {
          const normalized = normalizeJunctionSnapshot(snapshot as JunctionSnapshotInput);
          const daily = normalized.events?.find((event) => event.fields?.metric === "glucose");
          const feature = normalized.evidenceParts?.find((part) =>
            part.role.startsWith("junction-timeseries-features-glucose:")
          )?.content as { sampleCount?: number } | undefined;
          return {
            dayKey: daily?.dayKey,
            sampleCount: feature?.sampleCount,
            value: daily?.fields?.value,
          };
        }),
        [
          { dayKey: "2026-04-01", sampleCount: 2, value: 99.1001 },
          { dayKey: "2026-04-02", sampleCount: 2, value: 135.1365 },
          { dayKey: "2026-04-01", sampleCount: 2, value: 99.1001 },
          { dayKey: "2026-04-02", sampleCount: 2, value: 135.1365 },
        ],
      );
      assert.equal(
        requests
          .filter((url) => url.pathname.includes("/v2/timeseries/"))
          .every((url) => !url.searchParams.get("start_date")?.includes("T")),
        true,
      );
    }
  }
  assert.equal(Date.parse("2026-04-02T03:30:00Z") >= Date.parse("2026-04-02T00:00:00Z"), true);
});

test("Junction dense jobs wait for global provider-day closure in either transport order", async () => {
  for (const versioned of [false, true]) {
    for (const order of [["resource", "reconcile"], ["reconcile", "resource"]] as const) {
      const requests: URL[] = [];
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        requests.push(url);
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [] });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-1/glucose/grouped") {
          const revision = versioned ? { updatedAt: "2026-04-02T11:00:00.000Z" } : {};
          return createJsonResponse({
            groups: {
              dexcom: [{
                data: [
                  {
                    id: "provider-day-early",
                    timestamp: "2026-04-01T00:30:00-07:00",
                    value: 5,
                    ...revision,
                  },
                  {
                    id: "provider-day-late",
                    timestamp: "2026-04-01T23:30:00-07:00",
                    value: 6,
                    ...revision,
                  },
                ],
                source: { provider: "dexcom", type: "cgm" },
              }],
            },
          });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, {
        summaryResources: ["activity"],
        timeseriesResources: ["glucose"],
      });
      const importedSnapshots: unknown[] = [];
      const jobs = {
        reconcile: createJob("reconcile", {
          windowStart: "2026-04-01T00:00:00.000Z",
          windowEnd: "2026-04-02T00:00:00.000Z",
        }),
        resource: createJob("resource", {
          resource: "glucose",
          resourceCategory: "timeseries",
          windowStart: "2026-04-01T00:00:00.000Z",
          windowEnd: "2026-04-02T00:00:00.000Z",
        }),
      };
      const importSnapshot = async (snapshot: unknown) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      };
      const execute = (
        kind: keyof typeof jobs,
        context: ProviderJobContext,
      ) => kind === "reconcile"
        ? executeJunctionFullJob(provider, context, jobs[kind])
        : executeJunctionJob(provider, context, jobs[kind]);

      for (const kind of order) {
        await execute(
          kind,
          createJunctionJobContext({
            importSnapshot,
            now: "2026-04-02T00:05:00.000Z",
          }),
        );
      }
      assert.equal(
        requests.some((url) => url.pathname.includes("/v2/timeseries/")),
        false,
      );
      assert.equal(
        importedSnapshots.some((snapshot) =>
          Boolean((snapshot as { timeseries?: { glucose?: unknown[] } }).timeseries?.glucose)
        ),
        false,
      );

      for (const kind of order) {
        await execute(
          kind,
          createJunctionJobContext({
            account: createAccount({ lastSyncCompletedAt: "2026-04-02T00:05:00.000Z" }),
            importSnapshot,
            now: "2026-04-02T12:00:00.000Z",
          }),
        );
      }
      const glucoseSnapshots = importedSnapshots.flatMap((snapshot) => {
        const entry = snapshot as {
          timeseries?: { glucose?: Array<{ timestamp?: string }> };
          timeseriesWindowKind?: string;
        };
        return entry.timeseries?.glucose
          ? [{ records: entry.timeseries.glucose, windowKind: entry.timeseriesWindowKind }]
          : [];
      });
      assert.equal(glucoseSnapshots.length, 2);
      assert.deepEqual(
        glucoseSnapshots.map(({ records, windowKind }) => ({
          dates: records.map((record) => record.timestamp?.slice(0, 10)),
          windowKind,
        })),
        [
          { dates: ["2026-04-01", "2026-04-01"], windowKind: "calendar_day" },
          { dates: ["2026-04-01", "2026-04-01"], windowKind: "calendar_day" },
        ],
      );
      assert.equal(
        requests
          .filter((url) => url.pathname.includes("/v2/timeseries/"))
          .every((url) => url.searchParams.get("start_date") === "2026-04-01"),
        true,
      );
    }
  }
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
        recordId: "shared-note-record",
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

  const context = createJunctionJobContext({
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  await executeJunctionFullJob(
    provider,
    context,
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

test("Junction keeps same-time blood-pressure values when a fidelity-only id alias is shared", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/blood_pressure/grouped") {
      return createJsonResponse({
        groups: {
          omron: [{
            data: [
              {
                recordId: "shared-blood-pressure-record",
                timestamp: "2026-04-02T18:05:00.000Z",
                systolic: 120,
                diastolic: 80,
              },
              {
                recordId: "shared-blood-pressure-record",
                timestamp: "2026-04-02T18:05:00.000Z",
                systolic: 130,
                diastolic: 85,
              },
            ],
            source: { provider: "omron", type: "cuff" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: ["blood_pressure"],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      now: "2026-04-03T12:00:00.000Z",
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const readings = importedSnapshots.flatMap((snapshot) =>
    (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries?.blood_pressure ?? []
  ) as Array<{ diastolic?: number; systolic?: number }>;
  assert.deepEqual(readings.map((reading) => [reading.systolic, reading.diastolic]), [
    [120, 80],
    [130, 85],
  ]);
});

test("Junction reconcile keeps distinct same-time fidelity records while deduplicating exact repeats", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: {
            blood_oxygen: true,
            glucose: true,
            mindfulness_minutes: true,
            stress_level: true,
            water: true,
          },
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/glucose/grouped") {
      const first = {
        id: "glucose-record-1",
        timestamp: "2026-04-02T08:05:00.000Z",
        unit: "mmol/L",
        value: 5,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [first, { ...first }, { ...first, value: 7 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
      const first = {
        id: "water-record-1",
        start: "2026-04-02T09:00:00.000Z",
        end: "2026-04-02T09:05:00.000Z",
        unit: "mL",
        value: 250,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [
              first,
              { ...first },
              { ...first, start: "2026-04-02T09:02:00.000Z", value: 125 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped") {
      const first = {
        recordId: "oxygen-record-1",
        timestamp: "2026-04-02T10:00:00.000Z",
        oxygenSaturation: 0.91,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [
              first,
              { ...first },
              { ...first, recordId: "oxygen-record-2" },
              { ...first, oxygenSaturation: 0.97 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      const first = {
        providerId: "stress-record-1",
        timestamp: "2026-04-02T11:00:00.000Z",
        averageStressLevel: 50,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [first, { ...first }, { ...first, averageStressLevel: 80 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/mindfulness_minutes/grouped") {
      const first = {
        sampleId: "mindfulness-record-1",
        start: "2026-04-02T12:00:00.000Z",
        end: "2026-04-02T12:05:00.000Z",
        mindfulnessMinutes: 5,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [first, { ...first }, { ...first, mindfulnessMinutes: 10 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["activity"],
    timeseriesResources: [
      "blood_oxygen",
      "glucose",
      "mindfulness_minutes",
      "stress_level",
      "water",
    ],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionFullJob(
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

  const recordsFor = (
    resource: "blood_oxygen" | "glucose" | "mindfulness_minutes" | "stress_level" | "water",
  ) => importedSnapshots.flatMap((snapshot) => {
    const timeseries = (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries;
    return timeseries?.[resource] ?? [];
  });
  const glucoseRecords = recordsFor("glucose") as Array<{ value?: number }>;
  const waterRecords = recordsFor("water") as Array<{ start?: string; value?: number }>;

  assert.deepEqual(glucoseRecords.map((record) => record.value).sort((left, right) =>
    Number(left) - Number(right)
  ), [5, 7]);
  assert.deepEqual(waterRecords.map((record) => [record.start, record.value]).sort(), [
    ["2026-04-02T09:00:00.000Z", 250],
    ["2026-04-02T09:02:00.000Z", 125],
  ]);
  assert.deepEqual(
    (recordsFor("blood_oxygen") as Array<{ oxygenSaturation?: number }>).map((record) =>
      record.oxygenSaturation
    ).sort(),
    [0.91, 0.91, 0.97],
  );
  assert.deepEqual(
    (recordsFor("stress_level") as Array<{ averageStressLevel?: number }>).map((record) =>
      record.averageStressLevel
    ).sort((left, right) => Number(left) - Number(right)),
    [50, 80],
  );
  assert.deepEqual(
    (recordsFor("mindfulness_minutes") as Array<{ mindfulnessMinutes?: number }>).map((record) =>
      record.mindfulnessMinutes
    ).sort((left, right) => Number(left) - Number(right)),
    [5, 10],
  );
});

test("Junction transport preserves provider-day conflicts for importer rejection", async () => {
  const first = {
    id: "water-provider-day-conflict",
    start: "2026-04-02T09:00:00.000Z",
    end: "2026-04-02T09:05:00.000Z",
    updatedAt: "2026-04-03T08:00:00.000Z",
    unit: "mL",
    value: 250,
  };
  const conflicts = [
    [
      { ...first, calendarDate: "2026-04-02" },
      { ...first, calendarDate: "2026-04-03" },
    ],
    [
      { ...first, timestampSemantics: "utc" },
      { ...first, timestampSemantics: "floating" },
    ],
  ];

  for (const conflict of conflicts) {
    for (const records of [conflict, [...conflict].reverse()]) {
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
          return createJsonResponse({
            groups: {
              garmin: [{
                data: records,
                source: { provider: "garmin", type: "watch" },
              }],
            },
          });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, {
        summaryResources: ["activity"],
        timeseriesResources: ["water"],
      });

      await assert.rejects(
        executeJunctionFullJob(
          provider,
          createJunctionJobContext({
            now: "2026-04-03T12:00:00.000Z",
            importSnapshot: async (snapshot) => {
              normalizeJunctionSnapshot(snapshot as Parameters<typeof normalizeJunctionSnapshot>[0]);
              return { durableDeliveryAccepted: true, canonicalEventCount: 0 };
            },
          }),
          createJob("reconcile", {
            windowStart: "2026-04-02T00:00:00.000Z",
            windowEnd: "2026-04-03T00:00:00.000Z",
          }),
        ),
        /Junction water stable-id records with different bodies require distinct explicit provider revisions/u,
      );
    }
  }

  const newerBody = {
    ...first,
    calendarDate: "2026-04-03",
    updatedAt: "2026-04-03T09:00:00.000Z",
  };
  for (const records of [
    [{ ...first, calendarDate: "2026-04-02" }, newerBody],
    [newerBody, { ...first, calendarDate: "2026-04-02" }],
  ]) {
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [] });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: records,
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryResources: ["activity"],
      timeseriesResources: ["water"],
    });
    const intervalDayKeys: string[] = [];

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T12:00:00.000Z",
        importSnapshot: async (snapshot) => {
          const normalized = normalizeJunctionSnapshot(
            snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
          );
          intervalDayKeys.push(...(normalized.events ?? []).flatMap((event) =>
            event.kind === "measurement"
                && event.externalRef?.facet === "interval"
                && typeof event.dayKey === "string"
              ? [event.dayKey]
              : []
          ));
          return {
            canonicalEventCount: normalized.events?.length ?? 0,
            canonicalEventDayKeys: intervalDayKeys,
            durableDeliveryAccepted: true,
          };
        },
      }),
      createJob("resource", {
        resource: "water",
        resourceCategory: "timeseries",
        windowStart: "2026-04-02T08:00:00.000Z",
        windowEnd: "2026-04-02T10:00:00.000Z",
      }),
    );

    assert.deepEqual([...new Set(intervalDayKeys)], ["2026-04-03"]);
  }
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

  await executeJunctionFullJob(
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

test("Junction ordinary timeseries correction resumes on the next closed day after generic completion", async () => {
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
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/hrv/grouped")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["hrv"] });
  const importedSnapshots: unknown[] = [];
  const buildContext = (now: string) => ({
    account: createAccount({ lastSyncCompletedAt: "2026-04-03T12:00:00.000Z" }),
    now,
    importSnapshot: async (snapshot: unknown) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    logger: {},
    refreshAccountTokens: async () => createAccount(),
  });

  await executeJunctionFullJob(
    provider,
    buildContext("2026-04-03T12:00:00.000Z"),
    createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    requests.filter((url) => url.includes("/v2/timeseries/junction-user-1/hrv/grouped")).length,
    0,
  );

  requests.length = 0;
  importedSnapshots.length = 0;
  await executeJunctionFullJob(
    provider,
    buildContext("2026-04-04T12:00:00.000Z"),
    createJob("reconcile", {
      windowStart: "2026-03-28T00:00:00.000Z",
      windowEnd: "2026-04-04T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    requests.filter((url) => url.includes("/v2/timeseries/junction-user-1/hrv/grouped")).length,
    7,
  );
});

test("Junction temporal reconcile ignores generic job success and stays bounded to one day", async () => {
  const requestedWindows: Array<{ resource: string; start: string | null; end: string | null }> = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    const resource = /\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped/u.exec(
      url.pathname,
    )?.[1];
    if (resource === "blood_oxygen" || resource === "stress_level") {
      requestedWindows.push({
        resource,
        start: url.searchParams.get("start_date"),
        end: url.searchParams.get("end_date"),
      });
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { timeseriesResources: ["blood_oxygen", "stress_level"] });
  const authorityProofs: unknown[] = [];
  const executeAfterGenericSuccess = () => executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ lastSyncCompletedAt: "2026-04-04T11:59:00.000Z" }),
      now: "2026-04-04T12:00:00.000Z",
      importSnapshot: async (_snapshot, options) => {
        if (options?.completeSourceDay) {
          authorityProofs.push(options.completeSourceDay);
        }
        return { canonicalEventCount: 0, durableDeliveryAccepted: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-03-28T00:00:00.000Z",
      windowEnd: "2026-04-04T00:00:00.000Z",
    }),
  );

  await executeAfterGenericSuccess();
  await executeAfterGenericSuccess();

  assert.deepEqual(requestedWindows, [
    {
      resource: "blood_oxygen",
      start: "2026-04-03",
      end: "2026-04-03",
    },
    {
      resource: "stress_level",
      start: "2026-04-03",
      end: "2026-04-03",
    },
    {
      resource: "blood_oxygen",
      start: "2026-04-02T00:00:00.000Z",
      end: "2026-04-03T00:00:00.000Z",
    },
    {
      resource: "stress_level",
      start: "2026-04-02T00:00:00.000Z",
      end: "2026-04-03T00:00:00.000Z",
    },
    {
      resource: "blood_oxygen",
      start: "2026-04-03",
      end: "2026-04-03",
    },
    {
      resource: "stress_level",
      start: "2026-04-03",
      end: "2026-04-03",
    },
    {
      resource: "blood_oxygen",
      start: "2026-04-02T00:00:00.000Z",
      end: "2026-04-03T00:00:00.000Z",
    },
    {
      resource: "stress_level",
      start: "2026-04-02T00:00:00.000Z",
      end: "2026-04-03T00:00:00.000Z",
    },
  ]);
  assert.equal(authorityProofs.length, 4);
});

test("Junction direct dense resource jobs reuse closed calendar-day ownership", async () => {
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
  const importOptions: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount(),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot, options) => {
        importedSnapshots.push(snapshot);
        importOptions.push(options);
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
      const entry = snapshot as {
        timeseriesWindowKind?: string;
        windowEnd?: string;
        windowStart?: string;
      };
      return [entry.windowStart, entry.windowEnd, entry.timeseriesWindowKind];
    }),
    [["2026-04-02T00:00:00.000Z", "2026-04-03T00:00:00.000Z", "calendar_day"]],
  );
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.deepEqual(snapshot.summaries, {});
  assert.equal(importOptions[0], undefined);
  assert.equal(snapshot.timeseries?.blood_oxygen?.length, 1);
  const timeseriesRequest = requireValue(
    requests.find((url) => url.includes("/v2/timeseries/")),
    "Junction resource job should fetch the hinted timeseries resource.",
  );
  assertJunctionWindowQuery(
    timeseriesRequest,
    "2026-04-02",
    "2026-04-02",
  );
});

test("Junction dense resource windows retain floating values without manufacturing an instant", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      return createJsonResponse({ groups: { garmin: [{
        data: [{ timestamp: "2026-04-22T23:30:00", value: 45 }],
        source: { provider: "garmin", type: "watch" },
      }] } });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { timeseriesResources: ["stress_level"] });
  const imports: Array<{ options: unknown; snapshot: unknown }> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-24T12:00:00.000Z",
      vaultTimeZone: "America/Los_Angeles",
      importSnapshot: async (snapshot, options) => {
        imports.push({ options, snapshot });
        return { canonicalEventCount: 0, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", {
      resource: "stress_level",
      resourceCategory: "timeseries",
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-23T00:00:00.000Z",
    }),
  );

  assert.equal(imports[0]?.options, undefined);
  assert.equal(
    ((imports[0]?.snapshot as { timeseries?: { stress_level?: unknown[] } })
      .timeseries?.stress_level?.length ?? 0),
    1,
  );
});

test("Junction yielded sparse history retains every accepted day as calendar work", async () => {
  const requests: URL[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    requests.push(url);
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { caffeine: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/caffeine/grouped") {
      const requestedDay = requireValue(
        url.searchParams.get("start_date"),
        "Junction sparse history request date",
      );
      assert.equal(requestedDay, url.searchParams.get("end_date"));
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              end: `${requestedDay}T08:05:00.000Z`,
              id: `caffeine-${requestedDay}`,
              start: `${requestedDay}T08:00:00.000Z`,
              unit: "g",
              value: 0.1,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    timeseriesResources: ["caffeine"],
  });
  const sourceRecord = createConnectionSource({
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    resourceAvailabilitySummary: { caffeine: true },
  });
  const source = {
    displayName: sourceRecord.displayName,
    firstSeenAt: sourceRecord.firstSeenAt,
    lastDataAt: sourceRecord.lastDataAt,
    lastErrorCode: sourceRecord.lastErrorCode,
    lastErrorMessage: sourceRecord.lastErrorMessage,
    lastSeenAt: sourceRecord.lastSeenAt,
    resourceAvailabilitySummary: sourceRecord.resourceAvailabilitySummary,
    resourceCount: Object.keys(sourceRecord.resourceAvailabilitySummary).length,
    sourceProviderSlug: sourceRecord.sourceProviderSlug,
    status: sourceRecord.status,
  };
  const now = "2026-04-03T12:00:00.000Z";
  const scheduler = requireValue(
    provider.jobExecutor?.createScheduledJobs,
    "Junction provider should expose scheduled jobs.",
  );
  const initialJob = requireValue(
    scheduler(createStoredAccount({ sources: [source] }), now).jobs.find((job) =>
      job.kind === "resource"
      && job.payload?.historicalBackfill === true
      && job.payload?.resource === "caffeine"
    ),
    "Junction should schedule extended caffeine history.",
  );
  // Keep this continuation proof intentionally small; the scheduler's fixed
  // 180-day extended horizon is covered independently in the owner-policy test.
  const twoDayInitialJob = {
    ...initialJob,
    payload: {
      ...initialJob.payload,
      historicalWindowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    },
  };
  const acceptedDays: string[] = [];
  const context = createJunctionJobContext({
    account: createAccount({ sources: [source] }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const records = (snapshot as {
        timeseries?: { caffeine?: Array<{ start?: string }> };
      }).timeseries?.caffeine ?? [];
      const dayKey = requireValue(records[0]?.start, "accepted caffeine timestamp").slice(0, 10);
      acceptedDays.push(dayKey);
      return {
        canonicalEventCount: records.length,
        canonicalEventDayKeys: [dayKey],
        canonicalSparseCalendarTargets: [{
          dayKey,
          sourceProviderSlug: "garmin",
          sourceType: "watch",
        }],
        durableDeliveryAccepted: true,
      };
    },
    now,
  });

  const firstResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(twoDayInitialJob),
  );
  const preciseContinuation = requireValue(
    firstResult.scheduledJobs?.find((job) =>
      job.payload?.historicalBackfill === true
      && job.payload?.calendarRefreshDay === undefined
    ),
    "Yielded sparse history should retain its precise continuation.",
  );
  const firstCalendarJob = requireValue(
    firstResult.scheduledJobs?.find((job) => job.payload?.calendarRefreshDay === "2026-04-01"),
    "Yielded sparse history should retain its first accepted calendar day.",
  );
  assert.equal(firstCalendarJob.payload?.resource, "caffeine");
  assert.equal(firstCalendarJob.payload?.sourceProviderSlug, "garmin");

  const finalResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(preciseContinuation, 1),
  );
  const finalCalendarJob = requireValue(
    finalResult.scheduledJobs?.find((job) => job.payload?.calendarRefreshDay === "2026-04-02"),
    "Terminal sparse history should retain its final accepted calendar day.",
  );

  assert.deepEqual(acceptedDays, ["2026-04-01", "2026-04-02"]);
  assert.equal(finalCalendarJob.payload?.resource, "caffeine");
  assert.equal(finalResult.scheduledJobs?.some((job) =>
    job.payload?.historicalBackfill === true
    && job.payload?.calendarRefreshDay === undefined
  ), false);
  assert.deepEqual(
    requests
      .filter((url) => url.pathname.includes("/v2/timeseries/"))
      .map((url) => url.searchParams.get("start_date")),
    ["2026-04-01", "2026-04-02"],
  );
  assert.notEqual(firstCalendarJob.dedupeKey, finalCalendarJob.dedupeKey);
});

test("Junction sparse sub-day corrections refresh the provider-owned calendar date", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-kit-1",
          name: "Apple Health",
          resource_availability: { caffeine: true },
          slug: "apple_health_kit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/caffeine/grouped")) {
      const precise = new URL(url).searchParams.get("start_date")?.includes("T") === true;
      return createJsonResponse({
        groups: {
          apple_health_kit: [{
            data: [{
              id: "caffeine-reading-1",
              start: "2026-04-02T23:30:00-04:00",
              end: "2026-04-02T23:35:00-04:00",
              unit: "g",
              value: precise ? 0.095 : 0.105,
            }, {
              id: "caffeine-reading-2",
              start: "2026-04-02T23:40:00-04:00",
              end: "2026-04-02T23:45:00-04:00",
              unit: "g",
              value: precise ? 0.025 : 0.035,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["caffeine"] });
  const importedSnapshots: unknown[] = [];
  const importSnapshot = async (snapshot: unknown) => {
    importedSnapshots.push(snapshot);
    const normalized = normalizeJunctionSnapshot(snapshot as Parameters<
      typeof normalizeJunctionSnapshot
    >[0], { defaultTimeZone: "America/New_York" });
    assert.ok((normalized.events?.length ?? 0) > 0);
    const canonicalSparseCalendarTargets = [...new Map((normalized.events ?? []).flatMap((event) =>
      typeof event.dayKey === "string" && event.dataOrigin?.sourceProviderSlug
        ? [[JSON.stringify([
            event.dayKey,
            event.dataOrigin.sourceProviderSlug,
            event.dataOrigin.sourceType ?? null,
            event.dataOrigin.sourceInstanceId ?? null,
          ]), {
            dayKey: event.dayKey,
            sourceProviderSlug: event.dataOrigin.sourceProviderSlug,
            ...(event.dataOrigin.sourceInstanceId === undefined
              ? {}
              : { sourceInstanceId: event.dataOrigin.sourceInstanceId }),
            ...(event.dataOrigin.sourceType
              ? { sourceType: event.dataOrigin.sourceType }
              : {}),
          }] as const]
        : []
    )).values()];
    return {
      canonicalEventCount: normalized.events?.length ?? 0,
      canonicalEventDayKeys: [...new Set((normalized.events ?? []).flatMap((event) =>
        typeof event.dayKey === "string" ? [event.dayKey] : []
      ))],
      canonicalEventExternalRefResourceIds: (normalized.events ?? []).flatMap((event) =>
        event.externalRef?.resourceId ? [event.externalRef.resourceId] : []
      ),
      canonicalSparseCalendarTargets,
      durableDeliveryAccepted: true,
    };
  };
  const job = createJob("resource", {
    resource: "caffeine",
    resourceCategory: "timeseries",
    windowStart: "2026-04-03T03:25:00.000Z",
    windowEnd: "2026-04-03T03:50:00.000Z",
  });

  const preClosureResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T11:59:59.999Z",
      importSnapshot,
    }),
    job,
  );

  assert.equal(
    requests.filter((url) => url.includes("/v2/timeseries/")).length,
    1,
    "The provider-local April 2 day must remain unpublished before its UTC-12 close boundary.",
  );
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(preClosureResult.scheduledJobs, undefined);
  requests.length = 0;
  importedSnapshots.length = 0;

  const preciseResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot,
    }),
    job,
  );

  const calendarJob = requireValue(
    preciseResult.scheduledJobs?.[0],
    "Junction sparse correction should persist its calendar refresh as a continuation.",
  );
  assert.deepEqual(preciseResult.scheduledJobs, [{
    kind: "resource",
    payload: {
      calendarRefreshDay: "2026-04-02",
      resource: "caffeine",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple_health_kit",
      sourceType: "phone",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    },
    priority: job.priority,
    dedupeKey: sha256ForTest(JSON.stringify([
      "junction",
      "sparse-calendar-refresh",
      "apple_health_kit",
      "phone",
      null,
      "caffeine",
      "2026-04-02",
    ])),
  }]);
  assert.equal(importedSnapshots.length, 1, "Precise completion must not refresh a day transiently.");

  const calendarJobRecord = {
    ...createJob("resource", calendarJob.payload ?? {}),
    dedupeKey: calendarJob.dedupeKey ?? null,
    priority: calendarJob.priority ?? 0,
  };
  const yielded = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot,
      shouldYield: () => true,
    }),
    calendarJobRecord,
  );
  assert.deepEqual(yielded.scheduledJobs, preciseResult.scheduledJobs);
  assert.equal(importedSnapshots.length, 1, "A yielded calendar job must not repeat the precise import.");

  const calendarResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot,
    }),
    calendarJobRecord,
  );
  assert.deepEqual(calendarResult.scheduledJobs, undefined);

  assert.deepEqual(importedSnapshots.map((snapshot) => {
    const entry = snapshot as {
      timeseriesWindowKind?: string;
      windowEnd?: string;
      windowStart?: string;
    };
    return [entry.windowStart, entry.windowEnd, entry.timeseriesWindowKind];
  }), [
    ["2026-04-03T03:25:00.000Z", "2026-04-03T03:50:00.000Z", "precise"],
    ["2026-04-02T00:00:00.000Z", "2026-04-03T00:00:00.000Z", "calendar_day"],
  ]);
  assert.deepEqual(importedSnapshots.map((snapshot) =>
    (snapshot as { timeseries?: { caffeine?: Array<{ value?: number }> } })
      .timeseries?.caffeine?.map((record) => record.value)
  ), [[0.095, 0.025], [0.105, 0.035]]);
  const [preciseRequest, dailyRequest] = requests.filter((url) => url.includes("/v2/timeseries/"));
  const request = requireValue(preciseRequest, "Junction sparse resource job should issue a precise request.");
  assertJunctionWindowQuery(
    request,
    "2026-04-03T03:25:00.000Z",
    "2026-04-03T03:50:00.000Z",
  );
  assertJunctionWindowQuery(
    requireValue(dailyRequest, "Junction sparse resource job should refresh its closed daily total."),
    "2026-04-02",
    "2026-04-02",
  );
});

test("Junction sparse calendar refresh imports an authoritative empty source day", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          fitbit: [{
            data: [{
              end: "2026-04-02T08:01:00.000Z",
              sourceInstanceId: "source-bbbbbbbbbbbbbbbbbbbbbbbb",
              start: "2026-04-02T08:00:00.000Z",
              value: 250,
            }],
            source: { provider: "fitbit", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  const importedSnapshots: unknown[] = [];
  const normalizedImports: ReturnType<typeof normalizeJunctionSnapshot>[] = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        normalizedImports.push(normalizeJunctionSnapshot(snapshot as Parameters<
          typeof normalizeJunctionSnapshot
        >[0], { defaultTimeZone: "America/New_York" }));
        return {
          canonicalEventExternalRefResourceIds: [buildJunctionDailyTimeseriesAggregateResourceId({
            dayKey: "2026-04-02",
            resource: "water",
            sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
            sourceProviderSlug: "garmin",
            sourceType: "watch",
          })],
          durableDeliveryAccepted: true,
        };
      },
    }),
    createJob("resource", {
      calendarRefreshDay: "2026-04-02",
      resource: "water",
      resourceCategory: "timeseries",
      sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(
    (importedSnapshots[0] as {
      timeseries?: { water?: Array<Record<string, unknown>> };
    }).timeseries?.water,
    [{
      authoritativeEmptyCalendarSet: true,
      calendarDate: "2026-04-02",
      date: "2026-04-02",
      sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
      value: 0,
    }],
  );
  const zeroEvent = normalizedImports[0]?.events?.find((event) =>
    event.fields && "metric" in event.fields && event.fields.metric === "water"
  );
  assert.equal(zeroEvent?.dayKey, "2026-04-02");
  assert.equal(
    zeroEvent?.fields && "value" in zeroEvent.fields ? zeroEvent.fields.value : undefined,
    0,
  );
  assert.ok(normalizedImports[0]?.evidenceParts?.some((part) => {
    const content = part.content;
    return typeof content === "object"
      && content !== null
      && "status" in content
      && content.status === "authoritative_empty_calendar_set"
      && "sampleCount" in content
      && content.sampleCount === 0;
  }));
  assert.ok(requests.some((url) =>
    url.includes("provider=garmin")
    && url.includes("start_date=2026-04-02")
    && url.includes("end_date=2026-04-02")
  ));
});

test("Junction sparse calendar refresh rejects nonempty rows that apply no owned daily state", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              date: "2026-04-02",
              sourceProviderSlug: "garmin",
              sourceType: "watch",
              value: "not-a-number",
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async () => ({
          canonicalEventCount: 0,
          canonicalEventExternalRefResourceIds: [],
          durableDeliveryAccepted: true,
        }),
      }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_DAILY_STATE_NOT_APPLIED"
      && error.retryable,
  );
});

test("Junction sparse calendar refresh retains an unavailable optional endpoint", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({ message: "Resource unavailable." }, 422);
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({ now: "2026-04-03T12:00:00.000Z" }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_UNAVAILABLE"
      && error.retryable,
  );
});

test("Junction sparse corrections reject excessive calendar-refresh fanout", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              id: "bounded-water-reading",
              start: "2026-04-02T08:00:00.000Z",
              unit: "mL",
              value: 250,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  const affectedDayKeys = Array.from({ length: 65 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
  );

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async () => ({
          canonicalEventCount: 1,
          canonicalEventDayKeys: affectedDayKeys,
          canonicalSparseCalendarTargets: affectedDayKeys.map((dayKey) => ({
            dayKey,
            sourceProviderSlug: "garmin",
            sourceType: "watch",
          })),
          durableDeliveryAccepted: true,
        }),
      }),
      createJob("resource", {
        resource: "water",
        resourceCategory: "timeseries",
        windowStart: "2026-04-02T08:00:00.000Z",
        windowEnd: "2026-04-02T09:00:00.000Z",
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_DAY_LIMIT_EXCEEDED"
      && !error.retryable,
  );
  assert.equal(
    requests.filter((url) => url.includes("/v2/timeseries/")).length,
    1,
    "The bound must fail before any calendar-day provider-call fanout.",
  );
});

test("Junction dense resource jobs yield between closed calendar days", async () => {
  const requests: string[] = [];
  const requestTimingCategories: string[] = [];
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
      recordProviderRequestTiming: (category, elapsedMs) => {
        assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
        requestTimingCategories.push(category);
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
    [["2026-04-01T00:00:00.000Z", "2026-04-02T00:00:00.000Z"]],
  );
  const timeseriesRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(timeseriesRequests.length, 1);
  assert.deepEqual(requestTimingCategories, ["inventory", "resource"]);
  assertJunctionWindowQuery(
    requireValue(timeseriesRequests[0], "Junction resource job should fetch its first closed day."),
    "2026-04-01",
    "2026-04-01",
  );
  assert.deepEqual(result.scheduledJobs, [
    {
      kind: "resource",
      payload: {
        resource: "blood_oxygen",
        resourceCategory: "timeseries",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      },
      priority: job.priority,
      dedupeKey: sha256ForTest(JSON.stringify([
        "junction",
        "yield-follow-up",
        "2026-04-02T00:00:00.000Z",
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
    now: "2026-04-04T00:00:00.000Z",
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
