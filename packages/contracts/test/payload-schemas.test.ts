import assert from "node:assert/strict";

import { test } from "vitest";

import {
  PUBLIC_EVENT_WRITE_KINDS,
  bloodTestImportPayloadSchema,
  healthEntityDefinitionByKind,
  publicEventImportJsonlRowPayloadSchemasByKind,
} from "../src/index.ts";
import {
  bloodTestImportPayloadSchema as bloodTestImportPayloadJsonSchema,
  conditionImportPayloadSchema as conditionImportPayloadJsonSchema,
} from "../src/schemas.ts";
import { conditionImportPayloadSchema } from "../src/shares.ts";
import { safeParseContract } from "../src/validate.ts";

type JsonSchemaObject = {
  $id?: string;
  anyOf?: JsonSchemaObject[];
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  title?: string;
};

test("condition and blood-test scaffolds validate against import payload schemas", () => {
  const condition = healthEntityDefinitionByKind.get("condition");
  const bloodTest = healthEntityDefinitionByKind.get("blood_test");

  assert.ok(condition?.scaffoldTemplate);
  assert.ok(bloodTest?.scaffoldTemplate);
  assert.equal(
    safeParseContract(conditionImportPayloadSchema, condition.scaffoldTemplate).success,
    true,
  );
  assert.equal(
    safeParseContract(bloodTestImportPayloadSchema, bloodTest.scaffoldTemplate).success,
    true,
  );
});

test("condition import payload schema requires create-safe titles", () => {
  assert.equal(
    safeParseContract(conditionImportPayloadSchema, {
      clinicalStatus: "active",
    }).success,
    false,
  );
  assert.equal(
    safeParseContract(conditionImportPayloadSchema, {
      title: "Migraine",
      clinicalStatus: "active",
    }).success,
    true,
  );
  assert.equal(
    safeParseContract(conditionImportPayloadSchema, {
      conditionId: "cond_01JQ9R7WF97M1WAB2B4QF2Q1F0",
      note: null,
    }).success,
    true,
  );
  assert.equal(
    safeParseContract(conditionImportPayloadSchema, {
      slug: "migraine",
      severity: null,
    }).success,
    true,
  );

  const schema = conditionImportPayloadJsonSchema as JsonSchemaObject;
  assert.equal(schema.$id, "@murphai/contracts/condition-import-payload.schema.json");
  assert.equal(schema.title, "Murph Condition Import Payload");
  assert.equal(schema.required, undefined);
  assert.ok(schema.anyOf?.some((branch) => branch.required?.includes("conditionId")));
  assert.ok(schema.anyOf?.some((branch) => branch.required?.includes("slug")));
  assert.ok(schema.anyOf?.some((branch) => branch.required?.includes("title")));
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

test("blood-test import payload schema accepts core-normalized optional fields", () => {
  const result = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Functional health panel",
    testName: "functional_health_panel",
    labName: null,
    collectedAt: "2026-03-12T11:15:00.000Z",
    tags: ["Lab Export"],
    results: [
      {
        analyte: "Apolipoprotein B",
        slug: "Apo B",
        biomarkerSlug: "Cardio Apo B",
        value: null,
        textValue: "not tested",
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
  const resultsSchema = schema.properties?.results as JsonSchemaObject | undefined;
  const resultArraySchema =
    resultsSchema?.items
      ? resultsSchema
      : resultsSchema?.anyOf?.find((branch) => branch.items !== undefined);
  const resultItemSchema = resultArraySchema?.items;
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

  const dateOnly = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12",
    title: "Functional health panel",
    testName: "functional_health_panel",
  });

  assert.equal(dateOnly.success, false);
  if (dateOnly.success) {
    throw new Error("expected date-only blood-test timestamp to be rejected");
  }
  assert.match(dateOnly.errors.join("\n"), /Invalid ISO date-time string/u);

  const offsetless = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12T23:30:00",
    title: "Functional health panel",
    testName: "functional_health_panel",
  });

  assert.equal(offsetless.success, false);
  if (offsetless.success) {
    throw new Error("expected offsetless blood-test timestamp to be rejected");
  }
  assert.match(offsetless.errors.join("\n"), /Invalid ISO date-time string/u);
});

test("event JSONL row payload schemas match public write kinds and reject explicit ids", () => {
  assert.deepEqual(
    Object.keys(publicEventImportJsonlRowPayloadSchemasByKind).sort(),
    [...PUBLIC_EVENT_WRITE_KINDS].sort(),
  );
  const symptomSchema = publicEventImportJsonlRowPayloadSchemasByKind.symptom;
  const noteSchema = publicEventImportJsonlRowPayloadSchemasByKind.note;

  const validSymptom = {
    kind: "symptom",
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Headache",
    symptom: "headache",
    intensity: 4,
    externalRef: {
      system: "manual-import",
      resourceType: "symptom",
      resourceId: "symptom-2026-03-12",
    },
  };
  assert.equal(safeParseContract(symptomSchema, validSymptom).success, true);
  assert.equal(
    safeParseContract(noteSchema, {
      kind: "note",
      occurredAt: "2026-03-12T11:15:00.000Z",
      title: "Experiment context",
      note: "Started evening protocol.",
      experimentSlug: "evening-protocol",
      externalRef: {
        system: "manual-import",
        resourceType: "note",
        resourceId: "note-2026-03-12",
      },
    }).success,
    true,
  );

  const missingExternalRef = safeParseContract(symptomSchema, {
    ...validSymptom,
    externalRef: undefined,
  });
  assert.equal(missingExternalRef.success, true);

  const forbiddenFields = {
    id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1F0",
    eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1F0",
    dayKey: "2026-03-11",
  } as const;

  for (const [forbiddenKey, forbiddenValue] of Object.entries(forbiddenFields)) {
    const result = safeParseContract(symptomSchema, {
      ...validSymptom,
      [forbiddenKey]: forbiddenValue,
    });

    assert.equal(result.success, false);
    if (result.success) {
      throw new Error(`expected ${forbiddenKey} to be rejected`);
    }
    assert.match(result.errors.join("\n"), new RegExp(forbiddenKey, "u"));
  }
});

test("event JSONL row payload schema rejects invalid timestamps", () => {
  const symptomSchema = publicEventImportJsonlRowPayloadSchemasByKind.symptom;
  const validSymptom = {
    kind: "symptom",
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Headache",
    symptom: "headache",
    intensity: 4,
    externalRef: {
      system: "manual-import",
      resourceType: "symptom",
      resourceId: "symptom-2026-03-12",
    },
  } as const;

  const result = safeParseContract(symptomSchema, {
    ...validSymptom,
    occurredAt: "not-a-date",
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error("expected invalid event timestamp");
  }
  assert.match(result.errors.join("\n"), /Invalid ISO date-time string/u);

  const dateOnly = safeParseContract(symptomSchema, {
    ...validSymptom,
    occurredAt: "2026-03-12",
  });

  assert.equal(dateOnly.success, false);
  if (dateOnly.success) {
    throw new Error("expected date-only event timestamp to be rejected");
  }
  assert.match(dateOnly.errors.join("\n"), /Invalid ISO date-time string/u);

  const offsetless = safeParseContract(symptomSchema, {
    ...validSymptom,
    occurredAt: "2026-03-12T23:30:00",
  });

  assert.equal(offsetless.success, false);
  if (offsetless.success) {
    throw new Error("expected offsetless event timestamp to be rejected");
  }
  assert.match(offsetless.errors.join("\n"), /Invalid ISO date-time string/u);
});
