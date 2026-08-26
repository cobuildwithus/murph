import {
  DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST,
  assertJunctionWindowQuery,
  createAccount,
  createConnectionSource,
  createEmptyJunctionBackfillProvider,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  createJunctionSvixWebhook,
  createStoredAccount,
  executeJunctionFullJob,
  executeJunctionJob,
  requireJunctionConnectionHandler,
  requireJunctionWebhookHandler,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import {
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
} from "@murphai/importers";
import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  normalizeJunctionResourceName,
  resolveJunctionTimeseriesResourcePolicy,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { test, vi } from "vitest";
import { DeviceSyncError } from "../src/errors.ts";
import { JunctionTimeseriesProgressError } from "../src/junction-timeseries-progress.ts";
import {
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
} from "../src/junction-resources.ts";
import { createJsonResponse, makeTempDirectory, readUrl, requireValue } from "./helpers.ts";
import type {
  DeviceConnectionSourceRecord,
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

test("Junction direct glucose units complete three-page grouped responses", async () => {
  const resource = "glucose";
  let pages = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname !== `/v2/timeseries/junction-user-1/${resource}/grouped`) {
      throw new Error(`Unexpected request: ${url.toString()}`);
    }
    pages += 1;
    return createJsonResponse({
      groups: {},
      ...(pages < 3 ? { next_cursor: `page-${pages + 1}` } : {}),
    });
  }, {
    summaryResources: [],
    timeseriesResources: [resource],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({ now: "2026-04-03T12:00:00.000Z" }),
    createJob("reconcile", {
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor: resource,
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.equal(pages, 3);
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
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
      now: "2026-04-03T12:00:00.000Z",
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
    now: "2026-04-03T12:00:00.000Z",
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
    junctionSkippedResourceLastAt: "2026-04-03T12:00:00.000Z",
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
      now: "2026-04-03T12:00:00.000Z",
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
  assert.doesNotThrow(() => createJunctionProvider(async () => createJsonResponse({}), {
    timeseriesResources: [
      "calories_basal",
      "daylight_exposure",
      "fall",
      "floors_climbed",
      "handwashing",
      "stand_duration",
      "stand_hour",
      "uv_exposure",
      "wheelchair_push",
      "workout_distance",
      "workout_duration",
      "workout_swimming_stroke",
      "electrocardiogram_voltage",
      "workout_stream",
    ],
  }));
  assert.throws(
    () => createJunctionProvider(async () => createJsonResponse({}), {
      summaryResources: ["clinical_note"],
    }),
    /Junction summary resources include unsupported resource\(s\): clinical_note\./u,
  );
  assert.throws(
    () => createJunctionProvider(async () => createJsonResponse({}), {
      timeseriesResources: ["electrocardiogram_waveform_legacy", "workout_stream_legacy"],
    }),
    /Junction timeseries resources include unsupported resource\(s\): electrocardiogram_waveform_legacy, workout_stream_legacy\./u,
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

test("Junction sparse fetch dedupe preserves stable importer identities and rejects ambiguous rows in either order", async () => {
  const run = async (records: readonly Record<string, unknown>[]) => {
    const importedSnapshots: unknown[] = [];
    const normalizedPayloads: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));

      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-withings-1",
            slug: "withings",
            name: "Withings",
            status: "connected",
            resource_availability: { body_fat: true },
          }],
        });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/body_fat/grouped") {
        return createJsonResponse({
          groups: {
            withings: [{
              data: records,
              source: {
                device_id: "scale-1",
                provider: "withings",
                type: "scale",
              },
            }],
          },
        });
      }
      if (url.pathname.startsWith("/v2/summary/")) {
        return createJsonResponse({ data: [] });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryResources: [],
      timeseriesBackfillDays: 1,
      timeseriesResources: ["fat"],
    });

    const context = createJunctionJobContext({
        account: createAccount({
          lastSyncCompletedAt: "2026-06-15T00:00:00.000Z",
        }),
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          const normalized = await prepareDeviceProviderSnapshotImport({
            provider: "junction",
            connectionId: "acct-junction-1",
            deliveryMode: "scheduled_reconcile",
            sourceKind: "poll",
            snapshot,
          });
          normalizedPayloads.push(normalized);
          return {
            canonicalEventCount: normalized.events?.length ?? 0,
            durableDeliveryAccepted: true,
          };
        },
      });
    await executeJunctionFullJob(
      provider,
      context,
      createJob("reconcile", {
        windowStart: "2026-06-15T00:00:00.000Z",
        windowEnd: "2026-06-16T00:00:00.000Z",
      }),
    );

    assert.equal(importedSnapshots.length, normalizedPayloads.length);
    const sparseImportIndex = normalizedPayloads.findIndex((payload) =>
      payload.events?.some((event) => event.fields?.metric === "body-fat-percentage")
    );
    assert.notEqual(sparseImportIndex, -1);
    return {
      normalized: requireValue(
        normalizedPayloads[sparseImportIndex],
        "normalized Junction sparse payload",
      ),
      snapshot: requireValue(
        importedSnapshots[sparseImportIndex],
        "device-sync Junction sparse snapshot",
      ),
    };
  };
  const findFatEvent = (
    payload: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>,
  ) => payload.events?.find((event) => event.fields?.metric === "body-fat-percentage");

  const original = await run([{
    id: "fat-row-revision",
    timestamp: "2026-06-15T08:00:00.000Z",
    unit: "%",
    value: 18,
  }]);
  const corrected = await run([{
    id: "fat-row-revision",
    timestamp: "2026-06-15T08:05:00.000Z",
    unit: "%",
    value: 19,
  }]);
  const originalEvent = findFatEvent(original.normalized);
  const correctedEvent = findFatEvent(corrected.normalized);

  assert.ok(originalEvent);
  assert.ok(correctedEvent);
  assert.equal(correctedEvent.externalRef?.resourceId, originalEvent.externalRef?.resourceId);
  assert.equal(correctedEvent.externalRef?.facet, "body-fat-percentage");

  const records = [
    { id: "fat-row-exact", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 18 },
    { id: "fat-row-exact", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 18 },
    { id: "fat-row-distinct", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 18 },
    { timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 19 },
    { timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 20 },
    { id: "fat-row-conflict", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 21 },
    { id: "fat-row-conflict", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 22 },
    { id: "fat-row-date-only", timestamp: "2026-06-15", unit: "%", value: 23 },
    { id: "fat-row-alias-only", observedAt: "2026-06-15T10:00:00.000Z", unit: "%", value: 24 },
    { id: "fat-row-invalid-calendar", timestamp: "2026-06-31T10:00:00.000Z", unit: "%", value: 25 },
  ];
  const forward = await run(records);
  const reversed = await run([...records].reverse());
  const summarize = (
    payload: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>,
  ) => (payload.events ?? [])
    .map((event) => ({
      identity: `${event.externalRef?.resourceId}:${event.externalRef?.facet}`,
      value: event.fields?.value,
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const forwardSummary = summarize(forward.normalized);

  assert.deepEqual(forwardSummary, summarize(reversed.normalized));
  assert.equal(forwardSummary.length, 2);
  assert.equal(new Set(forwardSummary.map((event) => event.identity)).size, 2);
  assert.deepEqual(forwardSummary.map((event) => event.value).sort((left, right) =>
    Number(left) - Number(right)
  ), [18, 18]);
  assert.doesNotMatch(JSON.stringify(forward.snapshot), /fat-row-conflict/u);
  assert.doesNotMatch(JSON.stringify(reversed.snapshot), /fat-row-conflict/u);
  assert.doesNotMatch(
    JSON.stringify(forward.snapshot),
    /fat-row-date-only|fat-row-alias-only|fat-row-invalid-calendar/u,
  );
});

test("Junction full backfills keep configured sparse and dense resources in bounded daily units", async () => {
  const sparseResources = [
    "body_mass_index",
    "carbohydrates",
    "fat",
    "forced_expiratory_volume_1",
    "forced_vital_capacity",
    "heart_rate_alert",
    "inhaler_usage",
    "insulin_injection",
    "lean_body_mass",
    "peak_expiratory_flow_rate",
    "sleep_apnea_alert",
    "waist_circumference",
  ];
  const requests: string[] = [];
  const availability = Object.fromEntries([
    "activity",
    "blood_oxygen",
    ...sparseResources,
  ].map((resource) => [resource === "fat" ? "body_fat" : resource, true]));
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-withings-1",
          slug: "withings",
          name: "Withings",
          status: "connected",
          resource_availability: availability,
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    reconcileDays: 14,
    summaryBackfillDays: 180,
    timeseriesResources: ["blood_oxygen", ...sparseResources],
  });

  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({ now: "2026-07-01T00:00:00.000Z" }),
    createJob("backfill", {
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-06-30T00:00:00.000Z",
    }),
  );

  const timeseriesRequests = requests
    .filter((url) => url.includes("/v2/timeseries/"))
    .map((url) => new URL(url));
  assert.equal(timeseriesRequests.length, 196);

  for (const resource of sparseResources) {
    const apiResource = resource === "fat" ? "body_fat" : resource;
    const resourceRequests = timeseriesRequests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${apiResource}/grouped`
    );
    assert.equal(resourceRequests.length, 14, resource);
    for (const url of resourceRequests) {
      const start = url.searchParams.get("start_date");
      const end = url.searchParams.get("end_date");
      assert.ok(start !== null && start === end, resource);
    }
  }

  const denseRequests = timeseriesRequests.filter((url) =>
    url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
  );
  assert.equal(denseRequests.length, 28);
  const denseTemporalRequests = denseRequests.filter((url) => {
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    return start !== null
      && end !== null
      && Date.parse(end) - Date.parse(start) === 24 * 60 * 60_000;
  });
  assert.equal(denseTemporalRequests.length, 14);
  const denseOrdinaryRequests = denseRequests.filter((url) => {
    const start = url.searchParams.get("start_date");
    return start !== null && start === url.searchParams.get("end_date");
  });
  assert.equal(denseOrdinaryRequests.length, 14);
});

test("Junction direct-Link body data stays in the bounded history owner", async () => {
  const connectedAt = "2026-04-03T00:00:00.000Z";
  const now = "2026-07-01T12:00:00.000Z";
  const vaultRoot = await makeTempDirectory("murph-junction-fat-activation");

  try {
    const coreRuntime = await import("@murphai/core");
    await coreRuntime.initializeVault({
      createdAt: connectedAt,
      timezone: "UTC",
      vaultRoot,
    });

    const requests: URL[] = [];
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
              activity: true,
              body_fat: true,
            },
          }],
        });
      }
      if (url.pathname === "/v2/summary/activity/junction-user-1") {
        return createJsonResponse({
          data: [{
            connectionId: "provider-garmin-1",
            date: "2026-04-02",
            id: "activity-connect-row-1",
            observedAt: "2026-04-02T12:00:00.000Z",
            steps: 1_234,
          }],
        });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/body_fat/grouped") {
        requests.push(url);
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [],
              source: { provider: "garmin", type: "scale" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      providerFilter: ["garmin"],
      summaryBackfillDays: 180,
      timeseriesResources: ["fat"],
    });
    const source = createConnectionSource({
      resourceAvailabilitySummary: {
        activity: true,
        body_fat: true,
      },
    });
    const sourceSummary = {
      displayName: source.displayName,
      firstSeenAt: source.firstSeenAt,
      lastDataAt: source.lastDataAt,
      lastErrorCode: source.lastErrorCode,
      lastErrorMessage: source.lastErrorMessage,
      lastSeenAt: source.lastSeenAt,
      resourceAvailabilitySummary: source.resourceAvailabilitySummary,
      resourceCount: Object.keys(source.resourceAvailabilitySummary).length,
      sourceProviderSlug: source.sourceProviderSlug,
      status: source.status,
    };
    const toJobRecord = (
      input: DeviceSyncJobInput,
      fallbackAvailableAt = now,
    ): DeviceSyncJobRecord => ({
      ...createJob(input.kind, input.payload ?? {}),
      availableAt: input.availableAt ?? fallbackAvailableAt,
      dedupeKey: input.dedupeKey ?? null,
      priority: input.priority ?? 50,
    });
    let importedSnapshotCount = 0;
    const importSnapshot: ProviderJobContext["importSnapshot"] = async (snapshot) => {
      const imported = await importDeviceProviderSnapshot<
        Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
      >({
        provider: "junction",
        snapshot,
        vaultRoot,
      }, { corePort: coreRuntime });
      importedSnapshotCount += 1;
      return {
        canonicalEventCount: imported.events.length,
        durableDeliveryAccepted: true,
      };
    };

    const connection = await requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-fat-activation",
      seededExternalAccountId: "junction-user-1",
      sourceProviderSlug: "garmin",
      query: new URLSearchParams({
        murph_state: "state-fat-activation",
        state: "success",
      }),
      now: connectedAt,
      grantedScopes: [],
    });
    const connectBackfill = requireValue(
      connection.initialJobs?.find((job) => job.kind === "backfill"),
      "Direct Link should enqueue the global connect backfill.",
    );
    assert.equal(connection.setupPhase, "link_returned");
    assert.equal(connectBackfill.payload?.timeseriesCursor, undefined);
    assert.equal(sourceSummary.status, "connected");
    assert.equal(sourceSummary.sourceProviderSlug, "garmin");
    assert.equal(sourceSummary.resourceAvailabilitySummary.body_fat, true);

    const connectContext = createJunctionJobContext({
        account: createAccount({
          connectedAt,
          sources: [sourceSummary],
        }),
        connectionSourceAdmissionMode: "listed_only",
        importSnapshot,
        now: connectedAt,
      });
    const connectResult = await executeJunctionFullJob(
      provider,
      connectContext,
      toJobRecord(connectBackfill, connectedAt),
    );
    assert.equal(
      connectResult.metadataPatch?.junctionHistoricalBackfillStatus,
      "coverage_v3_complete",
    );
    assert.equal(
      connectResult.metadataPatch?.junctionExtendedTimeseriesHistoryBackfillCoverage,
      undefined,
    );
    assert.equal(connectResult.scheduledJobs?.some((job) => job.kind === "backfill") ?? false, false);
    assert.equal(importedSnapshotCount, 1);
    assert.equal(requests.length, 14);
    assert.equal(new Set(requests.map((url) => [
      url.searchParams.get("start_date"),
      url.searchParams.get("end_date"),
    ].join("|"))).size, 14);
    requests.length = 0;

    const terminalMetadata = requireValue(
      connectResult.metadataPatch,
      "The global connect backfill should return terminal coverage metadata.",
    );
    const executor = requireValue(provider.jobExecutor);
    const nonTerminalJobs = executor.createScheduledJobs?.(
      createStoredAccount({
        metadata: {
          ...terminalMetadata,
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        },
        nextReconcileAt: now,
        sources: [sourceSummary],
      }),
      now,
    ).jobs ?? [];
    assert.equal(nonTerminalJobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "fat"
    ), false);

    const scheduled = requireValue(executor.createScheduledJobs?.(
      createStoredAccount({
        metadata: terminalMetadata,
        nextReconcileAt: now,
        sources: [sourceSummary],
      }),
      now,
    ));
    const activationJobs = scheduled.jobs.filter((job) =>
      job.kind === "resource"
      && job.payload?.resource === "fat"
      && job.payload?.sourceProviderSlug === "garmin"
    );
    assert.equal(activationJobs.length, 0);
    assert.equal(requests.length, 0);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction timeseries continuations fail retryably after a source reconnect", async () => {
  let liveSource = createConnectionSource({ lifecycleEpoch: 1 });
  let advanceLifecycleDuringFetch = true;
  let sourceListReads = 0;
  let requestCount = 0;
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname !== "/v2/timeseries/junction-user-1/heart_rate_alert/grouped") {
      throw new Error(`Unexpected request: ${url.toString()}`);
    }
    requestCount += 1;
    if (advanceLifecycleDuringFetch) {
      liveSource = createConnectionSource({ lifecycleEpoch: 2 });
      advanceLifecycleDuringFetch = false;
    }
    return createJsonResponse({
      groups: {
        garmin: [{
          data: [{
            end: "2026-04-02T10:01:00.000Z",
            id: "heart-alert-reconnect",
            start: "2026-04-02T10:00:00.000Z",
            type: "irregular_rhythm",
            unit: "count",
            value: 1,
          }],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    });
  }, {
    summaryResources: [],
    timeseriesResources: ["heart_rate_alert"],
  });
  const currentSourceSummary = () => ({
    displayName: liveSource.displayName,
    firstSeenAt: liveSource.firstSeenAt,
    lastDataAt: liveSource.lastDataAt,
    lastErrorCode: liveSource.lastErrorCode,
    lastErrorMessage: liveSource.lastErrorMessage,
    lastSeenAt: liveSource.lastSeenAt,
    lifecycleEpoch: liveSource.lifecycleEpoch,
    resourceAvailabilitySummary: liveSource.resourceAvailabilitySummary,
    resourceCount: Object.keys(liveSource.resourceAvailabilitySummary).length,
    sourceProviderSlug: liveSource.sourceProviderSlug,
    status: liveSource.status,
  });
  const accountSources = [currentSourceSummary()];
  const context = createJunctionJobContext({
    account: createAccount({ sources: accountSources }),
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { canonicalEventCount: 1, durableDeliveryAccepted: true };
    },
    listConnectionSources: () => {
      sourceListReads += 1;
      return [liveSource];
    },
  });
  const job = createJob("reconcile", {
    timeseriesCursor: "2026-04-02T00:00:00.000Z",
    timeseriesResourceCursor: "heart_rate_alert",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });

  await assert.rejects(
    () => executeJunctionJob(provider, context, job),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_TIMESERIES_SOURCE_LIFECYCLE_SUPERSEDED"
      && error.retryable,
  );
  assert.equal(importedSnapshots.length, 0);
  assert.equal(sourceListReads, 1);

  accountSources[0] = currentSourceSummary();
  await executeJunctionJob(provider, context, job);

  assert.equal(requestCount, 2);
  assert.equal(sourceListReads, 2);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction clinical webhook pulls reuse the lifecycle-fenced resource owner", async () => {
  let liveSource = createConnectionSource({
    lifecycleEpoch: 1,
    resourceAvailabilitySummary: { heart_rate_alert: true },
  });
  let advanceLifecycleDuringFetch = true;
  let sourceListReads = 0;
  let requestCount = 0;
  const sourceListReadsAtFetch: number[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { heart_rate_alert: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.pathname !== "/v2/timeseries/junction-user-1/heart_rate_alert/grouped") {
      throw new Error(`Unexpected request: ${url.toString()}`);
    }
    requestCount += 1;
    sourceListReadsAtFetch.push(sourceListReads);
    if (advanceLifecycleDuringFetch) {
      liveSource = createConnectionSource({
        lifecycleEpoch: 2,
        resourceAvailabilitySummary: { heart_rate_alert: true },
      });
      advanceLifecycleDuringFetch = false;
    }
    return createJsonResponse({
      groups: {
        garmin: [{
          data: [{
            end: "2026-04-02T10:01:00.000Z",
            id: "heart-alert-webhook-reconnect",
            start: "2026-04-02T10:00:00.000Z",
            type: "irregular_rhythm",
            unit: "count",
            value: 1,
          }],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    });
  }, {
    summaryResources: [],
    timeseriesResources: ["heart_rate_alert"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.heart_rate_alert.created",
      user_id: "junction-user-1",
      data: {
        data: [{
          end: "2026-04-02T10:01:00.000Z",
          start: "2026-04-02T10:00:00.000Z",
        }],
        source: { provider: "garmin", type: "watch" },
      },
    },
    messageId: "msg_heart_alert_webhook_reconnect_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const parsedJob = requireValue(parsed.jobs[0]);
  assert.equal(parsedJob.kind, "resource");
  assert.equal(parsedJob.payload?.resource, "heart_rate_alert");

  const currentSourceSummary = () => ({
    displayName: liveSource.displayName,
    firstSeenAt: liveSource.firstSeenAt,
    lastDataAt: liveSource.lastDataAt,
    lastErrorCode: liveSource.lastErrorCode,
    lastErrorMessage: liveSource.lastErrorMessage,
    lastSeenAt: liveSource.lastSeenAt,
    lifecycleEpoch: liveSource.lifecycleEpoch,
    resourceAvailabilitySummary: liveSource.resourceAvailabilitySummary,
    resourceCount: Object.keys(liveSource.resourceAvailabilitySummary).length,
    sourceProviderSlug: liveSource.sourceProviderSlug,
    status: liveSource.status,
  });
  const accountSources = [currentSourceSummary()];
  const context = createJunctionJobContext({
    account: createAccount({ sources: accountSources }),
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { canonicalEventCount: 1, durableDeliveryAccepted: true };
    },
    listConnectionSources: () => {
      sourceListReads += 1;
      return [liveSource];
    },
  });
  const job = createJob(parsedJob.kind, parsedJob.payload ?? {});

  await assert.rejects(
    () => executeJunctionJob(provider, context, job),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_TIMESERIES_SOURCE_LIFECYCLE_SUPERSEDED"
      && error.retryable,
  );
  assert.equal(importedSnapshots.length, 0);
  assert.equal(sourceListReads - (sourceListReadsAtFetch[0] ?? 0), 1);

  accountSources[0] = currentSourceSummary();
  await executeJunctionJob(provider, context, job);

  assert.equal(requestCount, 2);
  assert.equal(sourceListReads - (sourceListReadsAtFetch[1] ?? 0), 1);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction historical clinical webhooks preserve one capped day per continuation", async () => {
  const source = createConnectionSource({
    lifecycleEpoch: 1,
    resourceAvailabilitySummary: { heart_rate_alert: true },
  });
  const sourceSummary = {
    displayName: source.displayName,
    firstSeenAt: source.firstSeenAt,
    lastDataAt: source.lastDataAt,
    lastErrorCode: source.lastErrorCode,
    lastErrorMessage: source.lastErrorMessage,
    lastSeenAt: source.lastSeenAt,
    lifecycleEpoch: source.lifecycleEpoch,
    resourceAvailabilitySummary: source.resourceAvailabilitySummary,
    resourceCount: Object.keys(source.resourceAvailabilitySummary).length,
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
  const requestedWindows: Array<{ windowEnd: string | null; windowStart: string | null }> = [];
  const importedSnapshots: Array<{
    timeseries?: Record<string, Array<Record<string, unknown>>>;
  }> = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { heart_rate_alert: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.pathname !== "/v2/timeseries/junction-user-1/heart_rate_alert/grouped") {
      throw new Error(`Unexpected request: ${url.toString()}`);
    }
    const windowStart = url.searchParams.get("start_date");
    const windowEnd = url.searchParams.get("end_date");
    requestedWindows.push({ windowEnd, windowStart });
    const day = windowStart?.slice(0, 10) ?? "2026-04-01";
    return createJsonResponse({
      groups: {
        garmin: [{
          data: Array.from({ length: 80 }, (_value, index) => ({
            end: `${day}T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:30.000Z`,
            id: `heart-alert-${day}-${index}`,
            start: `${day}T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
            type: "irregular_rhythm",
            unit: "count",
            value: 1,
          })),
          source: { provider: "garmin", type: "watch" },
        }],
      },
    });
  }, {
    summaryResources: [],
    timeseriesResources: ["heart_rate_alert"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "historical.data.heart_rate_alert.created",
      user_id: "junction-user-1",
      data: {
        end_date: "2026-04-02",
        source: { provider: "garmin", type: "watch" },
        start_date: "2026-04-01",
      },
    },
    messageId: "msg_heart_alert_historical_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const parsedJob = requireValue(parsed.jobs[0]);
  const context = createJunctionJobContext({
    account: createAccount({ sources: [sourceSummary] }),
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot as {
        timeseries?: Record<string, Array<Record<string, unknown>>>;
      });
      return { canonicalEventCount: 80, durableDeliveryAccepted: true };
    },
    listConnectionSources: () => [source],
  });

  const firstResult = await executeJunctionJob(
    provider,
    context,
    createJob(parsedJob.kind, parsedJob.payload ?? {}),
  );
  const followUp = requireValue(firstResult.scheduledJobs?.[0]);
  assert.deepEqual(requestedWindows, [{
    windowEnd: "2026-04-02T00:00:00.000Z",
    windowStart: "2026-04-01T00:00:00.000Z",
  }]);
  assert.equal(importedSnapshots[0]?.timeseries?.heart_rate_alert?.length, 80);
  assert.equal(followUp.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(followUp.payload?.windowEnd, "2026-04-03T00:00:00.000Z");

  const secondResult = await executeJunctionJob(
    provider,
    context,
    createJob(followUp.kind, followUp.payload ?? {}),
  );
  assert.equal(secondResult.scheduledJobs, undefined);
  assert.deepEqual(requestedWindows[1], {
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });
  assert.equal(importedSnapshots[1]?.timeseries?.heart_rate_alert?.length, 80);
  assert.equal(
    importedSnapshots.reduce(
      (total, snapshot) => total + (snapshot.timeseries?.heart_rate_alert?.length ?? 0),
      0,
    ),
    160,
  );
});

test("Junction activity resources keep fall sparse while dense aggregates and features stay daily", async () => {
  const denseResources = ["calories_basal", "handwashing", "workout_distance"];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          slug: "apple_health_kit",
          name: "Apple Health",
          status: "connected",
          resource_availability: Object.fromEntries([
            "activity",
            "fall",
            ...denseResources,
          ].map((resource) => [resource, true])),
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryBackfillDays: 30,
    summaryResources: ["activity"],
    timeseriesResources: ["fall", ...denseResources],
  });

  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({ now: "2026-03-03T00:00:00.000Z" }),
    createJob("backfill", {
      windowStart: "2026-02-01T00:00:00.000Z",
      windowEnd: "2026-03-03T00:00:00.000Z",
    }),
  );

  const timeseriesRequests = requests
    .filter((url) => url.includes("/v2/timeseries/"))
    .map((url) => new URL(url));
  const fallRequests = timeseriesRequests.filter((url) =>
    url.pathname === "/v2/timeseries/junction-user-1/fall/grouped"
  );
  assert.equal(fallRequests.length, 14);
  for (const url of fallRequests) {
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    assert.ok(start !== null && start === end);
  }

  for (const resource of denseResources) {
    const resourceRequests = timeseriesRequests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`
    );
    assert.equal(resourceRequests.length, 14, resource);
    assert.ok(resourceRequests.every((url) => {
      const start = url.searchParams.get("start_date");
      const end = url.searchParams.get("end_date");
      return start !== null && start === end;
    }), resource);
  }
});

test("Junction mixed temporal and sparse backfills keep separate day owners", async () => {
  const ownerWindowStart = "2026-01-01T00:00:00.000Z";
  const ownerWindowEnd = "2026-03-02T00:00:00.000Z";
  const createProviderForRequests = (requests: string[]) => createJunctionProvider(async (input) => {
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
            blood_oxygen: true,
            body_fat: true,
          },
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryBackfillDays: 60,
    timeseriesBackfillDays: 60,
    timeseriesResources: ["blood_oxygen", "fat"],
  });

  const firstRequests: string[] = [];
  const provider = createProviderForRequests(firstRequests);
  const context = createJunctionJobContext({ now: "2026-03-03T00:00:00.000Z" });
  const firstResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: ownerWindowStart,
      windowEnd: ownerWindowEnd,
    }),
  );

  const continuation = requireValue(
    firstResult.scheduledJobs?.find((job) => job.kind === "backfill"),
    "Mixed Junction backfill should schedule its first direct continuation.",
  );
  assert.deepEqual(continuation.payload, {
    emptyBackfillAttempts: 1,
    timeseriesCursor: ownerWindowStart,
    timeseriesResourceCursor: "blood_oxygen",
    windowEnd: ownerWindowEnd,
    windowStart: ownerWindowStart,
  });
  const temporalRequest = requireValue(
    firstRequests.find((url) => url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")),
    "Mixed Junction backfill should import the newest authoritative temporal day inline.",
  );
  assertJunctionWindowQuery(
    temporalRequest,
    "2026-03-01T00:00:00.000Z",
    "2026-03-02T00:00:00.000Z",
  );
  firstRequests.length = 0;

  const secondResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(continuation),
  );
  const secondTimeseriesRequests = firstRequests
    .filter((url) => url.includes("/v2/timeseries/"))
    .map((url) => new URL(url));
  assert.equal(secondTimeseriesRequests.length, 1);
  assert.equal(
    secondTimeseriesRequests[0]?.pathname,
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
  );
  assertJunctionWindowQuery(
    requireValue(secondTimeseriesRequests[0]?.toString(), "first dense day"),
    "2026-01-01",
    "2026-01-01",
  );
  assert.equal(
    secondResult.scheduledJobs?.[0]?.payload?.timeseriesCursor,
    "2026-01-02T00:00:00.000Z",
  );

  firstRequests.length = 0;
  const resourceBoundaryResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      timeseriesCursor: "2026-03-01T00:00:00.000Z",
      timeseriesResourceCursor: "fat",
      windowEnd: ownerWindowEnd,
      windowStart: ownerWindowStart,
    }),
  );
  assert.equal(resourceBoundaryResult.scheduledJobs, undefined);
});

test("Junction opt-in dense webhooks wait for a closed UTC day before importing", async () => {
  for (const resource of [
    "calories_basal",
    "handwashing",
    "stand_hour",
    "workout_duration",
  ] as const) {
    const requests: URL[] = [];
    const importedSnapshots: unknown[] = [];
    const preparedImports: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      requests.push(url);
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            slug: "garmin",
            status: "connected",
            resource_availability: { [resource]: true },
          }],
        });
      }
      if (url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`) {
        const requestedDay = url.searchParams.get("start_date");
        return createJsonResponse({
          groups: {
            garmin: [{
              data: requestedDay === "2026-04-02"
                ? resource === "stand_hour"
                  ? [{
                      end: "2026-04-03T00:00:00.000Z",
                      start: "2026-04-02T23:00:00.000Z",
                      unit: "count",
                      value: 1,
                    }]
                  : resource === "workout_duration"
                    ? [{
                        end: "2026-04-03T00:00:00.000Z",
                        start: "2026-04-02T23:12:00.000Z",
                        unit: "minutes",
                        value: 48,
                      }]
                  : [{
                      timestamp: "2026-04-02T12:00:00.000Z",
                      unit: resource === "calories_basal" ? "kcal" : "count",
                      value: 1,
                    }]
                : [],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryResources: [],
      timeseriesResources: [resource],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    });
    const source = createConnectionSource({
      resourceAvailabilitySummary: { [resource]: true },
    });
    const sourceSummary = {
      displayName: source.displayName,
      firstSeenAt: source.firstSeenAt,
      lastDataAt: source.lastDataAt,
      lastErrorCode: source.lastErrorCode,
      lastErrorMessage: source.lastErrorMessage,
      lastSeenAt: source.lastSeenAt,
      resourceAvailabilitySummary: source.resourceAvailabilitySummary,
      resourceCount: Object.keys(source.resourceAvailabilitySummary).length,
      sourceProviderSlug: source.sourceProviderSlug,
      status: source.status,
    };
    const parseWebhookJob = async (now: string, messageId: string) => {
      const webhook = createJunctionSvixWebhook({
        body: {
          event_type: `daily.data.${resource}.created`,
          user_id: "junction-user-1",
          data: {
            date: "2026-04-02",
            resource,
            source: { provider: "garmin" },
          },
        },
        messageId,
        timestamp: String(Math.floor(Date.parse(now) / 1_000)),
      });
      const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
        headers: webhook.headers,
        rawBody: webhook.rawBody,
        now,
      });
      return requireValue(parsed.jobs[0], `${resource} webhook resource job`);
    };
    const execute = (now: string, job: DeviceSyncJobInput) => executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ sources: [sourceSummary] }),
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          const prepared = await prepareDeviceProviderSnapshotImport({
            provider: "junction",
            snapshot,
          });
          preparedImports.push(prepared);
          return {
            canonicalEventCount: prepared.events?.length ?? 0,
            durableDeliveryAccepted: true,
          };
        },
        now,
      }),
      {
        ...createJob(job.kind, job.payload ?? {}),
        dedupeKey: job.dedupeKey ?? null,
        priority: job.priority ?? 50,
      },
    );

    await execute(
      "2026-04-02T15:00:00.000Z",
      await parseWebhookJob("2026-04-02T15:00:00.000Z", `msg_${resource}_open`),
    );
    const openDayRequests = requests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`
    );
    assert.deepEqual(
      openDayRequests.map((url) => url.searchParams.get("start_date")),
      ["2026-04-01"],
      resource,
    );
    assert.equal(importedSnapshots.length, 0, resource);

    await execute(
      "2026-04-03T00:05:00.000Z",
      await parseWebhookJob("2026-04-03T00:05:00.000Z", `msg_${resource}_closed`),
    );
    const resourceRequests = requests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`
    );
    assert.equal(resourceRequests.length, 3, resource);
    assert.equal(resourceRequests[2]?.searchParams.get("start_date"), "2026-04-02", resource);
    assert.equal(resourceRequests[2]?.searchParams.get("end_date"), "2026-04-02", resource);
    assert.equal(importedSnapshots.length, 1, resource);
    assert.equal(preparedImports.length, 1, resource);

    if (resource === "workout_duration") {
      const prepared = requireValue(preparedImports[0], "workout duration compact import");
      const artifacts = prepared.evidenceParts?.filter((part) =>
        part.metadata?.resource === "workout_duration"
        && part.metadata?.resourceCategory === "timeseries_feature_aggregate"
      ) ?? [];
      const events = prepared.events?.filter((candidate) =>
        candidate.fields?.metric === "workout-minutes"
      ) ?? [];
      assert.equal(artifacts.length, 1);
      assert.equal(events.length, 1);
      const artifact = requireValue(artifacts[0], "workout duration compact feature artifact");
      const content = artifact.content as Record<string, unknown>;
      const event = requireValue(events[0], "workout duration canonical observation");

      assert.equal(content.bucketStartAt, "2026-04-02T23:00:00.000Z");
      assert.equal(content.dayKey, "2026-04-02");
      assert.equal(content.firstSampleAt, "2026-04-02T23:12:00.000Z");
      assert.equal(content.lastSampleAt, "2026-04-02T23:12:00.000Z");
      assert.equal(content.sumValue, 48);
      assert.equal(event.occurredAt, "2026-04-02T23:12:00.000Z");
      assert.equal(event.dayKey, "2026-04-02");
      assert.equal(event.fields?.value, 48);
    }
  }
});
test.each([
  {
    groupedSourceProviderSlug: "apple_health_kit",
    summarySourceProviderSlug: "apple_health",
  },
  {
    groupedSourceProviderSlug: "apple_health",
    summarySourceProviderSlug: "apple_health_kit",
  },
])(
  "Junction ECG voltage binds $summarySourceProviderSlug summaries to $groupedSourceProviderSlug id-less groups",
  async ({ groupedSourceProviderSlug, summarySourceProviderSlug }) => {
    const requests: URL[] = [];
    const importedSnapshots: unknown[] = [];
    const recordingIds = ["ecg-recording-a", "ecg-recording-b"];
    const deviceIds = ["watch-a", "watch-b"];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      requests.push(url);
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-apple-health-1",
            slug: summarySourceProviderSlug,
            name: "Apple Health",
            status: "connected",
            resource_availability: { electrocardiogram_voltage: true },
          }],
        });
      }
      if (url.pathname === "/v2/summary/electrocardiogram/junction-user-1") {
        return createJsonResponse({
          electrocardiogram: recordingIds.map((id, index) => ({
            id,
            session_start: "2026-04-02T12:00:00.000Z",
            session_end: "2026-04-02T12:01:00.000Z",
            voltage_sample_count: 2,
            source_provider: summarySourceProviderSlug,
            source_type: "watch",
            source_device_id: deviceIds[index],
            created_at: "2026-04-02T12:01:00.000Z",
            updated_at: "2026-04-02T12:01:00.000Z",
            user_id: "junction-user-1",
            source: {
              provider: summarySourceProviderSlug,
              type: "watch",
              device_id: deviceIds[index],
            },
          })),
        });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/electrocardiogram_voltage/grouped") {
        return createJsonResponse({
          groups: {
            [groupedSourceProviderSlug]: deviceIds.map((deviceId) => ({
              source: {
                provider: groupedSourceProviderSlug,
                type: "watch",
                device_id: deviceId,
              },
              data: [
                {
                  id: 1,
                  timestamp: "2026-04-02T12:00:00.000Z",
                  type: "lead_i",
                  unit: "mV",
                  value: -0.1,
                },
                {
                  id: 2,
                  timestamp: "2026-04-02T12:00:01.000Z",
                  type: "lead_i",
                  unit: "mV",
                  value: 0.1,
                },
              ],
            })),
          },
        });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryResources: [],
      timeseriesResources: ["electrocardiogram_voltage"],
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
        resource: "electrocardiogram_voltage",
        resourceCategory: "timeseries",
        sourceProviderSlug: summarySourceProviderSlug,
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.equal(importedSnapshots.length, 1);
    const snapshot = importedSnapshots[0] as {
      timeseries?: { electrocardiogram_voltage?: Array<Record<string, unknown>> };
    };
    const features = snapshot.timeseries?.electrocardiogram_voltage ?? [];
    assert.deepEqual(features.map((feature) => feature.id), recordingIds);
    assert.deepEqual(features.map((feature) => feature.voltageSampleCount), [2, 2]);
    const summaryRequests = requests.filter((url) =>
      url.pathname.includes("/summary/electrocardiogram/")
    );
    const voltageRequests = requests.filter((url) =>
      url.pathname.includes("/electrocardiogram_voltage/grouped")
    );
    assert.equal(summaryRequests.length, 1);
    assert.equal(voltageRequests.length, 2);
    for (const url of voltageRequests) {
      assert.equal(url.searchParams.get("start_date"), "2026-04-02T12:00:00.000Z");
      assert.equal(url.searchParams.get("end_date"), "2026-04-02T12:01:00.000Z");
      assert.equal(url.searchParams.get("provider"), "apple_health_kit");
    }
  },
);

test("Junction ECG voltage retries when summary cardinality and voltage disagree", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          slug: "apple_health_kit",
          name: "Apple Health",
          status: "connected",
          resource_availability: { electrocardiogram_voltage: true },
        }],
      });
    }
    if (url.pathname.includes("/summary/electrocardiogram/")) {
      return createJsonResponse({
        electrocardiogram: [{
          id: "ecg-recording-a",
          session_start: "2026-04-02T12:00:00.000Z",
          session_end: "2026-04-02T12:01:00.000Z",
          voltage_sample_count: 2,
          source_provider: "apple_health_kit",
          source_type: "watch",
          source_device_id: "watch-a",
          created_at: "2026-04-02T12:01:00.000Z",
          updated_at: "2026-04-02T12:01:00.000Z",
          user_id: "junction-user-1",
          source: {
            provider: "apple_health_kit",
            type: "watch",
            device_id: "watch-a",
          },
        }],
      });
    }
    if (url.pathname.includes("/electrocardiogram_voltage/grouped")) {
      return createJsonResponse({
        groups: {
          apple_health_kit: [{
            source: {
              provider: "apple_health_kit",
              type: "watch",
              device_id: "watch-a",
            },
            data: [{
              timestamp: "2026-04-02T12:00:00.000Z",
              type: "lead_i",
              unit: "mV",
              value: 0.1,
            }],
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["electrocardiogram_voltage"],
  });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        resource: "electrocardiogram_voltage",
        resourceCategory: "timeseries",
        sourceProviderSlug: "apple_health_kit",
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.equal(error.failure.code, "JUNCTION_ECG_RECORDING_BINDING_INCOMPLETE");
      assert.equal(error.failure.retryable, true);
      return true;
    },
  );
});

test("Junction ECG voltage validates summary cardinality after cross-page deduplication", async () => {
  let voltageRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          slug: "apple_health_kit",
          name: "Apple Health",
          status: "connected",
          resource_availability: { electrocardiogram_voltage: true },
        }],
      });
    }
    if (url.pathname.includes("/summary/electrocardiogram/")) {
      return createJsonResponse({
        electrocardiogram: [{
          id: "ecg-recording-a",
          session_start: "2026-04-02T12:00:00.000Z",
          session_end: "2026-04-02T12:01:00.000Z",
          voltage_sample_count: 2,
          source_provider: "apple_health_kit",
          source_type: "watch",
          source_device_id: "watch-a",
          source: {
            provider: "apple_health_kit",
            type: "watch",
            device_id: "watch-a",
          },
        }],
      });
    }
    if (url.pathname.includes("/electrocardiogram_voltage/grouped")) {
      voltageRequests += 1;
      return createJsonResponse({
        groups: {
          apple_health_kit: [{
            source: {
              provider: "apple_health_kit",
              type: "watch",
              device_id: "watch-a",
            },
            data: [{
              timestamp: "2026-04-02T12:00:00.000Z",
              type: "lead_i",
              unit: "mV",
              value: 0.1,
            }],
          }],
        },
        ...(voltageRequests === 1 ? { next_cursor: "page-2" } : {}),
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["electrocardiogram_voltage"],
  });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        resource: "electrocardiogram_voltage",
        resourceCategory: "timeseries",
        sourceProviderSlug: "apple_health_kit",
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.equal(error.failure.code, "JUNCTION_ECG_RECORDING_BINDING_INCOMPLETE");
      assert.equal(error.failure.details?.reason, "sample_count_mismatch");
      assert.equal(error.failure.details?.actualSampleCount, 1);
      assert.equal(error.failure.details?.expectedSampleCount, 2);
      return true;
    },
  );
  assert.equal(voltageRequests, 2);
});

test("Junction ECG resource jobs use the bounded collection attempt contract", async () => {
  let summaryRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          slug: "apple_health_kit",
          name: "Apple Health",
          status: "connected",
          resource_availability: { electrocardiogram_voltage: true },
        }],
      });
    }
    if (url.pathname.includes("/summary/electrocardiogram/")) {
      summaryRequests += 1;
      return createJsonResponse({ error: "temporary" }, 500);
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["electrocardiogram_voltage"],
  });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        resource: "electrocardiogram_voltage",
        resourceCategory: "timeseries",
        sourceProviderSlug: "apple_health_kit",
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.equal(error.failure.code, "JUNCTION_API_REQUEST_FAILED");
      return true;
    },
  );
  assert.equal(summaryRequests, 1);
});

test("Junction ECG voltage rejects overlapping summaries without reading an ambiguous group", async () => {
  let voltageRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          slug: "apple_health_kit",
          name: "Apple Health",
          status: "connected",
          resource_availability: { electrocardiogram_voltage: true },
        }],
      });
    }
    if (url.pathname.includes("/summary/electrocardiogram/")) {
      return createJsonResponse({
        electrocardiogram: ["a", "b"].map((suffix) => ({
          id: `ecg-recording-${suffix}`,
          session_start: "2026-04-02T12:00:00.000Z",
          session_end: "2026-04-02T12:01:00.000Z",
          voltage_sample_count: 1,
          source_provider: "apple_health_kit",
          source_type: "watch",
          source_device_id: "watch-a",
          created_at: "2026-04-02T12:01:00.000Z",
          updated_at: "2026-04-02T12:01:00.000Z",
          user_id: "junction-user-1",
          source: {
            provider: "apple_health_kit",
            type: "watch",
            device_id: "watch-a",
          },
        })),
      });
    }
    voltageRequests += 1;
    return createJsonResponse({ groups: {} });
  }, {
    summaryResources: [],
    timeseriesResources: ["electrocardiogram_voltage"],
  });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        resource: "electrocardiogram_voltage",
        resourceCategory: "timeseries",
        sourceProviderSlug: "apple_health_kit",
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.equal(error.failure.code, "JUNCTION_ECG_RECORDING_BINDING_INCOMPLETE");
      assert.equal(error.failure.retryable, true);
      return true;
    },
  );
  assert.equal(voltageRequests, 0);
});
