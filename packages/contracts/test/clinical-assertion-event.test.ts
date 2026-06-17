import assert from "node:assert/strict";

import { test } from "vitest";

import { CLINICAL_ASSERTION_TYPES } from "../src/constants.ts";
import { eventRecordSchema } from "../src/zod.ts";

test("clinical assertion events capture negative allergy facts with source dates", () => {
  assert.deepEqual([...CLINICAL_ASSERTION_TYPES], [
    "no_known_allergies",
    "no_known_drug_allergies",
    "no_known_food_allergies",
  ]);

  const record = eventRecordSchema.parse({
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YS",
    kind: "clinical_assertion",
    occurredAt: "2026-03-12T08:15:00Z",
    recordedAt: "2026-03-12T08:16:00Z",
    dayKey: "2026-03-12",
    source: "import",
    title: "No known drug allergies",
    assertion: "no_known_drug_allergies",
    assertedOn: "2026-03-10",
    sourceLabel: "Uploaded visit summary",
  });

  assert.equal(record.kind, "clinical_assertion");
  assert.equal(record.assertion, "no_known_drug_allergies");
  assert.equal(record.assertedOn, "2026-03-10");
  assert.equal(record.sourceLabel, "Uploaded visit summary");
});

test("clinical assertion events reject untyped negative allergy wording", () => {
  assert.throws(() => eventRecordSchema.parse({
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YT",
    kind: "clinical_assertion",
    occurredAt: "2026-03-12T08:15:00Z",
    recordedAt: "2026-03-12T08:16:00Z",
    dayKey: "2026-03-12",
    source: "import",
    title: "No known allergies",
    assertion: "none",
    assertedOn: "2026-03-10",
  }));
});
