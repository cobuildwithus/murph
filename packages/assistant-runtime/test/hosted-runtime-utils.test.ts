import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
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

test("resolveHostedWake accepts wake and wake envelopes", () => {
  const wake = buildHostedExecutionEmailConversationMessageWake({
    eventId: "email-utils-1",
    identityId: "assistant@example.com",
    occurredAt: "2026-04-08T00:00:00.000Z",
    rawMessageKey: "raw_utils_1",
    selfAddress: null,
    userId: "member_123",
  });

  assert.deepEqual(resolveHostedWake(wake), wake);
  assert.deepEqual(resolveHostedWake({ wake }), wake);
});

test("resolveHostedWake fails closed without a wake subject", () => {
  assert.throws(() => resolveHostedWake({} as never), /must include wake/u);
});
