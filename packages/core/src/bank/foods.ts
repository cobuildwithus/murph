import type { FoodUpsertPayload } from "@murph/contracts";

import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  FOODS_DIRECTORY,
  FOOD_DOC_TYPE,
  FOOD_SCHEMA_VERSION,
  FOOD_STATUSES,
} from "./types.ts";
import {
  buildDocumentFromAttributes,
  buildMarkdownBody,
  detailList,
  listSection,
  normalizeDomainList,
  normalizeId,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUniqueTextList,
  normalizeUpsertSelectorSlug,
  optionalEnum,
  optionalString,
  requireObject,
  requireMatchingDocType,
  requireString,
  resolveOptionalUpsertValue,
  resolveRequiredUpsertValue,
  section,
  stripUndefined,
} from "./shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  DeleteFoodInput,
  DeleteFoodResult,
  FoodAutoLogDailyRule,
  FoodRecord,
  FoodStatus,
  ReadFoodInput,
  UpsertFoodInput,
  UpsertFoodResult,
} from "./types.ts";

const DAILY_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function normalizeFoodStatus(value: unknown): FoodStatus {
  return optionalEnum(value, FOOD_STATUSES, "status") ?? "active";
}

function normalizeFoodAutoLogDailyRule(
  value: unknown,
): FoodAutoLogDailyRule | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const object = requireObject(value, "autoLogDaily");
  const time = requireString(object.time, "autoLogDaily.time", 5);

  if (!DAILY_TIME_PATTERN.test(time)) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "autoLogDaily.time must use 24-hour HH:MM form.",
    );
  }

  return { time };
}

function buildBody(record: FoodRecord): string {
  const sections = [
    record.summary ? section("Summary", record.summary) : null,
    record.aliases?.length ? listSection("Aliases", record.aliases) : null,
    record.ingredients?.length ? listSection("Ingredients", record.ingredients) : null,
    listSection("Tags", record.tags),
    listSection("Attached protocols", record.attachedProtocolIds),
    record.note ? section("Notes", record.note) : null,
  ].filter((sectionValue): sectionValue is string => Boolean(sectionValue));

  return buildMarkdownBody(
    record.title,
    detailList([
      ["Status", record.status],
      ["Kind", record.kind],
      ["Brand", record.brand],
      ["Vendor", record.vendor],
      ["Location", record.location],
      ["Serving", record.serving],
      ["Auto-log daily", record.autoLogDaily?.time],
    ]),
    sections,
  );
}

function parseFoodRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): FoodRecord {
  requireMatchingDocType(
    attributes,
    FOOD_SCHEMA_VERSION,
    FOOD_DOC_TYPE,
    "VAULT_INVALID_FOOD",
    "Food registry document has an unexpected shape.",
  );

  return stripUndefined({
    schemaVersion: FOOD_SCHEMA_VERSION,
    docType: FOOD_DOC_TYPE,
    foodId: requireString(attributes.foodId, "foodId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", 160),
    status: normalizeFoodStatus(attributes.status),
    summary: optionalString(attributes.summary, "summary", 4000),
    kind: optionalString(attributes.kind, "kind", 160),
    brand: optionalString(attributes.brand, "brand", 160),
    vendor: optionalString(attributes.vendor, "vendor", 160),
    location: optionalString(attributes.location, "location", 160),
    serving: optionalString(attributes.serving, "serving", 160),
    aliases: normalizeUniqueTextList(attributes.aliases, "aliases"),
    ingredients: normalizeUniqueTextList(attributes.ingredients, "ingredients"),
    tags: normalizeDomainList(attributes.tags, "tags"),
    note: optionalString(attributes.note, "note", 4000),
    attachedProtocolIds: normalizeRecordIdList(attributes.attachedProtocolIds, "attachedProtocolIds", "prot"),
    autoLogDaily: normalizeFoodAutoLogDailyRule(attributes.autoLogDaily),
    relativePath,
    markdown,
  });
}

export function foodRecordToBasePayload(record: FoodRecord): Omit<FoodUpsertPayload, "foodId"> {
  return stripUndefined({
    slug: record.slug,
    title: record.title,
    status: record.status,
    summary: record.summary,
    kind: record.kind,
    brand: record.brand,
    vendor: record.vendor,
    location: record.location,
    serving: record.serving,
    aliases: record.aliases,
    ingredients: record.ingredients,
    tags: record.tags,
    note: record.note,
    attachedProtocolIds: record.attachedProtocolIds,
    autoLogDaily: record.autoLogDaily,
  }) as Omit<FoodUpsertPayload, "foodId">;
}

function buildAttributes(record: FoodRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: FOOD_SCHEMA_VERSION,
    docType: FOOD_DOC_TYPE,
    foodId: record.foodId,
    ...foodRecordToBasePayload(record),
  }) as unknown as FrontmatterObject;
}

const foodRegistryApi = createMarkdownRegistryApi<FoodRecord>({
  directory: FOODS_DIRECTORY,
  recordFromParts: parseFoodRecord,
  isExpectedRecord: (record) => record.docType === FOOD_DOC_TYPE && record.schemaVersion === FOOD_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_FOOD",
  invalidMessage: "Food registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) =>
        left.title.localeCompare(right.title) ||
        left.slug.localeCompare(right.slug) ||
        left.foodId.localeCompare(right.foodId),
    ),
  getRecordId: (record) => record.foodId,
  conflictCode: "VAULT_FOOD_CONFLICT",
  conflictMessage: "Food id and slug resolve to different records.",
  readMissingCode: "VAULT_FOOD_MISSING",
  readMissingMessage: "Food was not found.",
  createRecordId: () => generateRecordId("food"),
  operationType: "food_upsert",
  summary: (recordId) => `Upsert food ${recordId}`,
  deleteOperationType: "food_delete",
  deleteSummary: (recordId) => `Delete food ${recordId}`,
  audit: {
    action: "food_upsert",
    commandName: "core.upsertFood",
    summary: (_created, recordId) => `Upserted food ${recordId}.`,
  },
});

export async function upsertFood(input: UpsertFoodInput): Promise<UpsertFoodResult> {
  const normalizedFoodId = normalizeId(input.foodId, "foodId", "food");
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = await foodRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedFoodId,
    slug: requestedSlug,
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);

  return foodRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedFoodId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    allowSlugUpdate: input.allowSlugRename === true,
    buildDocument: (target) => {
      const attributes = buildAttributes(
        stripUndefined({
          schemaVersion: FOOD_SCHEMA_VERSION,
          docType: FOOD_DOC_TYPE,
          foodId: target.recordId,
          slug: target.slug,
          title,
          status: resolveRequiredUpsertValue(input.status, existingRecord?.status, "active", normalizeFoodStatus),
          summary: resolveOptionalUpsertValue(input.summary, existingRecord?.summary, (value) =>
            optionalString(value, "summary", 4000),
          ),
          kind: resolveOptionalUpsertValue(input.kind, existingRecord?.kind, (value) =>
            optionalString(value, "kind", 160),
          ),
          brand: resolveOptionalUpsertValue(input.brand, existingRecord?.brand, (value) =>
            optionalString(value, "brand", 160),
          ),
          vendor: resolveOptionalUpsertValue(input.vendor, existingRecord?.vendor, (value) =>
            optionalString(value, "vendor", 160),
          ),
          location: resolveOptionalUpsertValue(input.location, existingRecord?.location, (value) =>
            optionalString(value, "location", 160),
          ),
          serving: resolveOptionalUpsertValue(input.serving, existingRecord?.serving, (value) =>
            optionalString(value, "serving", 160),
          ),
          aliases: resolveOptionalUpsertValue(input.aliases, existingRecord?.aliases, (value) =>
            normalizeUniqueTextList(value, "aliases"),
          ),
          ingredients: resolveOptionalUpsertValue(input.ingredients, existingRecord?.ingredients, (value) =>
            normalizeUniqueTextList(value, "ingredients"),
          ),
          tags: resolveOptionalUpsertValue(input.tags, existingRecord?.tags, (value) =>
            normalizeDomainList(value, "tags"),
          ),
          note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
            optionalString(value, "note", 4000),
          ),
          attachedProtocolIds: resolveOptionalUpsertValue(
            input.attachedProtocolIds,
            existingRecord?.attachedProtocolIds,
            (value) => normalizeRecordIdList(value, "attachedProtocolIds", "prot"),
          ),
          autoLogDaily: resolveOptionalUpsertValue(
            input.autoLogDaily,
            existingRecord?.autoLogDaily,
            (value) => normalizeFoodAutoLogDailyRule(value),
          ),
        }) as FoodRecord,
      );

      return buildDocumentFromAttributes<FrontmatterObject, FoodRecord>({
        attributes,
        relativePath: target.relativePath,
        markdown: existingRecord?.markdown,
        buildBody,
      });
    },
  });
}

export async function listFoods(vaultRoot: string): Promise<FoodRecord[]> {
  return foodRegistryApi.listRecords(vaultRoot);
}

export async function readFood({ vaultRoot, foodId, slug }: ReadFoodInput): Promise<FoodRecord> {
  const normalizedFoodId = normalizeId(foodId, "foodId", "food");
  const normalizedSlug = normalizeSelectorSlug(slug);

  return foodRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedFoodId,
    slug: normalizedSlug,
  });
}

export async function deleteFood({ vaultRoot, foodId, slug }: DeleteFoodInput): Promise<DeleteFoodResult> {
  const normalizedFoodId = normalizeId(foodId, "foodId", "food");
  const normalizedSlug = normalizeSelectorSlug(slug);
  const result = await foodRegistryApi.deleteRecord({
    vaultRoot,
    recordId: normalizedFoodId,
    slug: normalizedSlug,
  });

  return {
    foodId: result.record.foodId,
    relativePath: result.record.relativePath,
    deleted: true,
  };
}
