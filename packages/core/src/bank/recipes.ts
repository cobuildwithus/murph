import {
  extractBankEntityRegistryLinks,
  type RecipeUpsertPayload,
} from "@murphai/contracts";

import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  RECIPE_DOC_TYPE,
  RECIPES_DIRECTORY,
  RECIPE_SCHEMA_VERSION,
  RECIPE_STATUSES,
} from "./types.ts";
import {
  buildDocumentFromAttributes,
  buildMarkdownBody,
  detailList,
  frontmatterLinkObjects,
  listSection,
  normalizeDomainList,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUniqueTextList,
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
} from "./shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  DeleteRecipeInput,
  DeleteRecipeResult,
  ReadRecipeInput,
  RecipeLink,
  RecipeLinkType,
  RecipeRecord,
  RecipeStatus,
  UpsertRecipeInput,
  UpsertRecipeResult,
} from "./types.ts";

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
  const relations = canonicalizeRecipeRelations(record);
  const sections = [
    record.summary ? section("Summary", record.summary) : null,
    record.ingredients?.length ? listSection("Ingredients", record.ingredients) : null,
    record.steps?.length ? section("Steps", numberedList(record.steps)) : null,
    listSection("Tags", record.tags),
    listSection("Related Goals", relations.relatedGoalIds),
    listSection("Related Conditions", relations.relatedConditionIds),
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

function normalizeRecipeLinkType(value: string): RecipeLinkType | null {
  switch (value) {
    case "supports_goal":
    case "addresses_condition":
      return value;
    default:
      return null;
  }
}

function compareRecipeLinks(left: RecipeLink, right: RecipeLink): number {
  const order: Record<RecipeLinkType, number> = {
    supports_goal: 0,
    addresses_condition: 1,
  };

  return order[left.type] - order[right.type] || left.targetId.localeCompare(right.targetId);
}

function buildRecipeLinksFromFields(input: {
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
}): RecipeLink[] {
  return [
    ...(input.relatedGoalIds ?? []).map((targetId) => ({
      type: "supports_goal",
      targetId,
    }) satisfies RecipeLink),
    ...(input.relatedConditionIds ?? []).map((targetId) => ({
      type: "addresses_condition",
      targetId,
    }) satisfies RecipeLink),
  ];
}

function normalizeRecipeLinks(rawLinks: readonly RecipeLink[]): RecipeLink[] {
  const sortedLinks = [...rawLinks].sort(compareRecipeLinks);
  const links: RecipeLink[] = [];
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

function parseRecipeLinks(attributes: FrontmatterObject): RecipeLink[] {
  return normalizeRecipeLinks(
    extractBankEntityRegistryLinks("recipe", attributes).flatMap((link) => {
      const type = normalizeRecipeLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies RecipeLink] : [];
    }),
  );
}

function recipeRelationsFromLinks(
  links: readonly RecipeLink[],
): Pick<RecipeRecord, "relatedGoalIds" | "relatedConditionIds" | "links"> {
  const relatedGoalIds = links
    .filter((link) => link.type === "supports_goal")
    .map((link) => link.targetId);
  const relatedConditionIds = links
    .filter((link) => link.type === "addresses_condition")
    .map((link) => link.targetId);

  return {
    relatedGoalIds: relatedGoalIds.length > 0 ? relatedGoalIds : undefined,
    relatedConditionIds: relatedConditionIds.length > 0 ? relatedConditionIds : undefined,
    links: [...links],
  };
}

function canonicalizeRecipeRelations(input: {
  links?: readonly RecipeLink[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
}): Pick<RecipeRecord, "relatedGoalIds" | "relatedConditionIds" | "links"> {
  const links = normalizeRecipeLinks(
    input.links !== undefined
      ? [...input.links]
      : buildRecipeLinksFromFields({
          relatedGoalIds: input.relatedGoalIds,
          relatedConditionIds: input.relatedConditionIds,
        }),
  );

  return recipeRelationsFromLinks(links);
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

  const relations = canonicalizeRecipeRelations({
    links: parseRecipeLinks(attributes),
  });

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
    ingredients: normalizeUniqueTextList(attributes.ingredients, "ingredients"),
    steps: normalizeUniqueTextList(attributes.steps, "steps"),
    relatedGoalIds: relations.relatedGoalIds,
    relatedConditionIds: relations.relatedConditionIds,
    links: relations.links,
    relativePath,
    markdown,
  });
}

export function recipeRecordToUpsertPayload(
  record: RecipeRecord,
): Omit<RecipeUpsertPayload, "recipeId"> {
  const relations = canonicalizeRecipeRelations(record);

  return stripUndefined({
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
    relatedGoalIds: relations.relatedGoalIds,
    relatedConditionIds: relations.relatedConditionIds,
    links: frontmatterLinkObjects(relations.links),
  }) as Omit<RecipeUpsertPayload, "recipeId">;
}

function buildAttributes(record: RecipeRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: RECIPE_SCHEMA_VERSION,
    docType: RECIPE_DOC_TYPE,
    recipeId: record.recipeId,
    ...recipeRecordToUpsertPayload(record),
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
  getRecordSlug: (record) => record.slug,
  getRecordRelativePath: (record) => record.relativePath,
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
      const relatedGoalIds = resolveOptionalUpsertValue(
        input.relatedGoalIds,
        existingRecord?.relatedGoalIds,
        (value) => normalizeRecordIdList(value, "relatedGoalIds", "goal"),
      );
      const relatedConditionIds = resolveOptionalUpsertValue(
        input.relatedConditionIds,
        existingRecord?.relatedConditionIds,
        (value) => normalizeRecordIdList(value, "relatedConditionIds", "cond"),
      );
      const usesRelationInputs =
        input.links !== undefined ||
        input.relatedGoalIds !== undefined ||
        input.relatedConditionIds !== undefined;
      const relations = canonicalizeRecipeRelations({
        links: input.links !== undefined ? input.links : usesRelationInputs ? undefined : existingRecord?.links,
        relatedGoalIds,
        relatedConditionIds,
      });
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
            normalizeUniqueTextList(value, "ingredients"),
          ),
          steps: resolveOptionalUpsertValue(input.steps, existingRecord?.steps, (value) =>
            normalizeUniqueTextList(value, "steps"),
          ),
          relatedGoalIds: relations.relatedGoalIds,
          relatedConditionIds: relations.relatedConditionIds,
          links: relations.links,
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
