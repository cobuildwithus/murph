import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createHostedRuntimeWakeCandidate,
  resolveHostedRuntimeWakeProjection,
  selectHostedRuntimeWakeCandidate,
} from "../src/hosted-runtime/wake-candidates.ts";

describe("hosted runtime wake candidates", () => {
  it("keeps the first candidate when candidates tie on timestamp", () => {
    const selected = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate("2026-04-08T00:30:00.000Z", "assistant"),
      createHostedRuntimeWakeCandidate(
        "2026-04-08T00:30:00.000Z",
        "device-sync.reconcile",
      ),
    ]);

    assert.deepEqual(selected, {
      at: "2026-04-08T00:30:00.000Z",
      reason: "assistant",
    });
  });

  it("does not let invalid timestamps outrank a valid candidate", () => {
    const selected = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate("not-a-timestamp", "device-sync.reconcile"),
      createHostedRuntimeWakeCandidate("2026-04-08T00:30:00.000Z", "assistant"),
    ]);

    assert.deepEqual(selected, {
      at: "2026-04-08T00:30:00.000Z",
      reason: "assistant",
    });
  });
});

describe("hosted runtime wake projection", () => {
  const capturedNow = "2026-04-08T12:00:00.000Z";

  it("lets a fresh due candidate supersede a carried due token regardless of age", () => {
    const projected = resolveHostedRuntimeWakeProjection([
      {
        at: "2026-04-08T02:00:00.000Z",
        reason: "device-sync.reconcile",
        source: "carry",
      },
      {
        at: "2026-04-08T11:59:00.000Z",
        reason: "assistant",
        source: "fresh",
      },
    ], capturedNow);

    assert.deepEqual(projected, {
      at: "2026-04-08T11:59:00.000Z",
      reason: "assistant",
    });
  });

  it("preserves a carried due token exactly when no fresh due candidate exists", () => {
    const projected = resolveHostedRuntimeWakeProjection([
      {
        at: "2026-04-08T02:00:00.000Z",
        reason: "device-sync.reconcile",
        source: "carry",
      },
      {
        at: "2026-04-08T18:00:00.000Z",
        reason: "assistant",
        source: "fresh",
      },
    ], capturedNow);

    assert.deepEqual(projected, {
      at: "2026-04-08T02:00:00.000Z",
      reason: "device-sync.reconcile",
    });
  });

  it("selects the earliest future candidate when nothing is due", () => {
    const projected = resolveHostedRuntimeWakeProjection([
      {
        at: "2026-04-08T18:00:00.000Z",
        reason: "device-sync.reconcile",
        source: "carry",
      },
      {
        at: "2026-04-08T13:00:00.000Z",
        reason: "assistant",
        source: "fresh",
      },
    ], capturedNow);

    assert.deepEqual(projected, {
      at: "2026-04-08T13:00:00.000Z",
      reason: "assistant",
    });
  });

  it("prefers the fresh candidate when future candidates tie on timestamp", () => {
    const projected = resolveHostedRuntimeWakeProjection([
      {
        at: "2026-04-08T13:00:00.000Z",
        reason: "device-sync.reconcile",
        source: "carry",
      },
      {
        at: "2026-04-08T13:00:00.000Z",
        reason: "assistant",
        source: "fresh",
      },
    ], capturedNow);

    assert.deepEqual(projected, {
      at: "2026-04-08T13:00:00.000Z",
      reason: "assistant",
    });
  });

  it("keeps a carried future wake when the pass observed nothing", () => {
    const projected = resolveHostedRuntimeWakeProjection([
      {
        at: "2026-04-08T13:00:00.000Z",
        reason: "assistant",
        source: "carry",
      },
      { at: null, reason: null, source: "fresh" },
    ], capturedNow);

    assert.deepEqual(projected, {
      at: "2026-04-08T13:00:00.000Z",
      reason: "assistant",
    });
  });

  it("returns an empty projection when no candidate has a timestamp", () => {
    const projected = resolveHostedRuntimeWakeProjection([
      { at: null, reason: null, source: "carry" },
      { at: null, reason: null, source: "fresh" },
    ], capturedNow);

    assert.deepEqual(projected, { at: null, reason: null });
  });
});
