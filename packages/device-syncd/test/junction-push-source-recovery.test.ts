import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildJunctionPushSourceRecoveryMetadataPatch,
  readJunctionPushSourceRecoveryState,
  resolveJunctionPushSourceRecoveryStatus,
  selectDueJunctionPushSourceRecovery,
} from "../src/junction-push-source-recovery.ts";
import type { PushPrimarySourceStaleness } from "../src/source-staleness.ts";

const STALL_START = "2026-07-18T00:00:00.000Z";

function staleGarmin(
  overrides: Partial<PushPrimarySourceStaleness> = {},
): PushPrimarySourceStaleness {
  return {
    lastDataAt: STALL_START,
    reason: "stopped_delivering",
    silentHours: 40,
    silentSinceAt: STALL_START,
    sourceProviderSlug: "garmin",
    thresholdHours: 36,
    ...overrides,
  };
}

function metadataAfter(input: {
  attempts: number;
  now: string;
  endpointUnavailable?: boolean;
  silentSinceAt?: string;
}): Record<string, unknown> {
  return buildJunctionPushSourceRecoveryMetadataPatch({
    attempts: input.attempts,
    now: input.now,
    silentSinceAt: input.silentSinceAt ?? STALL_START,
    sourceProviderSlug: "garmin",
    status: resolveJunctionPushSourceRecoveryStatus({
      attempts: input.attempts,
      endpointUnavailable: input.endpointUnavailable ?? false,
    }),
  });
}

test("a newly detected stall triggers recovery immediately", () => {
  assert.deepEqual(
    selectDueJunctionPushSourceRecovery({
      metadata: {},
      now: "2026-07-19T16:00:00.000Z",
      stale: [staleGarmin()],
    }),
    { silentSinceAt: STALL_START, sourceProviderSlug: "garmin" },
  );
});

test("a healthy connection triggers nothing", () => {
  assert.equal(
    selectDueJunctionPushSourceRecovery({
      metadata: {},
      now: "2026-07-19T16:00:00.000Z",
      stale: [],
    }),
    null,
  );
});

test("recovery attempts follow a bounded ladder and then stop", () => {
  // Attempt 1 fires on detection; the ladder then waits 6h and 24h.
  let metadata = metadataAfter({ attempts: 1, now: "2026-07-19T16:00:00.000Z" });
  assert.equal(readJunctionPushSourceRecoveryState(metadata).status, "triggered");

  assert.equal(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-19T20:00:00.000Z",
      stale: [staleGarmin()],
    }),
    null,
    "a second attempt must not fire before its delay elapses",
  );

  assert.deepEqual(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-19T22:00:00.000Z",
      stale: [staleGarmin()],
    }),
    { silentSinceAt: STALL_START, sourceProviderSlug: "garmin" },
  );

  metadata = metadataAfter({ attempts: 2, now: "2026-07-19T22:00:00.000Z" });
  assert.equal(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-20T10:00:00.000Z",
      stale: [staleGarmin()],
    }),
    null,
  );
  assert.ok(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-20T16:00:00.000Z",
      stale: [staleGarmin()],
    }),
  );

  // Third attempt lands; a fourth is still owed 24 more hours.
  metadata = metadataAfter({ attempts: 3, now: "2026-07-20T16:00:00.000Z" });
  assert.equal(readJunctionPushSourceRecoveryState(metadata).status, "triggered");
  assert.equal(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-21T10:00:00.000Z",
      stale: [staleGarmin()],
    }),
    null,
  );
  assert.ok(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-21T16:00:00.000Z",
      stale: [staleGarmin()],
    }),
  );

  // The fourth attempt exhausts the ladder; a still-silent source stops here
  // rather than triggering provider work forever.
  metadata = metadataAfter({ attempts: 4, now: "2026-07-21T16:00:00.000Z" });
  assert.equal(readJunctionPushSourceRecoveryState(metadata).status, "exhausted");
  assert.equal(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-30T00:00:00.000Z",
      stale: [staleGarmin()],
    }),
    null,
  );
});

test("a gated trigger endpoint pauses the episode without spending the ladder", () => {
  const metadata = metadataAfter({
    // A gated call never reached the recovery mechanism, so it consumes no
    // attempt; otherwise a build deployed before enablement would spend every
    // episode's whole ladder on 403s.
    attempts: 0,
    endpointUnavailable: true,
    now: "2026-07-19T16:00:00.000Z",
  });

  assert.equal(readJunctionPushSourceRecoveryState(metadata).status, "unavailable");
  assert.equal(readJunctionPushSourceRecoveryState(metadata).attempts, 0);

  // Not retried immediately: a gated endpoint stays gated for a while.
  assert.equal(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-20T00:00:00.000Z",
      stale: [staleGarmin()],
    }),
    null,
  );

  // But enablement is a vendor-side change we cannot observe, so the episode
  // must become eligible again rather than being abandoned forever.
  assert.deepEqual(
    selectDueJunctionPushSourceRecovery({
      metadata,
      now: "2026-07-20T17:00:00.000Z",
      stale: [staleGarmin()],
    }),
    { silentSinceAt: STALL_START, sourceProviderSlug: "garmin" },
  );
});

test("a later stall starts a fresh ladder after an exhausted one", () => {
  const exhausted = metadataAfter({ attempts: 4, now: "2026-07-21T16:00:00.000Z" });
  const laterStall = "2026-08-01T00:00:00.000Z";

  // Data resumed and the source stalled again, so the episode key changed. That
  // is what makes recovery repeatable without any explicit reset step.
  assert.deepEqual(
    selectDueJunctionPushSourceRecovery({
      metadata: exhausted,
      now: "2026-08-02T18:00:00.000Z",
      stale: [staleGarmin({ lastDataAt: laterStall, silentSinceAt: laterStall })],
    }),
    { silentSinceAt: laterStall, sourceProviderSlug: "garmin" },
  );
});

test("only one source is triggered per pass and selection is deterministic", () => {
  const other = "2026-07-17T00:00:00.000Z";
  const due = selectDueJunctionPushSourceRecovery({
    metadata: {},
    now: "2026-07-19T16:00:00.000Z",
    stale: [
      staleGarmin({ sourceProviderSlug: "polar", silentSinceAt: other, lastDataAt: other }),
      staleGarmin(),
    ],
  });

  // A multi-source connection must not fire a burst of provider work at once.
  assert.deepEqual(due, { silentSinceAt: STALL_START, sourceProviderSlug: "garmin" });
});
