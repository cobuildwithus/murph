/**
 * Regression coverage for the June 2026 incident where WHOOP (whoop_v2)
 * Junction sleep imports silently stopped after Junction enabled webhook
 * payload enrichment:
 *
 * 1. Enriched payloads carried record-level resource discriminators (for
 *    example `resource_type: "sleep_v2"`) that hijacked the job's resource
 *    name away from the `daily.data.sleep.created` event type, so the runner
 *    completed the job without importing, fetching, or failing.
 * 2. Every webhook-driven job completion reset `nextReconcileAt` to
 *    `now + interval`, so with webhooks arriving more often than the interval
 *    the scheduled full-resource reconcile (the safety net) never became due.
 *
 * These tests replay the production webhook sequence against the real
 * device-syncd service (real store, queue, scheduler, worker, junction
 * provider) with a mock Junction API.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import path from "node:path";
import { test } from "vitest";

import { createDeviceSyncService } from "../src/service.ts";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { SqliteDeviceSyncStore } from "../src/store.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";

import type { DeviceSyncImporterPort } from "../src/types.ts";

const WEBHOOK_SECRET = "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
const RECONCILE_INTERVAL_MS = 6 * 60 * 60_000;

interface CapturedImport {
  provider: string;
  snapshot: {
    summaries?: Record<string, unknown[]>;
    windowStart?: string;
    windowEnd?: string;
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function signJunctionWebhook(body: Record<string, unknown>, messageId: string): {
  headers: Headers;
  rawBody: Buffer;
} {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody = Buffer.from(JSON.stringify(body));
  const key = Buffer.from(WEBHOOK_SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": messageId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    }),
    rawBody,
  };
}

// Live (diagnose-confirmed) WHOOP sleep record shape from Junction's summary API.
function buildLiveWhoopSleepRecord(nowMs: number, id: string): Record<string, unknown> {
  return {
    id,
    date: iso(nowMs - 9 * 60 * 60_000).slice(0, 10),
    calendar_date: iso(nowMs - 9 * 60 * 60_000).slice(0, 10),
    created_at: iso(nowMs - 30 * 60_000),
    bedtime_start: iso(nowMs - 9 * 60 * 60_000),
    bedtime_stop: iso(nowMs - 60 * 60_000),
    duration: 28_800,
    deep: 5_400,
    rem: 5_400,
    light: 14_400,
    awake: 3_600,
    latency: 600,
    efficiency: 0.92,
    score: 84,
    average_hrv: 65,
    respiratory_rate: 14.2,
    skin_temperature: 33.8,
    recovery_readiness_score: 70,
    hr_average: 52,
    hr_lowest: 44,
    sleep_stream: {
      hr_samples: [
        { timestamp: iso(nowMs - 8 * 60 * 60_000), value: 55 },
        { timestamp: iso(nowMs - 7 * 60 * 60_000), value: 50 },
      ],
    },
    source: {
      provider: "whoop_v2",
    },
  };
}

function buildEnrichedActivityWebhook(nowMs: number, input: {
  calories: number;
  endOffsetMs: number;
  messageId: string;
}): { headers: Headers; rawBody: Buffer } {
  return signJunctionWebhook({
    event_type: "daily.data.activity.updated",
    user_id: "junction-user-1",
    data: {
      id: "cycle-1",
      start: iso(nowMs - 8 * 60 * 60_000),
      end: iso(nowMs - input.endOffsetMs),
      calories: input.calories,
      heart_rate: 92,
      source: { provider: "whoop_v2" },
    },
  }, input.messageId);
}

async function createWebhookFixture() {
  const vaultRoot = await makeTempDirectory("murph-junction-webhooks");
  const requests: string[] = [];
  const nowMs = Date.now();

  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity", "sleep", "sleep_cycle", "workouts", "body", "meal"],
    timeseriesResources: [],
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
    webhookSecret: WEBHOOK_SECRET,
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url.includes("/v2/user/providers/junction-user-1")) {
        // Diagnose-confirmed healthy connected source.
        return createJsonResponse({
          providers: [
            {
              id: "provider-whoop-1",
              slug: "whoop_v2",
              name: "WHOOP",
              status: "connected",
              resource_availability: {
                activity: true,
                sleep: true,
                workouts: true,
              },
            },
          ],
        });
      }

      const summaryResource = new URL(url).pathname.match(/^\/v2\/summary\/([^/]+)\//u)?.[1];
      if (summaryResource === "sleep") {
        // Diagnose-confirmed: 5 sleep records for the probe window.
        return createJsonResponse({
          data: Array.from({ length: 5 }, (_value, index) =>
            buildLiveWhoopSleepRecord(nowMs - index * 24 * 60 * 60_000, `sleep-${index + 1}`)),
        });
      }
      if (summaryResource === "activity") {
        return createJsonResponse({
          data: [{
            id: "cycle-1",
            start: iso(nowMs - 8 * 60 * 60_000),
            end: iso(nowMs - 60_000),
            calories: 512,
            source: { provider: "whoop_v2" },
          }],
        });
      }
      if (summaryResource) {
        return createJsonResponse({ data: [] });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const imports: CapturedImport[] = [];
  const importer: DeviceSyncImporterPort = {
    async importDeviceProviderSnapshot(input) {
      imports.push({
        provider: input.provider,
        snapshot: input.snapshot as CapturedImport["snapshot"],
      });
      return { ok: true };
    },
  };

  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, ".runtime", "device-syncd.sqlite"));
  const service = createDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      vaultRoot,
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: path.join(vaultRoot, ".runtime", "device-syncd.sqlite"),
      log: {
        warn() {
          // Keep test output focused on assertions.
        },
      },
    },
    providers: [provider],
    importer,
    store,
  });

  const account = store.upsertAccount({
    provider: "junction",
    externalAccountId: "junction-user-1",
    displayName: "Junction",
    scopes: [],
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    metadata: {},
    connectedAt: iso(nowMs - 30 * 24 * 60 * 60_000),
  });

  return {
    account,
    imports,
    nowMs,
    requests,
    service,
    store,
    close() {
      service.close();
      store.close();
    },
  };
}

function summaryRecordCounts(imports: readonly CapturedImport[]): Array<Record<string, number>> {
  return imports.map((entry) =>
    Object.fromEntries(
      Object.entries(entry.snapshot.summaries ?? {})
        .filter(([, records]) => records.length > 0)
        .map(([resource, records]) => [resource, records.length]),
    )
  );
}

function hasSleepImport(imports: readonly CapturedImport[]): boolean {
  return imports.some((entry) => (entry.snapshot.summaries?.sleep?.length ?? 0) > 0);
}

test("enriched activity webhooks direct-import and sleep webhooks with embedded data import sleep", async () => {
  const fixture = await createWebhookFixture();
  const { service, store, imports, requests, nowMs, account } = fixture;

  try {
    // Two enriched WHOOP activity (cycle) webhooks, ~2h apart in production.
    // Junction embeds the cycle record with start/end timestamps.
    for (const [index, endOffsetMs] of [2 * 60 * 60_000, 60_000].entries()) {
      const webhook = buildEnrichedActivityWebhook(nowMs, {
        calories: 480 + index,
        endOffsetMs,
        messageId: `msg_activity_${index + 1}`,
      });
      const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
      assert.equal(accepted.accepted, true);
      await service.drainWorker(100);
    }

    assert.equal(imports.length, 2, "each enriched activity webhook should direct-import one bundle");
    assert.deepEqual(summaryRecordCounts(imports), [{ activity: 1 }, { activity: 1 }]);
    assert.equal(
      requests.length,
      0,
      "direct activity imports must not call Junction",
    );

    // Regression (reconcile starvation): direct-import completions must not
    // keep pushing nextReconcileAt out. The second completion must preserve
    // the schedule seeded by the first instead of resetting it to
    // now + interval again.
    const afterActivity = store.getAccountById(account.id);
    const nextReconcileAtMs = Date.parse(afterActivity?.nextReconcileAt ?? "");
    assert.ok(
      Number.isFinite(nextReconcileAtMs)
      && nextReconcileAtMs <= Date.now() + RECONCILE_INTERVAL_MS,
      `direct imports must not push nextReconcileAt past now + interval (${afterActivity?.nextReconcileAt ?? "null"})`,
    );

    // Sleep webhook WITH embedded data (live WHOOP shape) direct-imports.
    const sleepRecord = buildLiveWhoopSleepRecord(nowMs, "sleep-live-1");
    const sleepWebhook = signJunctionWebhook({
      event_type: "daily.data.sleep.created",
      user_id: "junction-user-1",
      data: sleepRecord,
    }, "msg_sleep_with_data_1");
    const sleepAccepted = await service.handleWebhook("junction", sleepWebhook.headers, sleepWebhook.rawBody);
    assert.equal(sleepAccepted.accepted, true);
    await service.drainWorker(100);

    assert.ok(
      hasSleepImport(imports),
      `sleep webhook with embedded data should import sleep; imports=${JSON.stringify(summaryRecordCounts(imports))}, requests=${JSON.stringify(requests)}`,
    );
  } finally {
    fixture.close();
  }
});

test("sleep webhook WITHOUT embedded data falls back to a working fetch", async () => {
  const fixture = await createWebhookFixture();
  const { service, imports, requests } = fixture;

  try {
    const webhook = signJunctionWebhook({
      event_type: "daily.data.sleep.created",
      user_id: "junction-user-1",
      data: {
        id: "sleep-no-data-1",
        source: { provider: "whoop_v2" },
      },
    }, "msg_sleep_without_data_1");
    const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
    assert.equal(accepted.accepted, true);
    await service.drainWorker(100);

    assert.ok(
      requests.some((url) => url.includes("/v2/summary/sleep/junction-user-1")),
      `sleep fetch fallback should query Junction's sleep summary; requests=${JSON.stringify(requests)}`,
    );
    assert.ok(
      requests.some((url) => url.includes("/v2/user/providers/junction-user-1")),
      "sleep fetch fallback should project source providers (last_seen_at advance)",
    );
    assert.ok(
      hasSleepImport(imports),
      `sleep fetch fallback should import the diagnose-confirmed records; imports=${JSON.stringify(summaryRecordCounts(imports))}`,
    );
  } finally {
    fixture.close();
  }
});

test("enriched sleep webhook with an unknown resource-name override still imports sleep (June 2026 incident)", async () => {
  const fixture = await createWebhookFixture();
  const { service, imports, requests, nowMs } = fixture;

  try {
    // Junction's enriched `daily.data.sleep.created` payload carries a
    // record-level resource discriminator. It must not hijack the job's
    // resource name: the event type already says this is sleep, and
    // "sleep_v2" is not a Junction resource. Before the fix this job
    // completed silently with no import, no fetch, and no recorded failure.
    const sleepRecord = {
      ...buildLiveWhoopSleepRecord(nowMs, "sleep-live-2"),
      resource_type: "sleep_v2",
    };
    const webhook = signJunctionWebhook({
      event_type: "daily.data.sleep.created",
      user_id: "junction-user-1",
      data: sleepRecord,
    }, "msg_sleep_override_1");
    const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
    assert.equal(accepted.accepted, true);
    await service.drainWorker(100);

    assert.ok(
      hasSleepImport(imports),
      `enriched sleep webhook must import sleep; imports=${JSON.stringify(summaryRecordCounts(imports))}, requests=${JSON.stringify(requests)}`,
    );
    assert.equal(
      requests.length,
      0,
      "the embedded record should direct-import without calling Junction",
    );
  } finally {
    fixture.close();
  }
});

test("mixed due queue (activity direct + sleep direct) loses neither job", async () => {
  const fixture = await createWebhookFixture();
  const { service, imports, nowMs } = fixture;

  try {
    // Enqueue both webhooks BEFORE draining so the worker sees a mixed due
    // queue (production wakes claim batches seeded by direct-payload jobs).
    const activityWebhook = buildEnrichedActivityWebhook(nowMs, {
      calories: 480,
      endOffsetMs: 60_000,
      messageId: "msg_mixed_activity_1",
    });
    const sleepWebhook = signJunctionWebhook({
      event_type: "daily.data.sleep.created",
      user_id: "junction-user-1",
      data: buildLiveWhoopSleepRecord(nowMs, "sleep-mixed-1"),
    }, "msg_mixed_sleep_1");

    await service.handleWebhook("junction", activityWebhook.headers, activityWebhook.rawBody);
    await service.handleWebhook("junction", sleepWebhook.headers, sleepWebhook.rawBody);
    await service.drainWorker(100);

    const counts = summaryRecordCounts(imports);
    assert.ok(
      counts.some((entry) => (entry.activity ?? 0) > 0),
      `mixed queue should import activity; imports=${JSON.stringify(counts)}`,
    );
    assert.ok(
      hasSleepImport(imports),
      `mixed queue should import sleep; imports=${JSON.stringify(counts)}`,
    );
  } finally {
    fixture.close();
  }
});

test("direct-import completions do not starve the scheduled reconcile (June 2026 incident)", async () => {
  const fixture = await createWebhookFixture();
  const { service, store, requests, nowMs, account } = fixture;

  try {
    // The scheduled full-resource reconcile is already due.
    const dueReconcileAt = iso(nowMs - 60_000);
    store.patchAccount(account.id, { nextReconcileAt: dueReconcileAt });

    // A burst of enriched webhooks direct-imports before the scheduler runs
    // (production: webhooks every ~2h with a longer reconcile interval).
    for (const index of [0, 1, 2]) {
      const webhook = buildEnrichedActivityWebhook(nowMs, {
        calories: 500 + index,
        endOffsetMs: 60_000 + index * 1_000,
        messageId: `msg_starvation_activity_${index + 1}`,
      });
      const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
      assert.equal(accepted.accepted, true);
      await service.drainWorker(100);
    }
    assert.equal(requests.length, 0, "the burst should be direct imports only");

    // Regression: every direct-import completion used to reset
    // nextReconcileAt to now + interval, so the due reconcile never fired.
    const afterBurst = store.getAccountById(account.id);
    assert.equal(
      afterBurst?.nextReconcileAt,
      dueReconcileAt,
      "direct-import completions must preserve the already-due reconcile schedule",
    );

    await service.runSchedulerOnce();
    await service.drainWorker(100);

    assert.ok(
      requests.some((url) => url.includes("/v2/user/providers/junction-user-1")),
      `the scheduled reconcile must fetch and re-project source providers; requests=${JSON.stringify(requests)}`,
    );
    assert.ok(
      requests.some((url) => url.includes("/v2/summary/sleep/junction-user-1")),
      "the scheduled reconcile must run the full-resource summary fetch",
    );

    const afterReconcile = store.getAccountById(account.id);
    const rescheduledAtMs = Date.parse(afterReconcile?.nextReconcileAt ?? "");
    assert.ok(
      rescheduledAtMs > Date.now(),
      `the reconcile completion should schedule the next reconcile in the future (${afterReconcile?.nextReconcileAt ?? "null"})`,
    );
  } finally {
    fixture.close();
  }
});
