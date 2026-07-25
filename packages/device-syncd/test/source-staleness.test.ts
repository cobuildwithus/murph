import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import { SqliteDeviceSyncStore } from "../src/store.ts";
import {
  evaluatePushPrimarySourceStaleness,
  isPushPrimarySourceProvider,
} from "../src/source-staleness.ts";
import { makeTempDirectory } from "./helpers.ts";

const CONNECTED = "connected" as const;

function garminSource(overrides: {
  firstSeenAt?: string;
  lastDataAt?: string | null;
  status?: "connected" | "unavailable" | "error" | "disconnected";
} = {}) {
  return {
    firstSeenAt: overrides.firstSeenAt ?? "2026-07-01T00:00:00.000Z",
    lastDataAt: overrides.lastDataAt ?? null,
    sourceProviderSlug: "garmin",
    status: overrides.status ?? CONNECTED,
  };
}

test("push-primary staleness re-reports a long stall on a bounded cadence", () => {
  // Nothing downstream deduplicates hosted log writes, so an hourly pass would
  // otherwise record a fresh warning every hour for a days-long stall.
  const reportedAtHours: number[] = [];
  for (let hoursSinceLastData = 0; hoursSinceLastData <= 120; hoursSinceLastData += 1) {
    const [entry] = evaluatePushPrimarySourceStaleness({
      now: new Date(Date.parse("2026-07-18T00:00:00.000Z") + hoursSinceLastData * 3_600_000)
        .toISOString(),
      sources: [garminSource({ lastDataAt: "2026-07-18T00:00:00.000Z" })],
    });

    if (entry?.shouldReport) {
      reportedAtHours.push(hoursSinceLastData);
    }
  }

  // First pass past the 36h threshold, then once per day.
  assert.deepEqual(reportedAtHours, [36, 60, 84, 108]);
});

test("push-primary staleness flags a source that stopped delivering", () => {
  const stale = evaluatePushPrimarySourceStaleness({
    now: "2026-07-24T00:00:00.000Z",
    sources: [garminSource({ lastDataAt: "2026-07-18T00:00:00.000Z" })],
  });

  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.reason, "stopped_delivering");
  assert.equal(stale[0]?.silentSinceAt, "2026-07-18T00:00:00.000Z");
  assert.equal(stale[0]?.silentHours, 144);
  assert.equal(stale[0]?.thresholdHours, 36);
});

test("push-primary staleness leaves an ordinary quiet stretch alone", () => {
  assert.deepEqual(
    evaluatePushPrimarySourceStaleness({
      // A member who did not wear the device overnight is not a stalled carrier.
      now: "2026-07-24T00:00:00.000Z",
      sources: [garminSource({ lastDataAt: "2026-07-23T00:00:00.000Z" })],
    }),
    [],
  );
});

test("push-primary staleness flags a connect that never streamed", () => {
  const stale = evaluatePushPrimarySourceStaleness({
    now: "2026-07-24T00:00:00.000Z",
    sources: [garminSource({ firstSeenAt: "2026-07-23T00:00:00.000Z", lastDataAt: null })],
  });

  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.reason, "never_delivered");
  assert.equal(stale[0]?.lastDataAt, null);
  assert.equal(stale[0]?.silentSinceAt, "2026-07-23T00:00:00.000Z");
  assert.equal(stale[0]?.thresholdHours, 6);
});

test("push-primary staleness gives a fresh connect time to backfill", () => {
  assert.deepEqual(
    evaluatePushPrimarySourceStaleness({
      now: "2026-07-24T02:00:00.000Z",
      sources: [garminSource({ firstSeenAt: "2026-07-24T00:00:00.000Z", lastDataAt: null })],
    }),
    [],
  );
});

test("push-primary staleness ignores pull-capable sources and non-connected rows", () => {
  assert.equal(isPushPrimarySourceProvider("garmin"), true);
  assert.equal(isPushPrimarySourceProvider("oura"), false);
  assert.equal(isPushPrimarySourceProvider("whoop_v2"), false);

  assert.deepEqual(
    evaluatePushPrimarySourceStaleness({
      now: "2026-07-24T00:00:00.000Z",
      sources: [
        // Pull-capable: the reconcile floor recovers these without a signal.
        {
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastDataAt: "2026-07-01T00:00:00.000Z",
          sourceProviderSlug: "oura",
          status: CONNECTED,
        },
        // Already visible through ordinary connection state.
        garminSource({ lastDataAt: "2026-07-01T00:00:00.000Z", status: "error" }),
        garminSource({ lastDataAt: "2026-07-01T00:00:00.000Z", status: "disconnected" }),
      ],
    }),
    [],
  );
});

test("device sync store records source data arrival without letting reconcile move it", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-source-arrival");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const connection = store.upsertAccount({
      provider: "aggregator",
      externalAccountId: "aggregator-account",
      displayName: "Aggregator",
      scopes: [],
      credential: { kind: "none" },
      metadata: {},
      connectedAt: "2026-07-01T00:00:00.000Z",
    });

    const created = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_garmin",
      sourceProviderSlug: "garmin",
      status: "connected",
      lastSeenAt: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(created.lastDataAt, null, "a new source has not delivered yet");

    assert.equal(
      store.markConnectionSourceDataReceived({
        connectionId: connection.id,
        now: "2026-07-02T00:00:00.000Z",
        sourceProviderSlug: "garmin",
      }),
      1,
    );

    const [afterArrival] = store.listConnectionSources({ connectionId: connection.id });
    assert.equal(afterArrival?.lastDataAt, "2026-07-02T00:00:00.000Z");

    // The hourly reconcile refreshes last_seen_at because the provider still
    // lists the source. It must not imply that data arrived, or a dead carrier
    // would look freshly delivering forever.
    store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_garmin",
      sourceProviderSlug: "garmin",
      status: "connected",
      lastSeenAt: "2026-07-09T00:00:00.000Z",
    });

    const [afterReconcile] = store.listConnectionSources({ connectionId: connection.id });
    assert.equal(afterReconcile?.lastSeenAt, "2026-07-09T00:00:00.000Z");
    assert.equal(afterReconcile?.lastDataAt, "2026-07-02T00:00:00.000Z");

    assert.deepEqual(
      evaluatePushPrimarySourceStaleness({
        now: "2026-07-09T00:00:00.000Z",
        sources: [afterReconcile!],
      }).map((entry) => entry.reason),
      ["stopped_delivering"],
    );
  } finally {
    store.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("source data arrival only moves forward and only for the delivering source", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-source-arrival-scope");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const connection = store.upsertAccount({
      provider: "aggregator",
      externalAccountId: "aggregator-account",
      displayName: "Aggregator",
      scopes: [],
      credential: { kind: "none" },
      metadata: {},
      connectedAt: "2026-07-01T00:00:00.000Z",
    });

    for (const sourceProviderSlug of ["garmin", "oura"]) {
      store.upsertConnectionSource({
        connectionId: connection.id,
        sourceInstanceKey: `src_${sourceProviderSlug}`,
        sourceProviderSlug,
        status: "connected",
        lastSeenAt: "2026-07-01T00:00:00.000Z",
      });
    }

    store.markConnectionSourceDataReceived({
      connectionId: connection.id,
      now: "2026-07-05T00:00:00.000Z",
      sourceProviderSlug: "oura",
    });

    const bySlug = new Map(
      store
        .listConnectionSources({ connectionId: connection.id })
        .map((source) => [source.sourceProviderSlug, source]),
    );
    assert.equal(bySlug.get("oura")?.lastDataAt, "2026-07-05T00:00:00.000Z");
    assert.equal(
      bySlug.get("garmin")?.lastDataAt,
      null,
      "a live sibling source must not mask a silent one",
    );

    // Out-of-order redelivery must not rewind the signal.
    assert.equal(
      store.markConnectionSourceDataReceived({
        connectionId: connection.id,
        now: "2026-07-03T00:00:00.000Z",
        sourceProviderSlug: "oura",
      }),
      0,
    );
    const [oura] = store.listConnectionSources({
      connectionId: connection.id,
      sourceProviderSlug: "oura",
    });
    assert.equal(oura?.lastDataAt, "2026-07-05T00:00:00.000Z");
  } finally {
    store.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});
