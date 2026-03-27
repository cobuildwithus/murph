import { VaultError } from "../errors.js";
import { generateRecordId } from "../ids.js";
import { createMarkdownRegistryApi } from "../registry/api.js";

import {
  RECIPE_DOC_TYPE,
  RECIPES_DIRECTORY,
  RECIPE_SCHEMA_VERSION,
  RECIPE_STATUSES,
} from "./types.js";
import {
  buildDocumentFromAttributes,
  buildMarkdownBody,
  detailList,
  listSection,
  normalizeDomainList,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUpsertSelectorSlug,
  optionalEnum,
  optionalFiniteNumber,
  optionalInteger,
  optionalString,
  requireMatchingDocType,
  requireString,
  resolveOptionalUpsertValue,
  resolveRequiredUpsertValue,
  section,
  stripUndefined,
  normalizeId,
} from "./shared.js";

import type { FrontmatterObject } from "../types.js";
import type {
  DeleteRecipeInput,
  DeleteRecipeResult,
  ReadRecipeInput,
  RecipeRecord,
  RecipeStatus,
  UpsertRecipeInput,
  UpsertRecipeResult,
} from "./types.js";

function normalizeRecipeTextList(
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

function normalizeRecipeStatus(value: unknown): RecipeStatus {
  return optionalEnum(value, RECIPE_STATUSES, "status") ?? "saved";
}

function normalizeRecipeTimeMinutes(value: unknown, fieldName: string): number | undefined {
  return optionalInteger(value, fieldName, 0);
}

function numberedList(values: readonly string[]): string {
  return values.map((value, index) => `${index + 1}. ${value}`).join("\n");
}

function formatMinutes(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value} min`;
}

function buildBody(record: RecipeRecord): string {
  const sections = [
    record.summary ? section("Summary", record.summary) : null,
    record.ingredients?.length ? listSection("Ingredients", record.ingredients) : null,
    record.steps?.length ? section("Steps", numberedList(record.steps)) : null,
    listSection("Tags", record.tags),
    listSection("Related Goals", record.relatedGoalIds),
    listSection("Related Conditions", record.relatedConditionIds),
  ].filter((sectionValue): sectionValue is string => Boolean(sectionValue));

  return buildMarkdownBody(
    record.title,
    detailList([
      ["Status", record.status],
      ["Cuisine", record.cuisine],
      ["Dish type", record.dishType],
      ["Source", record.source],
      ["Servings", record.servings],
      ["Prep time", formatMinutes(record.prepTimeMinutes)],
      ["Cook time", formatMinutes(record.cookTimeMinutes)],
      ["Total time", formatMinutes(record.totalTimeMinutes)],
    ]),
    sections,
  );
}

function parseRecipeRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): RecipeRecord {
  requireMatchingDocType(
    attributes,
    RECIPE_SCHEMA_VERSION,
    RECIPE_DOC_TYPE,
    "VAULT_INVALID_RECIPE",
    "Recipe registry document has an unexpected shape.",
  );

  return stripUndefined({
    schemaVersion: RECIPE_SCHEMA_VERSION,
    docType: RECIPE_DOC_TYPE,
    recipeId: requireString(attributes.recipeId, "recipeId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", 160),
    status: normalizeRecipeStatus(attributes.status),
    summary: optionalString(attributes.summary, "summary", 4000),
    cuisine: optionalString(attributes.cuisine, "cuisine", 160),
    dishType: optionalString(attributes.dishType, "dishType", 160),
    source: optionalString(attributes.source, "source", 240),
    servings: optionalFiniteNumber(attributes.servings, "servings", 0),
    prepTimeMinutes: normalizeRecipeTimeMinutes(attributes.prepTimeMinutes, "prepTimeMinutes"),
    cookTimeMinutes: normalizeRecipeTimeMinutes(attributes.cookTimeMinutes, "cookTimeMinutes"),
    totalTimeMinutes: normalizeRecipeTimeMinutes(attributes.totalTimeMinutes, "totalTimeMinutes"),
    tags: normalizeDomainList(attributes.tags, "tags"),
    ingredients: normalizeRecipeTextList(attributes.ingredients, "ingredients"),
    steps: normalizeRecipeTextList(attributes.steps, "steps"),
    relatedGoalIds: normalizeRecordIdList(attributes.relatedGoalIds, "relatedGoalIds", "goal"),
    relatedConditionIds: normalizeRecordIdList(attributes.relatedConditionIds, "relatedConditionIds", "cond"),
    relativePath,
    markdown,
  });
}

function buildAttributes(record: RecipeRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: RECIPE_SCHEMA_VERSION,
    docType: RECIPE_DOC_TYPE,
    recipeId: record.recipeId,
    slug: record.slug,
    title: record.title,
    status: record.status,
    summary: record.summary,
    cuisine: record.cuisine,
    dishType: record.dishType,
    source: record.source,
    servings: record.servings,
    prepTimeMinutes: record.prepTimeMinutes,
    cookTimeMinutes: record.cookTimeMinutes,
    totalTimeMinutes: record.totalTimeMinutes,
    tags: record.tags,
    ingredients: record.ingredients,
    steps: record.steps,
    relatedGoalIds: record.relatedGoalIds,
    relatedConditionIds: record.relatedConditionIds,
  }) as FrontmatterObject;
}

const recipeRegistryApi = createMarkdownRegistryApi<RecipeRecord>({
  directory: RECIPES_DIRECTORY,
  recordFromParts: parseRecipeRecord,
  isExpectedRecord: (record) => record.docType === RECIPE_DOC_TYPE && record.schemaVersion === RECIPE_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_RECIPE",
  invalidMessage: "Recipe registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) =>
        left.title.localeCompare(right.title) ||
        left.slug.localeCompare(right.slug) ||
        left.recipeId.localeCompare(right.recipeId),
    ),
  getRecordId: (record) => record.recipeId,
  conflictCode: "VAULT_RECIPE_CONFLICT",
  conflictMessage: "Recipe id and slug resolve to different records.",
  readMissingCode: "VAULT_RECIPE_MISSING",
  readMissingMessage: "Recipe was not found.",
  createRecordId: () => generateRecordId("rcp"),
  operationType: "recipe_upsert",
  summary: (recordId) => `Upsert recipe ${recordId}`,
  deleteOperationType: "recipe_delete",
  deleteSummary: (recordId) => `Delete recipe ${recordId}`,
  audit: {
    action: "recipe_upsert",
    commandName: "core.upsertRecipe",
    summary: (_created, recordId) => `Upserted recipe ${recordId}.`,
  },
});

export async function upsertRecipe(input: UpsertRecipeInput): Promise<UpsertRecipeResult> {
  const normalizedRecipeId = normalizeId(input.recipeId, "recipeId", "rcp");
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = await recipeRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedRecipeId,
    slug: requestedSlug,
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const prepTimeMinutes = resolveOptionalUpsertValue(
    input.prepTimeMinutes,
    existingRecord?.prepTimeMinutes,
    (value) => normalizeRecipeTimeMinutes(value, "prepTimeMinutes"),
  );
  const cookTimeMinutes = resolveOptionalUpsertValue(
    input.cookTimeMinutes,
    existingRecord?.cookTimeMinutes,
    (value) => normalizeRecipeTimeMinutes(value, "cookTimeMinutes"),
  );
  const requestedTotalTimeMinutes = resolveOptionalUpsertValue(
    input.totalTimeMinutes,
    existingRecord?.totalTimeMinutes,
    (value) => normalizeRecipeTimeMinutes(value, "totalTimeMinutes"),
  );
  const totalTimeMinutes =
    requestedTotalTimeMinutes ??
    (prepTimeMinutes !== undefined && cookTimeMinutes !== undefined
      ? prepTimeMinutes + cookTimeMinutes
      : undefined);

  return recipeRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedRecipeId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    allowSlugUpdate: input.allowSlugRename === true,
    buildDocument: (target) => {
      const attributes = buildAttributes(
        stripUndefined({
          schemaVersion: RECIPE_SCHEMA_VERSION,
          docType: RECIPE_DOC_TYPE,
          recipeId: target.recordId,
          slug: target.slug,
          title,
          status: resolveRequiredUpsertValue(input.status, existingRecord?.status, "saved", normalizeRecipeStatus),
          summary: resolveOptionalUpsertValue(input.summary, existingRecord?.summary, (value) =>
            optionalString(value, "summary", 4000),
          ),
          cuisine: resolveOptionalUpsertValue(input.cuisine, existingRecord?.cuisine, (value) =>
            optionalString(value, "cuisine", 160),
          ),
          dishType: resolveOptionalUpsertValue(input.dishType, existingRecord?.dishType, (value) =>
            optionalString(value, "dishType", 160),
          ),
          source: resolveOptionalUpsertValue(input.source, existingRecord?.source, (value) =>
            optionalString(value, "source", 240),
          ),
          servings: resolveOptionalUpsertValue(input.servings, existingRecord?.servings, (value) =>
            optionalFiniteNumber(value, "servings", 0),
          ),
          prepTimeMinutes,
          cookTimeMinutes,
          totalTimeMinutes,
          tags: resolveOptionalUpsertValue(input.tags, existingRecord?.tags, (value) =>
            normalizeDomainList(value, "tags"),
          ),
          ingredients: resolveOptionalUpsertValue(input.ingredients, existingRecord?.ingredients, (value) =>
            normalizeRecipeTextList(value, "ingredients"),
          ),
          steps: resolveOptionalUpsertValue(input.steps, existingRecord?.steps, (value) =>
            normalizeRecipeTextList(value, "steps"),
          ),
          relatedGoalIds: resolveOptionalUpsertValue(input.relatedGoalIds, existingRecord?.relatedGoalIds, (value) =>
            normalizeRecordIdList(value, "relatedGoalIds", "goal"),
          ),
          relatedConditionIds: resolveOptionalUpsertValue(
            input.relatedConditionIds,
            existingRecord?.relatedConditionIds,
            (value) => normalizeRecordIdList(value, "relatedConditionIds", "cond"),
          ),
        }) as RecipeRecord,
      );

      return buildDocumentFromAttributes<FrontmatterObject, RecipeRecord>({
        attributes,
        relativePath: target.relativePath,
        markdown: existingRecord?.markdown,
        buildBody,
      });
    },
  });
}

export async function listRecipes(vaultRoot: string): Promise<RecipeRecord[]> {
  return recipeRegistryApi.listRecords(vaultRoot);
}

export async function readRecipe({ vaultRoot, recipeId, slug }: ReadRecipeInput): Promise<RecipeRecord> {
  const normalizedRecipeId = normalizeId(recipeId, "recipeId", "rcp");
  const normalizedSlug = normalizeSelectorSlug(slug);

  return recipeRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedRecipeId,
    slug: normalizedSlug,
  });
}

export async function deleteRecipe({ vaultRoot, recipeId, slug }: DeleteRecipeInput): Promise<DeleteRecipeResult> {
  const normalizedRecipeId = normalizeId(recipeId, "recipeId", "rcp");
  const normalizedSlug = normalizeSelectorSlug(slug);
  const result = await recipeRegistryApi.deleteRecord({
    vaultRoot,
    recordId: normalizedRecipeId,
    slug: normalizedSlug,
  });

  return {
    recipeId: result.record.recipeId,
    relativePath: result.record.relativePath,
    deleted: true,
  };
}
