import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";

import {
  assertNever,
  resolveHostedWake,
} from "../src/hosted-runtime/utils.ts";

test("assertNever throws with the unexpected hosted execution payload", () => {
  assert.throws(
    () => assertNever({ kind: "unexpected" } as never),
    /Unexpected hosted execution event/u,
  );
});

test("resolveHostedWake returns the first wake from a run-drain request", () => {
  const wake = buildHostedExecutionRuntimeTimerWake({
    eventId: "hosted-run:run_utils_1",
    occurredAt: "2026-04-08T00:00:00.000Z",
    triggerKind: "runtime_timer",
    userId: "member_123",
  });

  assert.deepEqual(resolveHostedWake({
    acquiredAt: "2026-04-08T00:00:01.000Z",
    events: [{ seq: "24", wake, ingressEventId: "wake_24" }],
    inputCommittedSeq: "24",
    inputCursorVersion: "4",
    runId: "run_utils_1",
    triggerKind: "external_ingress",
    userId: "member_123",
  }), wake);
});

test("resolveHostedWake falls back to a synthetic runtime-timer wake for empty run drains", () => {
  assert.deepEqual(resolveHostedWake({
    acquiredAt: "2026-04-08T00:00:01.000Z",
    events: [],
    inputCommittedSeq: "24",
    inputCursorVersion: "4",
    runId: "run_utils_timer",
    triggerKind: "runtime_timer",
    userId: "member_123",
  }), buildHostedExecutionRuntimeTimerWake({
    eventId: "hosted-run:run_utils_timer",
    occurredAt: "2026-04-08T00:00:01.000Z",
    triggerKind: "runtime_timer",
    userId: "member_123",
  }));
});
