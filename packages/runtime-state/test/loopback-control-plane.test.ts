import assert from "node:assert/strict";

import { test } from "vitest";

import {
  assertListenerPort,
  isListenerPort,
  readLoopbackControlHeaderValue,
} from "../src/loopback-control-plane.ts";
import { hasMatchingLoopbackControlBearerToken } from "../src/node/loopback-control-plane-auth.ts";

test("listener port helpers accept integer TCP ports and reject invalid values", () => {
  assert.equal(isListenerPort(0), false);
  assert.equal(isListenerPort(0, { allowZero: true }), true);
  assert.equal(isListenerPort(50241), true);
  assert.equal(isListenerPort(65_536), false);
  assert.equal(isListenerPort(50.5), false);
  assert.doesNotThrow(() =>
    assertListenerPort(0, "listener port", { allowZero: true }),
  );
  assert.throws(() => assertListenerPort(-1), TypeError);
});

test("readLoopbackControlHeaderValue trims single values and rejects duplicates or blanks", () => {
  assert.equal(readLoopbackControlHeaderValue("  Bearer secret  "), "Bearer secret");
  assert.equal(
    readLoopbackControlHeaderValue(["Bearer one", "Bearer two"]),
    null,
  );
  assert.equal(readLoopbackControlHeaderValue("   "), null);
});

test("hasMatchingLoopbackControlBearerToken accepts matching tokens and rejects duplicates or mismatches", () => {
  assert.equal(
    hasMatchingLoopbackControlBearerToken("Bearer control-token", "control-token"),
    true,
  );
  assert.equal(
    hasMatchingLoopbackControlBearerToken("Bearer wrong-token", "control-token"),
    false,
  );
  assert.equal(
    hasMatchingLoopbackControlBearerToken(
      ["Bearer control-token", "Bearer shadow-token"],
      "control-token",
    ),
    false,
  );
});
