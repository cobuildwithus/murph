import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";

import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncJobRecord,
  ProviderJobContext,
} from "../src/types.ts";

function createAccount(): DeviceSyncAccount {
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
  };
}

function createProvider(fetchImpl: typeof fetch) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_junction-test",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    fetchImpl,
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
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

function createJunctionSvixWebhook(input: {
  body: Record<string, unknown>;
  messageId: string;
}): { headers: Headers; rawBody: Buffer } {
  const timestamp = "1775174400";
  const secret = "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${input.messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": input.messageId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    }),
    rawBody,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function createJobContext(importedSnapshots: unknown[]): ProviderJobContext {
  return {
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
      sourceProviderSlug: "withings",
      displayName: "Withings",
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
}

test("Junction webhooks canonicalize resource aliases before category inference", async () => {
  const provider = createProvider(async () => createJsonResponse({}));
  const webhookHandler = provider.webhookHandler;
  assert.ok(webhookHandler);

  const cases = [
    ["daily.data.heart_rate.created", "heartrate", "timeseries"],
    ["daily.data.steps.created", "steps", "timeseries"],
    ["daily.data.body_weight.created", "weight", "timeseries"],
    ["daily.data.stress_level.created", "stress_level", "timeseries"],
    ["daily.data.sleep_cycle.created", "sleep_cycle", "summary"],
    ["daily.data.hypnogram.created", "sleep_cycle", "summary"],
    ["daily.data.calories_active.updated", "calories_active", "timeseries"],
    ["daily.data.distance.updated", "distance", "timeseries"],
  ] as const;

  for (const [eventType, resource, resourceCategory] of cases) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: eventType,
        user_id: "junction-user-1",
        data: {
          id: `${resource}-record-1`,
          source: {
            provider: "garmin",
            type: "watch",
          },
        },
      },
      messageId: `msg_${resource}`,
    });

    const parsed = await webhookHandler.verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });
    const payload = parsed.jobs[0]?.payload;

    assert.equal(parsed.resourceCategory, resourceCategory);
    assert.ok(payload);
    assert.equal(payload.resource, resource);
    assert.equal(payload.resourceCategory, resourceCategory);
    if (resourceCategory === "timeseries") {
      assert.equal(Object.hasOwn(payload, "webhookDataJson"), false);
    }
  }
});

function createStressLevelFetchProvider(input: {
  responseStressLevel: number;
  responseTimestamp?: string;
}): { provider: ReturnType<typeof createProvider>; seenUrls: string[] } {
  const seenUrls: string[] = [];
  const provider = createProvider(async (request) => {
    const url = readUrl(request);
    seenUrls.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: {
            stress_level: true,
          },
        }],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              timestamp: input.responseTimestamp ?? "2026-04-02T12:00:00.000Z",
              stressLevel: input.responseStressLevel,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  return { provider, seenUrls };
}

async function executeStressLevelWebhook(input: {
  data: Record<string, unknown>;
  messageId: string;
  now?: string;
  provider: ReturnType<typeof createProvider>;
}): Promise<{
  importedSnapshots: unknown[];
  jobPayload: Record<string, unknown>;
}> {
  const webhookHandler = input.provider.webhookHandler;
  const executor = input.provider.jobExecutor;
  assert.ok(webhookHandler);
  assert.ok(executor);

  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.stress_level.created",
      user_id: "junction-user-1",
      data: input.data,
    },
    messageId: input.messageId,
  });

  const parsed = await webhookHandler.verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: input.now ?? "2026-04-03T00:00:00.000Z",
  });
  const jobInput = parsed.jobs[0];
  assert.ok(jobInput);
  const jobPayload = jobInput.payload;
  assert.ok(jobPayload);

  const importedSnapshots: unknown[] = [];
  await executor.executeJob(
    createJobContext(importedSnapshots),
    createJob(jobInput.kind, jobPayload),
  );

  return { importedSnapshots, jobPayload };
}

test("Junction stress level webhooks fetch timeseries instead of importing small direct payloads", async () => {
  const { provider, seenUrls } = createStressLevelFetchProvider({ responseStressLevel: 18 });
  const webhookHandler = provider.webhookHandler;
  const executor = provider.jobExecutor;
  assert.ok(webhookHandler);
  assert.ok(executor);

  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.stress_level.created",
      user_id: "junction-user-1",
      data: {
        id: "stress-level-1",
        stressLevel: 18,
        observedAt: "2026-04-02T12:00:00.000Z",
        source: {
          provider: "garmin",
          type: "watch",
        },
      },
    },
    messageId: "msg_stress_level_direct",
  });

  const parsed = await webhookHandler.verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const jobInput = parsed.jobs[0];
  assert.ok(jobInput);
  const jobPayload = jobInput.payload;
  assert.ok(jobPayload);
  assert.equal(parsed.resourceCategory, "timeseries");
  assert.equal(jobInput.kind, "resource");
  assert.equal(jobPayload.resource, "stress_level");
  assert.equal(jobPayload.resourceCategory, "timeseries");
  assert.equal(Object.hasOwn(jobPayload, "webhookDataJson"), false);
  assert.equal(jobPayload.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(jobPayload.windowEnd, "2026-04-03T00:00:00.000Z");

  const importedSnapshots: unknown[] = [];
  await executor.executeJob(
    createJobContext(importedSnapshots),
    createJob(jobInput.kind, jobPayload),
  );

  assert.equal(seenUrls.some((url) => url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")), true);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, Array<Record<string, unknown>>>;
  };
  assert.equal(Object.keys(snapshot.summaries ?? {}).length, 0);
  assert.equal(snapshot.timeseries?.stress_level?.length, 1);
  assert.equal(snapshot.timeseries?.stress_level?.[0]?.stressLevel, 18);
});

test("Junction stress level webhooks treat score payloads as fetch hints", async () => {
  const { provider, seenUrls } = createStressLevelFetchProvider({ responseStressLevel: 22 });
  const { importedSnapshots, jobPayload } = await executeStressLevelWebhook({
    provider,
    messageId: "msg_stress_level_fetch",
    data: {
      id: "stress-level-metadata-only",
      observedAt: "2026-04-01T12:00:00.000Z",
      data: [{
        timestamp: "2026-04-02T12:00:00.000Z",
        score: 44,
      }],
      source: {
        provider: "garmin",
        type: "watch",
      },
    },
  });

  assert.equal(Object.hasOwn(jobPayload, "webhookDataJson"), false);
  assert.equal(jobPayload.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(jobPayload.windowEnd, "2026-04-03T00:00:00.000Z");
  assert.equal(seenUrls.some((url) => url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")), true);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, Array<Record<string, unknown>>> };
  assert.equal(snapshot.timeseries?.stress_level?.length, 1);
  assert.equal(snapshot.timeseries?.stress_level?.[0]?.stressLevel, 22);
});

test("Junction stress level webhooks fetch timeseries when direct value is invalid", async () => {
  const { provider, seenUrls } = createStressLevelFetchProvider({ responseStressLevel: 32 });
  const { importedSnapshots, jobPayload } = await executeStressLevelWebhook({
    provider,
    messageId: "msg_stress_level_invalid",
    data: {
      id: "stress-level-invalid-direct",
      observedAt: "2026-04-02T12:00:00.000Z",
      stressLevel: 120,
      source: {
        provider: "garmin",
        type: "watch",
      },
    },
  });
  assert.equal(jobPayload.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(jobPayload.windowEnd, "2026-04-03T00:00:00.000Z");

  assert.equal(seenUrls.some((url) => url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")), true);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, Array<Record<string, unknown>>> };
  assert.equal(snapshot.timeseries?.stress_level?.length, 1);
  assert.equal(snapshot.timeseries?.stress_level?.[0]?.stressLevel, 32);
});

test("Junction stress level webhook fallback windows use grouped sample timestamps", async () => {
  const { provider, seenUrls } = createStressLevelFetchProvider({
    responseStressLevel: 36,
    responseTimestamp: "2026-04-01T12:00:00.000Z",
  });
  const { importedSnapshots, jobPayload } = await executeStressLevelWebhook({
    provider,
    messageId: "msg_stress_level_grouped_window",
    now: "2026-04-03T00:00:00.000Z",
    data: {
      id: "stress-level-grouped-invalid-direct",
      groups: {
        garmin: [{
          data: [{
            timestamp: "2026-04-01T12:00:00.000Z",
            stressLevel: 120,
          }],
          source: {
            provider: "garmin",
            type: "watch",
          },
        }],
      },
    },
  });

  assert.equal(Object.hasOwn(jobPayload, "webhookDataJson"), false);
  assert.equal(jobPayload.windowStart, "2026-04-01T00:00:00.000Z");
  assert.equal(jobPayload.windowEnd, "2026-04-02T00:00:00.000Z");
  assert.equal(seenUrls.some((url) => url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")), true);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, Array<Record<string, unknown>>> };
  assert.equal(snapshot.timeseries?.stress_level?.length, 1);
  assert.equal(snapshot.timeseries?.stress_level?.[0]?.stressLevel, 36);
});

test("Junction stress level webhooks fetch timeseries instead of chunking oversized direct payloads", async () => {
  const { provider, seenUrls } = createStressLevelFetchProvider({ responseStressLevel: 28 });
  const { importedSnapshots, jobPayload } = await executeStressLevelWebhook({
    provider,
    messageId: "msg_stress_level_oversized",
    data: {
      id: "stress-level-oversized-direct",
      source: {
        provider: "garmin",
        type: "watch",
      },
      data: Array.from({ length: 1500 }, (_, index) => ({
        timestamp: `2026-04-02T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
        stressLevel: 20 + (index % 10),
        marker: "stress-webhook-direct-payload-size-padding",
      })),
    },
  });
  assert.equal(Object.hasOwn(jobPayload, "webhookDataJson"), false);

  assert.equal(seenUrls.some((url) => url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")), true);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, Array<Record<string, unknown>>> };
  assert.equal(snapshot.timeseries?.stress_level?.length, 1);
  assert.equal(snapshot.timeseries?.stress_level?.[0]?.stressLevel, 28);
});

test("Junction legacy direct stress level resource jobs fetch instead of importing webhookDataJson", async () => {
  const { provider, seenUrls } = createStressLevelFetchProvider({ responseStressLevel: 48 });
  const executor = provider.jobExecutor;
  assert.ok(executor);
  const importedSnapshots: unknown[] = [];

  await executor.executeJob(
    createJobContext(importedSnapshots),
    createJob("resource", {
      eventType: "daily.data.stress_level.created",
      objectId: "stress-level-legacy-direct",
      occurredAt: "2026-04-02T12:00:00.000Z",
      resource: "stress_level",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        id: "stress-level-legacy-direct",
        timestamp: "2026-04-02T12:00:00.000Z",
        stressLevel: 18,
        marker: "legacy-direct-stress-payload",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(seenUrls.some((url) => url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")), true);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, Array<Record<string, unknown>>> };
  assert.equal(snapshot.timeseries?.stress_level?.length, 1);
  assert.equal(snapshot.timeseries?.stress_level?.[0]?.stressLevel, 48);
  assert.equal(JSON.stringify(snapshot).includes("legacy-direct-stress-payload"), false);
});

test("Junction REST diagnostics canonicalize resource aliases before allowlist checks", async () => {
  const seenUrls: string[] = [];
  const provider = createProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.includes("/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    if (
      url.includes("/v2/timeseries/junction-user-1/body_weight/grouped") ||
      url.includes("/v2/timeseries/junction-user-1/calories_active/grouped") ||
      url.includes("/v2/timeseries/junction-user-1/distance/grouped")
    ) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const cases = [
    {
      resource: "body_weight",
      canonicalResource: "weight",
      category: "timeseries",
      configuredResource: true,
      path: /\/v2\/timeseries\/junction-user-1\/body_weight\/grouped/u,
    },
    {
      resource: "calories_active",
      canonicalResource: "calories_active",
      category: "timeseries",
      configuredResource: true,
      path: /\/v2\/timeseries\/junction-user-1\/calories_active\/grouped/u,
    },
    {
      resource: "distance",
      canonicalResource: "distance",
      category: "timeseries",
      configuredResource: true,
      path: /\/v2\/timeseries\/junction-user-1\/distance\/grouped/u,
    },
    {
      resource: "hypnogram",
      canonicalResource: "sleep_cycle",
      category: "summary",
      configuredResource: true,
      path: /\/v2\/summary\/sleep_cycle\/junction-user-1/u,
    },
  ] as const;

  for (const { resource, canonicalResource, category, configuredResource, path } of cases) {
    seenUrls.length = 0;
    const result = await probeRest({
      account: createAccount(),
      endpoint: "auto",
      now: "2026-04-03T12:00:00.000Z",
      resource,
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    });
    const request = requireRecord(result.result.request);
    const url = seenUrls[0];

    assert.equal(request.configuredResource, configuredResource);
    assert.equal(request.resource, canonicalResource);
    assert.equal(request.resourceCategory, category);
    assert.ok(url);
    assert.match(url, path);
  }
});

test("Junction resource jobs re-infer category for canonicalized timeseries aliases", async () => {
  const seenUrls: string[] = [];
  const provider = createProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          slug: "withings",
          name: "Withings",
          status: "connected",
          resource_availability: {
            body_weight: true,
          },
        }],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/body_weight/grouped")) {
      return createJsonResponse({
        groups: {
          withings: [{
            data: [{
              id: "weight-1",
              timestamp: "2026-04-02T08:00:00.000Z",
              unit: "kg",
              value: 80,
            }],
            source: { provider: "withings", type: "scale" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const executor = provider.jobExecutor;
  assert.ok(executor);
  const importedSnapshots: unknown[] = [];

  await executor.executeJob(
    createJobContext(importedSnapshots),
    createJob("resource", {
      eventType: "daily.data.body_weight.created",
      objectId: "weight-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "body_weight",
      resourceCategory: "summary",
      sourceProviderSlug: "withings",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(seenUrls.some((url) => url.includes("/v2/summary/weight/")), false);
  assert.equal(seenUrls.some((url) => url.includes("/v2/timeseries/junction-user-1/body_weight/grouped")), true);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    timeseries?: Record<string, Array<Record<string, unknown>>>;
  };
  assert.equal(snapshot.timeseries?.weight?.length, 1);
  assert.equal(snapshot.timeseries?.weight?.[0]?.id, "weight-1");
  assert.equal(snapshot.timeseries?.weight?.[0]?.timestamp, "2026-04-02T08:00:00.000Z");
  assert.equal(snapshot.timeseries?.weight?.[0]?.unit, "kg");
  assert.equal(snapshot.timeseries?.weight?.[0]?.value, 80);
});
