import { VaultError } from "../errors.js";
import { stringifyFrontmatterDocument } from "../frontmatter.js";
import { generateRecordId } from "../ids.js";
import { upsertMarkdownRegistryDocument } from "../registry/markdown.js";

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
  findRecordByIdOrSlug,
  listSection,
  loadMarkdownRegistry,
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
  selectRecordByIdOrSlug,
  stripUndefined,
  normalizeId,
  normalizeSlug,
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
  return loadMarkdownRegistry(
    vaultRoot,
    CONDITIONS_DIRECTORY,
    parseConditionRecord,
    (left, right) => left.title.localeCompare(right.title) || left.conditionId.localeCompare(right.conditionId),
  );
}

export async function upsertCondition(
  input: UpsertConditionInput,
): Promise<UpsertConditionResult> {
  const normalizedConditionId = normalizeId(input.conditionId, "conditionId", "cond");
  const existingRecords = await loadConditions(input.vaultRoot);
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = selectRecordByIdOrSlug(
    existingRecords,
    normalizedConditionId,
    requestedSlug,
    (record) => record.conditionId,
    "Condition",
    "VAULT_CONDITION_CONFLICT",
  );
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const slug = existingRecord?.slug ?? requestedSlug ?? normalizeSlug(undefined, "slug", title);
  const conditionId = existingRecord?.conditionId ?? normalizedConditionId ?? generateRecordId("cond");
  const record = validateConditionTimeline(
    stripUndefined({
      schemaVersion: CONDITION_SCHEMA_VERSION,
      docType: CONDITION_DOC_TYPE,
      conditionId,
      slug: existingRecord?.slug ?? slug,
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
      relativePath: existingRecord?.relativePath ?? `${CONDITIONS_DIRECTORY}/${slug}.md`,
    }) as ConditionRecord,
  );
  const markdown = stringifyFrontmatterDocument({
    attributes: buildAttributes(record),
    body: buildBody(record),
  });
  const auditPath = await upsertMarkdownRegistryDocument({
    vaultRoot: input.vaultRoot,
    operationType: "condition_upsert",
    summary: `Upsert condition ${record.conditionId}`,
    relativePath: record.relativePath,
    markdown,
    created: !existingRecord,
    audit: {
      action: "condition_upsert",
      commandName: "core.upsertCondition",
      summary: `Upserted condition ${record.conditionId}.`,
      targetIds: [record.conditionId],
    },
  });

  return {
    created: !existingRecord,
    auditPath,
    record: {
      ...record,
      markdown,
    },
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
  const match = findRecordByIdOrSlug(records, normalizedConditionId, normalizedSlug, (record) => record.conditionId);

  if (!match) {
    throw new VaultError("VAULT_CONDITION_MISSING", "Condition was not found.");
  }

  return match;
}
