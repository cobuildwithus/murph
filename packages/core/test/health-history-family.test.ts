import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import {
  appendJsonlRecord,
  initializeVault,
  readJsonlRecords,
  stringifyFrontmatterDocument,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
  VaultError,
} from "../src/index.ts";
import {
  appendBloodTest,
  appendHistoryEvent,
  listHistoryEvents,
  readHistoryEvent,
} from "../src/history/index.ts";
import { listFamilyMembers, readFamilyMember, upsertFamilyMember } from "../src/family/index.ts";
import { listGeneticVariants, readGeneticVariant, upsertGeneticVariant } from "../src/genetics/index.ts";
import { listWriteOperationMetadataPaths, readStoredWriteOperation } from "../src/operations/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("health history appends to the shared event ledger and supports list/read flows", async () => {
  const vaultRoot = await makeTempDirectory("murph-history");
  await initializeVault({ vaultRoot });

  const encounter = await appendHistoryEvent({
    vaultRoot,
    kind: "encounter",
    occurredAt: "2026-03-01T12:00:00.000Z",
    title: "Endocrinology follow-up",
    encounterType: "specialist_follow_up",
    location: "Endocrinology clinic",
    providerId: "prov_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    tags: ["Endocrine", "Quarterly"],
  });
  const adverseEffect = await appendHistoryEvent({
    vaultRoot,
    kind: "adverse_effect",
    occurredAt: "2026-03-02T12:00:00.000Z",
    title: "Rash after antibiotic",
    substance: "amoxicillin",
    effect: "rash",
    severity: "moderate",
  });

  assert.equal(encounter.relativePath, "ledger/events/2026/2026-03.jsonl");
  assert.equal(adverseEffect.relativePath, "ledger/events/2026/2026-03.jsonl");

  const shardRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: encounter.relativePath,
  });
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: adverseEffect.auditPath,
  });

  assert.equal(shardRecords.length, 2);
  assert.equal(
    auditRecords.filter((record) => (record as { action?: string }).action === "history_add").length,
    2,
  );

  const listed = await listHistoryEvents({
    vaultRoot,
    order: "asc",
  });
  const filtered = await listHistoryEvents({
    vaultRoot,
    kinds: ["adverse_effect"],
  });
  const read = await readHistoryEvent({
    vaultRoot,
    eventId: adverseEffect.record.id,
  });

  assert.equal(listed.length, 2);
  assert.equal(listed[0]?.kind, "encounter");
  assert.deepEqual(listed[0]?.tags, ["endocrine", "quarterly"]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, adverseEffect.record.id);
  assert.equal(read.record.kind, "adverse_effect");
  assert.equal(read.record.effect, "rash");

  const operations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );
  const historyOperations = operations.filter((operation) => operation.operationType === "history_add");

  assert.equal(historyOperations.length, 2);
  assert.ok(historyOperations.every((operation) => operation.status === "committed"));
});

test("health history writes store the vault-local dayKey and timezone when UTC crosses midnight", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-local-day");
  await initializeVault({
    vaultRoot,
    timezone: "Australia/Melbourne",
  });

  const appended = await appendHistoryEvent({
    vaultRoot,
    kind: "encounter",
    occurredAt: "2026-03-26T21:00:00.000Z",
    title: "Breakfast follow-up",
    encounterType: "office_visit",
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });
  const storedRecord = stored.find(
    (record) => (record as { id?: string }).id === appended.record.id,
  ) as { dayKey?: string; timeZone?: string } | undefined;

  assert.equal(appended.record.dayKey, "2026-03-27");
  assert.equal(appended.record.timeZone, "Australia/Melbourne");
  assert.equal(storedRecord?.dayKey, "2026-03-27");
  assert.equal(storedRecord?.timeZone, "Australia/Melbourne");
});

test("history test-event normalization keeps writes canonical and ignores legacy status aliases on read", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-test-aliases");
  await initializeVault({ vaultRoot });

  const writeInput = {
    vaultRoot,
    kind: "test" as const,
    occurredAt: "2026-03-03T12:00:00.000Z",
    title: "CBC results imported from legacy payload",
    testName: "CBC",
    status: "abnormal",
  } as Parameters<typeof appendHistoryEvent>[0] & { status?: string };

  const appended = await appendHistoryEvent(writeInput);
  assert.equal(appended.record.kind, "test");
  assert.equal(appended.record.resultStatus, "unknown");

  const storedWriteRecord = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });
  assert.equal((storedWriteRecord[0] as { resultStatus?: string }).resultStatus, "unknown");
  assert.equal((storedWriteRecord[0] as { status?: string }).status, undefined);

  const legacyRelativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    "2026-03-03T18:00:00.000Z",
    "occurredAt",
  );
  const legacyEventId = "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";

  await appendJsonlRecord({
    vaultRoot,
    relativePath: legacyRelativePath,
    record: {
      schemaVersion: "murph.event.v1",
      id: legacyEventId,
      kind: "test",
      occurredAt: "2026-03-03T18:00:00.000Z",
      recordedAt: "2026-03-03T18:05:00.000Z",
      dayKey: "2026-03-03",
      source: "manual",
      title: "Legacy CBC result",
      testName: "CBC",
      status: "abnormal",
      summary: "Legacy payload used status.",
    },
  });

  const readLegacy = await readHistoryEvent({
    vaultRoot,
    eventId: legacyEventId,
  });
  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["test"],
    order: "asc",
  });

  assert.equal(readLegacy.record.kind, "test");
  assert.equal(readLegacy.record.resultStatus, "unknown");
  assert.equal(readLegacy.record.summary, "Legacy payload used status.");
  assert.deepEqual(
    listed.map((record) => ({
      id: record.id,
      resultStatus: record.kind === "test" ? record.resultStatus : undefined,
    })),
    [
      { id: appended.record.id, resultStatus: "unknown" },
      { id: legacyEventId, resultStatus: "unknown" },
    ],
  );
});

test("history append keeps per-kind defaults and resultSummary alias behavior through stored/read/list flows", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-kind-normalization");
  await initializeVault({ vaultRoot });

  const procedure = await appendHistoryEvent({
    vaultRoot,
    kind: "procedure",
    occurredAt: "2026-03-04T09:00:00.000Z",
    title: "Left knee arthroscopy",
    procedure: "arthroscopy",
  });
  const adverseEffect = await appendHistoryEvent({
    vaultRoot,
    kind: "adverse_effect",
    occurredAt: "2026-03-04T10:00:00.000Z",
    title: "Nausea after ibuprofen",
    substance: "ibuprofen",
    effect: "nausea",
  });
  const exposure = await appendHistoryEvent({
    vaultRoot,
    kind: "exposure",
    occurredAt: "2026-03-04T11:00:00.000Z",
    title: "Mold cleanup",
    substance: "mold",
  });
  const labResult = await appendHistoryEvent({
    vaultRoot,
    kind: "test",
    occurredAt: "2026-03-04T12:00:00.000Z",
    title: "hs-CRP imported from summary-only payload",
    testName: "hs_crp",
    resultSummary: "Borderline elevation noted in source system.",
  });

  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: procedure.relativePath,
  });
  const storedById = new Map(
    stored.map((record) => [(record as { id?: string }).id, record as Record<string, unknown>]),
  );
  const listed = await listHistoryEvents({
    vaultRoot,
    order: "asc",
  });
  const listedById = new Map(listed.map((record) => [record.id, record]));
  const readProcedure = await readHistoryEvent({
    vaultRoot,
    eventId: procedure.record.id,
  });
  const readAdverseEffect = await readHistoryEvent({
    vaultRoot,
    eventId: adverseEffect.record.id,
  });
  const readExposure = await readHistoryEvent({
    vaultRoot,
    eventId: exposure.record.id,
  });
  const readLabResult = await readHistoryEvent({
    vaultRoot,
    eventId: labResult.record.id,
  });

  assert.equal(procedure.record.kind, "procedure");
  assert.equal(procedure.record.status, "completed");
  assert.equal(readProcedure.record.kind, "procedure");
  assert.equal(readProcedure.record.status, "completed");
  assert.equal(listedById.get(procedure.record.id)?.kind, "procedure");
  assert.equal(
    (listedById.get(procedure.record.id) as { status?: string } | undefined)?.status,
    "completed",
  );
  assert.equal(storedById.get(procedure.record.id)?.status, "completed");

  assert.equal(adverseEffect.record.kind, "adverse_effect");
  assert.equal(adverseEffect.record.severity, "moderate");
  assert.equal(readAdverseEffect.record.kind, "adverse_effect");
  assert.equal(readAdverseEffect.record.severity, "moderate");
  assert.equal(listedById.get(adverseEffect.record.id)?.kind, "adverse_effect");
  assert.equal(
    (listedById.get(adverseEffect.record.id) as { severity?: string } | undefined)?.severity,
    "moderate",
  );
  assert.equal(storedById.get(adverseEffect.record.id)?.severity, "moderate");

  assert.equal(exposure.record.kind, "exposure");
  assert.equal(exposure.record.exposureType, "unspecified");
  assert.equal(readExposure.record.kind, "exposure");
  assert.equal(readExposure.record.exposureType, "unspecified");
  assert.equal(listedById.get(exposure.record.id)?.kind, "exposure");
  assert.equal(
    (listedById.get(exposure.record.id) as { exposureType?: string } | undefined)?.exposureType,
    "unspecified",
  );
  assert.equal(storedById.get(exposure.record.id)?.exposureType, "unspecified");

  assert.equal(labResult.record.kind, "test");
  assert.equal(labResult.record.summary, "Borderline elevation noted in source system.");
  assert.equal(labResult.record.resultStatus, "unknown");
  assert.equal(readLabResult.record.kind, "test");
  assert.equal(readLabResult.record.summary, "Borderline elevation noted in source system.");
  assert.equal(readLabResult.record.resultStatus, "unknown");
  assert.equal(listedById.get(labResult.record.id)?.kind, "test");
  assert.equal(
    (listedById.get(labResult.record.id) as { summary?: string } | undefined)?.summary,
    "Borderline elevation noted in source system.",
  );
  assert.equal(storedById.get(labResult.record.id)?.summary, "Borderline elevation noted in source system.");
  assert.equal(storedById.get(labResult.record.id)?.resultSummary, undefined);
});

test("blood-test writes infer result status and persist structured analytes canonically", async () => {
  const vaultRoot = await makeTempDirectory("murph-blood-test");
  await initializeVault({ vaultRoot });

  const appended = await appendBloodTest({
    vaultRoot,
    occurredAt: "2026-03-05T08:30:00.000Z",
    title: "Functional health panel",
    testName: "functional_health_panel",
    labName: "Function Health",
    fastingStatus: "fasting",
    results: [
      {
        analyte: "Apolipoprotein B",
        value: 87,
        unit: "mg/dL",
        flag: "normal",
        referenceRange: {
          text: "<90",
        },
      },
      {
        analyte: "LDL Cholesterol",
        value: 134,
        unit: "mg/dL",
        flag: "high",
        referenceRange: {
          high: 99,
        },
      },
    ],
  });

  assert.equal(appended.record.kind, "test");
  assert.equal(appended.record.testCategory, "blood");
  assert.equal(appended.record.specimenType, "blood");
  assert.equal(appended.record.resultStatus, "mixed");
  assert.equal(appended.record.fastingStatus, "fasting");
  assert.equal(appended.record.labName, "Function Health");
  assert.equal(appended.record.results.length, 2);
  assert.equal(appended.record.results[0]?.analyte, "Apolipoprotein B");

  const listed = await listHistoryEvents({
    vaultRoot,
    kinds: ["test"],
  });
  const read = await readHistoryEvent({
    vaultRoot,
    eventId: appended.record.id,
  });
  const stored = await readJsonlRecords({
    vaultRoot,
    relativePath: appended.relativePath,
  });

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.kind, "test");
  assert.equal(listed[0]?.resultStatus, "mixed");
  assert.equal(listed[0]?.testCategory, "blood");
  assert.equal(read.record.kind, "test");
  assert.equal(read.record.resultStatus, "mixed");
  assert.equal(read.record.labName, "Function Health");
  assert.equal(read.record.results?.length, 2);
  assert.equal((stored[0] as { resultStatus?: string }).resultStatus, "mixed");
  assert.equal((stored[0] as { testCategory?: string }).testCategory, "blood");
  assert.equal((stored[0] as { specimenType?: string }).specimenType, "blood");
});

test("history writes reject provider ids and raw refs that violate the canonical event contract", async () => {
  const vaultRoot = await makeTempDirectory("murph-history-contracts");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      appendHistoryEvent({
        vaultRoot,
        kind: "encounter",
        occurredAt: "2026-03-04T12:00:00.000Z",
        title: "Contract-invalid encounter",
        encounterType: "office_visit",
        providerId: "dr-smith",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_INVALID",
  );

  await assert.rejects(
    () =>
      appendHistoryEvent({
        vaultRoot,
        kind: "adverse_effect",
        occurredAt: "2026-03-04T12:00:00.000Z",
        title: "Contract-invalid raw ref",
        substance: "amoxicillin",
        effect: "rash",
        rawRefs: ["bank/goals/sleep.md"],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_INVALID",
  );
});

test("family members are stored as deterministic markdown registry entries", async () => {
  const vaultRoot = await makeTempDirectory("murph-family");
  await initializeVault({ vaultRoot });

  const created = await upsertFamilyMember({
    vaultRoot,
    title: "Maternal Grandmother",
    relationship: "grandmother",
    conditions: ["Type 2 diabetes", "cardiometabolic risk"],
    note: "Type 2 diabetes diagnosed in her 60s.",
    relatedVariantIds: ["var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
  });
  const updated = await upsertFamilyMember({
    vaultRoot,
    familyMemberId: created.record.familyMemberId,
    slug: "changed-slug-that-should-not-rename",
    note: "Updated summary.",
  });

  const listed = await listFamilyMembers(vaultRoot);
  const read = await readFamilyMember({
    vaultRoot,
    slug: created.record.slug,
  });

  assert.equal(created.created, true);
  assert.equal(updated.created, false);
  assert.equal(updated.record.relativePath, created.record.relativePath);
  assert.equal(updated.record.slug, created.record.slug);
  assert.equal(listed.length, 1);
  assert.equal(read.familyMemberId, created.record.familyMemberId);
  assert.match(read.markdown, /## Related Variants/);
  assert.deepEqual(read.relatedVariantIds, ["var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"]);
  assert.doesNotMatch(read.markdown, /updatedAt:/);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: updated.auditPath,
  });

  assert.equal(
    auditRecords.filter((record) => (record as { action?: string }).action === "family_upsert").length,
    2,
  );

  const familyOperations = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
        readStoredWriteOperation(vaultRoot, relativePath),
      ),
    )
  ).filter((operation) => operation.operationType === "family_upsert");

  assert.equal(familyOperations.length, 2);
  assert.ok(familyOperations.every((operation) => operation.status === "committed"));
});

test("family registry upserts reject conflicting family member ids and slugs", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-conflict");
  await initializeVault({ vaultRoot });

  const first = await upsertFamilyMember({
    vaultRoot,
    title: "Mother",
    relationship: "mother",
  });
  const second = await upsertFamilyMember({
    vaultRoot,
    title: "Father",
    relationship: "father",
  });

  await assert.rejects(
    () =>
      upsertFamilyMember({
        vaultRoot,
        familyMemberId: first.record.familyMemberId,
        slug: second.record.slug,
        note: "This should fail.",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_FAMILY_MEMBER_CONFLICT" &&
      error.message === "familyMemberId and slug resolve to different family members.",
  );
});

test("family registry listing preserves invalid document shape errors after shared loader extraction", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-invalid-shape");
  await initializeVault({ vaultRoot });

  const invalidMarkdown = stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: "murph.family-member-frontmatter.v999",
      docType: "murph.family_member",
      familyMemberId: "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      slug: "invalid-family-member",
      title: "Invalid Family Member",
      relationship: "parent",
    },
    body: "# Invalid Family Member\n",
  });

  await fs.writeFile(path.join(vaultRoot, "bank/family/invalid-family-member.md"), invalidMarkdown, "utf8");

  await assert.rejects(
    () => listFamilyMembers(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_FAMILY_MEMBER" &&
      error.message === "Family registry document has an unexpected shape.",
  );
});

test("genetic variants are stored in markdown registries and can link to family members", async () => {
  const vaultRoot = await makeTempDirectory("murph-genetics");
  await initializeVault({ vaultRoot });

  const familyMember = await upsertFamilyMember({
    vaultRoot,
    title: "Father",
    relationship: "father",
  });
  const created = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
    zygosity: "compound_heterozygous",
    significance: "risk_factor",
    inheritance: "maternal lineage",
    sourceFamilyMemberIds: [familyMember.record.familyMemberId],
    note: "Family history and genotype raise late-life risk.",
  });
  const updated = await upsertGeneticVariant({
    vaultRoot,
    variantId: created.record.variantId,
    slug: "changed-slug-that-should-not-rename",
    gene: "APOE",
    title: "APOE e4 allele updated",
    significance: "risk_factor",
    note: "Maintain aggressive cardiometabolic prevention.",
    sourceFamilyMemberIds: [familyMember.record.familyMemberId],
  });

  const listed = await listGeneticVariants(vaultRoot);
  const read = await readGeneticVariant({
    vaultRoot,
    variantId: created.record.variantId,
  });

  assert.equal(created.created, true);
  assert.equal(updated.created, false);
  assert.equal(updated.record.slug, created.record.slug);
  assert.equal(updated.record.relativePath, created.record.relativePath);
  assert.equal(listed.length, 1);
  assert.equal(read.variantId, created.record.variantId);
  assert.equal(read.gene, "APOE");
  assert.equal(read.title, "APOE e4 allele updated");
  assert.equal(read.zygosity, "compound_heterozygous");
  assert.equal(read.inheritance, "maternal lineage");
  assert.deepEqual(read.sourceFamilyMemberIds, [familyMember.record.familyMemberId]);
  assert.match(read.markdown, /## Source Family Members/);
  assert.doesNotMatch(read.markdown, /updatedAt:/);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: updated.auditPath,
  });

  const geneticsAuditRecords = auditRecords.filter(
    (record) =>
      (record as { action?: string; targetIds?: string[] }).action === "genetics_upsert" &&
      (record as { targetIds?: string[] }).targetIds?.includes(created.record.variantId),
  ) as Array<{
    changes?: Array<{ path?: string; op?: string }>;
  }>;

  assert.equal(geneticsAuditRecords.length, 2);
  assert.deepEqual(
    geneticsAuditRecords.map((record) => record.changes?.[0]),
    [
      { path: created.record.relativePath, op: "create" },
      { path: created.record.relativePath, op: "update" },
    ],
  );

  const geneticOperations = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
        readStoredWriteOperation(vaultRoot, relativePath),
      ),
    )
  ).filter((operation) => operation.operationType === "genetics_upsert");

  assert.equal(geneticOperations.length, 2);
  assert.ok(geneticOperations.every((operation) => operation.status === "committed"));
});

test("genetic registry upserts reject conflicting variant ids and slugs", async () => {
  const vaultRoot = await makeTempDirectory("murph-genetics-conflict");
  await initializeVault({ vaultRoot });

  const first = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
  });
  const second = await upsertGeneticVariant({
    vaultRoot,
    gene: "MTHFR",
    title: "MTHFR C677T",
  });

  await assert.rejects(
    () =>
      upsertGeneticVariant({
        vaultRoot,
        variantId: first.record.variantId,
        slug: second.record.slug,
        gene: "APOE",
        note: "This should fail.",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_GENETIC_VARIANT_CONFLICT" &&
      error.message === "variantId and slug resolve to different variants.",
  );
});

test("genetic registry listing preserves invalid document shape errors after shared loader extraction", async () => {
  const vaultRoot = await makeTempDirectory("murph-genetics-invalid-shape");
  await initializeVault({ vaultRoot });

  const invalidMarkdown = stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: "murph.genetic-variant-frontmatter.v999",
      docType: "murph.genetic_variant",
      variantId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      slug: "invalid-genetic-variant",
      gene: "APOE",
      title: "Invalid Genetic Variant",
    },
    body: "# Invalid Genetic Variant\n",
  });

  await fs.writeFile(path.join(vaultRoot, "bank/genetics/invalid-genetic-variant.md"), invalidMarkdown, "utf8");

  await assert.rejects(
    () => listGeneticVariants(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_GENETIC_VARIANT" &&
      error.message === "Genetics registry document has an unexpected shape.",
  );
});

test("family and genetics registry writes enforce the frozen contract length boundaries", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-boundaries");
  await initializeVault({ vaultRoot });

  const familyAtLimit = await upsertFamilyMember({
    vaultRoot,
    title: "F".repeat(160),
    relationship: "R".repeat(120),
  });

  assert.equal(familyAtLimit.record.title.length, 160);
  assert.equal(familyAtLimit.record.relationship.length, 120);

  await assert.rejects(
    () =>
      upsertFamilyMember({
        vaultRoot,
        title: "F".repeat(161),
        relationship: "parent",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "title exceeds the maximum length.",
  );

  const variantAtLimit = await upsertGeneticVariant({
    vaultRoot,
    slug: "variant-at-limit",
    gene: "G".repeat(40),
    title: "T".repeat(160),
  });

  assert.equal(variantAtLimit.record.gene.length, 40);
  assert.equal(variantAtLimit.record.title.length, 160);

  await assert.rejects(
    () =>
      upsertGeneticVariant({
        vaultRoot,
        slug: "variant-too-long-gene",
        gene: "G".repeat(41),
        title: "Boundary check",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "gene exceeds the maximum length.",
  );
});

test("family and genetics registry creation preserves caller-provided ids and explicit slugs", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-explicit-ids");
  await initializeVault({ vaultRoot });

  const familyMemberId = "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";
  const variantId = "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";

  const familyMember = await upsertFamilyMember({
    vaultRoot,
    familyMemberId,
    slug: "maternal-uncle",
    title: "Maternal Uncle",
    relationship: "uncle",
  });
  const variant = await upsertGeneticVariant({
    vaultRoot,
    variantId,
    slug: "apoe-e3",
    gene: "APOE",
    title: "APOE e3 allele",
  });

  assert.equal(familyMember.record.familyMemberId, familyMemberId);
  assert.equal(familyMember.record.slug, "maternal-uncle");
  assert.equal(familyMember.record.relativePath, "bank/family/maternal-uncle.md");
  assert.equal(variant.record.variantId, variantId);
  assert.equal(variant.record.slug, "apoe-e3");
  assert.equal(variant.record.relativePath, "bank/genetics/apoe-e3.md");
});

test("family and genetics registry id-or-slug resolution preserves conflict and missing errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-family-genetics-resolution");
  await initializeVault({ vaultRoot });

  const mother = await upsertFamilyMember({
    vaultRoot,
    title: "Mother",
    relationship: "mother",
  });
  const father = await upsertFamilyMember({
    vaultRoot,
    title: "Father",
    relationship: "father",
  });

  await assert.rejects(
    () =>
      upsertFamilyMember({
        vaultRoot,
        familyMemberId: mother.record.familyMemberId,
        slug: father.record.slug,
        note: "Should fail because id and slug resolve to different records.",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_FAMILY_MEMBER_CONFLICT" &&
      error.message === "familyMemberId and slug resolve to different family members.",
  );

  await assert.rejects(
    () =>
      readFamilyMember({
        vaultRoot,
        slug: "missing-family-member",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FAMILY_MEMBER_MISSING",
  );

  const readFamilyByConflictingSelectors = await readFamilyMember({
    vaultRoot,
    memberId: mother.record.familyMemberId,
    slug: father.record.slug,
  });

  assert.equal(readFamilyByConflictingSelectors.familyMemberId, mother.record.familyMemberId);

  const apoe = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
  });
  const mthfr = await upsertGeneticVariant({
    vaultRoot,
    gene: "MTHFR",
    title: "MTHFR C677T",
  });

  await assert.rejects(
    () =>
      upsertGeneticVariant({
        vaultRoot,
        variantId: apoe.record.variantId,
        slug: mthfr.record.slug,
        gene: "APOE",
        title: "Conflicting selector",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_GENETIC_VARIANT_CONFLICT" &&
      error.message === "variantId and slug resolve to different variants.",
  );

  await assert.rejects(
    () =>
      readGeneticVariant({
        vaultRoot,
        variantId: "var_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_GENETIC_VARIANT_MISSING",
  );

  const readVariantByConflictingSelectors = await readGeneticVariant({
    vaultRoot,
    variantId: apoe.record.variantId,
    slug: mthfr.record.slug,
  });

  assert.equal(readVariantByConflictingSelectors.variantId, apoe.record.variantId);
});
