import {
  assertContract,
  foodUpsertPayloadSchema,
  regimenUpsertPayloadSchema,
  recipeUpsertPayloadSchema,
  sharePackFoodPayloadSchema,
  sharePackSchema,
  type SharePack,
  type SharePackEntity,
} from "@murphai/contracts";

import { generateRecordId } from "./ids.ts";
import { addMeal } from "./public-mutations.ts";
import { foodRecordToBasePayload, readFood, upsertFood } from "./bank/foods.ts";
import { regimenRecordToUpsertPayload, readRegimen, upsertRegimen } from "./bank/regimens.ts";
import { readRecipe, recipeRecordToUpsertPayload, upsertRecipe } from "./bank/recipes.ts";

import type { DateInput } from "./types.ts";
import type {
  FoodLink,
  FoodRecord,
  RegimenLink,
  RegimenEntity,
  RegimenStoredDocument,
  RecipeLink,
  RecipeRecord,
} from "./bank/types.ts";

export interface ShareEntitySelector {
  id?: string;
  slug?: string;
  group?: string;
}

export interface BuildSharePackFromVaultInput {
  vaultRoot: string;
  title?: string;
  foods?: ShareEntitySelector[];
  regimens?: ShareEntitySelector[];
  recipes?: ShareEntitySelector[];
  includeAttachedRegimens?: boolean;
  logMeal?: {
    food?: ShareEntitySelector;
    note?: string;
    occurredAt?: DateInput;
  } | null;
}

export interface ImportSharePackIntoVaultInput {
  vaultRoot: string;
  pack: SharePack;
}

export interface ImportSharePackIntoVaultResult {
  pack: SharePack;
  foods: FoodRecord[];
  regimens: RegimenEntity[];
  recipes: RecipeRecord[];
  meal: Awaited<ReturnType<typeof addMeal>> | null;
}

export async function buildSharePackFromVault(
  input: BuildSharePackFromVaultInput,
): Promise<SharePack> {
  const entities: SharePackEntity[] = [];
  const includeAttachedRegimens = input.includeAttachedRegimens !== false;
  const regimenRefsById = new Map<string, string>();
  const foodRefsById = new Map<string, string>();
  const recipeRefsById = new Map<string, string>();

  const addRegimenRecord = (record: RegimenStoredDocument): string => {
    const existing = regimenRefsById.get(record.entity.regimenId);

    if (existing) {
      return existing;
    }

    const ref = buildRegimenRef(record);
    const payload = assertContract(
      regimenUpsertPayloadSchema,
      regimenRecordToUpsertPayload(record.entity),
      `regimen payload ${record.entity.regimenId}`,
    );

    entities.push({
      kind: "regimen",
      ref,
      payload,
    });
    regimenRefsById.set(record.entity.regimenId, ref);
    return ref;
  };

  const addFoodRecord = async (record: FoodRecord): Promise<string> => {
    const existing = foodRefsById.get(record.foodId);

    if (existing) {
      return existing;
    }

    const attachedRegimenRefs: string[] = [];

    if (includeAttachedRegimens) {
      for (const regimenId of record.attachedRegimenIds ?? []) {
        const regimen = await readRegimen({
          vaultRoot: input.vaultRoot,
          regimenId,
        });
        attachedRegimenRefs.push(addRegimenRecord(regimen));
      }
    }

    const ref = buildFoodRef(record);
    const { attachedRegimenIds: _attachedRegimenIds, ...foodPayload } = foodRecordToBasePayload(record);
    const payload = assertContract(
      sharePackFoodPayloadSchema,
      stripUndefined({
        ...foodPayload,
        attachedRegimenRefs: attachedRegimenRefs.length > 0 ? attachedRegimenRefs : undefined,
      }),
      `food payload ${record.foodId}`,
    );

    entities.push({
      kind: "food",
      ref,
      payload,
    });
    foodRefsById.set(record.foodId, ref);
    return ref;
  };

  const addRecipeRecord = (record: RecipeRecord): string => {
    const existing = recipeRefsById.get(record.recipeId);

    if (existing) {
      return existing;
    }

    const ref = buildRecipeRef(record);
    const payload = assertContract(
      recipeUpsertPayloadSchema,
      recipeRecordToUpsertPayload(record),
      `recipe payload ${record.recipeId}`,
    );

    entities.push({
      kind: "recipe",
      ref,
      payload,
    });
    recipeRefsById.set(record.recipeId, ref);
    return ref;
  };

  for (const selector of input.regimens ?? []) {
    const regimen = await readRegimen({
      vaultRoot: input.vaultRoot,
      regimenId: selector.id,
      slug: selector.slug,
      group: selector.group,
    });
    addRegimenRecord(regimen);
  }

  for (const selector of input.recipes ?? []) {
    const recipe = await readRecipe({
      vaultRoot: input.vaultRoot,
      recipeId: selector.id,
      slug: selector.slug,
    });
    addRecipeRecord(recipe);
  }

  for (const selector of input.foods ?? []) {
    const food = await readFood({
      vaultRoot: input.vaultRoot,
      foodId: selector.id,
      slug: selector.slug,
    });
    await addFoodRecord(food);
  }

  let logMeal:
    | {
        foodRef: string;
        note?: string;
        occurredAt?: string;
      }
    | undefined;

  if (input.logMeal?.food) {
    const food = await readFood({
      vaultRoot: input.vaultRoot,
      foodId: input.logMeal.food.id,
      slug: input.logMeal.food.slug,
    });
    const foodRef = await addFoodRecord(food);
    logMeal = stripUndefined({
      foodRef,
      note: normalizeOptionalString(input.logMeal.note),
      occurredAt: toOptionalIsoTimestamp(input.logMeal.occurredAt),
    });
  }

  const pack = assertContract(
    sharePackSchema,
    {
      schemaVersion: "murph.share-pack.v1",
      title: normalizeRequiredTitle(input.title, entities),
      createdAt: new Date().toISOString(),
      entities,
      afterImport: logMeal ? { logMeal } : undefined,
    },
    "share pack",
  );

  return pack;
}

export async function importSharePackIntoVault(
  input: ImportSharePackIntoVaultInput,
): Promise<ImportSharePackIntoVaultResult> {
  const pack = assertContract(sharePackSchema, input.pack, "share pack");
  const regimenIdsByRef = new Map<string, string>();
  const foods: FoodRecord[] = [];
  const regimens: RegimenEntity[] = [];
  const recipes: RecipeRecord[] = [];

  for (const entity of pack.entities) {
    if (entity.kind !== "regimen") {
      continue;
    }

    const payload = assertContract(regimenUpsertPayloadSchema, entity.payload, `regimen ${entity.ref}`);
    const regimenId = generateRecordId("reg");
    const result = await upsertRegimen({
      vaultRoot: input.vaultRoot,
      ...payload,
      links: normalizeRegimenLinks(payload.links),
      regimenId,
      slug: buildImportedSlug(payload.slug ?? payload.title, regimenId),
    });

    regimenIdsByRef.set(entity.ref, result.record.entity.regimenId);
    regimens.push(result.record.entity);
  }

  for (const entity of pack.entities) {
    if (entity.kind !== "recipe") {
      continue;
    }

    const payload = assertContract(recipeUpsertPayloadSchema, entity.payload, `recipe ${entity.ref}`);
    const recipeId = generateRecordId("rcp");
    const result = await upsertRecipe({
      vaultRoot: input.vaultRoot,
      ...payload,
      links: normalizeRecipeLinks(payload.links),
      recipeId,
      slug: buildImportedSlug(payload.slug ?? payload.title, recipeId),
    });

    recipes.push(result.record);
  }

  const foodIdsByRef = new Map<string, string>();

  for (const entity of pack.entities) {
    if (entity.kind !== "food") {
      continue;
    }

    const attachedRegimenIds = (entity.payload.attachedRegimenRefs ?? []).map((ref) => {
      const regimenId = regimenIdsByRef.get(ref);

      if (!regimenId) {
        throw new TypeError(`Food share entity ${entity.ref} references missing regimen ref ${ref}.`);
      }

      return regimenId;
    });
    const { attachedRegimenRefs, ...foodPayload } = entity.payload;
    const payload = assertContract(
      foodUpsertPayloadSchema,
      stripUndefined({
        ...foodPayload,
        attachedRegimenIds: attachedRegimenIds.length > 0 ? attachedRegimenIds : undefined,
      }),
      `food ${entity.ref}`,
    );
    const foodId = generateRecordId("food");
    const result = await upsertFood({
      vaultRoot: input.vaultRoot,
      ...payload,
      links: normalizeFoodLinks(payload.links),
      foodId,
      slug: buildImportedSlug(payload.slug ?? payload.title, foodId),
    });

    foodIdsByRef.set(entity.ref, result.record.foodId);
    foods.push(result.record);
  }

  const logMeal = pack.afterImport?.logMeal;
  const meal = logMeal
    ? await addMeal({
        vaultRoot: input.vaultRoot,
        note: buildSharedMealNote({
          foodRef: logMeal.foodRef,
          foodTitle: foods.find((entry) => foodIdsByRef.get(logMeal.foodRef) === entry.foodId)?.title ?? null,
          note: logMeal.note,
        }),
        occurredAt: logMeal.occurredAt,
      })
    : null;

  return {
    pack,
    foods,
    regimens,
    recipes,
    meal,
  };
}

function normalizeFoodLinks(
  links: readonly { type: string; targetId: string }[] | undefined,
): FoodLink[] | undefined {
  if (!links || links.length === 0) {
    return undefined;
  }

  return links.map((link, index) => {
    if (link.type !== "related_regimen") {
      throw new TypeError(`Food share payload links[${index}] has unsupported type "${link.type}".`);
    }

    return {
      type: "related_regimen",
      targetId: link.targetId,
    } satisfies FoodLink;
  });
}

function normalizeRecipeLinks(
  links: readonly { type: string; targetId: string }[] | undefined,
): RecipeLink[] | undefined {
  if (!links || links.length === 0) {
    return undefined;
  }

  return links.map((link, index) => {
    switch (link.type) {
      case "supports_goal":
        return {
          type: "supports_goal",
          targetId: link.targetId,
        } satisfies RecipeLink;
      case "addresses_condition":
        return {
          type: "addresses_condition",
          targetId: link.targetId,
        } satisfies RecipeLink;
      default:
        throw new TypeError(`Recipe share payload links[${index}] has unsupported type "${link.type}".`);
    }
  });
}

function normalizeRegimenLinks(
  links: readonly { type: string; targetId: string }[] | undefined,
): RegimenLink[] | undefined {
  if (!links || links.length === 0) {
    return undefined;
  }

  return links.map((link, index) => {
    switch (link.type) {
      case "supports_goal":
        return {
          type: "supports_goal",
          targetId: link.targetId,
        } satisfies RegimenLink;
      case "addresses_condition":
        return {
          type: "addresses_condition",
          targetId: link.targetId,
        } satisfies RegimenLink;
      case "related_regimen":
        return {
          type: "related_regimen",
          targetId: link.targetId,
        } satisfies RegimenLink;
      default:
        throw new TypeError(`Regimen share payload links[${index}] has unsupported type "${link.type}".`);
    }
  });
}

function buildFoodRef(record: FoodRecord): string {
  return `food:${sanitizeRefSegment(record.slug || record.foodId)}`;
}

function buildRecipeRef(record: RecipeRecord): string {
  return `recipe:${sanitizeRefSegment(record.slug || record.recipeId)}`;
}

function buildRegimenRef(record: RegimenStoredDocument): string {
  return `regimen:${sanitizeRefSegment(record.entity.group)}:${sanitizeRefSegment(record.entity.slug || record.entity.regimenId)}`;
}

function buildSharedMealNote(input: {
  foodRef: string;
  foodTitle: string | null;
  note?: string;
}): string {
  const parts = [
    input.foodTitle ? `Shared meal: ${input.foodTitle}` : `Shared meal: ${input.foodRef}`,
    normalizeOptionalString(input.note),
  ].filter((value): value is string => Boolean(value));

  return parts.join("\n\n");
}

function normalizeRequiredTitle(
  explicitTitle: string | undefined,
  entities: SharePackEntity[],
): string {
  const title = normalizeOptionalString(explicitTitle)
    ?? entities.find((entity) => entity.kind === "food")?.payload.title
    ?? entities[0]?.payload.title;

  if (!title) {
    throw new TypeError("Share packs require at least one entity with a title.");
  }

  return title;
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function sanitizeRefSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\//gu, ":")
    .replace(/[^a-z0-9:._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
}

function buildImportedSlug(baseValue: string, recordId: string): string {
  const slugBase = baseValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  const recordSuffix = recordId.split("_").pop()?.toLowerCase().slice(-8) ?? "shared";

  return `${slugBase || "shared-item"}-shared-${recordSuffix}`;
}

function stripUndefined<TValue extends Record<string, unknown>>(value: TValue): TValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue;
}

function toOptionalIsoTimestamp(value: DateInput | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" || typeof value === "number"
    ? new Date(value).toISOString()
    : undefined;
}
