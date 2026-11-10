import assert from "node:assert/strict";

import { describe, it } from "vitest";
import { parseHostedRuntimeRedactedJson } from "@murphai/hosted-execution/parsers";

import {
  createHostedRuntimeWakeCandidate,
  floorHostedAutonomousWakeCandidate,
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
  resolveHostedAutonomousWakeWindow,
  selectHostedRuntimeOwnerWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "../src/hosted-runtime/wake-candidates.ts";

describe("hosted runtime wake candidates", () => {
  it("repairs missing, future, invalid, and expired autonomous windows", () => {
    const nowMs = Date.parse("2026-11-10T12:00:00.000Z");
    for (const startedAt of [undefined, "invalid", "2026-11-10T12:00:01.000Z", "2026-11-10T11:00:00.000Z"]) {
      assert.deepEqual(resolveHostedAutonomousWakeWindow({
        nowMs, startedAt, shortWakeCount: 99,
      }), { startedAtMs: nowMs, shortWakeCount: 0 });
    }
  });

  it("keeps additive snapshot counters readable by the unchanged status parser", () => {
    const status = {
      hostedAutonomousWakeWindowStartedAt: "2026-11-10T12:00:00.000Z",
      hostedAutonomousShortWakeCount: 20,
    };
    assert.deepEqual(parseHostedRuntimeRedactedJson(status, "redactedStatus"), status);
  });

  it("floors only a positively autonomous short wake after twenty publications", () => {
    const nowMs = Date.parse("2026-11-10T12:00:00.000Z");
    const shortWake = createHostedRuntimeWakeCandidate(
      "2026-11-10T12:00:15.000Z", "device-sync.reconcile", true,
    );
    assert.deepEqual(floorHostedAutonomousWakeCandidate({
      candidate: shortWake, nowMs,
      window: { startedAtMs: nowMs, shortWakeCount: 19 },
    }), shortWake);
    const floored = floorHostedAutonomousWakeCandidate({
      candidate: shortWake, nowMs,
      window: { startedAtMs: nowMs, shortWakeCount: 20 },
    });
    assert.equal(floored?.at, "2026-11-10T12:05:00.000Z");
    assert.equal(floored?.autonomousWakeFloorApplied, true);
    const pendingReply = createHostedRuntimeWakeCandidate(
      "2026-11-10T12:00:01.000Z", "assistant",
    );
    const selected = selectHostedRuntimeOwnerWakeCandidate({
      backgroundCandidates: [floored],
      foregroundCandidates: [pendingReply],
      nowMs,
      systemMailboxWake: { at: null, executionClass: null, reason: null },
    });
    assert.deepEqual(selected, pendingReply);
    const retentionDeadline = createHostedRuntimeWakeCandidate(
      "2026-11-10T12:00:02.000Z", "inbox_media_retention",
    );
    assert.deepEqual(selectHostedRuntimeWakeCandidate([floored, retentionDeadline]),
      retentionDeadline);
  });
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
