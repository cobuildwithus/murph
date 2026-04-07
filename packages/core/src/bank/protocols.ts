import {
  deriveProtocolGroupFromRelativePath,
  extractHealthEntityRegistryLinks,
  type ProtocolUpsertPayload,
} from "@murphai/contracts";

import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { defaultTimeZone, toLocalDayKey } from "../time.ts";
import { loadVault } from "../vault.ts";
import {
  loadMarkdownRegistryDocuments,
  resolveMarkdownRegistryUpsertTarget,
  writeMarkdownRegistryRecord,
} from "../registry/markdown.ts";

import {
  PROTOCOL_DOC_TYPE,
  PROTOCOL_KINDS,
  PROTOCOLS_DIRECTORY,
  PROTOCOL_SCHEMA_VERSION,
  PROTOCOL_STATUSES,
} from "./types.ts";
import {
  buildMarkdownBody,
  detailList,
  frontmatterLinkObjects,
  requireObject,
  listSection,
  normalizeGroupPath,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUpsertSelectorSlug,
  optionalDateOnly,
  optionalEnum,
  optionalFiniteNumber,
  optionalString,
  resolveOptionalUpsertValue,
  resolveRequiredUpsertValue,
  requireMatchingDocType,
  requireString,
  section,
  stripUndefined,
  normalizeId,
} from "./shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  ProtocolLink,
  ProtocolLinkType,
  ReadProtocolItemInput,
  ProtocolItemEntity,
  ProtocolItemStoredDocument,
  SupplementIngredientRecord,
  StopProtocolItemInput,
  StopProtocolItemResult,
  UpsertProtocolItemInput,
  UpsertProtocolItemResult,
} from "./types.ts";

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be a boolean.`);
  }

  return value;
}

function normalizeSupplementIngredients(
  value: unknown,
  fieldName = "ingredients",
): SupplementIngredientRecord[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an array of ingredient objects.`);
  }

  const ingredients = value.map((entry, index) => {
    const objectValue = requireObject(entry, `${fieldName}[${index}]`);
    return stripUndefined({
      compound: requireString(objectValue.compound, `${fieldName}[${index}].compound`, 160),
      label: optionalString(objectValue.label, `${fieldName}[${index}].label`, 160),
      amount: optionalFiniteNumber(objectValue.amount, `${fieldName}[${index}].amount`, 0),
      unit: optionalString(objectValue.unit, `${fieldName}[${index}].unit`, 40),
      active: optionalBoolean(objectValue.active, `${fieldName}[${index}].active`),
      note: optionalString(objectValue.note, `${fieldName}[${index}].note`, 4000),
    }) as SupplementIngredientRecord;
  });

  return ingredients.length > 0 ? ingredients : undefined;
}

function ingredientAmountLabel(ingredient: SupplementIngredientRecord): string {
  if (ingredient.amount === undefined) {
    return "amount not specified";
  }

  return `${ingredient.amount}${ingredient.unit ? ` ${ingredient.unit}` : ""}`;
}

function formatIngredientLine(ingredient: SupplementIngredientRecord): string {
  const parts = [
    `${ingredient.compound} — ${ingredientAmountLabel(ingredient)}`,
  ];

  if (ingredient.label && ingredient.label !== ingredient.compound) {
    parts.push(`label: ${ingredient.label}`);
  }

  if (ingredient.active === false) {
    parts.push("inactive");
  }

  if (ingredient.note) {
    parts.push(ingredient.note);
  }

  return parts.join("; ");
}

function buildBody(record: ProtocolItemEntity): string {
  const relations = canonicalizeProtocolRelations(record);
  const sections = [
    (record.brand || record.manufacturer || record.servingSize)
      ? section(
          "Product",
          detailList([
            ["Brand", record.brand],
            ["Manufacturer", record.manufacturer],
            ["Serving size", record.servingSize],
          ]),
        )
      : null,
    (record.substance || record.dose !== undefined)
      ? section(
          "Substance",
          detailList([
            ["Name", record.substance],
            ["Dose", record.dose !== undefined ? `${record.dose}${record.unit ? ` ${record.unit}` : ""}` : undefined],
          ]),
        )
      : null,
    record.ingredients?.length
      ? listSection(
          "Ingredients",
          record.ingredients.map((ingredient) => formatIngredientLine(ingredient)),
        )
      : null,
    listSection("Related Goals", relations.relatedGoalIds),
    listSection("Related Conditions", relations.relatedConditionIds),
    listSection("Related Protocols", relations.relatedProtocolIds),
  ].filter((sectionValue): sectionValue is string => Boolean(sectionValue));

  return buildMarkdownBody(
    record.title,
    detailList([
      ["Kind", record.kind],
      ["Status", record.status],
      ["Group", record.group],
      ["Started on", record.startedOn],
      ["Stopped on", record.stoppedOn],
      ["Schedule", record.schedule],
    ]),
    sections,
  );
}

function normalizeProtocolLinkType(value: string): ProtocolLinkType | null {
  switch (value) {
    case "supports_goal":
    case "addresses_condition":
    case "related_protocol":
      return value;
    default:
      return null;
  }
}

function compareProtocolLinks(left: ProtocolLink, right: ProtocolLink): number {
  const order: Record<ProtocolLinkType, number> = {
    supports_goal: 0,
    addresses_condition: 1,
    related_protocol: 2,
  };

  return order[left.type] - order[right.type] || left.targetId.localeCompare(right.targetId);
}

function buildProtocolLinksFromFields(input: {
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  relatedProtocolIds?: string[];
}): ProtocolLink[] {
  return [
    ...(input.relatedGoalIds ?? []).map((targetId) => ({
      type: "supports_goal",
      targetId,
    }) satisfies ProtocolLink),
    ...(input.relatedConditionIds ?? []).map((targetId) => ({
      type: "addresses_condition",
      targetId,
    }) satisfies ProtocolLink),
    ...(input.relatedProtocolIds ?? []).map((targetId) => ({
      type: "related_protocol",
      targetId,
    }) satisfies ProtocolLink),
  ];
}

function normalizeProtocolLinks(rawLinks: readonly ProtocolLink[]): ProtocolLink[] {
  const sortedLinks = [...rawLinks].sort(compareProtocolLinks);
  const links: ProtocolLink[] = [];
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

function parseProtocolLinks(attributes: FrontmatterObject): ProtocolLink[] {
  const protocolSelfId =
    typeof attributes.protocolId === "string" && attributes.protocolId.trim().length > 0
      ? attributes.protocolId.trim()
      : null;

  return normalizeProtocolLinks(
    extractHealthEntityRegistryLinks("protocol", attributes)
      .filter((link) =>
        !(
          protocolSelfId &&
          link.type === "related_protocol" &&
          link.targetId === protocolSelfId &&
          link.sourceKeys.length === 1 &&
          link.sourceKeys[0] === "protocolId"
        )
      )
      .flatMap((link) => {
      const type = normalizeProtocolLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies ProtocolLink] : [];
      }),
  );
}

function protocolRelationsFromLinks(
  links: readonly ProtocolLink[],
): Pick<ProtocolItemEntity, "relatedGoalIds" | "relatedConditionIds" | "relatedProtocolIds" | "links"> {
  const relatedGoalIds = links
    .filter((link) => link.type === "supports_goal")
    .map((link) => link.targetId);
  const relatedConditionIds = links
    .filter((link) => link.type === "addresses_condition")
    .map((link) => link.targetId);
  const relatedProtocolIds = links
    .filter((link) => link.type === "related_protocol")
    .map((link) => link.targetId);

  return {
    relatedGoalIds: relatedGoalIds.length > 0 ? relatedGoalIds : undefined,
    relatedConditionIds: relatedConditionIds.length > 0 ? relatedConditionIds : undefined,
    relatedProtocolIds: relatedProtocolIds.length > 0 ? relatedProtocolIds : undefined,
    links: [...links],
  };
}

function canonicalizeProtocolRelations(input: {
  links?: readonly ProtocolLink[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  relatedProtocolIds?: string[];
}): Pick<ProtocolItemEntity, "relatedGoalIds" | "relatedConditionIds" | "relatedProtocolIds" | "links"> {
  const links = normalizeProtocolLinks(
    input.links !== undefined
      ? [...input.links]
      : buildProtocolLinksFromFields({
          relatedGoalIds: input.relatedGoalIds,
          relatedConditionIds: input.relatedConditionIds,
          relatedProtocolIds: input.relatedProtocolIds,
        }),
  );

  return protocolRelationsFromLinks(links);
}

function requireProtocolGroupFromRelativePath(relativePath: string): string {
  const group = deriveProtocolGroupFromRelativePath(relativePath, PROTOCOLS_DIRECTORY);

  if (!group) {
    throw new VaultError("VAULT_INVALID_PROTOCOL", "Protocol path is missing a group directory.");
  }

  return group;
}

function parseProtocolItemRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): ProtocolItemStoredDocument {
  requireMatchingDocType(
    attributes,
    PROTOCOL_SCHEMA_VERSION,
    PROTOCOL_DOC_TYPE,
    "VAULT_INVALID_PROTOCOL",
    "Protocol registry document has an unexpected shape.",
  );
  const startedOn = optionalDateOnly(attributes.startedOn as string | undefined, "startedOn");

  if (!startedOn) {
    throw new VaultError("VAULT_INVALID_PROTOCOL", "Protocol registry document is missing startedOn.");
  }

  const relations = canonicalizeProtocolRelations({
    links: parseProtocolLinks(attributes),
    relatedGoalIds: normalizeRecordIdList(attributes.relatedGoalIds, "relatedGoalIds", "goal"),
    relatedConditionIds: normalizeRecordIdList(attributes.relatedConditionIds, "relatedConditionIds", "cond"),
    relatedProtocolIds: normalizeRecordIdList(attributes.relatedProtocolIds, "relatedProtocolIds", "prot"),
  });

  const entity = stripUndefined({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    docType: PROTOCOL_DOC_TYPE,
    protocolId: requireString(attributes.protocolId, "protocolId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", 160),
    kind: optionalEnum(attributes.kind, PROTOCOL_KINDS, "kind") ?? "medication",
    status: optionalEnum(attributes.status, PROTOCOL_STATUSES, "status") ?? "active",
    startedOn,
    stoppedOn: optionalDateOnly(attributes.stoppedOn as string | undefined, "stoppedOn"),
    substance: optionalString(attributes.substance, "substance", 160),
    dose: optionalFiniteNumber(attributes.dose, "dose", 0),
    unit: optionalString(attributes.unit, "unit", 40),
    schedule: optionalString(attributes.schedule, "schedule", 160),
    brand: optionalString(attributes.brand, "brand", 160),
    manufacturer: optionalString(attributes.manufacturer, "manufacturer", 160),
    servingSize: optionalString(attributes.servingSize, "servingSize", 160),
    ingredients: normalizeSupplementIngredients(attributes.ingredients),
    relatedGoalIds: relations.relatedGoalIds,
    relatedConditionIds: relations.relatedConditionIds,
    relatedProtocolIds: relations.relatedProtocolIds,
    links: relations.links,
    group: requireProtocolGroupFromRelativePath(relativePath),
  }) as ProtocolItemEntity;

  return {
    entity,
    document: {
      relativePath,
      markdown,
    },
  };
}

export function protocolRecordToUpsertPayload(
  record: ProtocolItemEntity,
): Omit<ProtocolUpsertPayload, "protocolId"> {
  const relations = canonicalizeProtocolRelations(record);

  return stripUndefined({
    slug: record.slug,
    title: record.title,
    kind: record.kind,
    status: record.status,
    startedOn: record.startedOn,
    stoppedOn: record.stoppedOn,
    substance: record.substance,
    dose: record.dose,
    unit: record.unit,
    schedule: record.schedule,
    brand: record.brand,
    manufacturer: record.manufacturer,
    servingSize: record.servingSize,
    ingredients: record.ingredients?.map((ingredient) =>
      stripUndefined({
        compound: ingredient.compound,
        label: ingredient.label,
        amount: ingredient.amount,
        unit: ingredient.unit,
        active: ingredient.active,
        note: ingredient.note,
      }),
    ),
    relatedGoalIds: relations.relatedGoalIds,
    relatedConditionIds: relations.relatedConditionIds,
    relatedProtocolIds: relations.relatedProtocolIds,
    links: frontmatterLinkObjects(relations.links),
    group: record.group,
  }) as Omit<ProtocolUpsertPayload, "protocolId">;
}

function buildAttributes(record: ProtocolItemEntity): FrontmatterObject {
  const { group: _group, ...payload } = protocolRecordToUpsertPayload(record);

  return stripUndefined({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    docType: PROTOCOL_DOC_TYPE,
    protocolId: record.protocolId,
    ...payload,
  }) as FrontmatterObject;
}

function validateProtocolTiming(record: ProtocolItemEntity): ProtocolItemEntity {
  if (!record.startedOn) {
    throw new VaultError("VAULT_INVALID_INPUT", "startedOn is required.");
  }

  if (record.stoppedOn && record.stoppedOn < record.startedOn) {
    throw new VaultError("VAULT_INVALID_INPUT", "stoppedOn must be on or after startedOn.");
  }

  if (record.stoppedOn && !["stopped", "completed"].includes(record.status)) {
    throw new VaultError("VAULT_INVALID_INPUT", "stoppedOn requires status=stopped or completed.");
  }

  if (record.status === "stopped" && !record.stoppedOn) {
    throw new VaultError("VAULT_INVALID_INPUT", "status=stopped requires stoppedOn.");
  }

  return record;
}

async function loadProtocolItems(vaultRoot: string): Promise<ProtocolItemStoredDocument[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: PROTOCOLS_DIRECTORY,
    recordFromParts: parseProtocolItemRecord,
    isExpectedRecord: (record) =>
      record.entity.docType === PROTOCOL_DOC_TYPE
      && record.entity.schemaVersion === PROTOCOL_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_PROTOCOL",
    invalidMessage: "Protocol registry document has an unexpected shape.",
  });

  records.sort(
    (left, right) =>
      left.entity.group.localeCompare(right.entity.group) ||
      left.entity.title.localeCompare(right.entity.title) ||
      left.entity.protocolId.localeCompare(right.entity.protocolId),
  );
  return records;
}

function selectProtocolRecord(
  records: ProtocolItemStoredDocument[],
  protocolId: string | undefined,
  slug: string | undefined,
  group: string | undefined,
): ProtocolItemStoredDocument | null {
  const byId = protocolId
    ? records.find((record) => record.entity.protocolId === protocolId) ?? null
    : null;
  const slugMatches = slug
    ? records.filter(
        (record) => record.entity.slug === slug && (!group || record.entity.group === group),
      )
    : [];
  const bySlug = slugMatches.length > 0 ? slugMatches[0] ?? null : null;

  if (slugMatches.length > 1 && !protocolId) {
    throw new VaultError("VAULT_PROTOCOL_CONFLICT", "slug resolves to multiple protocol records; include group or protocolId.");
  }

  if (byId && bySlug && byId.entity.protocolId !== bySlug.entity.protocolId) {
    throw new VaultError("VAULT_PROTOCOL_CONFLICT", "protocolId and slug resolve to different protocol records.");
  }

  return byId ?? bySlug;
}

async function resolveProtocolRecord(input: ReadProtocolItemInput): Promise<ProtocolItemStoredDocument> {
  const normalizedProtocolId = normalizeId(input.protocolId, "protocolId", "prot");
  const normalizedSlug = normalizeSelectorSlug(input.slug);
  const normalizedGroup = input.group ? normalizeGroupPath(input.group, "protocol") : undefined;
  const records = await loadProtocolItems(input.vaultRoot);
  const match = records.find((record) => {
    if (normalizedProtocolId && record.entity.protocolId === normalizedProtocolId) {
      return true;
    }

    if (!normalizedSlug) {
      return false;
    }

    if (record.entity.slug !== normalizedSlug) {
      return false;
    }

    return normalizedGroup ? record.entity.group === normalizedGroup : true;
  });

  if (!match) {
    throw new VaultError("VAULT_PROTOCOL_MISSING", "Protocol item was not found.");
  }

  if (normalizedSlug && !normalizedGroup && !normalizedProtocolId) {
    const collisions = records.filter((record) => record.entity.slug === normalizedSlug);
    if (collisions.length > 1) {
      throw new VaultError("VAULT_PROTOCOL_CONFLICT", "slug resolves to multiple protocol records; include group.");
    }
  }

  return match;
}

export async function upsertProtocolItem(
  input: UpsertProtocolItemInput,
): Promise<UpsertProtocolItemResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const today = toLocalDayKey(new Date(), vault.metadata.timezone ?? defaultTimeZone(), "startedOn");
  const normalizedProtocolId = normalizeId(input.protocolId, "protocolId", "prot");
  const existingRecords = await loadProtocolItems(input.vaultRoot);
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const requestedGroup = input.group ? normalizeGroupPath(input.group, input.kind ?? "protocol") : undefined;
  const existingRecord = selectProtocolRecord(existingRecords, normalizedProtocolId, requestedSlug, requestedGroup);
  const existingEntity = existingRecord?.entity;
  const title = requireString(input.title ?? existingEntity?.title, "title", 160);
  const kind = resolveRequiredUpsertValue(input.kind, existingEntity?.kind, "medication", (value) =>
    optionalEnum(value, PROTOCOL_KINDS, "kind") ?? "medication",
  );
  const group = existingEntity?.group ?? requestedGroup ?? normalizeGroupPath(undefined, kind);
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: normalizedProtocolId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    allowSlugUpdate: input.allowSlugRename === true,
    directory: `${PROTOCOLS_DIRECTORY}/${group}`,
    getRecordId: (record) => record.entity.protocolId,
    getRecordSlug: (record) => record.entity.slug,
    getRecordRelativePath: (record) => record.document.relativePath,
    createRecordId: () => generateRecordId("prot"),
  });
  const relatedGoalIds = resolveOptionalUpsertValue(
    input.relatedGoalIds,
    existingEntity?.relatedGoalIds,
    (value) => normalizeRecordIdList(value, "relatedGoalIds", "goal"),
  );
  const relatedConditionIds = resolveOptionalUpsertValue(
    input.relatedConditionIds,
    existingEntity?.relatedConditionIds,
    (value) => normalizeRecordIdList(value, "relatedConditionIds", "cond"),
  );
  const relatedProtocolIds = resolveOptionalUpsertValue(
    input.relatedProtocolIds,
    existingEntity?.relatedProtocolIds,
    (value) => normalizeRecordIdList(value, "relatedProtocolIds", "prot"),
  );
  const usesRelationInputs =
    input.links !== undefined ||
    input.relatedGoalIds !== undefined ||
    input.relatedConditionIds !== undefined ||
    input.relatedProtocolIds !== undefined;
  const attributes = buildAttributes(
    validateProtocolTiming(
      stripUndefined({
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        docType: PROTOCOL_DOC_TYPE,
        protocolId: target.recordId,
        slug: target.slug,
        title,
        kind,
        status: resolveRequiredUpsertValue(input.status, existingEntity?.status, "active", (value) =>
          optionalEnum(value, PROTOCOL_STATUSES, "status") ?? "active",
        ),
        startedOn: optionalDateOnly(input.startedOn ?? existingEntity?.startedOn ?? today, "startedOn") ?? "",
        stoppedOn: resolveOptionalUpsertValue(input.stoppedOn, existingEntity?.stoppedOn, (value) =>
          optionalDateOnly(value, "stoppedOn"),
        ),
        substance: resolveOptionalUpsertValue(input.substance, existingEntity?.substance, (value) =>
          optionalString(value, "substance", 160),
        ),
        dose: resolveOptionalUpsertValue(input.dose, existingEntity?.dose, (value) =>
          optionalFiniteNumber(value, "dose", 0),
        ),
        unit: resolveOptionalUpsertValue(input.unit, existingEntity?.unit, (value) =>
          optionalString(value, "unit", 40),
        ),
        schedule: resolveOptionalUpsertValue(input.schedule, existingEntity?.schedule, (value) =>
          optionalString(value, "schedule", 160),
        ),
        brand: resolveOptionalUpsertValue(input.brand, existingEntity?.brand, (value) =>
          optionalString(value, "brand", 160),
        ),
        manufacturer: resolveOptionalUpsertValue(
          input.manufacturer,
          existingEntity?.manufacturer,
          (value) => optionalString(value, "manufacturer", 160),
        ),
        servingSize: resolveOptionalUpsertValue(input.servingSize, existingEntity?.servingSize, (value) =>
          optionalString(value, "servingSize", 160),
        ),
        ingredients: resolveOptionalUpsertValue(input.ingredients, existingEntity?.ingredients, (value) =>
          normalizeSupplementIngredients(value),
        ),
        ...canonicalizeProtocolRelations({
          links: input.links !== undefined ? input.links : usesRelationInputs ? undefined : existingEntity?.links,
          relatedGoalIds,
          relatedConditionIds,
          relatedProtocolIds,
        }),
      }) as ProtocolItemEntity,
    ),
  );
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes,
    body: buildBody({
      ...attributes,
      group,
    } as ProtocolItemEntity),
    recordFromParts: parseProtocolItemRecord,
    operationType: "protocol_upsert",
    summary: `Upsert protocol ${target.recordId}`,
    audit: {
      action: "protocol_upsert",
      commandName: "core.upsertProtocolItem",
      summary: `Upserted protocol ${target.recordId}.`,
      targetIds: [target.recordId],
    },
  });

  return {
    created: target.created,
    auditPath,
    record,
  };
}

export async function listProtocolItems(vaultRoot: string): Promise<ProtocolItemStoredDocument[]> {
  return loadProtocolItems(vaultRoot);
}

export async function readProtocolItem(
  input: ReadProtocolItemInput,
): Promise<ProtocolItemStoredDocument> {
  return resolveProtocolRecord(input);
}

export async function stopProtocolItem(
  input: StopProtocolItemInput,
): Promise<StopProtocolItemResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const current = await resolveProtocolRecord(input);
  const stoppedOn = optionalDateOnly(
    input.stoppedOn ?? toLocalDayKey(new Date(), vault.metadata.timezone ?? defaultTimeZone(), "stoppedOn"),
    "stoppedOn",
  ) ?? "";
  const updatedEntity = validateProtocolTiming({
    ...current.entity,
    status: "stopped",
    stoppedOn,
  } satisfies ProtocolItemEntity);
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target: {
      recordId: updatedEntity.protocolId,
      slug: updatedEntity.slug,
      relativePath: current.document.relativePath,
      created: false,
    },
    attributes: buildAttributes(updatedEntity),
    body: buildBody(updatedEntity),
    recordFromParts: parseProtocolItemRecord,
    operationType: "protocol_stop",
    summary: `Stop protocol ${updatedEntity.protocolId}`,
    audit: {
      action: "protocol_stop",
      commandName: "core.stopProtocolItem",
      summary: `Stopped protocol ${updatedEntity.protocolId}.`,
      targetIds: [updatedEntity.protocolId],
    },
  });

  return {
    auditPath,
    record,
  };
}
