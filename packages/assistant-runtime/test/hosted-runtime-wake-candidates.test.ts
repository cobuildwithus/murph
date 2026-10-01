import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createHostedRuntimeWakeCandidate,
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
  selectHostedRuntimeOwnerWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "../src/hosted-runtime/wake-candidates.ts";

describe("hosted runtime wake candidates", () => {
  it("preserves device-sync ownership when candidates tie on timestamp", () => {
    const selected = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate("2026-04-08T00:30:00.000Z", "assistant"),
      createHostedRuntimeWakeCandidate(
        "2026-04-08T00:30:00.000Z",
        "device-sync.reconcile",
      ),
    ]);

    assert.deepEqual(selected, {
      at: "2026-04-08T00:30:00.000Z",
      reason: "device-sync.reconcile",
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

  it("keeps model-capable assistant ownership when a delivery retry ties", () => {
    const selected = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(
        "2026-04-08T00:30:00.000Z",
        HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      ),
      createHostedRuntimeWakeCandidate(
        "2026-04-08T00:30:00.000Z",
        "assistant",
      ),
    ]);

    assert.deepEqual(selected, {
      at: "2026-04-08T00:30:00.000Z",
      reason: "assistant",
    });
  });

  it("lets due foreground delivery outrank a due model-free mailbox row", () => {
    const selected = selectHostedRuntimeOwnerWakeCandidate({
      backgroundCandidates: [],
      foregroundCandidates: [
        createHostedRuntimeWakeCandidate(
          "2026-04-08T00:30:00.000Z",
          HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
        ),
      ],
      nowMs: Date.parse("2026-04-08T00:30:00.000Z"),
      systemMailboxWake: {
        at: "2026-04-08T00:30:00.000Z",
        executionClass: "model_free",
        reason: "mailbox",
      },
    });

    assert.deepEqual(selected, {
      at: "2026-04-08T00:30:00.000Z",
      reason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    });
  });

  it("lets a due model-free mailbox row outrank older background assistant work", () => {
    const selected = selectHostedRuntimeOwnerWakeCandidate({
      backgroundCandidates: [
        createHostedRuntimeWakeCandidate(
          "2026-04-08T00:20:00.000Z",
          "assistant",
        ),
      ],
      foregroundCandidates: [],
      nowMs: Date.parse("2026-04-08T00:30:00.000Z"),
      systemMailboxWake: {
        at: "2026-04-08T00:30:00.000Z",
        executionClass: "model_free",
        reason: "mailbox",
      },
    });

    assert.deepEqual(selected, {
      at: "2026-04-08T00:30:00.000Z",
      reason: "mailbox",
    });
  });

  it("keeps normal wake ordering for a default-owned mailbox row", () => {
    const selected = selectHostedRuntimeOwnerWakeCandidate({
      backgroundCandidates: [
        createHostedRuntimeWakeCandidate(
          "2026-04-08T00:20:00.000Z",
          "assistant",
        ),
      ],
      foregroundCandidates: [],
      nowMs: Date.parse("2026-04-08T00:30:00.000Z"),
      systemMailboxWake: {
        at: "2026-04-08T00:30:00.000Z",
        executionClass: "default_owned",
        reason: "assistant",
      },
    });

    assert.deepEqual(selected, {
      at: "2026-04-08T00:20:00.000Z",
      reason: "assistant",
    });
  });
});
