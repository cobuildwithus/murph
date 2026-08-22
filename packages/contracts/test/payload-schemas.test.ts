import assert from "node:assert/strict";

import { test } from "vitest";

import {
  PUBLIC_EVENT_WRITE_KINDS,
  bloodTestImportPayloadSchema,
  eventImportDecisionSchema,
  eventRecordSchema,
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
  format?: string;
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  title?: string;
};

function schemaHasFormat(schema: JsonSchemaObject | undefined, format: string): boolean {
  if (!schema) {
    return false;
  }

  return schema.format === format || (schema.anyOf?.some((branch) => schemaHasFormat(branch, format)) ?? false);
}

test("sleep session records accept only explicit canonical main-sleep and nap identities", () => {
  const base = {
    schemaVersion: "murph.event.v1",
    id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1F0",
    kind: "sleep_session",
    occurredAt: "2026-03-15T22:00:00.000Z",
    recordedAt: "2026-03-16T07:30:00.000Z",
    dayKey: "2026-03-16",
    timeZone: "UTC",
    source: "device",
    title: "Sleep session",
    startAt: "2026-03-15T22:00:00.000Z",
    endAt: "2026-03-16T07:00:00.000Z",
    durationMinutes: 540,
  };

  assert.equal(eventRecordSchema.safeParse(base).success, true);
  assert.equal(eventRecordSchema.safeParse({ ...base, sleepType: "main_sleep" }).success, true);
  assert.equal(eventRecordSchema.safeParse({ ...base, sleepType: "nap" }).success, true);
  assert.equal(eventRecordSchema.safeParse({ ...base, sleepType: "rest" }).success, false);
});

test("activity session records preserve structured workouts when duration is unknown", () => {
  const record = eventRecordSchema.parse({
    schemaVersion: "murph.event.v1",
    id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1F1",
    kind: "activity_session",
    occurredAt: "2026-03-15T22:00:00.000Z",
    recordedAt: "2026-03-15T23:00:00.000Z",
    dayKey: "2026-03-15",
    timeZone: "UTC",
    source: "import",
    title: "Strength",
    activityType: "strength-training",
    workout: {
      sourceApp: "strong",
      exercises: [{
        name: "Squat",
        order: 1,
        sets: [{ order: 1, reps: 5 }],
      }],
    },
  });

  assert.equal(record.kind, "activity_session");
  assert.equal(record.durationMinutes, undefined);
  assert.equal(record.workout.exercises[0]?.sets[0]?.reps, 5);
});

test("derived observation evidence accepts only bounded scalar qualifiers", () => {
  const base = {
    schemaVersion: "murph.event.v1",
    id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1F1",
    kind: "observation",
    occurredAt: "2026-03-15T22:00:00.000Z",
    recordedAt: "2026-03-15T22:01:00.000Z",
    dayKey: "2026-03-15",
    source: "device",
    title: "Derived stress variation",
    metric: "stress-mean-absolute-successive-difference",
    observationGrain: "summary",
    unit: "score",
    value: 12.5,
    qualifiers: {
      derived: true,
      evidenceConfidence: "medium",
      evidenceMethod: "distinct-instant-mean-median-gap-2.5x-absolute-cap.v2",
      maxAdjacentGapSeconds: 900,
      qualifyingPairCount: 3,
      sampleCount: 4,
      sampleIntervalSeconds: 300,
    },
  };

  assert.equal(eventRecordSchema.safeParse(base).success, true);
  assert.equal(eventRecordSchema.safeParse({
    ...base,
    qualifiers: { ...base.qualifiers, sampleCount: 5_001 },
  }).success, false);
  assert.equal(eventRecordSchema.safeParse({
    ...base,
    qualifiers: { ...base.qualifiers, timestamps: ["2026-03-15T22:00:00.000Z"] },
  }).success, false);
});

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
  const titleOnlyResult = safeParseContract(conditionImportPayloadSchema, {
    title: "Migraine",
    note: "Tracking recurrence pattern.",
  });
  assert.equal(titleOnlyResult.success, true);
  if (!titleOnlyResult.success) {
    throw new Error("expected title-only condition import payload to parse");
  }
  assert.equal(
    Object.hasOwn(titleOnlyResult.data as Record<string, unknown>, "clinicalStatus"),
    false,
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
    eventId: "",
    occurredAt: "2026-03-12T11:15:00.000Z",
    timeZone: null,
    title: "Functional health panel",
    testName: "functional_health_panel",
    labName: null,
    collectedAt: "2026-03-12T11:15:00.000Z",
    tags: ["Lab Export"],
    links: null,
    rawRefs: null,
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

  const duplicateCollections = safeParseContract(bloodTestImportPayloadSchema, {
    eventId: null,
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Functional health panel",
    testName: "functional_health_panel",
    links: [
      {
        type: "supports_goal",
        targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6S",
      },
      {
        type: "supports_goal",
        targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6S",
      },
    ],
    rawRefs: ["raw/labs/panel.pdf", "raw/labs/panel.pdf"],
  });

  assert.equal(duplicateCollections.success, true);
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

test("blood-test import payload schema accepts writable timestamp shapes", () => {
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

  const dateOnly = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12",
    title: "Functional health panel",
    testName: "functional_health_panel",
  });

  assert.equal(dateOnly.success, true);

  const microseconds = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12T23:30:00.123456Z",
    recordedAt: "2026-03-12T23:45:00.123456-05:00",
    title: "Functional health panel",
    testName: "functional_health_panel",
    collectedAt: "2026-03-12T23:30:00.123456Z",
    reportedAt: "2026-03-13T09:00:00.123456Z",
  });

  assert.equal(microseconds.success, true);

  const lowercaseRfc3339 = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12t23:30:00.123456z",
    title: "Functional health panel",
    testName: "functional_health_panel",
  });

  assert.equal(lowercaseRfc3339.success, true);

  const offsetless = safeParseContract(bloodTestImportPayloadSchema, {
    occurredAt: "2026-03-12T23:30:00",
    recordedAt: "2026-03-12T23:45:00",
    title: "Functional health panel",
    testName: "functional_health_panel",
    collectedAt: "2026-03-12",
    reportedAt: "2026-03-13T09:00:00",
  });

  assert.equal(offsetless.success, false);

  const schema = bloodTestImportPayloadJsonSchema as JsonSchemaObject;
  assert.equal(schemaHasFormat(schema.properties?.occurredAt, "date"), true);
  assert.equal(schemaHasFormat(schema.properties?.occurredAt, "date-time"), true);
});

test("event JSONL row payload schemas match public write kinds and reject explicit ids", () => {
  assert.deepEqual(
    Object.keys(publicEventImportJsonlRowPayloadSchemasByKind).sort(),
    [...PUBLIC_EVENT_WRITE_KINDS].sort(),
  );
  const symptomSchema = publicEventImportJsonlRowPayloadSchemasByKind.symptom;
  const noteSchema = publicEventImportJsonlRowPayloadSchemasByKind.note;
  const clinicalAssertionSchema =
    publicEventImportJsonlRowPayloadSchemasByKind.clinical_assertion;
  const activitySessionSchema =
    publicEventImportJsonlRowPayloadSchemasByKind.activity_session;

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
  const activitySession = {
    kind: "activity_session",
    occurredAt: "2026-03-12T11:15:00.000Z",
    title: "Strength training",
    activityType: "strength-training",
    workout: {
      exercises: [
        {
          name: "Squat",
          order: 1,
          sets: [{ order: 1, reps: 5 }],
        },
      ],
    },
  };
  assert.equal(
    safeParseContract(activitySessionSchema, activitySession).success,
    false,
  );
  assert.equal(
    safeParseContract(activitySessionSchema, {
      ...activitySession,
      durationMinutes: 45,
    }).success,
    true,
  );
  const validNote = {
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
  };
  assert.equal(safeParseContract(noteSchema, validNote).success, true);
  assert.equal(
    safeParseContract(noteSchema, { ...validNote, reportedGender: "other" }).success,
    false,
  );
  assert.equal(
    safeParseContract(clinicalAssertionSchema, {
      kind: "clinical_assertion",
      occurredAt: "2026-03-12T11:15:00.000Z",
      title: "Alcohol denied",
      assertion: "denial_asserted",
      assertedOn: "2026-03-12",
      evidence: [
        {
          rawRef: "raw/documents/2026/03/visit-summary.pdf",
          page: 2,
          excerpt: "Alcohol denied in visit summary.",
        },
      ],
      externalRef: {
        system: "manual-import",
        resourceType: "clinical-assertion",
        resourceId: "assertion-2026-03-12",
      },
    }).success,
    true,
  );

  const missingExternalRef = safeParseContract(symptomSchema, {
    ...validSymptom,
    externalRef: undefined,
  });
  assert.equal(missingExternalRef.success, true);

  const nullRecordedAt = safeParseContract(symptomSchema, {
    ...validSymptom,
    recordedAt: null,
  });
  assert.equal(nullRecordedAt.success, true);

  const normalizedOptionals = safeParseContract(symptomSchema, {
    ...validSymptom,
    source: null,
    note: null,
    tags: null,
    links: null,
    rawRefs: null,
    evidence: null,
    timeZone: null,
  });
  assert.equal(normalizedOptionals.success, true);

  const duplicateCollections = safeParseContract(symptomSchema, {
    ...validSymptom,
    note: "",
    source: "",
    tags: ["headache", "headache"],
    links: [
      { type: "related_to", targetId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG" },
      { type: "related_to", targetId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG" },
    ],
    rawRefs: ["raw/imports/symptom.json", "raw/imports/symptom.json"],
  });
  assert.equal(duplicateCollections.success, true);

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

test("event import decisions require an ordered retraction identity", () => {
  const retraction = {
    action: "retract",
    externalRef: {
      system: "generic-smart-fhir-base-patient",
      resourceType: "observation",
      resourceId: "observation-1",
      version: "2026-03-12T11:15:00.123456Z",
    },
    reason: "FHIR resource entered in error",
    evidence: [{
      rawRef: "raw/clinical/fhir/connection-1/retrieval-2/Observation/page-1.json",
      sourceLabel: "Observation/observation-1",
    }],
  };

  assert.equal(safeParseContract(eventImportDecisionSchema, retraction).success, true);
  assert.equal(
    safeParseContract(eventImportDecisionSchema, {
      ...retraction,
      externalRef: { ...retraction.externalRef, version: undefined },
    }).success,
    false,
  );
  assert.equal(
    safeParseContract(eventImportDecisionSchema, {
      ...retraction,
      externalRef: { ...retraction.externalRef, version: "not-a-timestamp" },
    }).success,
    false,
  );
  assert.equal(
    safeParseContract(eventImportDecisionSchema, {
      ...retraction,
      externalRef: {
        ...retraction.externalRef,
        version: `2026-03-12T11:15:00.${"1".repeat(201)}Z`,
      },
    }).success,
    false,
  );
});

test("event JSONL row payload schema accepts writable timestamp shapes", () => {
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

  const dateOnly = safeParseContract(symptomSchema, {
    ...validSymptom,
    occurredAt: "2026-03-12",
  });

  assert.equal(dateOnly.success, true);

  const microseconds = safeParseContract(symptomSchema, {
    ...validSymptom,
    occurredAt: "2026-03-12T23:30:00.123456Z",
    recordedAt: "2026-03-12T23:45:00.123456-05:00",
  });

  assert.equal(microseconds.success, true);

  const lowercaseRfc3339 = safeParseContract(symptomSchema, {
    ...validSymptom,
    occurredAt: "2026-03-12t23:30:00.123456z",
  });

  assert.equal(lowercaseRfc3339.success, true);

  const offsetless = safeParseContract(symptomSchema, {
    ...validSymptom,
    occurredAt: "2026-03-12T23:30:00",
    recordedAt: "2026-03-12T23:45:00",
  });

  assert.equal(offsetless.success, false);
});
