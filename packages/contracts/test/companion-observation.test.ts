import assert from "node:assert/strict";

import { test } from "vitest";

import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_SCHEMA,
  parseCompanionHrvRmssdAdmissionId,
  parseCompanionHrvRmssdObservation,
  parseSerializedCompanionHrvRmssdObservation,
  serializeCompanionHrvRmssdObservation,
} from "../src/companion-observation.ts";

const validObservation = {
  schema: COMPANION_HRV_RMSSD_SCHEMA,
  methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
  nightDate: "2026-07-10",
  rmssdMs: 52.75,
  completedWindowCount: 96,
  acceptedWindowCount: 72,
};

test("companion HRV contract round-trips one bounded overnight summary", () => {
  assert.equal(
    COMPANION_HRV_RMSSD_METHOD_VERSION,
    "prv-rmssd-5m-mean-scheduled-0000-0800-local-v1",
  );
  const parsed = parseCompanionHrvRmssdObservation(validObservation);
  const serialized = serializeCompanionHrvRmssdObservation(parsed);

  assert.deepEqual(Object.keys(parsed).sort(), [
    "acceptedWindowCount",
    "completedWindowCount",
    "methodVersion",
    "nightDate",
    "rmssdMs",
    "schema",
  ]);
  assert.ok(new TextEncoder().encode(serialized).byteLength <= 512);
  assert.deepEqual(parseSerializedCompanionHrvRmssdObservation(serialized), validObservation);
});

test("companion HRV contract requires every field in the six-key envelope", () => {
  for (const requiredField of Object.keys(validObservation)) {
    const missingField = { ...validObservation } as Record<string, unknown>;
    delete missingField[requiredField];

    assert.throws(() => parseCompanionHrvRmssdObservation(missingField));
  }
});

test("companion HRV contract rejects timestamps, raw data, identifiers, and per-window values", () => {
  for (const [forbiddenField, value] of Object.entries({
    acceptedCoverageMs: 72 * 280_000,
    captureDurationMs: 8 * 60 * 60 * 1_000,
    captureEndUtcOffsetMinutes: -4 * 60,
    captureId: "123e4567-e89b-42d3-a456-426614174000",
    captureStartedAt: "2026-07-10T03:00:00.000Z",
    deviceIdentifier: "wearable-identifier",
    packetTimestamps: [1, 2],
    rawBleBytes: "001122",
    rrIntervals: [800, 810],
    windowRmssdMs: [42],
  })) {
    assert.throws(() => parseCompanionHrvRmssdObservation({
      ...validObservation,
      [forbiddenField]: value,
    }));
  }
});

test("companion HRV contract enforces completed and accepted window bounds", () => {
  for (const invalid of [
    { completedWindowCount: 83 },
    { completedWindowCount: 109 },
    { acceptedWindowCount: 47 },
    { acceptedWindowCount: 97 },
    { acceptedWindowCount: 48, completedWindowCount: 97 },
  ]) {
    assert.throws(() => parseCompanionHrvRmssdObservation({
      ...validObservation,
      ...invalid,
    }));
  }

  for (const [completedWindowCount, acceptedWindowCount] of [
    [84, 48],
    [90, 48],
    [96, 48],
    [102, 51],
    [108, 54],
  ] as const) {
    assert.doesNotThrow(() => parseCompanionHrvRmssdObservation({
      ...validObservation,
      acceptedWindowCount,
      completedWindowCount,
    }));
  }
});

test("companion HRV contract rejects the retired user-bounded method", () => {
  assert.throws(() => parseCompanionHrvRmssdObservation({
    ...validObservation,
    methodVersion: "prv-rmssd-5m-mean-v1",
  }));
});

test("companion HRV contract rejects the undistributed spot schema", () => {
  assert.throws(() => parseCompanionHrvRmssdObservation({
    schema: "murph.companion.hrv-rmssd.v1",
    captureId: "123e4567-e89b-42d3-a456-426614174000",
    observedAt: "2026-07-10T13:45:00.000Z",
    durationMs: 60_000,
    rmssdMs: 48.25,
    intervalCount: 72,
    acceptedIntervalCount: 68,
    successivePairCount: 63,
    quality: "good",
    methodVersion: "rmssd-pulse-interval-v1",
  }));
});

test("companion HRV serialized payloads are capped at 512 bytes", () => {
  assert.throws(
    () => parseSerializedCompanionHrvRmssdObservation(validObservation),
    /must be a JSON string/u,
  );
  assert.throws(
    () => parseSerializedCompanionHrvRmssdObservation(
      `${" ".repeat(513)}${JSON.stringify(validObservation)}`,
    ),
    /payload limit/u,
  );
});

test("companion HRV contract accepts only canonical admission digests", () => {
  const admissionId = "a".repeat(64);

  assert.equal(parseCompanionHrvRmssdAdmissionId(admissionId), admissionId);
  assert.throws(
    () => parseCompanionHrvRmssdAdmissionId("A".repeat(64)),
    /admission identity/u,
  );
  assert.throws(
    () => parseCompanionHrvRmssdAdmissionId("a".repeat(63)),
    /admission identity/u,
  );
});
