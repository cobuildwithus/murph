import { VaultError } from "../errors.js";
import { generateRecordId } from "../ids.js";
import {
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
  resolveMarkdownRegistryUpsertTarget,
  selectExistingRegistryRecord,
  writeMarkdownRegistryRecord,
} from "../registry/markdown.js";

import {
  CONDITIONS_DIRECTORY,
  CONDITION_CLINICAL_STATUSES,
  CONDITION_DOC_TYPE,
  CONDITION_SCHEMA_VERSION,
  CONDITION_SEVERITIES,
  CONDITION_VERIFICATION_STATUSES,
} from "./types.js";
import {
  buildMarkdownBody,
  detailList,
  listSection,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUpsertSelectorSlug,
  optionalDateOnly,
  optionalEnum,
  optionalString,
  resolveOptionalUpsertValue,
  resolveRequiredUpsertValue,
  requireMatchingDocType,
  requireString,
  section,
  stripUndefined,
  normalizeId,
  normalizeStringList,
} from "./shared.js";

import type { FrontmatterObject } from "../types.js";
import type {
  ConditionRecord,
  ReadConditionInput,
  UpsertConditionInput,
  UpsertConditionResult,
} from "./types.js";

function buildBody(record: ConditionRecord): string {
  return buildMarkdownBody(
    record.title,
    detailList([
      ["Clinical status", record.clinicalStatus],
      ["Verification status", record.verificationStatus],
      ["Severity", record.severity],
      ["Asserted on", record.assertedOn],
      ["Resolved on", record.resolvedOn],
    ]),
    [
      listSection("Body Sites", record.bodySites),
      listSection("Related Goals", record.relatedGoalIds),
      listSection("Related Regimens", record.relatedRegimenIds),
      section("Note", record.note ?? "- none"),
    ],
  );
}

function parseConditionRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): ConditionRecord {
  requireMatchingDocType(
    attributes,
    CONDITION_SCHEMA_VERSION,
    CONDITION_DOC_TYPE,
    "VAULT_INVALID_CONDITION",
    "Condition registry document has an unexpected shape.",
  );

  return stripUndefined({
    schemaVersion: CONDITION_SCHEMA_VERSION,
    docType: CONDITION_DOC_TYPE,
    conditionId: requireString(attributes.conditionId, "conditionId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", 160),
    clinicalStatus:
      optionalEnum(attributes.clinicalStatus, CONDITION_CLINICAL_STATUSES, "clinicalStatus") ?? "active",
    verificationStatus: optionalEnum(
      attributes.verificationStatus,
      CONDITION_VERIFICATION_STATUSES,
      "verificationStatus",
    ),
    assertedOn: optionalDateOnly(attributes.assertedOn as string | undefined, "assertedOn"),
    resolvedOn: optionalDateOnly(attributes.resolvedOn as string | undefined, "resolvedOn"),
    severity: optionalEnum(attributes.severity, CONDITION_SEVERITIES, "severity"),
    bodySites: normalizeStringList(attributes.bodySites, "bodySites", "bodySite", 16, 120),
    relatedGoalIds: normalizeRecordIdList(attributes.relatedGoalIds, "relatedGoalIds", "goal"),
    relatedRegimenIds: normalizeRecordIdList(attributes.relatedRegimenIds, "relatedRegimenIds", "reg"),
    note: optionalString(attributes.note, "note", 4000),
    relativePath,
    markdown,
  });
}

function buildAttributes(record: ConditionRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: CONDITION_SCHEMA_VERSION,
    docType: CONDITION_DOC_TYPE,
    conditionId: record.conditionId,
    slug: record.slug,
    title: record.title,
    clinicalStatus: record.clinicalStatus,
    verificationStatus: record.verificationStatus,
    assertedOn: record.assertedOn,
    resolvedOn: record.resolvedOn,
    severity: record.severity,
    bodySites: record.bodySites,
    relatedGoalIds: record.relatedGoalIds,
    relatedRegimenIds: record.relatedRegimenIds,
    note: record.note,
  }) as FrontmatterObject;
}

function validateConditionTimeline(record: ConditionRecord): ConditionRecord {
  if (record.resolvedOn && record.clinicalStatus !== "resolved") {
    throw new VaultError("VAULT_INVALID_INPUT", "resolvedOn requires clinicalStatus=resolved.");
  }

  if (record.assertedOn && record.resolvedOn && record.resolvedOn < record.assertedOn) {
    throw new VaultError("VAULT_INVALID_INPUT", "resolvedOn must be on or after assertedOn.");
  }

  return record;
}

async function loadConditions(vaultRoot: string): Promise<ConditionRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: CONDITIONS_DIRECTORY,
    recordFromParts: parseConditionRecord,
    isExpectedRecord: (record) =>
      record.docType === CONDITION_DOC_TYPE && record.schemaVersion === CONDITION_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_CONDITION",
    invalidMessage: "Condition registry document has an unexpected shape.",
  });

  records.sort((left, right) => left.title.localeCompare(right.title) || left.conditionId.localeCompare(right.conditionId));
  return records;
}

export async function upsertCondition(
  input: UpsertConditionInput,
): Promise<UpsertConditionResult> {
  const normalizedConditionId = normalizeId(input.conditionId, "conditionId", "cond");
  const existingRecords = await loadConditions(input.vaultRoot);
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = selectExistingRegistryRecord({
    records: existingRecords,
    recordId: normalizedConditionId,
    slug: requestedSlug,
    getRecordId: (record) => record.conditionId,
    conflictCode: "VAULT_CONDITION_CONFLICT",
    conflictMessage: "Condition id and slug resolve to different records.",
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: normalizedConditionId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    directory: CONDITIONS_DIRECTORY,
    getRecordId: (record) => record.conditionId,
    createRecordId: () => generateRecordId("cond"),
  });
  const attributes = buildAttributes(
    validateConditionTimeline(
      stripUndefined({
        schemaVersion: CONDITION_SCHEMA_VERSION,
        docType: CONDITION_DOC_TYPE,
        conditionId: target.recordId,
        slug: target.slug,
        title,
        clinicalStatus: resolveRequiredUpsertValue(
          input.clinicalStatus,
          existingRecord?.clinicalStatus,
          "active",
          (value) => optionalEnum(value, CONDITION_CLINICAL_STATUSES, "clinicalStatus") ?? "active",
        ),
        verificationStatus: resolveOptionalUpsertValue(
          input.verificationStatus,
          existingRecord?.verificationStatus,
          (value) => optionalEnum(value, CONDITION_VERIFICATION_STATUSES, "verificationStatus"),
        ),
        assertedOn: resolveOptionalUpsertValue(input.assertedOn, existingRecord?.assertedOn, (value) =>
          optionalDateOnly(value, "assertedOn"),
        ),
        resolvedOn: resolveOptionalUpsertValue(input.resolvedOn, existingRecord?.resolvedOn, (value) =>
          optionalDateOnly(value, "resolvedOn"),
        ),
        severity: resolveOptionalUpsertValue(input.severity, existingRecord?.severity, (value) =>
          optionalEnum(value, CONDITION_SEVERITIES, "severity"),
        ),
        bodySites: resolveOptionalUpsertValue(input.bodySites, existingRecord?.bodySites, (value) =>
          normalizeStringList(value, "bodySites", "bodySite", 16, 120),
        ),
        relatedGoalIds: resolveOptionalUpsertValue(
          input.relatedGoalIds,
          existingRecord?.relatedGoalIds,
          (value) => normalizeRecordIdList(value, "relatedGoalIds", "goal"),
        ),
        relatedRegimenIds: resolveOptionalUpsertValue(
          input.relatedRegimenIds,
          existingRecord?.relatedRegimenIds,
          (value) => normalizeRecordIdList(value, "relatedRegimenIds", "reg"),
        ),
        note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
          optionalString(value, "note", 4000),
        ),
      }) as ConditionRecord,
    ),
  );
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes,
    body: buildBody({
      ...attributes,
      relativePath: target.relativePath,
      markdown: existingRecord?.markdown ?? "",
    } as ConditionRecord),
    recordFromParts: parseConditionRecord,
    operationType: "condition_upsert",
    summary: `Upsert condition ${target.recordId}`,
    audit: {
      action: "condition_upsert",
      commandName: "core.upsertCondition",
      summary: `Upserted condition ${target.recordId}.`,
      targetIds: [target.recordId],
    },
  });

  return {
    created: target.created,
    auditPath,
    record,
  };
}

export async function listConditions(vaultRoot: string): Promise<ConditionRecord[]> {
  return loadConditions(vaultRoot);
}

export async function readCondition({
  vaultRoot,
  conditionId,
  slug,
}: ReadConditionInput): Promise<ConditionRecord> {
  const normalizedConditionId = normalizeId(conditionId, "conditionId", "cond");
  const normalizedSlug = normalizeSelectorSlug(slug);
  const records = await loadConditions(vaultRoot);
  return readRegistryRecord({
    records,
    recordId: normalizedConditionId,
    slug: normalizedSlug,
    getRecordId: (record) => record.conditionId,
    readMissingCode: "VAULT_CONDITION_MISSING",
    readMissingMessage: "Condition was not found.",
  });
}
