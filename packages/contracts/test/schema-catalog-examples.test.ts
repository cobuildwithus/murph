import { describe, expect, it } from "vitest";

import {
  exampleAssessmentResponses,
  exampleAuditRecords,
  exampleEventRecords,
  exampleFrontmatterMarkdown,
  exampleFrontmatterObjects,
  exampleHealthFrontmatterObjects,
  exampleInboxCaptureRecords,
  exampleMetricSampleRecords,
  examplePreferencesDocument,
  exampleSampleRecords,
  exampleVaultMetadata,
} from "../src/examples.ts";
import { automationFrontmatterSchema as automationFrontmatterContract } from "../src/automation.ts";
import { parseFrontmatterDocument } from "../src/frontmatter.ts";
import { memoryDocumentFrontmatterSchema as memoryDocumentFrontmatterContract } from "../src/memory.ts";
import { preferencesDocumentSchema as preferencesDocumentContract } from "../src/preferences.ts";
import { scheduledLogFrontmatterSchema as scheduledLogFrontmatterContract } from "../src/scheduled-log.ts";
import {
  allergyFrontmatterSchema as allergyFrontmatterContract,
  assessmentResponseSchema as assessmentResponseContract,
  auditRecordSchema as auditRecordContract,
  bloodTestReferenceRangeSchema as bloodTestReferenceRangeContract,
  bloodTestResultSchema as bloodTestResultContract,
  conditionFrontmatterSchema as conditionFrontmatterContract,
  coreFrontmatterSchema as coreFrontmatterContract,
  eventRecordSchema as eventRecordContract,
  experimentFrontmatterSchema as experimentFrontmatterContract,
  familyMemberFrontmatterSchema as familyMemberFrontmatterContract,
  foodFrontmatterSchema as foodFrontmatterContract,
  geneticVariantFrontmatterSchema as geneticVariantFrontmatterContract,
  goalFrontmatterSchema as goalFrontmatterContract,
  inboxCaptureRecordSchema as inboxCaptureRecordContract,
  journalDayFrontmatterSchema as journalDayFrontmatterContract,
  metricSampleRecordSchema as metricSampleRecordContract,
  protocolFrontmatterSchema as protocolFrontmatterContract,
  providerFrontmatterSchema as providerFrontmatterContract,
  recipeFrontmatterSchema as recipeFrontmatterContract,
  regimenFrontmatterSchema as regimenFrontmatterContract,
  rawAssetOwnerSchema as rawAssetOwnerContract,
  rawImportManifestArtifactSchema as rawImportManifestArtifactContract,
  rawImportManifestSchema as rawImportManifestContract,
  sampleRecordSchema as sampleRecordContract,
  vaultMetadataSchema as vaultMetadataContract,
  workoutFormatFrontmatterSchema as workoutFormatFrontmatterContract,
} from "../src/zod.ts";
import type { ContractSchema } from "../src/validate.ts";
import { safeParseContract } from "../src/validate.ts";
import {
  allergyFrontmatterSchema,
  automationFrontmatterSchema,
  assessmentResponseSchema,
  auditRecordSchema,
  conditionFrontmatterSchema,
  coreFrontmatterSchema,
  eventRecordSchema,
  experimentFrontmatterSchema,
  familyMemberFrontmatterSchema,
  foodFrontmatterSchema,
  geneticVariantFrontmatterSchema,
  goalFrontmatterSchema,
  inboxCaptureRecordSchema,
  journalDayFrontmatterSchema,
  memoryDocumentFrontmatterSchema,
  metricSampleRecordSchema,
  preferencesDocumentSchema,
  protocolFrontmatterSchema,
  providerFrontmatterSchema,
  recipeFrontmatterSchema,
  regimenFrontmatterSchema,
  sampleRecordSchema,
  scheduledLogFrontmatterSchema,
  schemaCatalog,
  vaultMetadataSchema,
  workoutFormatFrontmatterSchema,
} from "../src/schemas.ts";
import { VAULT_FAMILY_DESCRIPTORS } from "../src/vault-families.ts";

const schemaFixtures = [
  ["assessment-response", assessmentResponseSchema, assessmentResponseContract],
  ["audit-record", auditRecordSchema, auditRecordContract],
  ["event-record", eventRecordSchema, eventRecordContract],
  ["inbox-capture-record", inboxCaptureRecordSchema, inboxCaptureRecordContract],
  ["metric-sample-record", metricSampleRecordSchema, metricSampleRecordContract],
  ["frontmatter-allergy", allergyFrontmatterSchema, allergyFrontmatterContract],
  ["frontmatter-automation", automationFrontmatterSchema, automationFrontmatterContract],
  ["frontmatter-condition", conditionFrontmatterSchema, conditionFrontmatterContract],
  ["frontmatter-core", coreFrontmatterSchema, coreFrontmatterContract],
  ["frontmatter-experiment", experimentFrontmatterSchema, experimentFrontmatterContract],
  ["frontmatter-family-member", familyMemberFrontmatterSchema, familyMemberFrontmatterContract],
  ["frontmatter-food", foodFrontmatterSchema, foodFrontmatterContract],
  ["frontmatter-genetic-variant", geneticVariantFrontmatterSchema, geneticVariantFrontmatterContract],
  ["frontmatter-goal", goalFrontmatterSchema, goalFrontmatterContract],
  ["frontmatter-journal-day", journalDayFrontmatterSchema, journalDayFrontmatterContract],
  ["frontmatter-memory", memoryDocumentFrontmatterSchema, memoryDocumentFrontmatterContract],
  ["frontmatter-provider", providerFrontmatterSchema, providerFrontmatterContract],
  ["frontmatter-protocol", protocolFrontmatterSchema, protocolFrontmatterContract],
  ["frontmatter-regimen", regimenFrontmatterSchema, regimenFrontmatterContract],
  ["frontmatter-recipe", recipeFrontmatterSchema, recipeFrontmatterContract],
  ["frontmatter-scheduled-log", scheduledLogFrontmatterSchema, scheduledLogFrontmatterContract],
  ["frontmatter-workout-format", workoutFormatFrontmatterSchema, workoutFormatFrontmatterContract],
  ["preferences-document", preferencesDocumentSchema, preferencesDocumentContract],
  ["sample-record", sampleRecordSchema, sampleRecordContract],
  ["vault-metadata", vaultMetadataSchema, vaultMetadataContract],
] as const;

const contractExamples = [
  ["vault metadata", vaultMetadataContract, [exampleVaultMetadata]],
  ["inbox capture records", inboxCaptureRecordContract, exampleInboxCaptureRecords],
  ["event records", eventRecordContract, exampleEventRecords],
  ["sample records", sampleRecordContract, exampleSampleRecords],
  ["metric sample records", metricSampleRecordContract, exampleMetricSampleRecords],
  ["audit records", auditRecordContract, exampleAuditRecords],
  ["assessment responses", assessmentResponseContract, exampleAssessmentResponses],
  ["preferences document", preferencesDocumentContract, [examplePreferencesDocument]],
] as const;

const frontmatterObjectExamples = [
  ["automation", automationFrontmatterContract, exampleFrontmatterObjects.automation],
  ["core", coreFrontmatterContract, exampleFrontmatterObjects.core],
  ["experiment", experimentFrontmatterContract, exampleFrontmatterObjects.experiment],
  ["food", foodFrontmatterContract, exampleFrontmatterObjects.food],
  ["journal day", journalDayFrontmatterContract, exampleFrontmatterObjects.journalDay],
  ["memory", memoryDocumentFrontmatterContract, exampleFrontmatterObjects.memory],
  ["provider", providerFrontmatterContract, exampleFrontmatterObjects.provider],
  ["recipe", recipeFrontmatterContract, exampleFrontmatterObjects.recipe],
  ["scheduled log", scheduledLogFrontmatterContract, exampleFrontmatterObjects.scheduledLog],
  ["workout format", workoutFormatFrontmatterContract, exampleFrontmatterObjects.workoutFormat],
  ["goal", goalFrontmatterContract, exampleHealthFrontmatterObjects.goal],
  ["condition", conditionFrontmatterContract, exampleHealthFrontmatterObjects.condition],
  ["allergy", allergyFrontmatterContract, exampleHealthFrontmatterObjects.allergy],
  ["protocol", protocolFrontmatterContract, exampleHealthFrontmatterObjects.protocol],
  ["regimen", regimenFrontmatterContract, exampleHealthFrontmatterObjects.regimen],
  ["family member", familyMemberFrontmatterContract, exampleHealthFrontmatterObjects.familyMember],
  ["genetic variant", geneticVariantFrontmatterContract, exampleHealthFrontmatterObjects.geneticVariant],
] as const;

const frontmatterMarkdownExamples = [
  [
    "automation",
    automationFrontmatterContract,
    exampleFrontmatterMarkdown.automation,
    exampleFrontmatterObjects.automation,
  ],
  ["core", coreFrontmatterContract, exampleFrontmatterMarkdown.core, exampleFrontmatterObjects.core],
  [
    "journal day",
    journalDayFrontmatterContract,
    exampleFrontmatterMarkdown.journalDay,
    exampleFrontmatterObjects.journalDay,
  ],
  [
    "memory",
    memoryDocumentFrontmatterContract,
    exampleFrontmatterMarkdown.memory,
    exampleFrontmatterObjects.memory,
  ],
  [
    "experiment",
    experimentFrontmatterContract,
    exampleFrontmatterMarkdown.experiment,
    exampleFrontmatterObjects.experiment,
  ],
  ["food", foodFrontmatterContract, exampleFrontmatterMarkdown.food, exampleFrontmatterObjects.food],
  [
    "provider",
    providerFrontmatterContract,
    exampleFrontmatterMarkdown.provider,
    exampleFrontmatterObjects.provider,
  ],
  [
    "recipe",
    recipeFrontmatterContract,
    exampleFrontmatterMarkdown.recipe,
    exampleFrontmatterObjects.recipe,
  ],
  [
    "scheduled log",
    scheduledLogFrontmatterContract,
    exampleFrontmatterMarkdown.scheduledLog,
    exampleFrontmatterObjects.scheduledLog,
  ],
  [
    "workout format",
    workoutFormatFrontmatterContract,
    exampleFrontmatterMarkdown.workoutFormat,
    exampleFrontmatterObjects.workoutFormat,
  ],
] as const;

function expectValidExample(contract: ContractSchema, example: unknown): void {
  expect(safeParseContract(contract, example)).toEqual({
    success: true,
    data: example,
  });
}

describe("schema catalog and example seam", () => {
  it("keeps the JSON schema catalog aligned with the named schema exports", () => {
    expect(Object.isFrozen(schemaCatalog)).toBe(true);
    expect(Object.keys(schemaCatalog).sort()).toEqual(
      schemaFixtures.map(([catalogKey]) => catalogKey).sort(),
    );
    expect(experimentFrontmatterSchema).toMatchObject({
      dependentRequired: {
        protocolRef: ["commonsProtocolRef", "effectiveProtocolSnapshot"],
      },
    });

    for (const [catalogKey, schemaExport, contract] of schemaFixtures) {
      expect(schemaCatalog[catalogKey]).toBe(schemaExport);
      expect(schemaExport).toMatchObject({
        $id: contract.meta()?.$id,
        title: contract.meta()?.title,
      });
      expect(
        "type" in schemaExport || "anyOf" in schemaExport || "oneOf" in schemaExport,
      ).toBe(true);
    }
  });

  it("keeps automation route delivery source optional for legacy frontmatter", () => {
    const routeSchema = (
      automationFrontmatterSchema as {
        properties?: Record<string, { required?: string[] }>;
      }
    ).properties?.route;

    expect(routeSchema?.required).toEqual(expect.arrayContaining([
      "channel",
      "deliveryTarget",
      "identityId",
      "participantId",
      "threadId",
    ]));
    expect(routeSchema?.required).toEqual(
      expect.not.arrayContaining(["deliverySource"]),
    );
  });

  it("keeps every validated vault family on the schema-artifact seam", () => {
    const catalogSchemaIds = new Set(
      Object.values(schemaCatalog)
        .map((schema) => schema.$id)
        .filter((value): value is string => typeof value === "string"),
    );

    for (const family of VAULT_FAMILY_DESCRIPTORS) {
      if (!("validation" in family) || !family.validation) {
        continue;
      }

      const metadata = family.validation.schema.meta();
      if (!metadata) {
        throw new Error(`Validated vault family "${family.id}" is missing schema metadata.`);
      }

      expect(typeof metadata.$id).toBe("string");
      expect(typeof metadata.title).toBe("string");
      expect(catalogSchemaIds.has(metadata.$id as string)).toBe(true);
    }
  });

  it("validates exported contract examples against the canonical contracts", () => {
    for (const [, contract, examples] of contractExamples) {
      for (const example of examples) {
        expectValidExample(contract, example);
      }
    }
  });

  it("accepts inbox capture ids as audit metadata targets", () => {
    const capture = exampleInboxCaptureRecords[0];

    expectValidExample(auditRecordContract, {
      ...exampleAuditRecords[0],
      action: "inbox_capture_persist",
      commandName: "inboxd.persistCanonicalInboxCapture",
      summary: "Persisted inbox capture.",
      targetIds: [capture.captureId, capture.eventId],
    });

    const emptyTargetResult = safeParseContract(auditRecordContract, {
      ...exampleAuditRecords[0],
      targetIds: [""],
    });
    expect(emptyTargetResult.success).toBe(false);

    const overlongTargetResult = safeParseContract(auditRecordContract, {
      ...exampleAuditRecords[0],
      targetIds: ["x".repeat(256)],
    });
    expect(overlongTargetResult.success).toBe(false);
  });

  it("validates exported frontmatter object fixtures against the canonical contracts", () => {
    for (const [, contract, example] of frontmatterObjectExamples) {
      expectValidExample(contract, example);
    }
  });

  it("rejects unknown fields in protocol and experiment protocol snapshot frontmatter", () => {
    const protocolResult = safeParseContract(protocolFrontmatterContract, {
      ...exampleHealthFrontmatterObjects.protocol,
      unexpected: true,
    });
    expect(protocolResult.success).toBe(false);
    if (!protocolResult.success) {
      expect(protocolResult.errors.join("\n")).toContain("unexpected");
    }

    const protocolRef = exampleFrontmatterObjects.experiment.protocolRef;
    if (!protocolRef) {
      throw new Error("Expected experiment example to include protocolRef.");
    }
    const protocolRefResult = safeParseContract(experimentFrontmatterContract, {
      ...exampleFrontmatterObjects.experiment,
      protocolRef: {
        ...protocolRef,
        unexpected: true,
      },
    });
    expect(protocolRefResult.success).toBe(false);
    if (!protocolRefResult.success) {
      expect(protocolRefResult.errors.join("\n")).toContain("protocolRef");
      expect(protocolRefResult.errors.join("\n")).toContain("unexpected");
    }

    const effectiveProtocolSnapshot = exampleFrontmatterObjects.experiment.effectiveProtocolSnapshot;
    if (!effectiveProtocolSnapshot) {
      throw new Error("Expected experiment example to include effectiveProtocolSnapshot.");
    }
    const effectiveSnapshotResult = safeParseContract(experimentFrontmatterContract, {
      ...exampleFrontmatterObjects.experiment,
      effectiveProtocolSnapshot: {
        ...effectiveProtocolSnapshot,
        unexpected: true,
      },
    });
    expect(effectiveSnapshotResult.success).toBe(false);
    if (!effectiveSnapshotResult.success) {
      expect(effectiveSnapshotResult.errors.join("\n")).toContain("effectiveProtocolSnapshot");
      expect(effectiveSnapshotResult.errors.join("\n")).toContain("unexpected");
    }
  });

  it("requires commonsProtocolRef and an effective snapshot for protocol-backed experiments", () => {
    const { commonsProtocolRef: _commonsProtocolRef, ...missingCommonsProtocolRef } =
      exampleFrontmatterObjects.experiment;
    const missingCommonsProtocolRefResult = safeParseContract(
      experimentFrontmatterContract,
      missingCommonsProtocolRef,
    );
    expect(missingCommonsProtocolRefResult.success).toBe(false);
    if (!missingCommonsProtocolRefResult.success) {
      expect(missingCommonsProtocolRefResult.errors.join("\n")).toContain("commonsProtocolRef");
    }

    const { effectiveProtocolSnapshot: _effectiveProtocolSnapshot, ...missingSnapshot } =
      exampleFrontmatterObjects.experiment;
    const missingSnapshotResult = safeParseContract(experimentFrontmatterContract, missingSnapshot);
    expect(missingSnapshotResult.success).toBe(false);
    if (!missingSnapshotResult.success) {
      expect(missingSnapshotResult.errors.join("\n")).toContain("effectiveProtocolSnapshot");
    }

    const effectiveProtocolSnapshot = exampleFrontmatterObjects.experiment.effectiveProtocolSnapshot;
    if (!effectiveProtocolSnapshot) {
      throw new Error("Expected experiment example to include effectiveProtocolSnapshot.");
    }
    const mismatchedHashResult = safeParseContract(experimentFrontmatterContract, {
      ...exampleFrontmatterObjects.experiment,
      effectiveProtocolSnapshot: {
        ...effectiveProtocolSnapshot,
        effectiveSpecHash: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      },
    });
    expect(mismatchedHashResult.success).toBe(false);
    if (!mismatchedHashResult.success) {
      expect(mismatchedHashResult.errors.join("\n")).toContain("effectiveSpecHash");
    }
  });

  it("requires parent protocol refs for protocol lineage", () => {
    const protocolWithoutParentResult = safeParseContract(protocolFrontmatterContract, {
      ...exampleHealthFrontmatterObjects.protocol,
      lineage: {
        sourceKind: "protocol",
      },
    });
    expect(protocolWithoutParentResult.success).toBe(false);
    if (!protocolWithoutParentResult.success) {
      expect(protocolWithoutParentResult.errors.join("\n")).toContain("parentProtocolRef");
    }

    const protocolWithParentResult = safeParseContract(protocolFrontmatterContract, {
      ...exampleHealthFrontmatterObjects.protocol,
      lineage: {
        sourceKind: "protocol",
        parentProtocolRef: {
          protocolId: "prot_01K72NVW6Z4QK8VYAVX7GT7S4B",
          protocolRevisionId: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
          effectiveSpecHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
        },
      },
    });
    expect(protocolWithParentResult.success).toBe(true);
  });

  it("parses markdown frontmatter fixtures into the canonical contract shape", () => {
    for (const [, contract, markdown, expectedAttributes] of frontmatterMarkdownExamples) {
      const parsed = parseFrontmatterDocument(markdown);
      expect(parsed.rawFrontmatter).not.toBeNull();
      expect(parsed.body.startsWith("\n# ")).toBe(true);
      expect(parsed.attributes).toEqual(expectedAttributes);
      expectValidExample(contract, parsed.attributes);
    }
  });

  it("covers raw-import manifest and owner refinement branches", () => {
    const asset = {
      role: "source_document",
      relativePath: "raw/documents/2026/04/source.json",
      originalFileName: "source.json",
      mediaType: "application/json",
      byteSize: 12,
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const owner = {
      kind: "device_batch",
      id: "xfm_0123456789ABCDEFGHJKMNPQRS",
      partition: "2026-04",
    };

    expect(safeParseContract(rawImportManifestArtifactContract, asset)).toEqual({
      success: true,
      data: asset,
    });
    expect(safeParseContract(rawAssetOwnerContract, owner)).toEqual({
      success: true,
      data: owner,
    });
    expect(safeParseContract(rawAssetOwnerContract, {
      kind: "device_batch",
      id: "xfm_0123456789ABCDEFGHJKMNPQRS",
    })).toEqual({
      success: false,
      errors: [
        '$.partition: Raw asset owner kind "device_batch" requires partition.',
      ],
    });
    expect(safeParseContract(rawAssetOwnerContract, {
      kind: "document",
      id: "doc_0123456789ABCDEFGHJKMNPQRS",
      partition: "unexpected",
    })).toEqual({
      success: false,
      errors: [
        '$.partition: Raw asset owner kind "document" must not include partition.',
      ],
    });
    expect(safeParseContract(rawAssetOwnerContract, {
      kind: "workout_batch",
      id: "xfm_0123456789ABCDEFGHJKMNPQRS",
      partition: "2026-04",
    })).toEqual({
      success: true,
      data: {
        kind: "workout_batch",
        id: "xfm_0123456789ABCDEFGHJKMNPQRS",
        partition: "2026-04",
      },
    });
    expect(safeParseContract(rawAssetOwnerContract, {
      kind: "document",
      id: "bad",
    })).toEqual({
      success: false,
      errors: [
        expect.stringContaining("$.id: Raw asset owner id must match"),
      ],
    });
    expect(safeParseContract(rawImportManifestContract, {
      schemaVersion: "murph.raw-import-manifest.v1",
      importId: "xfm_0123456789ABCDEFGHJKMNPQRS",
      importKind: "device_batch",
      importedAt: "2026-04-08T10:11:12.000Z",
      source: null,
      owner,
      rawDirectory: "raw/device-batches/2026/04",
      artifacts: [asset],
      provenance: {},
    })).toEqual({
      success: true,
      data: {
        schemaVersion: "murph.raw-import-manifest.v1",
        importId: "xfm_0123456789ABCDEFGHJKMNPQRS",
        importKind: "device_batch",
        importedAt: "2026-04-08T10:11:12.000Z",
        source: null,
        owner,
        rawDirectory: "raw/device-batches/2026/04",
        artifacts: [asset],
        provenance: {},
      },
    });
    expect(safeParseContract(rawImportManifestContract, {
      schemaVersion: "murph.raw-import-manifest.v1",
      importId: "bad",
      importKind: "document",
      importedAt: "2026-04-08T10:11:12.000Z",
      source: null,
      owner: {
        kind: "document",
        id: "doc_0123456789ABCDEFGHJKMNPQRS",
        partition: "unexpected",
      },
      rawDirectory: "raw/documents/2026/04",
      artifacts: [asset],
      provenance: {},
    })).toEqual({
      success: false,
      errors: expect.arrayContaining([
        expect.stringContaining("$.importId"),
      ]),
    });
    expect(safeParseContract(rawImportManifestContract, {
      schemaVersion: "murph.raw-import-manifest.v1",
      importId: "xfm_0123456789ABCDEFGHJKMNPQRS",
      importKind: "workout_batch",
      importedAt: "2026-04-08T10:11:12.000Z",
      source: null,
      owner: {
        kind: "workout_batch",
        id: "xfm_0123456789ABCDEFGHJKMNPQRS",
        partition: "2026-04",
      },
      rawDirectory: "raw/workouts/2026/04",
      artifacts: [asset],
      provenance: {},
    })).toEqual({
      success: true,
      data: {
        schemaVersion: "murph.raw-import-manifest.v1",
        importId: "xfm_0123456789ABCDEFGHJKMNPQRS",
        importKind: "workout_batch",
        importedAt: "2026-04-08T10:11:12.000Z",
        source: null,
        owner: {
          kind: "workout_batch",
          id: "xfm_0123456789ABCDEFGHJKMNPQRS",
          partition: "2026-04",
        },
        rawDirectory: "raw/workouts/2026/04",
        artifacts: [asset],
        provenance: {},
      },
    });
    expect(safeParseContract(bloodTestReferenceRangeContract, {
      low: 1.2,
    })).toEqual({
      success: true,
      data: {
        low: 1.2,
      },
    });
    expect(safeParseContract(bloodTestReferenceRangeContract, {})).toEqual({
      success: false,
      errors: [
        "$: Blood-test reference ranges must include at least one boundary or a text range.",
      ],
    });
    expect(safeParseContract(bloodTestResultContract, {
      analyte: "Glucose",
      value: 5.1,
      unit: "mmol/L",
    })).toEqual({
      success: true,
      data: {
        analyte: "Glucose",
        value: 5.1,
        unit: "mmol/L",
      },
    });
    expect(safeParseContract(bloodTestResultContract, {
      analyte: "Glucose",
    })).toEqual({
      success: false,
      errors: [
        '$.value: Blood-test results require either a numeric value or a textValue.',
      ],
    });
  });
});
