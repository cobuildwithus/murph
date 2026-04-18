import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionWakeFromDispatch,
} from "@murphai/hosted-execution";

import {
  assertNever,
  resolveHostedDispatch,
  resolveHostedWake,
} from "../src/hosted-runtime/utils.ts";

test("assertNever throws with the unexpected hosted execution payload", () => {
  assert.throws(
    () => assertNever({ kind: "unexpected" } as never),
    /Unexpected hosted execution event/u,
  );
});

test("resolveHostedDispatch and resolveHostedWake accept dispatch, wake, and envelope subjects", () => {
  const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
    eventId: "email-utils-1",
    identityId: "assistant@example.com",
    occurredAt: "2026-04-08T00:00:00.000Z",
    rawMessageKey: "raw_utils_1",
    selfAddress: null,
    userId: "member_123",
  });
  const wake = buildHostedExecutionWakeFromDispatch(dispatch);

  assert.deepEqual(resolveHostedDispatch(dispatch), dispatch);
  assert.deepEqual(resolveHostedDispatch(wake), dispatch);
  assert.deepEqual(resolveHostedDispatch({ dispatch }), dispatch);
  assert.deepEqual(resolveHostedDispatch({ wake }), dispatch);

  assert.deepEqual(resolveHostedWake(wake), wake);
  assert.deepEqual(resolveHostedWake(dispatch), wake);
  assert.deepEqual(resolveHostedWake({ wake }), wake);
  assert.deepEqual(resolveHostedWake({ dispatch }), wake);
});

test("resolveHostedDispatch and resolveHostedWake fail closed without dispatch or wake subjects", () => {
  assert.throws(() => resolveHostedDispatch({} as never), /must include dispatch or wake/u);
  assert.throws(() => resolveHostedWake({} as never), /must include dispatch or wake/u);
});
