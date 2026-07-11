import assert from "node:assert/strict";

import { test } from "vitest";

import {
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS,
  JunctionCompanionHealthMetadataParseError,
  parseJunctionCompanionHealthMetadataBatch,
} from "../src/junction-resources.ts";

const RECEIVED_AT_MS = Date.parse("2026-04-03T13:00:00.000Z");

function healthMetadataRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    endAt: "2026-04-02T16:00:00.000Z",
    kind: "recovery_score",
    recordId: "a".repeat(64),
    startAt: "2026-04-02T08:00:00.000Z",
    syncVersion: 1,
    value: 72,
    ...overrides,
  };
}

test("companion health metadata parser canonicalizes and sorts the closed batch", () => {
  const batch = parseJunctionCompanionHealthMetadataBatch({
    records: [
      healthMetadataRecord({
        endAt: "2026-04-02T17:45:00-04:00",
        kind: "workout_strain",
        recordId: "b".repeat(64),
        startAt: "2026-04-02T17:00:00-04:00",
        syncVersion: 2,
        value: 11.3,
      }),
      healthMetadataRecord({
        endAt: "2026-04-02T12:00:00-04:00",
        recordId: "a".repeat(64),
        startAt: "2026-04-02T04:00:00-04:00",
        syncVersion: Number.MAX_SAFE_INTEGER,
        value: 0,
      }),
    ],
    schemaVersion: 1,
  }, RECEIVED_AT_MS);

  assert.deepEqual(batch, {
    records: [
      {
        endAt: "2026-04-02T16:00:00.000Z",
        kind: "recovery_score",
        recordId: "a".repeat(64),
        startAt: "2026-04-02T08:00:00.000Z",
        syncVersion: Number.MAX_SAFE_INTEGER,
        value: 0,
      },
      {
        endAt: "2026-04-02T21:45:00.000Z",
        kind: "workout_strain",
        recordId: "b".repeat(64),
        startAt: "2026-04-02T21:00:00.000Z",
        syncVersion: 2,
        value: 11.3,
      },
    ],
    schemaVersion: 1,
  });
  assert.ok(
    new TextEncoder().encode(JSON.stringify(batch)).byteLength
      <= JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  );
});

test("companion health metadata parser accepts exact value, clock, and version boundaries", () => {
  const historyStart = new Date(
    RECEIVED_AT_MS - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  ).toISOString();
  const historyEnd = new Date(Date.parse(historyStart) + 1).toISOString();
  const futureEnd = new Date(
    RECEIVED_AT_MS + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  ).toISOString();
  const futureStart = new Date(Date.parse(futureEnd) - 1).toISOString();

  const batch = parseJunctionCompanionHealthMetadataBatch({
    records: [
      healthMetadataRecord({
        endAt: historyEnd,
        recordId: "c".repeat(64),
        startAt: historyStart,
        syncVersion: Number.MAX_SAFE_INTEGER,
        value: 0,
      }),
      healthMetadataRecord({
        endAt: futureEnd,
        kind: "workout_strain",
        recordId: "d".repeat(64),
        startAt: futureStart,
        syncVersion: 0,
        value: 21,
      }),
    ],
    schemaVersion: 1,
  }, RECEIVED_AT_MS);

  assert.equal(batch.records.length, 2);
  assert.equal(batch.records[0]?.syncVersion, Number.MAX_SAFE_INTEGER);
  assert.equal(batch.records[1]?.syncVersion, 0);
  assert.equal(batch.records[1]?.value, 21);
});

test("companion health metadata parser rejects malformed or broadened decoded batches", () => {
  const tooOldStart = new Date(
    RECEIVED_AT_MS - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS - 1,
  ).toISOString();
  const tooOldEnd = new Date(Date.parse(tooOldStart) + 1).toISOString();
  const tooFutureEnd = new Date(
    RECEIVED_AT_MS + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS + 1,
  ).toISOString();
  const tooFutureStart = new Date(Date.parse(tooFutureEnd) - 1).toISOString();
  const validBatch = () => ({ records: [healthMetadataRecord()], schemaVersion: 1 });
  const cases: Array<{ label: string; value: unknown }> = [
    { label: "non-object batch", value: null },
    { label: "unexpected batch field", value: { ...validBatch(), extra: true } },
    { label: "unsupported schema", value: { ...validBatch(), schemaVersion: 2 } },
    { label: "records are not an array", value: { records: {}, schemaVersion: 1 } },
    { label: "empty batch", value: { records: [], schemaVersion: 1 } },
    {
      label: "too many records",
      value: {
        records: Array.from(
          { length: JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS + 1 },
          () => healthMetadataRecord(),
        ),
        schemaVersion: 1,
      },
    },
    { label: "non-object record", value: { records: [null], schemaVersion: 1 } },
    {
      label: "unexpected record field",
      value: { records: [healthMetadataRecord({ extra: true })], schemaVersion: 1 },
    },
    {
      label: "invalid record id",
      value: { records: [healthMetadataRecord({ recordId: "A".repeat(64) })], schemaVersion: 1 },
    },
    {
      label: "duplicate record id",
      value: { records: [healthMetadataRecord(), healthMetadataRecord()], schemaVersion: 1 },
    },
    {
      label: "unsupported kind",
      value: { records: [healthMetadataRecord({ kind: "sleep_stage" })], schemaVersion: 1 },
    },
    {
      label: "recovery value out of range",
      value: { records: [healthMetadataRecord({ value: 101 })], schemaVersion: 1 },
    },
    {
      label: "strain value out of range",
      value: {
        records: [healthMetadataRecord({ kind: "workout_strain", value: 21.1 })],
        schemaVersion: 1,
      },
    },
    {
      label: "non-finite value",
      value: { records: [healthMetadataRecord({ value: Number.POSITIVE_INFINITY })], schemaVersion: 1 },
    },
    {
      label: "non-ISO timestamp",
      value: { records: [healthMetadataRecord({ startAt: "April 2, 2026" })], schemaVersion: 1 },
    },
    {
      label: "invalid interval",
      value: {
        records: [healthMetadataRecord({ startAt: "2026-04-02T16:00:00.000Z" })],
        schemaVersion: 1,
      },
    },
    {
      label: "history too old",
      value: {
        records: [healthMetadataRecord({ endAt: tooOldEnd, startAt: tooOldStart })],
        schemaVersion: 1,
      },
    },
    {
      label: "future timestamp",
      value: {
        records: [healthMetadataRecord({ endAt: tooFutureEnd, startAt: tooFutureStart })],
        schemaVersion: 1,
      },
    },
    {
      label: "missing sync version",
      value: { records: [healthMetadataRecord({ syncVersion: undefined })], schemaVersion: 1 },
    },
    {
      label: "negative sync version",
      value: { records: [healthMetadataRecord({ syncVersion: -1 })], schemaVersion: 1 },
    },
    {
      label: "unsafe sync version",
      value: {
        records: [healthMetadataRecord({ syncVersion: Number.MAX_SAFE_INTEGER + 1 })],
        schemaVersion: 1,
      },
    },
  ];

  for (const testCase of cases) {
    assert.throws(
      () => parseJunctionCompanionHealthMetadataBatch(testCase.value, RECEIVED_AT_MS),
      (error: unknown) => error instanceof JunctionCompanionHealthMetadataParseError,
      testCase.label,
    );
  }
  assert.throws(
    () => parseJunctionCompanionHealthMetadataBatch(validBatch(), Number.NaN),
    (error: unknown) => error instanceof JunctionCompanionHealthMetadataParseError,
    "invalid receivedAt",
  );
});
