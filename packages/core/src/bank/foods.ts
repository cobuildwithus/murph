import { VaultError } from "../errors.js";
import { generateRecordId } from "../ids.js";
import { createMarkdownRegistryApi } from "../registry/api.js";

import {
  FOODS_DIRECTORY,
  FOOD_DOC_TYPE,
  FOOD_SCHEMA_VERSION,
  FOOD_STATUSES,
} from "./types.js";
import {
  buildDocumentFromAttributes,
  buildMarkdownBody,
  detailList,
  listSection,
  normalizeDomainList,
  normalizeId,
  normalizeSelectorSlug,
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
} from "./shared.js";

import type { FrontmatterObject } from "../types.js";
import type {
  FoodAutoLogDailyRule,
  FoodRecord,
  FoodStatus,
  ReadFoodInput,
  UpsertFoodInput,
  UpsertFoodResult,
} from "./types.js";

const DAILY_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function normalizeFoodTextList(
  value: unknown,
  fieldName: string,
  maxItems = 100,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an array.`);
  }

  if (value.length > maxItems) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} exceeds the maximum item count.`);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  value.forEach((entry, index) => {
    const item = requireString(entry, `${fieldName}[${index}]`, 4000);

    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  });

  return normalized.length > 0 ? normalized : undefined;
}

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
    aliases: normalizeFoodTextList(attributes.aliases, "aliases"),
    ingredients: normalizeFoodTextList(attributes.ingredients, "ingredients"),
    tags: normalizeDomainList(attributes.tags, "tags"),
    note: optionalString(attributes.note, "note", 4000),
    autoLogDaily: normalizeFoodAutoLogDailyRule(attributes.autoLogDaily),
    relativePath,
    markdown,
  });
}

function buildAttributes(record: FoodRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: FOOD_SCHEMA_VERSION,
    docType: FOOD_DOC_TYPE,
    foodId: record.foodId,
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
    autoLogDaily: record.autoLogDaily,
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
            normalizeFoodTextList(value, "aliases"),
          ),
          ingredients: resolveOptionalUpsertValue(input.ingredients, existingRecord?.ingredients, (value) =>
            normalizeFoodTextList(value, "ingredients"),
          ),
          tags: resolveOptionalUpsertValue(input.tags, existingRecord?.tags, (value) =>
            normalizeDomainList(value, "tags"),
          ),
          note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
            optionalString(value, "note", 4000),
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
