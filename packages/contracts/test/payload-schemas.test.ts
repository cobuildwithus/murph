import assert from "node:assert/strict";

import { test } from "vitest";

import {
  PUBLIC_EVENT_WRITE_KINDS,
  bloodTestImportPayloadSchema,
  eventImportJsonlRowPayloadSchema,
  healthEntityDefinitionByKind,
  publicEventImportJsonlRowPayloadSchemasByKind,
} from "../src/index.ts";
import {
  bloodTestImportPayloadSchema as bloodTestImportPayloadJsonSchema,
} from "../src/schemas.ts";
import { conditionUpsertPatchPayloadSchema } from "../src/shares.ts";
import { safeParseContract } from "../src/validate.ts";

type JsonSchemaObject = {
  anyOf?: unknown[];
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
};

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
  assert.match(result.errors.join("\n"), /expected number/u);
  assert.match(result.errors.join("\n"), /expected string/u);
});

test("blood-test import payload schema accepts core-normalizable dates and result slugs", () => {
  const result = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12",
    title: "Functional health panel",
    testName: "functional_health_panel",
    collectedAt: "2026-03-12",
    results: [
      {
        analyte: "Apolipoprotein B",
        slug: "Apo B",
        biomarkerSlug: "Cardio Apo B",
        value: 82,
        unit: "mg/dL",
      },
    ],
  });

  assert.equal(result.success, true);
});

test("blood-test import payload schema accepts pending tests without results", () => {
  const result = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Pending functional health panel",
    testName: "functional_health_panel",
    resultStatus: "pending",
  });

  assert.equal(result.success, true);

  const emptyResults = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Empty functional health panel",
    testName: "functional_health_panel",
    results: [],
  });

  assert.equal(emptyResults.success, false);

  const schema = bloodTestImportPayloadJsonSchema as JsonSchemaObject;
  assert.equal(schema.required?.includes("results") ?? false, false);
});

test("blood-test emitted JSON schema carries nested value and reference-range constraints", () => {
  const schema = bloodTestImportPayloadJsonSchema as JsonSchemaObject;
  const resultItemSchema = schema.properties?.results?.items as JsonSchemaObject | undefined;
  assert.ok(resultItemSchema);
  assert.ok(resultItemSchema.anyOf);

  const resultBranches = resultItemSchema.anyOf as JsonSchemaObject[];
  assert.ok(resultBranches.some((branch) => branch.required?.includes("value")));
  assert.ok(resultBranches.some((branch) => branch.required?.includes("textValue")));

  const referenceRangeSchemas = resultBranches
    .map((branch) => branch.properties?.referenceRange)
    .filter((value): value is JsonSchemaObject => value !== undefined);
  assert.ok(referenceRangeSchemas.length > 0);
  for (const referenceRangeSchema of referenceRangeSchemas) {
    assert.ok(referenceRangeSchema.anyOf);
    const referenceRangeBranches = referenceRangeSchema.anyOf as JsonSchemaObject[];
    assert.ok(referenceRangeBranches.some((branch) => branch.required?.includes("low")));
    assert.ok(referenceRangeBranches.some((branch) => branch.required?.includes("high")));
    assert.ok(referenceRangeBranches.some((branch) => branch.required?.includes("text")));
  }
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
