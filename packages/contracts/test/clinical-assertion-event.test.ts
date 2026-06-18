import assert from "node:assert/strict";

import { test } from "vitest";

import {
  CLINICAL_ASSERTION_DOMAINS,
  CLINICAL_ASSERTION_POLARITIES,
  CLINICAL_ASSERTION_TYPES,
} from "../src/constants.ts";
import {
  eventRecordSchema,
  familyMemberFrontmatterSchema,
} from "../src/zod.ts";

test("clinical assertion events capture bounded assertion facts with evidence", () => {
  for (const assertion of [
    "denial_asserted",
    "normality_asserted",
    "no_known_drug_allergies",
    "no_known_medications",
  ] as const) {
    assert.equal(CLINICAL_ASSERTION_TYPES.includes(assertion), true);
  }
  assert.equal(CLINICAL_ASSERTION_DOMAINS.includes("social"), true);
  assert.equal(CLINICAL_ASSERTION_POLARITIES.includes("absent"), true);

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
    domain: "allergy",
    polarity: "absent",
    subject: "drug allergies",
    assertionText: "No known drug allergies documented.",
    assertedOn: "2026-03-10",
    sourceLabel: "Uploaded visit summary",
    evidence: [
      {
        sourceDocumentId: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        page: 2,
        spanStart: 120,
        spanEnd: 172,
        excerpt: "Synthetic evidence excerpt.",
        confidence: 0.92,
      },
    ],
  });

  assert.equal(record.kind, "clinical_assertion");
  assert.equal(record.assertion, "no_known_drug_allergies");
  assert.equal(record.domain, "allergy");
  assert.equal(record.polarity, "absent");
  assert.equal(record.evidence?.[0]?.sourceDocumentId, "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV");
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

test("clinical note events capture structured sections without a new event kind", () => {
  const record = eventRecordSchema.parse({
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YV",
    kind: "note",
    occurredAt: "2026-03-12T08:15:00Z",
    recordedAt: "2026-03-12T08:16:00Z",
    dayKey: "2026-03-12",
    source: "import",
    title: "Clinical note",
    note: "Assessment\nSynthetic assessment text.",
    noteType: "progress_note",
    authoredAt: "2026-03-12T08:10:00Z",
    author: "Example clinician",
    facility: "Example Clinic",
    sections: [
      {
        kind: "assessment",
        heading: "Assessment",
        text: "Synthetic assessment text.",
      },
    ],
  });

  assert.equal(record.kind, "note");
  assert.equal(record.noteType, "progress_note");
  assert.equal(record.sections?.[0]?.kind, "assessment");
});

test("family frontmatter accepts structured condition history", () => {
  const familyMember = familyMemberFrontmatterSchema.parse({
    schemaVersion: "murph.frontmatter.family-member.v1",
    docType: "family_member",
    familyMemberId: "fam_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "parent",
    title: "Parent",
    relationship: "parent",
    conditionHistory: [
      {
        condition: "Synthetic condition",
        status: "present",
        onsetText: "adult onset",
        evidence: [
          {
            sourceDocumentId: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            rawRef: "raw/documents/2026/06/synthetic.pdf",
          },
        ],
      },
    ],
  });

  assert.equal(familyMember.conditionHistory?.[0]?.condition, "Synthetic condition");
  assert.equal(
    familyMember.conditionHistory?.[0]?.evidence?.[0]?.sourceDocumentId,
    "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  );
});
