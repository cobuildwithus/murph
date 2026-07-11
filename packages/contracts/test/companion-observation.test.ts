import assert from "node:assert/strict";

import { test } from "vitest";

import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_SCHEMA,
  parseCompanionHrvRmssdObservation,
  parseSerializedCompanionHrvRmssdObservation,
  serializeCompanionHrvRmssdObservation,
} from "../src/companion-observation.ts";

const validObservation = {
  schema: COMPANION_HRV_RMSSD_SCHEMA,
  captureId: "123e4567-e89b-42d3-a456-426614174000",
  observedAt: "2026-07-10T13:45:00.000Z",
  durationMs: 60_000,
  rmssdMs: 48.25,
  intervalCount: 72,
  acceptedIntervalCount: 68,
  successivePairCount: 63,
  quality: "good" as const,
  methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
};

test("companion HRV contract round-trips only the bounded derived observation", () => {
  const parsed = parseCompanionHrvRmssdObservation(validObservation);
  const serialized = serializeCompanionHrvRmssdObservation(parsed);

  assert.ok(new TextEncoder().encode(serialized).byteLength <= 512);
  assert.deepEqual(parseSerializedCompanionHrvRmssdObservation(serialized), validObservation);
});

test("companion HRV contract rejects raw interval, packet, and device fields", () => {
  for (const forbiddenField of [
    "rrIntervals",
    "rawBleBytes",
    "deviceIdentifier",
    "packetTimestamps",
  ]) {
    assert.throws(() => parseCompanionHrvRmssdObservation({
      ...validObservation,
      [forbiddenField]: [800, 810],
    }));
  }
});

test("companion HRV contract requires an opaque UUIDv4 capture id", () => {
  for (const captureId of [
    "wearable_serial_1234567890",
    "123e4567-e89b-12d3-a456-426614174000",
  ]) {
    assert.throws(() => parseCompanionHrvRmssdObservation({
      ...validObservation,
      captureId,
    }));
  }
});

test("companion HRV contract enforces duration and count relationships", () => {
  assert.throws(() => parseCompanionHrvRmssdObservation({
    ...validObservation,
    durationMs: 59_999,
  }));
  assert.throws(() => parseCompanionHrvRmssdObservation({
    ...validObservation,
    acceptedIntervalCount: validObservation.intervalCount + 1,
  }));
  assert.throws(() => parseCompanionHrvRmssdObservation({
    ...validObservation,
    successivePairCount: validObservation.acceptedIntervalCount,
  }));
});

test("companion HRV contract rejects interval counts that are implausible for the duration", () => {
  assert.throws(() => parseCompanionHrvRmssdObservation({
    ...validObservation,
    intervalCount: 206,
    quality: "limited",
  }));
});

test("companion HRV contract rejects quality inconsistent with the reported counts", () => {
  assert.throws(() => parseCompanionHrvRmssdObservation({
    ...validObservation,
    quality: "limited",
  }));
});
