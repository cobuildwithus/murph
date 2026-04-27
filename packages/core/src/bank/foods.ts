import {
  extractBankEntityRegistryLinks,
  type FoodUpsertPayload,
} from "@murphai/contracts";

import { generateRecordId } from "../ids.ts";
import {
  normalizeFoodNutrition,
} from "../nutrition.ts";
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
  frontmatterLinkObjects,
  listSection,
  normalizeDomainList,
  normalizeId,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUniqueTextList,
  normalizeUpsertSelectorSlug,
  optionalEnum,
  optionalString,
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
  FoodLink,
  FoodLinkType,
  FoodRecord,
  FoodStatus,
  ReadFoodInput,
  UpsertFoodInput,
  UpsertFoodResult,
} from "./types.ts";

function normalizeFoodStatus(value: unknown): FoodStatus {
  return optionalEnum(value, FOOD_STATUSES, "status") ?? "active";
}

function buildBody(record: FoodRecord): string {
  const relations = canonicalizeFoodRelations(record);
  const nutritionLines = [
    record.nutrition?.perServing?.calories !== undefined
      ? `Calories: ${record.nutrition.perServing.calories}`
      : null,
    record.nutrition?.perServing?.proteinGrams !== undefined
      ? `Protein: ${record.nutrition.perServing.proteinGrams} g`
      : null,
    record.nutrition?.perServing?.carbsGrams !== undefined
      ? `Carbs: ${record.nutrition.perServing.carbsGrams} g`
      : null,
    record.nutrition?.perServing?.fatGrams !== undefined
      ? `Fat: ${record.nutrition.perServing.fatGrams} g`
      : null,
    record.nutrition?.perServing?.fiberGrams !== undefined
      ? `Fiber: ${record.nutrition.perServing.fiberGrams} g`
      : null,
    record.nutrition?.provenance?.source ? `Source: ${record.nutrition.provenance.source}` : null,
    record.nutrition?.provenance?.confidence
      ? `Confidence: ${record.nutrition.provenance.confidence}`
      : null,
    record.nutrition?.provenance?.sourceDetail
      ? `Source detail: ${record.nutrition.provenance.sourceDetail}`
      : null,
  ].filter((line): line is string => Boolean(line));
  const sections = [
    record.summary ? section("Summary", record.summary) : null,
    record.aliases?.length ? listSection("Aliases", record.aliases) : null,
    record.ingredients?.length ? listSection("Ingredients", record.ingredients) : null,
    nutritionLines.length ? listSection("Nutrition per serving", nutritionLines) : null,
    listSection("Tags", record.tags),
    listSection("Attached regimens", relations.attachedRegimenIds),
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
    ]),
    sections,
  );
}

function normalizeFoodLinkType(value: string): FoodLinkType | null {
  return value === "related_regimen" ? value : null;
}

function compareFoodLinks(left: FoodLink, right: FoodLink): number {
  return left.targetId.localeCompare(right.targetId);
}

function buildFoodLinksFromFields(input: {
  attachedRegimenIds?: string[];
}): FoodLink[] {
  return (input.attachedRegimenIds ?? []).map((targetId) => ({
    type: "related_regimen",
    targetId,
  }) satisfies FoodLink);
}

function normalizeFoodLinks(rawLinks: readonly FoodLink[]): FoodLink[] {
  const sortedLinks = [...rawLinks].sort(compareFoodLinks);
  const links: FoodLink[] = [];
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

function parseFoodLinks(attributes: FrontmatterObject): FoodLink[] {
  return normalizeFoodLinks(
    extractBankEntityRegistryLinks("food", attributes).flatMap((link) => {
      const type = normalizeFoodLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies FoodLink] : [];
    }),
  );
}

function foodRelationsFromLinks(
  links: readonly FoodLink[],
): Pick<FoodRecord, "attachedRegimenIds" | "links"> {
  const attachedRegimenIds = links.map((link) => link.targetId);

  return {
    attachedRegimenIds: attachedRegimenIds.length > 0 ? attachedRegimenIds : undefined,
    links: [...links],
  };
}

function canonicalizeFoodRelations(input: {
  links?: readonly FoodLink[];
  attachedRegimenIds?: string[];
}): Pick<FoodRecord, "attachedRegimenIds" | "links"> {
  const links = normalizeFoodLinks(
    input.links !== undefined
      ? [...input.links]
      : buildFoodLinksFromFields({
          attachedRegimenIds: input.attachedRegimenIds,
        }),
  );

  return foodRelationsFromLinks(links);
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

  const relations = canonicalizeFoodRelations({
    links: parseFoodLinks(attributes),
    attachedRegimenIds: normalizeRecordIdList(attributes.attachedRegimenIds, "attachedRegimenIds", "reg"),
  });

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
    nutrition: normalizeFoodNutrition(attributes.nutrition, "nutrition"),
    aliases: normalizeUniqueTextList(attributes.aliases, "aliases"),
    ingredients: normalizeUniqueTextList(attributes.ingredients, "ingredients"),
    tags: normalizeDomainList(attributes.tags, "tags"),
    note: optionalString(attributes.note, "note", 4000),
    attachedRegimenIds: relations.attachedRegimenIds,
    links: relations.links,
    relativePath,
    markdown,
  });
}

export function foodRecordToBasePayload(record: FoodRecord): Omit<FoodUpsertPayload, "foodId"> {
  const relations = canonicalizeFoodRelations(record);

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
    nutrition: record.nutrition,
    aliases: record.aliases,
    ingredients: record.ingredients,
    tags: record.tags,
    note: record.note,
    attachedRegimenIds: relations.attachedRegimenIds,
    links: frontmatterLinkObjects(relations.links),
  }) as Omit<FoodUpsertPayload, "foodId">;
}

function buildAttributes(record: FoodRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: FOOD_SCHEMA_VERSION,
    docType: FOOD_DOC_TYPE,
    foodId: record.foodId,
    ...foodRecordToBasePayload(record),
  }) as FrontmatterObject;
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
  getRecordSlug: (record) => record.slug,
  getRecordRelativePath: (record) => record.relativePath,
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
  deleteAudit: {
    action: "food_delete",
    commandName: "core.deleteFood",
    summary: (recordId) => `Deleted food ${recordId}.`,
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
      const attachedRegimenIds = resolveOptionalUpsertValue(
        input.attachedRegimenIds,
        existingRecord?.attachedRegimenIds,
        (value) => normalizeRecordIdList(value, "attachedRegimenIds", "reg"),
      );
      const usesRelationInputs =
        input.links !== undefined ||
        input.attachedRegimenIds !== undefined;
      const relations = canonicalizeFoodRelations({
        links: input.links !== undefined ? input.links : usesRelationInputs ? undefined : existingRecord?.links,
        attachedRegimenIds,
      });
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
          nutrition: resolveOptionalUpsertValue(
            input.nutrition,
            existingRecord?.nutrition,
            (value) => normalizeFoodNutrition(value, "nutrition"),
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
          attachedRegimenIds: relations.attachedRegimenIds,
          links: relations.links,
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
