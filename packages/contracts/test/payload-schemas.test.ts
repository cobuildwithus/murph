import assert from "node:assert/strict";

import { test } from "vitest";

import {
  PUBLIC_EVENT_WRITE_KINDS,
  bloodTestImportPayloadSchema,
  eventImportJsonlRowPayloadSchema,
  healthEntityDefinitionByKind,
  publicEventImportJsonlRowPayloadSchemasByKind,
} from "../src/index.ts";
import { conditionUpsertPatchPayloadSchema } from "../src/shares.ts";
import { safeParseContract } from "../src/validate.ts";

test("condition and blood-test scaffolds validate against import payload schemas", () => {
  const condition = healthEntityDefinitionByKind.get("condition");
  const bloodTest = healthEntityDefinitionByKind.get("blood_test");

  assert.ok(condition?.scaffoldTemplate);
  assert.ok(bloodTest?.scaffoldTemplate);
  assert.equal(
    safeParseContract(conditionUpsertPatchPayloadSchema, condition.scaffoldTemplate).success,
    true,
  );
  assert.equal(
    safeParseContract(bloodTestImportPayloadSchema, bloodTest.scaffoldTemplate).success,
    true,
  );
});

test("blood-test import payload schema enforces nested result values", () => {
  const result = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Functional health panel",
    testName: "functional_health_panel",
    results: [
      {
        analyte: "Apolipoprotein B",
        unit: "mg/dL",
      },
    ],
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error("expected invalid blood-test payload");
  }
  assert.match(result.errors.join("\n"), /numeric value or a textValue/u);
});

test("blood-test import payload schema rejects invalid timestamps", () => {
  const result = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "not-a-date",
    title: "Functional health panel",
    testName: "functional_health_panel",
    results: [
      {
        analyte: "Apolipoprotein B",
        value: 82,
        unit: "mg/dL",
      },
    ],
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error("expected invalid blood-test timestamp");
  }
  assert.match(result.errors.join("\n"), /Invalid ISO date-time string/u);
});

test("event JSONL row payload schemas match public write kinds and reject explicit ids", () => {
  assert.deepEqual(
    Object.keys(publicEventImportJsonlRowPayloadSchemasByKind).sort(),
    [...PUBLIC_EVENT_WRITE_KINDS].sort(),
  );

  const validSymptom = {
    kind: "symptom",
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Headache",
    symptom: "headache",
    intensity: 4,
  };
  assert.equal(safeParseContract(eventImportJsonlRowPayloadSchema, validSymptom).success, true);
  assert.equal(
    safeParseContract(eventImportJsonlRowPayloadSchema, {
      kind: "note",
      occurredAt: "2026-03-12T11:15:00.000Z",
      title: "Experiment context",
      note: "Started evening protocol.",
      experimentSlug: "evening-protocol",
    }).success,
    true,
  );

  for (const forbiddenKey of ["id", "eventId"] as const) {
    const result = safeParseContract(eventImportJsonlRowPayloadSchema, {
      ...validSymptom,
      [forbiddenKey]: "evt_01JQ9R7WF97M1WAB2B4QF2Q1F0",
    });

    assert.equal(result.success, false);
    if (result.success) {
      throw new Error(`expected ${forbiddenKey} to be rejected`);
    }
    assert.match(result.errors.join("\n"), new RegExp(forbiddenKey, "u"));
  }
});

test("event JSONL row payload schema rejects invalid timestamps", () => {
  const result = safeParseContract(eventImportJsonlRowPayloadSchema, {
    kind: "symptom",
    occurredAt: "not-a-date",
    title: "Headache",
    symptom: "headache",
    intensity: 4,
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error("expected invalid event timestamp");
  }
  assert.match(result.errors.join("\n"), /Invalid ISO date-time string/u);
});
