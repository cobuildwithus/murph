import {
  conditionRegistryEntityDefinition,
  extractHealthEntityRegistryLinks,
  type ConditionFrontmatter,
} from "@murph/contracts";

import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  CONDITIONS_DIRECTORY,
  CONDITION_CLINICAL_STATUSES,
  CONDITION_DOC_TYPE,
  CONDITION_SCHEMA_VERSION,
  CONDITION_SEVERITIES,
  CONDITION_VERIFICATION_STATUSES,
} from "./types.ts";
import {
  buildDocumentFromAttributes,
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
  validateSortedStringList,
} from "./shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  ConditionEntity,
  ConditionLink,
  ConditionLinkType,
  ConditionRecord,
  ReadConditionInput,
  UpsertConditionInput,
  UpsertConditionResult,
} from "./types.ts";

function buildBody(record: ConditionRecord): string {
  const relations = canonicalizeConditionRelations(record);

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
      listSection("Related Goals", relations.relatedGoalIds),
      listSection("Related Protocols", relations.relatedProtocolIds),
      section("Note", record.note ?? "- none"),
    ],
  );
}

function parseConditionFrontmatter(
  attributes: FrontmatterObject,
): ConditionFrontmatter {
  const schema = conditionRegistryEntityDefinition.registry.frontmatterSchema;

  if (!schema) {
    throw new Error("Condition registry definition is missing a frontmatter schema.");
  }

  const result = schema.safeParse(attributes);

  if (!result.success) {
    throw new VaultError("VAULT_INVALID_CONDITION", "Condition registry document has an unexpected shape.");
  }

  return result.data as ConditionFrontmatter;
}

function normalizeConditionLinkType(value: string): ConditionLinkType | null {
  switch (value) {
    case "related_goal":
    case "related_protocol":
      return value;
    default:
      return null;
  }
}

function compareConditionLinks(left: ConditionLink, right: ConditionLink): number {
  const order: Record<ConditionLinkType, number> = {
    related_goal: 0,
    related_protocol: 1,
  };

  return order[left.type] - order[right.type] || left.targetId.localeCompare(right.targetId);
}

function buildConditionLinksFromFields(input: {
  relatedGoalIds?: string[];
  relatedProtocolIds?: string[];
}): ConditionLink[] {
  return [
    ...(input.relatedGoalIds ?? []).map((targetId) => ({ type: "related_goal", targetId }) satisfies ConditionLink),
    ...(input.relatedProtocolIds ?? []).map((targetId) => ({
      type: "related_protocol",
      targetId,
    }) satisfies ConditionLink),
  ];
}

function normalizeConditionLinks(rawLinks: readonly ConditionLink[]): ConditionLink[] {
  const sortedLinks = [...rawLinks].sort(compareConditionLinks);
  const links: ConditionLink[] = [];
  const seen = new Set<string>();

  for (const link of sortedLinks) {
    const dedupeKey = `${link.type}:${link.targetId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    links.push(link);
  }

  return links;
}

function parseConditionLinks(attributes: FrontmatterObject): ConditionLink[] {
  return normalizeConditionLinks(
    extractHealthEntityRegistryLinks("condition", attributes).flatMap((link) => {
      const type = normalizeConditionLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies ConditionLink] : [];
    }),
  );
}

function conditionRelationsFromLinks(
  links: readonly ConditionLink[],
): Pick<ConditionEntity, "relatedGoalIds" | "relatedProtocolIds" | "links"> {
  const relatedGoalIds = links
    .filter((link) => link.type === "related_goal")
    .map((link) => link.targetId);
  const relatedProtocolIds = links
    .filter((link) => link.type === "related_protocol")
    .map((link) => link.targetId);

  return {
    relatedGoalIds: relatedGoalIds.length > 0 ? relatedGoalIds : undefined,
    relatedProtocolIds: relatedProtocolIds.length > 0 ? relatedProtocolIds : undefined,
    links: [...links],
  };
}

function canonicalizeConditionRelations(input: {
  links?: readonly ConditionLink[];
  relatedGoalIds?: string[];
  relatedProtocolIds?: string[];
}): Pick<ConditionEntity, "relatedGoalIds" | "relatedProtocolIds" | "links"> {
  const links = normalizeConditionLinks(
    (input.links?.length ?? 0) > 0
      ? [...(input.links ?? [])]
      : buildConditionLinksFromFields({
          relatedGoalIds: input.relatedGoalIds,
          relatedProtocolIds: input.relatedProtocolIds,
        }),
  );

  return conditionRelationsFromLinks(links);
}

function parseConditionRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): ConditionRecord {
  const parsed = parseConditionFrontmatter(attributes);
  requireMatchingDocType(
    parsed as unknown as FrontmatterObject,
    CONDITION_SCHEMA_VERSION,
    CONDITION_DOC_TYPE,
    "VAULT_INVALID_CONDITION",
    "Condition registry document has an unexpected shape.",
  );
  const relations = canonicalizeConditionRelations({
    links: parseConditionLinks(attributes),
  });

  return stripUndefined({
    schemaVersion: CONDITION_SCHEMA_VERSION,
    docType: CONDITION_DOC_TYPE,
    conditionId: requireString(parsed.conditionId, "conditionId", 64),
    slug: requireString(parsed.slug, "slug", 160),
    title: requireString(parsed.title, "title", 160),
    clinicalStatus:
      optionalEnum(parsed.clinicalStatus, CONDITION_CLINICAL_STATUSES, "clinicalStatus") ?? "active",
    verificationStatus: optionalEnum(parsed.verificationStatus, CONDITION_VERIFICATION_STATUSES, "verificationStatus"),
    assertedOn: optionalDateOnly(parsed.assertedOn, "assertedOn"),
    resolvedOn: optionalDateOnly(parsed.resolvedOn, "resolvedOn"),
    severity: optionalEnum(parsed.severity, CONDITION_SEVERITIES, "severity"),
    bodySites: validateSortedStringList(parsed.bodySites, "bodySites", "bodySite", 16, 120),
    relatedGoalIds: relations.relatedGoalIds,
    relatedProtocolIds: relations.relatedProtocolIds,
    note: optionalString(parsed.note, "note", 4000),
    links: relations.links,
    relativePath,
    markdown,
  });
}

function buildAttributes(record: ConditionEntity | ConditionRecord): FrontmatterObject {
  const relations = canonicalizeConditionRelations(record);

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
    relatedGoalIds: relations.relatedGoalIds,
    relatedProtocolIds: relations.relatedProtocolIds,
    note: record.note,
  }) as FrontmatterObject;
}

function validateConditionTimeline(record: ConditionEntity): ConditionEntity {
  if (record.resolvedOn && record.clinicalStatus !== "resolved") {
    throw new VaultError("VAULT_INVALID_INPUT", "resolvedOn requires clinicalStatus=resolved.");
  }

  if (record.assertedOn && record.resolvedOn && record.resolvedOn < record.assertedOn) {
    throw new VaultError("VAULT_INVALID_INPUT", "resolvedOn must be on or after assertedOn.");
  }

  return record;
}

const conditionRegistryApi = createMarkdownRegistryApi<ConditionRecord>({
  directory: CONDITIONS_DIRECTORY,
  recordFromParts: parseConditionRecord,
  isExpectedRecord: (record) =>
    record.docType === CONDITION_DOC_TYPE && record.schemaVersion === CONDITION_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_CONDITION",
  invalidMessage: "Condition registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) =>
        left.title.localeCompare(right.title) || left.conditionId.localeCompare(right.conditionId),
    ),
  getRecordId: (record) => record.conditionId,
  conflictCode: "VAULT_CONDITION_CONFLICT",
  conflictMessage: "Condition id and slug resolve to different records.",
  readMissingCode: "VAULT_CONDITION_MISSING",
  readMissingMessage: "Condition was not found.",
  createRecordId: () => generateRecordId("cond"),
  operationType: "condition_upsert",
  summary: (recordId) => `Upsert condition ${recordId}`,
  audit: {
    action: "condition_upsert",
    commandName: "core.upsertCondition",
    summary: (_created, recordId) => `Upserted condition ${recordId}.`,
  },
});

export async function upsertCondition(
  input: UpsertConditionInput,
): Promise<UpsertConditionResult> {
  const normalizedConditionId = normalizeId(input.conditionId, "conditionId", "cond");
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = await conditionRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedConditionId,
    slug: requestedSlug,
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  return conditionRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedConditionId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    buildDocument: (target) => {
      const relatedGoalIds = resolveOptionalUpsertValue(
        input.relatedGoalIds,
        existingRecord?.relatedGoalIds,
        (value) => normalizeRecordIdList(value, "relatedGoalIds", "goal"),
      );
      const relatedProtocolIds = resolveOptionalUpsertValue(
        input.relatedProtocolIds,
        existingRecord?.relatedProtocolIds,
        (value) => normalizeRecordIdList(value, "relatedProtocolIds", "prot"),
      );
      const relations = canonicalizeConditionRelations({
        relatedGoalIds,
        relatedProtocolIds,
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
              validateSortedStringList(value, "bodySites", "bodySite", 16, 120),
            ),
            relatedGoalIds: relations.relatedGoalIds,
            relatedProtocolIds: relations.relatedProtocolIds,
            note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
              optionalString(value, "note", 4000),
            ),
            links: relations.links,
          }) as ConditionEntity,
        ),
      );

      return buildDocumentFromAttributes<FrontmatterObject, ConditionRecord>({
        attributes,
        relativePath: target.relativePath,
        markdown: existingRecord?.markdown,
        buildBody,
      });
    },
  });
}

export async function listConditions(vaultRoot: string): Promise<ConditionRecord[]> {
  return conditionRegistryApi.listRecords(vaultRoot);
}

export async function readCondition({
  vaultRoot,
  conditionId,
  slug,
}: ReadConditionInput): Promise<ConditionRecord> {
  const normalizedConditionId = normalizeId(conditionId, "conditionId", "cond");
  const normalizedSlug = normalizeSelectorSlug(slug);
  return conditionRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedConditionId,
    slug: normalizedSlug,
  });
}
