import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createHostedRuntimeWakeCandidate,
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
});
