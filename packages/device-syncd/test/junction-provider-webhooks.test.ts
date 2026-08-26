import {
  createAccount,
  createEmptyJunctionBackfillProvider,
  createJob,
  createJunctionJobContext,
  createJunctionProvider,
  createJunctionSvixWebhook,
  executeFullJobTimeseriesContinuations,
  executeJunctionFullJob,
  executeJunctionJob,
  requireJunctionWebhookHandler,
  sha256ForTest,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { HistoricalPullCompleted as JunctionHistoricalPullCompletedSchema } from "@junction-api/sdk/serialization";
import {
  buildJunctionDailyTimeseriesAggregateResourceId,
  deriveJunctionCanonicalCoverageEvidence,
  normalizeJunctionSnapshot,
  type JunctionSnapshotInput,
} from "@murphai/importers/device-providers/junction";
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

test.each([
  {
    data: {
      end: "2026-04-03T00:10:00.000Z",
      observedAt: "2026-04-01T12:00:00.000Z",
      resource: "body_mass_index",
      source: { provider: "withings" },
      start: "2026-04-02T23:50:00.000Z",
      timestamp: "2026-04-01T13:00:00.000Z",
    },
    eventType: "daily.data.body_mass_index.created",
    label: "interval start",
  },
  {
    data: {
      observedAt: "2026-04-01T12:00:00.000Z",
      resource: "weight",
      source: { provider: "withings" },
      timestamp: "2026-04-02T08:00:00.000Z",
    },
    eventType: "daily.data.weight.created",
    label: "instant timestamp",
  },
])("Junction webhook body range uses canonical $label instead of aliases", async ({
  data,
  eventType,
  label,
}) => {
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
      event_type: eventType,
      user_id: "junction-user-1",
      data,
    },
    messageId: `msg_body_range_${label.replaceAll(" ", "_")}`,
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.occurredAt, label === "interval start"
    ? "2026-04-02T23:50:00.000Z"
    : "2026-04-02T08:00:00.000Z");
  assert.equal(parsed.jobs[0]?.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(parsed.jobs[0]?.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
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
          activity: [{
            id: "summary-2",
            accountId: "junction-account-raw-2",
            calendar_date: "2026-04-02",
            created_at: "2026-04-02T01:00:00+00:00",
            date: "2026-04-02T00:00:00+00:00",
            providerConnectionId: "provider-connection-oura-ring-2",
            source: { provider: "oura", type: "ring" },
            steps: 2000,
            updated_at: "2026-04-02T02:00:00+00:00",
            user_id: "junction-user-raw-2",
          }],
        });
      }

      return createJsonResponse({
        activity: [{
          id: "summary-1",
          Source: { id: "nested-source-summary-1", name: "Nested Source Summary" },
          account_id: "junction-account-raw-1",
          account: { id: "nested-account-summary-1" },
          app: { id: "nested-app-summary-1", name: "Nested Summary App" },
          calendar_date: "2026-04-02",
          client_user_id: "client-user-raw-1",
          created_at: "2026-04-02T01:00:00+00:00",
          date: "2026-04-02T00:00:00+00:00",
          device: { id: "nested-device-summary-1", name: "Nested Summary Device" },
          provider_connection_id: "provider-connection-oura-ring-1",
          source: { provider: "oura", type: "ring" },
          steps: 1000,
          updated_at: "2026-04-02T02:00:00+00:00",
          user_id: "junction-user-raw-1",
        }],
        next_cursor: "page-2",
      });
    }

    const timeseriesResource = new URL(url).pathname.match(/\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1];
    if (timeseriesResource && timeseriesResource in groupedTimeseriesPayloads) {
      const bloodOxygenStartDate = new URL(url).searchParams.get("start_date");
      if (
        bloodOxygenStartDate !== "2026-04-02"
        && bloodOxygenStartDate !== "2026-04-02T00:00:00.000Z"
      ) {
        return createJsonResponse({ groups: {} });
      }
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
    now: "2026-04-04T00:00:00.000Z",
    vaultTimeZone: "UTC",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: (input) => {
      const existingIndex = sources.findIndex((source) =>
        source.sourceInstanceKey === input.sourceInstanceKey
      );
      const existing = existingIndex >= 0 ? sources[existingIndex] : undefined;
      const source: DeviceConnectionSourceRecord = {
        id: existing?.id ?? `src-${sources.length + 1}`,
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
      if (existingIndex >= 0) {
        sources[existingIndex] = source;
      } else {
        sources.push(source);
      }
      return source;
    },
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  const result = await executeJunctionFullJob(
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
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.date, "2026-04-02T00:00:00.000Z");
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.device, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.provider_connection_id, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.accountId, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.providerConnectionId, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.userId, undefined);
  assert.deepEqual(summarySnapshot.timeseries, {});
  const normalizedSummary = normalizeJunctionSnapshot(summarySnapshot);
  const activityStepsEvent = requireValue(
    normalizedSummary.events?.find((event) =>
      event.fields?.metric === "daily-steps" && event.fields.value === 1000
    ),
    "Sanitized Junction activity should reach the canonical importer.",
  );
  assert.deepEqual(
    [activityStepsEvent.occurredAt, activityStepsEvent.dayKey],
    ["2026-04-02T00:00:00.000Z", "2026-04-02"],
  );

  const timeseriesSnapshots = importedSnapshots.slice(1) as Array<{
    timeseries?: Record<string, Array<Record<string, unknown>>>;
    windowEnd?: string;
    windowStart?: string;
  }>;
  const nonEmptyTimeseriesSnapshots = timeseriesSnapshots.filter((snapshot) =>
    Object.values(snapshot.timeseries ?? {}).some((records) => records.length > 0)
  );
  assert.equal(
    nonEmptyTimeseriesSnapshots.every((snapshot) =>
      snapshot.windowStart === "2026-04-02T00:00:00.000Z"
      && snapshot.windowEnd === "2026-04-03T00:00:00.000Z"
      && Object.keys(snapshot.timeseries ?? {}).length === 1
    ),
    true,
  );
  const timeseries = nonEmptyTimeseriesSnapshots.reduce<Record<string, Array<Record<string, unknown>>>>(
    (merged, snapshot) => {
      for (const [resource, records] of Object.entries(snapshot.timeseries ?? {})) {
        merged[resource] = [...(merged[resource] ?? []), ...records];
      }
      return merged;
    },
    {},
  );

  assert.deepEqual(Object.keys(timeseries).sort(), ["blood_oxygen", "stress_level"]);
  assert.equal(timeseries.blood_oxygen?.length, 2);
  assert.equal(timeseries.stress_level?.length, 2);
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
  assert.equal(bloodOxygenRecord?.timestamp, "2026-04-02T14:30:52.000Z");
  assert.equal(bloodOxygenRecord?.user_id, undefined);
  assert.equal((bloodOxygenRecord as { source?: unknown } | undefined)?.source, undefined);
  assert.equal((bloodOxygenRecord as { provider?: unknown } | undefined)?.provider, undefined);
  assert.equal(typeof bloodOxygenRecord?.sourceInstanceId, "string");
  assert.match(String(bloodOxygenRecord?.sourceInstanceId), /^source-[a-f0-9]{24}$/u);
  assert.equal(timeseries.stress_level?.[0]?.sourceType, "ring");
  assert.equal(timeseries.stress_level?.[0]?.timestamp, "2026-04-02T14:30:52.000Z");
  assert.equal(timeseries.blood_oxygen?.[0]?.junctionResource, "blood_oxygen");
  assert.equal(timeseries.stress_level?.[0]?.unit, "score");
  const normalizedBloodOxygen = normalizeJunctionSnapshot(requireValue(
    timeseriesSnapshots.find((snapshot) => snapshot.timeseries?.blood_oxygen),
    "Junction polling should produce a sanitized blood-oxygen snapshot.",
  ));
  const normalizedStressLevel = normalizeJunctionSnapshot(requireValue(
    timeseriesSnapshots.find((snapshot) => snapshot.timeseries?.stress_level),
    "Junction polling should produce a sanitized stress-level snapshot.",
  ));
  const bloodOxygenEvent = requireValue(
    normalizedBloodOxygen.events?.find((event) => event.fields?.metric === "spo2"),
    "Sanitized Junction blood oxygen should reach the canonical importer.",
  );
  const stressLevelEvent = requireValue(
    normalizedStressLevel.events?.find((event) => event.fields?.metric === "stress-level"),
    "Sanitized Junction stress level should reach the canonical importer.",
  );
  assert.deepEqual(
    [bloodOxygenEvent.occurredAt, bloodOxygenEvent.dayKey],
    ["2026-04-02T14:30:52.000Z", "2026-04-02"],
  );
  assert.deepEqual(
    [stressLevelEvent.occurredAt, stressLevelEvent.dayKey],
    ["2026-04-02T14:30:52.000Z", "2026-04-02"],
  );
  assert.notEqual(bloodOxygenEvent.externalRef?.resourceId, stressLevelEvent.externalRef?.resourceId);
  assert.doesNotMatch(
    JSON.stringify(timeseries),
    /Timeseries Oura Ring|timeseries-device-oura-ring-1|timeseries-app-oura-cloud-1/u,
  );
  assert.equal(requests.filter((url) => url.includes("/v2/summary/")).length, 2);
  assert.equal(requests.some((url) => url.includes("next_cursor=page-2")), true);
  const timeseriesRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(timeseriesRequests.length, 18);
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

  const result = await executeJunctionFullJob(
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

test("Junction source projection keeps fail-closed error state when a sibling entry is connected", async () => {
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
  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[0]?.lastErrorCode, "token_refresh_failed");
  assert.equal(upserts[0]?.lastErrorMessage, "WHOOP rejected the refresh token.");
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
    now: "2026-04-04T00:00:00.000Z",
    vaultTimeZone: "UTC",
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

  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  const result = await executeFullJobTimeseriesContinuations({
    context,
    initialResult,
    provider,
  });

  const summarySnapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  };
  const timeseriesSnapshots = importedSnapshots.slice(1) as Array<{
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  }>;
  assert.equal(summarySnapshot.summaries?.activity?.length, 1);
  assert.equal(summarySnapshot.summaries?.profile, undefined);
  assert.deepEqual(summarySnapshot.timeseries, {});
  assert.equal(
    timeseriesSnapshots.every((snapshot) =>
      Object.keys(snapshot.summaries ?? {}).length === 0
      && Object.keys(snapshot.timeseries ?? {}).length === 1
    ),
    true,
  );
  const timeseries = timeseriesSnapshots.reduce<Record<string, unknown[]>>(
    (merged, snapshot) => {
      for (const [resource, records] of Object.entries(snapshot.timeseries ?? {})) {
        merged[resource] = [...(merged[resource] ?? []), ...records];
      }
      return merged;
    },
    {},
  );
  assert.deepEqual(Object.keys(timeseries), ["blood_oxygen"]);
  assert.equal(timeseries.blood_oxygen?.length, 2);
  assert.equal(timeseries.stress_level, undefined);
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
    junctionProfileSummaryCheckedAt: "2026-04-04T00:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 2,
    junctionSkippedResourceTotal: 13,
    junctionSkippedSummaryTotal: 5,
    junctionSkippedTimeseriesTotal: 8,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-04T00:00:00.000Z",
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
    junctionProfileSummaryNormalizationRevision: 2,
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
      account: createAccount({
        metadata: {
          junctionProfileSummaryCheckedAt: "2026-04-01T00:00:00.000Z",
        },
      }),
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
    junctionProfileSummaryNormalizationRevision: 2,
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
          lastDataAt: null,
          lastErrorCode: "SOURCE_USER_DISCONNECTED",
          lastErrorMessage: null,
          lastSeenAt: "2026-04-03T00:00:00.000Z",
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
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
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
