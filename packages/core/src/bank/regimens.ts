import {
  extractHealthEntityRegistryLinks,
  SUPPLEMENT_INGREDIENTS_MAX_ITEMS,
} from "@murphai/contracts";

import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { defaultTimeZone, toLocalDayKey } from "../time.ts";
import { loadVault } from "../vault.ts";
import {
  canonicalLogicalResource,
  withCanonicalResourceLocks,
} from "../operations/index.ts";
import {
  loadMarkdownRegistryDocuments,
  resolveMarkdownRegistryUpsertTarget,
  writeMarkdownRegistryRecord,
} from "../registry/markdown.ts";

import {
  REGIMEN_DOC_TYPE,
  REGIMEN_KINDS,
  REGIMENS_DIRECTORY,
  REGIMEN_SCHEMA_VERSION,
  REGIMEN_STATUSES,
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
  RegimenLink,
  RegimenLinkType,
  ReadRegimenInput,
  RegimenEntity,
  RegimenStoredDocument,
  SupplementIngredientRecord,
  StopRegimenInput,
  StopRegimenResult,
  UpsertRegimenInput,
  UpsertRegimenResult,
} from "./types.ts";

type RegimenUpsertPayload = Omit<RegimenEntity, "schemaVersion" | "docType" | "regimenId">;

const regimenRegistryResource = canonicalLogicalResource("bank/regimens", REGIMENS_DIRECTORY);

function deriveRegimenGroupFromRelativePath(relativePath: string, directory: string): string | null {
  const prefix = `${directory.replace(/\/+$/u, "")}/`;
  if (!relativePath.startsWith(prefix)) {
    return null;
  }

  const suffix = relativePath.slice(prefix.length);
  const segments = suffix.split("/");
  return segments.length > 1 ? segments.slice(0, -1).join("/") : null;
}

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

  if (value.length > SUPPLEMENT_INGREDIENTS_MAX_ITEMS) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      `${fieldName} must contain at most ${SUPPLEMENT_INGREDIENTS_MAX_ITEMS} ingredients.`,
    );
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

function buildBody(record: RegimenEntity): string {
  const relations = canonicalizeRegimenRelations(record);
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
    record.note ? section("Notes", record.note) : null,
    record.ingredients?.length
      ? listSection(
          "Ingredients",
          record.ingredients.map((ingredient) => formatIngredientLine(ingredient)),
        )
      : null,
    listSection("Related Goals", relations.relatedGoalIds),
    listSection("Related Conditions", relations.relatedConditionIds),
    listSection("Related Regimens", relations.relatedRegimenIds),
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

function normalizeRegimenLinkType(value: string): RegimenLinkType | null {
  switch (value) {
    case "supports_goal":
    case "addresses_condition":
    case "related_regimen":
      return value;
    default:
      return null;
  }
}

function compareRegimenLinks(left: RegimenLink, right: RegimenLink): number {
  const order: Record<RegimenLinkType, number> = {
    supports_goal: 0,
    addresses_condition: 1,
    related_regimen: 2,
  };

  return order[left.type] - order[right.type] || left.targetId.localeCompare(right.targetId);
}

function buildRegimenLinksFromFields(input: {
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  relatedRegimenIds?: string[];
}): RegimenLink[] {
  return [
    ...(input.relatedGoalIds ?? []).map((targetId) => ({
      type: "supports_goal",
      targetId,
    }) satisfies RegimenLink),
    ...(input.relatedConditionIds ?? []).map((targetId) => ({
      type: "addresses_condition",
      targetId,
    }) satisfies RegimenLink),
    ...(input.relatedRegimenIds ?? []).map((targetId) => ({
      type: "related_regimen",
      targetId,
    }) satisfies RegimenLink),
  ];
}

function normalizeRegimenLink(link: RegimenLink): RegimenLink {
  switch (link.type) {
    case "supports_goal": {
      const targetId = normalizeRecordIdList([link.targetId], "links.targetId", "goal")?.[0];
      if (!targetId) {
        throw new VaultError("VAULT_INVALID_INPUT", "links.targetId is invalid.");
      }
      return {
        type: link.type,
        targetId,
      };
    }
    case "addresses_condition": {
      const targetId = normalizeRecordIdList([link.targetId], "links.targetId", "cond")?.[0];
      if (!targetId) {
        throw new VaultError("VAULT_INVALID_INPUT", "links.targetId is invalid.");
      }
      return {
        type: link.type,
        targetId,
      };
    }
    case "related_regimen": {
      const targetId = normalizeRecordIdList([link.targetId], "links.targetId", "reg")?.[0];
      if (!targetId) {
        throw new VaultError("VAULT_INVALID_INPUT", "links.targetId is invalid.");
      }
      return {
        type: link.type,
        targetId,
      };
    }
    default:
      throw new VaultError("VAULT_INVALID_INPUT", "links.type is invalid.");
  }
}

function normalizeRegimenLinks(rawLinks: readonly RegimenLink[]): RegimenLink[] {
  const sortedLinks = rawLinks.map(normalizeRegimenLink).sort(compareRegimenLinks);
  const links: RegimenLink[] = [];
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

function parseRegimenLinks(attributes: FrontmatterObject): RegimenLink[] {
  const regimenSelfId =
    typeof attributes.regimenId === "string" && attributes.regimenId.trim().length > 0
      ? attributes.regimenId.trim()
      : null;

  return normalizeRegimenLinks(
    extractHealthEntityRegistryLinks("regimen", attributes)
      .filter((link) =>
        !(
          regimenSelfId &&
          link.type === "related_regimen" &&
          link.targetId === regimenSelfId &&
          link.sourceKeys.length === 1 &&
          link.sourceKeys[0] === "regimenId"
        )
      )
      .flatMap((link) => {
      const type = normalizeRegimenLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies RegimenLink] : [];
      }),
  );
}

function regimenRelationsFromLinks(
  links: readonly RegimenLink[],
): Pick<RegimenEntity, "relatedGoalIds" | "relatedConditionIds" | "relatedRegimenIds" | "links"> {
  const relatedGoalIds = links
    .filter((link) => link.type === "supports_goal")
    .map((link) => link.targetId);
  const relatedConditionIds = links
    .filter((link) => link.type === "addresses_condition")
    .map((link) => link.targetId);
  const relatedRegimenIds = links
    .filter((link) => link.type === "related_regimen")
    .map((link) => link.targetId);

  return {
    relatedGoalIds: relatedGoalIds.length > 0 ? relatedGoalIds : undefined,
    relatedConditionIds: relatedConditionIds.length > 0 ? relatedConditionIds : undefined,
    relatedRegimenIds: relatedRegimenIds.length > 0 ? relatedRegimenIds : undefined,
    links: [...links],
  };
}

function canonicalizeRegimenRelations(input: {
  links?: readonly RegimenLink[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  relatedRegimenIds?: string[];
}): Pick<RegimenEntity, "relatedGoalIds" | "relatedConditionIds" | "relatedRegimenIds" | "links"> {
  const links = normalizeRegimenLinks(
    input.links !== undefined
      ? [...input.links]
      : buildRegimenLinksFromFields({
          relatedGoalIds: input.relatedGoalIds,
          relatedConditionIds: input.relatedConditionIds,
          relatedRegimenIds: input.relatedRegimenIds,
        }),
  );

  return regimenRelationsFromLinks(links);
}

function requireRegimenGroupFromRelativePath(relativePath: string): string {
  const group = deriveRegimenGroupFromRelativePath(relativePath, REGIMENS_DIRECTORY);

  if (!group) {
    throw new VaultError("VAULT_INVALID_REGIMEN", "Regimen path is missing a group directory.");
  }

  return group;
}

function requirePersistedRegimenId(value: unknown): string {
  try {
    const regimenId = normalizeId(value, "regimenId", "reg");

    if (regimenId) {
      return regimenId;
    }
  } catch (error) {
    if (error instanceof VaultError) {
      throw new VaultError("VAULT_INVALID_REGIMEN", error.message);
    }

    throw error;
  }

  throw new VaultError("VAULT_INVALID_REGIMEN", "regimenId is required.");
}

function parseRegimenRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): RegimenStoredDocument {
  requireMatchingDocType(
    attributes,
    REGIMEN_SCHEMA_VERSION,
    REGIMEN_DOC_TYPE,
    "VAULT_INVALID_REGIMEN",
    "Regimen registry document has an unexpected shape.",
  );
  const startedOn = optionalDateOnly(attributes.startedOn as string | undefined, "startedOn");

  if (!startedOn) {
    throw new VaultError("VAULT_INVALID_REGIMEN", "Regimen registry document is missing startedOn.");
  }

  const relations = canonicalizeRegimenRelations({
    links: parseRegimenLinks(attributes),
    relatedGoalIds: normalizeRecordIdList(attributes.relatedGoalIds, "relatedGoalIds", "goal"),
    relatedConditionIds: normalizeRecordIdList(attributes.relatedConditionIds, "relatedConditionIds", "cond"),
    relatedRegimenIds: normalizeRecordIdList(attributes.relatedRegimenIds, "relatedRegimenIds", "reg"),
  });

  const entity = stripUndefined({
    schemaVersion: REGIMEN_SCHEMA_VERSION,
    docType: REGIMEN_DOC_TYPE,
    regimenId: requirePersistedRegimenId(attributes.regimenId),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", 160),
    kind: optionalEnum(attributes.kind, REGIMEN_KINDS, "kind") ?? "medication",
    status: optionalEnum(attributes.status, REGIMEN_STATUSES, "status") ?? "active",
    startedOn,
    stoppedOn: optionalDateOnly(attributes.stoppedOn as string | undefined, "stoppedOn"),
    substance: optionalString(attributes.substance, "substance", 160),
    dose: optionalFiniteNumber(attributes.dose, "dose", 0),
    unit: optionalString(attributes.unit, "unit", 40),
    schedule: optionalString(attributes.schedule, "schedule", 160),
    brand: optionalString(attributes.brand, "brand", 160),
    manufacturer: optionalString(attributes.manufacturer, "manufacturer", 160),
    servingSize: optionalString(attributes.servingSize, "servingSize", 160),
    note: optionalString(attributes.note, "note", 4000),
    ingredients: normalizeSupplementIngredients(attributes.ingredients),
    relatedGoalIds: relations.relatedGoalIds,
    relatedConditionIds: relations.relatedConditionIds,
    relatedRegimenIds: relations.relatedRegimenIds,
    links: relations.links,
    group: requireRegimenGroupFromRelativePath(relativePath),
  }) as RegimenEntity;

  return {
    entity,
    document: {
      relativePath,
      markdown,
    },
  };
}

export function regimenRecordToUpsertPayload(
  record: RegimenEntity,
): Omit<RegimenUpsertPayload, "regimenId"> {
  const relations = canonicalizeRegimenRelations(record);

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
    note: record.note,
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
    relatedRegimenIds: relations.relatedRegimenIds,
    links: relations.links.length > 0 ? relations.links : undefined,
    group: record.group,
  }) as Omit<RegimenUpsertPayload, "regimenId">;
}

function buildAttributes(record: RegimenEntity): FrontmatterObject {
  const { group: _group, links, ...payload } = regimenRecordToUpsertPayload(record);

  return stripUndefined({
    schemaVersion: REGIMEN_SCHEMA_VERSION,
    docType: REGIMEN_DOC_TYPE,
    regimenId: record.regimenId,
    ...payload,
    ingredients: payload.ingredients?.map((ingredient) =>
      stripUndefined({
        compound: ingredient.compound,
        label: ingredient.label,
        amount: ingredient.amount,
        unit: ingredient.unit,
        active: ingredient.active,
        note: ingredient.note,
      }),
    ),
    links: frontmatterLinkObjects(links),
  }) as FrontmatterObject;
}

function validateRegimenTiming(record: RegimenEntity): RegimenEntity {
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

async function loadRegimens(vaultRoot: string): Promise<RegimenStoredDocument[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: REGIMENS_DIRECTORY,
    recordFromParts: parseRegimenRecord,
    isExpectedRecord: (record) =>
      record.entity.docType === REGIMEN_DOC_TYPE
      && record.entity.schemaVersion === REGIMEN_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_REGIMEN",
    invalidMessage: "Regimen registry document has an unexpected shape.",
  });

  records.sort(
    (left, right) =>
      left.entity.group.localeCompare(right.entity.group) ||
      left.entity.title.localeCompare(right.entity.title) ||
      left.entity.regimenId.localeCompare(right.entity.regimenId),
  );
  return records;
}

function selectRegimenRecord(
  records: RegimenStoredDocument[],
  regimenId: string | undefined,
  slug: string | undefined,
  group: string | undefined,
): RegimenStoredDocument | null {
  const byId = regimenId
    ? records.find((record) => record.entity.regimenId === regimenId) ?? null
    : null;
  const slugMatches = slug
    ? records.filter(
        (record) => record.entity.slug === slug && (!group || record.entity.group === group),
      )
    : [];
  const bySlug = slugMatches.length > 0 ? slugMatches[0] ?? null : null;

  if (slugMatches.length > 1 && !regimenId) {
    throw new VaultError("VAULT_REGIMEN_CONFLICT", "slug resolves to multiple regimen records; include group or regimenId.");
  }

  if (byId && bySlug && byId.entity.regimenId !== bySlug.entity.regimenId) {
    throw new VaultError("VAULT_REGIMEN_CONFLICT", "regimenId and slug resolve to different regimen records.");
  }

  if (regimenId && !byId && bySlug) {
    throw new VaultError("VAULT_REGIMEN_CONFLICT", "regimenId and slug resolve to different regimen records.");
  }

  return byId ?? bySlug;
}

async function resolveRegimenRecord(input: ReadRegimenInput): Promise<RegimenStoredDocument> {
  const normalizedRegimenId = normalizeId(input.regimenId, "regimenId", "reg");
  const normalizedSlug = normalizeSelectorSlug(input.slug);
  const normalizedGroup = input.group ? normalizeGroupPath(input.group, "regimen") : undefined;
  const records = await loadRegimens(input.vaultRoot);

  if (normalizedSlug && !normalizedGroup && !normalizedRegimenId) {
    const collisions = records.filter((record) => record.entity.slug === normalizedSlug);
    if (collisions.length > 1) {
      throw new VaultError("VAULT_REGIMEN_CONFLICT", "slug resolves to multiple regimen records; include group.");
    }
  }

  const match = selectRegimenRecord(records, normalizedRegimenId, normalizedSlug, normalizedGroup);

  if (!match) {
    throw new VaultError("VAULT_REGIMEN_MISSING", "Regimen item was not found.");
  }

  if (normalizedSlug && !normalizedGroup && !normalizedRegimenId) {
    const collisions = records.filter((record) => record.entity.slug === normalizedSlug);
    if (collisions.length > 1) {
      throw new VaultError("VAULT_REGIMEN_CONFLICT", "slug resolves to multiple regimen records; include group.");
    }
  }

  return match;
}

export async function upsertRegimen(
  input: UpsertRegimenInput,
): Promise<UpsertRegimenResult> {
  return await withRegimenRegistryLock(input.vaultRoot, () => upsertRegimenWithLatestRegistry(input));
}

async function upsertRegimenWithLatestRegistry(
  input: UpsertRegimenInput,
): Promise<UpsertRegimenResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const today = toLocalDayKey(new Date(), vault.metadata.timezone ?? defaultTimeZone(), "startedOn");
  const normalizedRegimenId = normalizeId(input.regimenId, "regimenId", "reg");
  const existingRecords = await loadRegimens(input.vaultRoot);
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const requestedGroup = input.group ? normalizeGroupPath(input.group, input.kind ?? "regimen") : undefined;
  const existingRecord = selectRegimenRecord(existingRecords, normalizedRegimenId, requestedSlug, requestedGroup);
  const existingEntity = existingRecord?.entity;
  const title = requireString(input.title ?? existingEntity?.title, "title", 160);
  const kind = resolveRequiredUpsertValue(input.kind, existingEntity?.kind, "medication", (value) =>
    optionalEnum(value, REGIMEN_KINDS, "kind") ?? "medication",
  );
  const group = existingEntity?.group ?? requestedGroup ?? normalizeGroupPath(undefined, kind);
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: normalizedRegimenId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    allowSlugUpdate: input.allowSlugRename === true,
    directory: `${REGIMENS_DIRECTORY}/${group}`,
    getRecordId: (record) => record.entity.regimenId,
    getRecordSlug: (record) => record.entity.slug,
    getRecordRelativePath: (record) => record.document.relativePath,
    createRecordId: () => generateRecordId("reg"),
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
  const relatedRegimenIds = resolveOptionalUpsertValue(
    input.relatedRegimenIds,
    existingEntity?.relatedRegimenIds,
    (value) => normalizeRecordIdList(value, "relatedRegimenIds", "reg"),
  );
  const usesRelationInputs =
    input.links !== undefined ||
    input.relatedGoalIds !== undefined ||
    input.relatedConditionIds !== undefined ||
    input.relatedRegimenIds !== undefined;
  const attributes = buildAttributes(
    validateRegimenTiming(
      stripUndefined({
        schemaVersion: REGIMEN_SCHEMA_VERSION,
        docType: REGIMEN_DOC_TYPE,
        regimenId: target.recordId,
        slug: target.slug,
        title,
        kind,
        status: resolveRequiredUpsertValue(input.status, existingEntity?.status, "active", (value) =>
          optionalEnum(value, REGIMEN_STATUSES, "status") ?? "active",
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
        note: resolveOptionalUpsertValue(input.note, existingEntity?.note, (value) =>
          optionalString(value, "note", 4000),
        ),
        ingredients: resolveOptionalUpsertValue(input.ingredients, existingEntity?.ingredients, (value) =>
          normalizeSupplementIngredients(value),
        ),
        ...canonicalizeRegimenRelations({
          links: input.links !== undefined ? input.links : usesRelationInputs ? undefined : existingEntity?.links,
          relatedGoalIds,
          relatedConditionIds,
          relatedRegimenIds,
        }),
      }) as RegimenEntity,
    ),
  );
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes,
    body: buildBody({
      ...attributes,
      group,
    } as RegimenEntity),
    recordFromParts: parseRegimenRecord,
    operationType: "regimen_upsert",
    summary: `Upsert regimen ${target.recordId}`,
    audit: {
      action: "regimen_upsert",
      commandName: "core.upsertRegimen",
      summary: `Upserted regimen ${target.recordId}.`,
      targetIds: [target.recordId],
    },
  });

  return {
    created: target.created,
    auditPath,
    record,
  };
}

export async function listRegimens(vaultRoot: string): Promise<RegimenStoredDocument[]> {
  return loadRegimens(vaultRoot);
}

export async function readRegimen(
  input: ReadRegimenInput,
): Promise<RegimenStoredDocument> {
  return resolveRegimenRecord(input);
}

export async function stopRegimen(
  input: StopRegimenInput,
): Promise<StopRegimenResult> {
  return await withRegimenRegistryLock(input.vaultRoot, () => stopRegimenWithLatestRegistry(input));
}

async function stopRegimenWithLatestRegistry(
  input: StopRegimenInput,
): Promise<StopRegimenResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const current = await resolveRegimenRecord(input);
  const stoppedOn = optionalDateOnly(
    input.stoppedOn ?? toLocalDayKey(new Date(), vault.metadata.timezone ?? defaultTimeZone(), "stoppedOn"),
    "stoppedOn",
  ) ?? "";
  const updatedEntity = validateRegimenTiming({
    ...current.entity,
    status: "stopped",
    stoppedOn,
  } satisfies RegimenEntity);
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target: {
      recordId: updatedEntity.regimenId,
      slug: updatedEntity.slug,
      relativePath: current.document.relativePath,
      created: false,
    },
    attributes: buildAttributes(updatedEntity),
    body: buildBody(updatedEntity),
    recordFromParts: parseRegimenRecord,
    operationType: "regimen_stop",
    summary: `Stop regimen ${updatedEntity.regimenId}`,
    audit: {
      action: "regimen_stop",
      commandName: "core.stopRegimen",
      summary: `Stopped regimen ${updatedEntity.regimenId}.`,
      targetIds: [updatedEntity.regimenId],
    },
  });

  return {
    auditPath,
    record,
  };
}

async function withRegimenRegistryLock<TResult>(
  vaultRoot: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return await withCanonicalResourceLocks({
    vaultRoot,
    resources: [regimenRegistryResource],
    run,
  });
}
