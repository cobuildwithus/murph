import assert from "node:assert/strict";

import { test } from "vitest";

import { readHostedRunnerCommitTimeoutMs } from "../src/hosted-runtime/timeouts.ts";

test("hosted runner commit timeout keeps positive finite values", () => {
  assert.equal(readHostedRunnerCommitTimeoutMs(15_000), 15_000);
});

test("hosted runner commit timeout falls back for null and non-positive values", () => {
  assert.equal(readHostedRunnerCommitTimeoutMs(null), 30_000);
  assert.equal(readHostedRunnerCommitTimeoutMs(0), 30_000);
  assert.equal(readHostedRunnerCommitTimeoutMs(-1), 30_000);
});

test("hosted runner commit timeout falls back for non-finite values", () => {
  assert.equal(readHostedRunnerCommitTimeoutMs(Number.NaN), 30_000);
  assert.equal(readHostedRunnerCommitTimeoutMs(Number.POSITIVE_INFINITY), 30_000);
});
