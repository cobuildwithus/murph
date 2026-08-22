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
import { buildJunctionProviderSourceInstanceKey } from "../src/config/junction-connect-sources.ts";
import { DeviceSyncError } from "../src/errors.ts";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { scopeWebhookTraceId } from "../src/shared.ts";
import { SqliteDeviceSyncStore } from "../src/store.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";
import {
  countJobsForAccountForTesting,
  readWebhookTraceStatusForTesting,
} from "./store-test-helpers.ts";

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

function listProviderRequests(requests: readonly string[]): string[] {
  return requests.filter((url) => url.includes("/v2/user/providers/junction-user-1"));
}

function listSummaryFetchRequests(requests: readonly string[]): string[] {
  return requests.filter((url) => /\/v2\/summary\/[^/]+\/junction-user-1/u.test(url));
}

// A `daily.data.profile.created` event resolves to the `profile` resource via
// the event type. `profile` is a known Junction webhook resource name (so a
// resource job IS built) but it is NOT in the fixture's configured summary
// resources and the event-type fallback also resolves to `profile`, so the job
// reaches the former E4 silent-complete branch. After P2 this branch degrades
// to the pull floor instead of completing without import or fetch.
function buildUnconfiguredResourceWebhook(nowMs: number, messageId: string, options?: {
  occurredAtMs?: number;
}): {
  headers: Headers;
  rawBody: Buffer;
} {
  return signJunctionWebhook({
    event_type: "daily.data.profile.created",
    user_id: "junction-user-1",
    data: {
      id: `profile-${messageId}`,
      occurred_at: iso(options?.occurredAtMs ?? nowMs - 60_000),
      source: { provider: "whoop_v2" },
    },
  }, messageId);
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

test("production service ranks canonical and legacy Junction sources consistently", async () => {
  const fixture = await createWebhookFixture();
  const { account, imports, nowMs, service, store } = fixture;
  const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: account.id,
    sourceProviderSlug: "whoop_v2",
  });
  assert.ok(canonicalSourceInstanceKey);
  const legacySourceInstanceKey = "legacy_whoop_v2_source";
  let webhookIndex = 0;

  const buildWebhook = () => {
    webhookIndex += 1;
    return {
      messageId: `msg_source_admission_${webhookIndex}`,
      webhook: buildEnrichedActivityWebhook(nowMs, {
        calories: 600 + webhookIndex,
        endOffsetMs: 60_000 + webhookIndex * 1_000,
        messageId: `msg_source_admission_${webhookIndex}`,
      }),
    };
  };
  const expectAcceptedAndImported = async () => {
    const jobsBefore = countJobsForAccountForTesting(store, account.id);
    const importsBefore = imports.length;
    const { messageId, webhook } = buildWebhook();

    const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);

    assert.equal(accepted.accepted, true);
    assert.equal(countJobsForAccountForTesting(store, account.id), jobsBefore + 1);
    assert.equal(
      readWebhookTraceStatusForTesting(
        store,
        "junction",
        scopeWebhookTraceId("junction", account.externalAccountId, messageId),
      ),
      "processed",
    );
    await service.drainWorker(100);
    assert.equal(imports.length, importsBefore + 1);
  };
  const expectRetriableSourceFailure = async () => {
    const jobsBefore = countJobsForAccountForTesting(store, account.id);
    const importsBefore = imports.length;
    const { messageId, webhook } = buildWebhook();

    await assert.rejects(
      service.handleWebhook("junction", webhook.headers, webhook.rawBody),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "WEBHOOK_SOURCE_NOT_READY"
        && error.httpStatus === 503
        && error.retryable === true,
    );
    assert.equal(countJobsForAccountForTesting(store, account.id), jobsBefore);
    assert.equal(imports.length, importsBefore);
    assert.equal(
      readWebhookTraceStatusForTesting(
        store,
        "junction",
        scopeWebhookTraceId("junction", account.externalAccountId, messageId),
      ),
      null,
    );
  };

  try {
    await expectAcceptedAndImported();

    store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: legacySourceInstanceKey,
      sourceProviderSlug: "whoop_v2",
      status: "connected",
      firstSeenAt: iso(nowMs - 120_000),
      lastSeenAt: iso(nowMs - 120_000),
    });
    await expectAcceptedAndImported();

    store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: legacySourceInstanceKey,
      sourceProviderSlug: "whoop_v2",
      status: "disconnected",
      firstSeenAt: iso(nowMs - 120_000),
      lastSeenAt: iso(nowMs - 90_000),
    });
    await expectRetriableSourceFailure();

    store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: legacySourceInstanceKey,
      sourceProviderSlug: "whoop_v2",
      status: "connected",
      firstSeenAt: iso(nowMs - 120_000),
      lastSeenAt: iso(nowMs - 60_000),
    });
    store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: canonicalSourceInstanceKey,
      sourceProviderSlug: "whoop_v2",
      status: "disconnected",
      firstSeenAt: iso(nowMs - 180_000),
      lastSeenAt: iso(nowMs - 180_000),
    });
    await expectRetriableSourceFailure();

    store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: canonicalSourceInstanceKey,
      sourceProviderSlug: "whoop_v2",
      status: "connected",
      firstSeenAt: iso(nowMs - 180_000),
      lastSeenAt: iso(nowMs - 30_000),
    });
    await expectAcceptedAndImported();
  } finally {
    fixture.close();
  }
});

test("sleep webhook with a metric-free embedded record imports inline once the usefulness gate is removed", async () => {
  // Pre-P3 a sleep payload carrying only an id and source (no recognized sleep
  // metrics) was deemed "not useful" and dropped to a REST summary fetch. The
  // usefulness gate was removed in P3: the configured summary payload with a
  // single, consistent source now imports inline. The branch still ends in
  // import (the P1+P2 import-or-fetch guarantee holds), only louder/earlier;
  // the unconditional reconcile floor still recovers any fuller record later.
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

    assert.deepEqual(
      requests,
      [],
      `metric-free sleep payload should import inline without Junction HTTP; requests=${JSON.stringify(requests)}`,
    );
    assert.ok(
      hasSleepImport(imports),
      `metric-free sleep payload should import inline; imports=${JSON.stringify(summaryRecordCounts(imports))}`,
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

// P1: min-only scheduling. The clamp is the sole writer of nextReconcileAt for
// every non-floor (webhook/direct-import) completion, and it only ever moves
// the schedule EARLIER. A direct-import completion occurring after an earlier
// scheduled reconcile must leave that earlier time intact (not push it out to
// now + interval).
test("direct-import completion preserves an earlier scheduled reconcile (min-only clamp)", async () => {
  const fixture = await createWebhookFixture();
  const { service, store, requests, nowMs, account } = fixture;

  try {
    // An earlier reconcile is scheduled for 1h out, well inside the 6h interval.
    const earlierReconcileAt = iso(nowMs + 60 * 60_000);
    store.patchAccount(account.id, { nextReconcileAt: earlierReconcileAt });

    const webhook = buildEnrichedActivityWebhook(nowMs, {
      calories: 600,
      endOffsetMs: 60_000,
      messageId: "msg_minonly_activity_1",
    });
    const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
    assert.equal(accepted.accepted, true);
    await service.drainWorker(100);

    assert.equal(requests.length, 0, "the activity webhook should direct-import without calling Junction");
    const after = store.getAccountById(account.id);
    assert.equal(
      after?.nextReconcileAt,
      earlierReconcileAt,
      "a direct import must not push an earlier scheduled reconcile out to now + interval",
    );
  } finally {
    fixture.close();
  }
});

// P1: the floor is the sole owner of source projection. While ONLY direct
// imports occur (no reconcile), last_seen_at / source projection is NOT
// refreshed by the import path; the import path must not call listUserProviders
// (preserves the deliberate user/providers decoupling). When the floor
// reconcile runs, projection IS refreshed — proving the floor owns it and an
// unconditional floor keeps last_seen_at fresh.
test("floor owns source projection; direct imports never call listUserProviders", async () => {
  const fixture = await createWebhookFixture();
  const { service, store, requests, nowMs, account } = fixture;

  try {
    // A burst of direct imports — no reconcile fires.
    for (const index of [0, 1, 2]) {
      const webhook = buildEnrichedActivityWebhook(nowMs, {
        calories: 700 + index,
        endOffsetMs: 60_000 + index * 1_000,
        messageId: `msg_floor_projection_activity_${index + 1}`,
      });
      const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
      assert.equal(accepted.accepted, true);
      await service.drainWorker(100);
    }

    assert.equal(
      listProviderRequests(requests).length,
      0,
      "direct-import completions must not call listUserProviders (user/providers decoupling)",
    );
    assert.equal(
      store.listConnectionSources({ connectionId: account.id }).length,
      0,
      "the direct-import path must not project sources — the floor owns projection",
    );

    // Now run the unconditional floor reconcile: it fetches user/providers and
    // projects sources with last_seen_at = now.
    store.patchAccount(account.id, { nextReconcileAt: iso(nowMs - 60_000) });
    await service.runSchedulerOnce();
    await service.drainWorker(100);

    assert.ok(
      listProviderRequests(requests).length >= 1,
      `the floor reconcile must fetch and re-project sources; requests=${JSON.stringify(requests)}`,
    );
    const afterReconcile = store.listConnectionSources({ connectionId: account.id });
    const projected = afterReconcile.find((source) => source.sourceProviderSlug === "whoop_v2");
    assert.ok(
      projected && Number.isFinite(Date.parse(projected.lastSeenAt)),
      `the floor reconcile must project last_seen_at for the connected source; sources=${JSON.stringify(afterReconcile)}`,
    );
  } finally {
    fixture.close();
  }
});

// P2: no webhook execution branch may complete without import-or-fetch. Each
// fixture below must end in an import OR a fetch / floor-reconcile — never a
// skip-only completion. The former E4 silent-complete (unconfigured resource,
// no event-type fallback) now degrades to a coalescible floor reconcile.
const importOrFetchFixtures: Array<{
  name: string;
  build: (nowMs: number, messageId: string) => { headers: Headers; rawBody: Buffer };
  expect: "import" | "fetch-or-floor";
}> = [
  {
    name: "enriched sleep (known discriminator) direct-imports",
    expect: "import",
    build: (nowMs, messageId) =>
      signJunctionWebhook({
        event_type: "daily.data.sleep.created",
        user_id: "junction-user-1",
        data: { ...buildLiveWhoopSleepRecord(nowMs, `sleep-${messageId}`), resource_type: "sleep_v2" },
      }, messageId),
  },
  {
    name: "meal webhook with embedded data direct-imports",
    expect: "import",
    build: (nowMs, messageId) =>
      signJunctionWebhook({
        event_type: "daily.data.meal.created",
        user_id: "junction-user-1",
        data: {
          id: `meal-${messageId}`,
          calendar_date: iso(nowMs - 2 * 60 * 60_000).slice(0, 10),
          consumed_at: iso(nowMs - 2 * 60 * 60_000),
          calories: 540,
          protein_g: 32,
          source: { provider: "whoop_v2" },
        },
      }, messageId),
  },
  {
    name: "sleep webhook with no payload falls back to a fetch",
    expect: "fetch-or-floor",
    build: (nowMs, messageId) =>
      signJunctionWebhook({
        event_type: "daily.data.sleep.created",
        user_id: "junction-user-1",
        data: { id: `sleep-empty-${messageId}`, source: { provider: "whoop_v2" } },
      }, messageId),
  },
  {
    name: "unknown discriminator on a sleep event still imports sleep",
    expect: "import",
    build: (nowMs, messageId) =>
      signJunctionWebhook({
        event_type: "daily.data.sleep.created",
        user_id: "junction-user-1",
        data: { ...buildLiveWhoopSleepRecord(nowMs, `sleep-unk-${messageId}`), resource_type: "totally_unknown_v9" },
      }, messageId),
  },
  {
    name: "unconfigured resource (no fallback) degrades to a floor reconcile",
    expect: "fetch-or-floor",
    build: (nowMs, messageId) => buildUnconfiguredResourceWebhook(nowMs, messageId),
  },
  {
    // Oversized payloads are dropped to [] before a job is built (the size cap
    // lives in buildJunctionWebhookDataJobJsons, still present until P3). With
    // no embedded json the resource job becomes a fetch job — modeled here as a
    // sleep event whose payload carries no importable record.
    name: "oversized payload (modeled as no embedded json) falls back to a fetch",
    expect: "fetch-or-floor",
    build: (nowMs, messageId) =>
      signJunctionWebhook({
        event_type: "daily.data.sleep.created",
        user_id: "junction-user-1",
        data: { id: `sleep-oversized-${messageId}`, source: { provider: "whoop_v2" } },
      }, messageId),
  },
];

for (const fixtureCase of importOrFetchFixtures) {
  test(`every webhook ends in import-or-fetch: ${fixtureCase.name}`, async () => {
    const fixture = await createWebhookFixture();
    const { service, store, imports, requests, nowMs, account } = fixture;

    try {
      const webhook = fixtureCase.build(nowMs, `msg_iof_${fixtureCase.name.replace(/[^a-z0-9]+/giu, "_")}`);
      const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
      assert.equal(accepted.accepted, true);

      // Drain until the queue settles: floor-reconcile follow-ups re-enqueue, so
      // pump the worker and scheduler a few times to let them run.
      for (let pass = 0; pass < 4; pass += 1) {
        await service.runSchedulerOnce();
        await service.drainWorker(100);
        if (store.summarize().jobsQueued === 0 && store.summarize().jobsRunning === 0) {
          break;
        }
      }

      const importedAnything = imports.length > 0;
      const fetched = listSummaryFetchRequests(requests).length > 0
        || listProviderRequests(requests).length > 0;

      if (fixtureCase.expect === "import") {
        assert.ok(
          importedAnything,
          `${fixtureCase.name} must import; imports=${JSON.stringify(summaryRecordCounts(imports))}, requests=${JSON.stringify(requests)}`,
        );
      } else {
        assert.ok(
          importedAnything || fetched,
          `${fixtureCase.name} must import OR fetch/floor-reconcile, never skip-only; imports=${imports.length}, requests=${JSON.stringify(requests)}`,
        );
      }

      // No terminal branch may leave a dead job behind (a dead job would be the
      // silent-complete failure class this work eliminates).
      assert.equal(store.summarize().jobsDead, 0, `${fixtureCase.name} must not dead-letter any job`);
    } finally {
      fixture.close();
    }
  });
}

// P2 storm-safety: a burst of N webhooks that all hit the former E4 branch must
// coalesce to a SINGLE floor reconcile (one wake), not N per-webhook fetch jobs.
// The day-floored `reconcile` follow-up shares a dedupe key across the burst.
test("unconfigured-resource burst coalesces to a single floor reconcile (storm-safety)", async () => {
  const fixture = await createWebhookFixture();
  const { service, store, requests, nowMs, account } = fixture;

  try {
    // Anchor the burst mid-UTC-day so each webhook's occurred_at lands a
    // distinct sub-day window (distinct construction-time resource jobs) while
    // sharing the same UTC day (so the day-floored degrade-to-floor reconcile
    // follow-ups coalesce). This isolates the follow-up coalescing under test
    // from construction-time dedupe.
    const midDayMs = Date.parse(`${iso(nowMs - 24 * 60 * 60_000).slice(0, 10)}T12:00:00.000Z`);

    // Enqueue a burst of unconfigured-resource webhooks BEFORE draining so the
    // worker sees them together (production wakes claim batches).
    for (const index of [0, 1, 2, 3, 4]) {
      const webhook = buildUnconfiguredResourceWebhook(nowMs, `msg_storm_profile_${index + 1}`, {
        occurredAtMs: midDayMs + index * 60_000,
      });
      const accepted = await service.handleWebhook("junction", webhook.headers, webhook.rawBody);
      assert.equal(accepted.accepted, true);
    }

    // Sanity: the burst enqueued five distinct unconfigured-resource jobs (each
    // carries a distinct sub-day window, so they do NOT coalesce at
    // construction). The coalescing under test is the degrade-to-floor
    // reconcile follow-up emitted by each E4 completion.
    assert.equal(
      store.summarize().jobsQueued,
      5,
      "the burst should enqueue one resource job per webhook before draining",
    );

    // Drain everything: each of the 5 E4 completions enqueues a day-floored
    // reconcile follow-up, but they share a dedupe key so only ONE reconcile is
    // queued and runs. A coalesced burst therefore fetches the floor exactly
    // once; without coalescing we would see one floor fetch per webhook (5).
    await service.drainWorker(100);

    assert.equal(
      listProviderRequests(requests).length,
      1,
      `a burst of unconfigured-resource webhooks must coalesce to a single floor fetch; requests=${JSON.stringify(requests)}`,
    );
    assert.equal(store.summarize().jobsDead, 0, "the burst must not dead-letter any job");
  } finally {
    fixture.close();
  }
});
