import assert from "node:assert/strict";
import { test } from "vitest";
import { SqliteDeviceSyncStore } from "../src/store.ts";
import { buildJunctionScheduleTimeHistoryDedupeKey } from "../src/junction-historical-backfill-progress.ts";

const NOW = "2026-06-12T12:00:00.000Z";
function fixture() {
  const store = new SqliteDeviceSyncStore(":memory:");
  const account = store.upsertAccount({
    provider: "junction", externalAccountId: "synthetic-history-account", scopes: [],
    credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
    connectedAt: NOW,
  });
  const enqueue = (key: string, overrides: Record<string, unknown> = {}) => store.enqueueJob({
    accountId: account.id, provider: "junction", kind: "resource", dedupeKey: key, availableAt: NOW,
    payload: {
      resource: "weight", resourceCategory: "timeseries", historicalBackfill: true,
      historicalUnresolvedProviderRecordIdentitiesJson: JSON.stringify({ v: 1, i: [] }),
      historicalUnresolvedProviderRecordCount: 0,
      historicalBackfillVersion: 2, sourceProviderSlug: "apple_health_kit", sourceLifecycleEpoch: 1,
      historicalWindowStart: "2026-01-01T00:00:00.000Z", windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-06-01T00:00:00.000Z", historicalPullPending: true,
      ...overrides,
    },
  });
  return { store, account, enqueue };
}

test.each([
  ["encoded empty", {}],
  ["legacy absent", {
    historicalUnresolvedProviderRecordIdentitiesJson: undefined,
    historicalUnresolvedProviderRecordCount: undefined,
  }],
  ["explicitly known empty", {
    historicalUnresolvedProviderRecordIdentitiesJson: '{"v":1,"i":[],"u":false}',
  }],
])("cold-restored empty weight roots share one retry retaining every accepted day (%s)", (_label, evidence) => {
  const { store, account, enqueue } = fixture();
  try {
    const later = enqueue("legacy-later", {
      ...evidence,
      historicalWindowStart: "2026-01-02T00:00:00.000Z", windowStart: "2026-01-02T00:00:00.000Z",
      windowEnd: "2026-06-02T00:00:00.000Z",
    });
    const earlier = enqueue("legacy-earlier", evidence);
    assert.equal(earlier.id, later.id);
    assert.equal(earlier.payload.windowStart, "2026-01-01T00:00:00.000Z");
    assert.equal(earlier.payload.historicalWindowStart, earlier.payload.windowStart);
    assert.equal(earlier.payload.windowEnd, "2026-06-02T00:00:00.000Z");
    assert.equal(earlier.payload.historicalPullPending, true);
    assert.equal(store.listPendingJobsForAccount(account.id, 10).length, 1);
    const key = buildJunctionScheduleTimeHistoryDedupeKey({
      sourceProviderSlug: "apple_health_kit", resource: "weight", sourceLifecycleEpoch: 1, coverageVersion: 2,
    });
    assert.equal(earlier.dedupeKey, key);
    assert.deepEqual([...store.findActiveJobDedupeKeys({ accountId: account.id, provider: "junction", dedupeKeys: [key] })], [key]);
  } finally { store.close(); }
});

for (const [label, payload] of [
  ["partial scan", { windowStart: "2026-03-01T00:00:00.000Z" }],
  ["accepted evidence", { historicalRecordsSeen: true }],
  ["unresolved evidence", { historicalUnresolvedProviderRecordCount: 1 }],
  ["encoded unresolved identities", { historicalUnresolvedProviderRecordIdentitiesJson: '{"v":1,"i":["synthetic-record"]}' }],
  ["unidentified unresolved records", { historicalUnresolvedProviderRecordIdentitiesJson: '{"v":1,"i":[],"u":true}' }],
  ["malformed encoding", { historicalUnresolvedProviderRecordIdentitiesJson: '{' }],
  ["unknown encoding version", { historicalUnresolvedProviderRecordIdentitiesJson: '{"v":2,"i":[]}' }],
  ["unknown encoded evidence", { historicalUnresolvedProviderRecordIdentitiesJson: '{"v":1,"i":[],"cursor":"pending"}' }],
  ["older generation", { historicalBackfillVersion: 1 }],
  ["unrecognized continuation state", { providerCursor: "synthetic-cursor" }],
  ["another lifecycle", { sourceLifecycleEpoch: 2 }],
  ["another source", { sourceProviderSlug: "garmin" }],
] as const) {
  test(`weight root convergence preserves ${label}`, () => {
    const { store, account, enqueue } = fixture();
    try {
      const first = enqueue("legacy-first", payload);
      const second = enqueue("legacy-second");
      assert.notEqual(first.id, second.id);
      assert.equal(store.listPendingJobsForAccount(account.id, 10).length, 2);
    } finally { store.close(); }
  });
}

test("weight root convergence never rewrites a running scan", () => {
  const { store, account, enqueue } = fixture();
  try {
    const first = enqueue("legacy-first");
    const running = store.claimDueJob("worker", NOW, 60_000, account.id);
    assert.equal(running?.id, first.id);
    const second = enqueue("legacy-second", {
      historicalWindowStart: "2025-12-31T00:00:00.000Z", windowStart: "2025-12-31T00:00:00.000Z",
    });
    assert.notEqual(first.id, second.id);
    assert.equal(store.getJobById(first.id)?.payload.windowStart, "2026-01-01T00:00:00.000Z");
  } finally { store.close(); }
});
