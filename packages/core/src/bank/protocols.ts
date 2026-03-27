import { VaultError } from "../errors.js";
import { generateRecordId } from "../ids.js";
import { defaultTimeZone, toLocalDayKey } from "../time.js";
import { loadVault } from "../vault.js";
import {
  loadMarkdownRegistryDocuments,
  resolveMarkdownRegistryUpsertTarget,
  writeMarkdownRegistryRecord,
} from "../registry/markdown.js";

import {
  PROTOCOL_DOC_TYPE,
  PROTOCOL_KINDS,
  PROTOCOLS_DIRECTORY,
  PROTOCOL_SCHEMA_VERSION,
  PROTOCOL_STATUSES,
} from "./types.js";
import {
  buildMarkdownBody,
  detailList,
  groupFromProtocolPath,
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
} from "./shared.js";

import type { FrontmatterObject } from "../types.js";
import type {
  ReadProtocolItemInput,
  ProtocolItemRecord,
  SupplementIngredientRecord,
  StopProtocolItemInput,
  StopProtocolItemResult,
  UpsertProtocolItemInput,
  UpsertProtocolItemResult,
} from "./types.js";

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

function buildBody(record: ProtocolItemRecord): string {
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
    listSection("Related Goals", record.relatedGoalIds),
    listSection("Related Conditions", record.relatedConditionIds),
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

function parseProtocolItemRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): ProtocolItemRecord {
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

  return stripUndefined({
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
    relatedGoalIds: normalizeRecordIdList(attributes.relatedGoalIds, "relatedGoalIds", "goal"),
    relatedConditionIds: normalizeRecordIdList(attributes.relatedConditionIds, "relatedConditionIds", "cond"),
    group: groupFromProtocolPath(relativePath, PROTOCOLS_DIRECTORY),
    relativePath,
    markdown,
  });
}

function buildAttributes(record: ProtocolItemRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    docType: PROTOCOL_DOC_TYPE,
    protocolId: record.protocolId,
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
    relatedGoalIds: record.relatedGoalIds,
    relatedConditionIds: record.relatedConditionIds,
  }) as FrontmatterObject;
}

function validateProtocolTiming(record: ProtocolItemRecord): ProtocolItemRecord {
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

async function loadProtocolItems(vaultRoot: string): Promise<ProtocolItemRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: PROTOCOLS_DIRECTORY,
    recordFromParts: parseProtocolItemRecord,
    isExpectedRecord: (record) =>
      record.docType === PROTOCOL_DOC_TYPE && record.schemaVersion === PROTOCOL_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_PROTOCOL",
    invalidMessage: "Protocol registry document has an unexpected shape.",
  });

  records.sort(
    (left, right) =>
      left.group.localeCompare(right.group) ||
      left.title.localeCompare(right.title) ||
      left.protocolId.localeCompare(right.protocolId),
  );
  return records;
}

function selectProtocolRecord(
  records: ProtocolItemRecord[],
  protocolId: string | undefined,
  slug: string | undefined,
  group: string | undefined,
): ProtocolItemRecord | null {
  const byId = protocolId ? records.find((record) => record.protocolId === protocolId) ?? null : null;
  const slugMatches = slug
    ? records.filter((record) => record.slug === slug && (!group || record.group === group))
    : [];
  const bySlug = slugMatches.length > 0 ? slugMatches[0] ?? null : null;

  if (slugMatches.length > 1 && !protocolId) {
    throw new VaultError("VAULT_PROTOCOL_CONFLICT", "slug resolves to multiple protocol records; include group or protocolId.");
  }

  if (byId && bySlug && byId.protocolId !== bySlug.protocolId) {
    throw new VaultError("VAULT_PROTOCOL_CONFLICT", "protocolId and slug resolve to different protocol records.");
  }

  return byId ?? bySlug;
}

async function resolveProtocolRecord(input: ReadProtocolItemInput): Promise<ProtocolItemRecord> {
  const normalizedProtocolId = normalizeId(input.protocolId, "protocolId", "prot");
  const normalizedSlug = normalizeSelectorSlug(input.slug);
  const normalizedGroup = input.group ? normalizeGroupPath(input.group, "protocol") : undefined;
  const records = await loadProtocolItems(input.vaultRoot);
  const match = records.find((record) => {
    if (normalizedProtocolId && record.protocolId === normalizedProtocolId) {
      return true;
    }

    if (!normalizedSlug) {
      return false;
    }

    if (record.slug !== normalizedSlug) {
      return false;
    }

    return normalizedGroup ? record.group === normalizedGroup : true;
  });

  if (!match) {
    throw new VaultError("VAULT_PROTOCOL_MISSING", "Protocol item was not found.");
  }

  if (normalizedSlug && !normalizedGroup && !normalizedProtocolId) {
    const collisions = records.filter((record) => record.slug === normalizedSlug);
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
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const kind = resolveRequiredUpsertValue(input.kind, existingRecord?.kind, "medication", (value) =>
    optionalEnum(value, PROTOCOL_KINDS, "kind") ?? "medication",
  );
  const group = existingRecord?.group ?? requestedGroup ?? normalizeGroupPath(undefined, kind);
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: normalizedProtocolId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    allowSlugUpdate: input.allowSlugRename === true,
    directory: `${PROTOCOLS_DIRECTORY}/${group}`,
    getRecordId: (record) => record.protocolId,
    createRecordId: () => generateRecordId("prot"),
  });
  const attributes = buildAttributes(
    validateProtocolTiming(
      stripUndefined({
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        docType: PROTOCOL_DOC_TYPE,
        protocolId: target.recordId,
        slug: target.slug,
        title,
        kind,
        status: resolveRequiredUpsertValue(input.status, existingRecord?.status, "active", (value) =>
          optionalEnum(value, PROTOCOL_STATUSES, "status") ?? "active",
        ),
        startedOn:
          optionalDateOnly(input.startedOn ?? existingRecord?.startedOn ?? today, "startedOn") ?? "",
        stoppedOn: resolveOptionalUpsertValue(input.stoppedOn, existingRecord?.stoppedOn, (value) =>
          optionalDateOnly(value, "stoppedOn"),
        ),
        substance: resolveOptionalUpsertValue(input.substance, existingRecord?.substance, (value) =>
          optionalString(value, "substance", 160),
        ),
        dose: resolveOptionalUpsertValue(input.dose, existingRecord?.dose, (value) =>
          optionalFiniteNumber(value, "dose", 0),
        ),
        unit: resolveOptionalUpsertValue(input.unit, existingRecord?.unit, (value) =>
          optionalString(value, "unit", 40),
        ),
        schedule: resolveOptionalUpsertValue(input.schedule, existingRecord?.schedule, (value) =>
          optionalString(value, "schedule", 160),
        ),
        brand: resolveOptionalUpsertValue(input.brand, existingRecord?.brand, (value) =>
          optionalString(value, "brand", 160),
        ),
        manufacturer: resolveOptionalUpsertValue(
          input.manufacturer,
          existingRecord?.manufacturer,
          (value) => optionalString(value, "manufacturer", 160),
        ),
        servingSize: resolveOptionalUpsertValue(input.servingSize, existingRecord?.servingSize, (value) =>
          optionalString(value, "servingSize", 160),
        ),
        ingredients: resolveOptionalUpsertValue(input.ingredients, existingRecord?.ingredients, (value) =>
          normalizeSupplementIngredients(value),
        ),
        relatedGoalIds: resolveOptionalUpsertValue(
          input.relatedGoalIds,
          existingRecord?.relatedGoalIds,
          (value) => normalizeRecordIdList(value, "relatedGoalIds", "goal"),
        ),
        relatedConditionIds: resolveOptionalUpsertValue(
          input.relatedConditionIds,
          existingRecord?.relatedConditionIds,
          (value) => normalizeRecordIdList(value, "relatedConditionIds", "cond"),
        ),
      }) as ProtocolItemRecord,
    ),
  );
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes,
    body: buildBody({
      ...attributes,
      group,
      relativePath: target.relativePath,
      markdown: existingRecord?.markdown ?? "",
    } as ProtocolItemRecord),
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

export async function listProtocolItems(vaultRoot: string): Promise<ProtocolItemRecord[]> {
  return loadProtocolItems(vaultRoot);
}

export async function readProtocolItem(input: ReadProtocolItemInput): Promise<ProtocolItemRecord> {
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
  const updatedRecord = validateProtocolTiming({
    ...current,
    status: "stopped",
    stoppedOn,
  });
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target: {
      recordId: updatedRecord.protocolId,
      slug: updatedRecord.slug,
      relativePath: updatedRecord.relativePath,
      created: false,
    },
    attributes: buildAttributes(updatedRecord),
    body: buildBody(updatedRecord),
    recordFromParts: parseProtocolItemRecord,
    operationType: "protocol_stop",
    summary: `Stop protocol ${updatedRecord.protocolId}`,
    audit: {
      action: "protocol_stop",
      commandName: "core.stopProtocolItem",
      summary: `Stopped protocol ${updatedRecord.protocolId}.`,
      targetIds: [updatedRecord.protocolId],
    },
  });

  return {
    auditPath,
    record,
  };
}
