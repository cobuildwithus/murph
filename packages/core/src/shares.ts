import {
  assertContract,
  foodUpsertPayloadSchema,
  protocolUpsertPayloadSchema,
  recipeUpsertPayloadSchema,
  sharePackFoodPayloadSchema,
  sharePackSchema,
  type SharePack,
  type SharePackEntity,
} from "@murph/contracts";

import { generateRecordId } from "./ids.ts";
import { addMeal } from "./public-mutations.ts";
import { foodRecordToBasePayload, readFood, upsertFood } from "./bank/foods.ts";
import { protocolRecordToUpsertPayload, readProtocolItem, upsertProtocolItem } from "./bank/protocols.ts";
import { readRecipe, recipeRecordToUpsertPayload, upsertRecipe } from "./bank/recipes.ts";

import type { DateInput } from "./types.ts";
import type {
  FoodRecord,
  ProtocolItemEntity,
  ProtocolItemStoredDocument,
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
  protocols?: ShareEntitySelector[];
  recipes?: ShareEntitySelector[];
  includeAttachedProtocols?: boolean;
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
  protocols: ProtocolItemEntity[];
  recipes: RecipeRecord[];
  meal: Awaited<ReturnType<typeof addMeal>> | null;
}

export async function buildSharePackFromVault(
  input: BuildSharePackFromVaultInput,
): Promise<SharePack> {
  const entities: SharePackEntity[] = [];
  const includeAttachedProtocols = input.includeAttachedProtocols !== false;
  const protocolRefsById = new Map<string, string>();
  const foodRefsById = new Map<string, string>();
  const recipeRefsById = new Map<string, string>();

  const addProtocolRecord = (record: ProtocolItemStoredDocument): string => {
    const existing = protocolRefsById.get(record.entity.protocolId);

    if (existing) {
      return existing;
    }

    const ref = buildProtocolRef(record);
    const payload = assertContract(
      protocolUpsertPayloadSchema,
      protocolRecordToUpsertPayload(record.entity),
      `protocol payload ${record.entity.protocolId}`,
    );

    entities.push({
      kind: "protocol",
      ref,
      payload,
    });
    protocolRefsById.set(record.entity.protocolId, ref);
    return ref;
  };

  const addFoodRecord = async (record: FoodRecord): Promise<string> => {
    const existing = foodRefsById.get(record.foodId);

    if (existing) {
      return existing;
    }

    const attachedProtocolRefs: string[] = [];

    if (includeAttachedProtocols) {
      for (const protocolId of record.attachedProtocolIds ?? []) {
        const protocol = await readProtocolItem({
          vaultRoot: input.vaultRoot,
          protocolId,
        });
        attachedProtocolRefs.push(addProtocolRecord(protocol));
      }
    }

    const ref = buildFoodRef(record);
    const { attachedProtocolIds: _attachedProtocolIds, ...foodPayload } = foodRecordToBasePayload(record);
    const payload = assertContract(
      sharePackFoodPayloadSchema,
      stripUndefined({
        ...foodPayload,
        attachedProtocolRefs: attachedProtocolRefs.length > 0 ? attachedProtocolRefs : undefined,
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

  for (const selector of input.protocols ?? []) {
    const protocol = await readProtocolItem({
      vaultRoot: input.vaultRoot,
      protocolId: selector.id,
      slug: selector.slug,
      group: selector.group,
    });
    addProtocolRecord(protocol);
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
  const protocolIdsByRef = new Map<string, string>();
  const foods: FoodRecord[] = [];
  const protocols: ProtocolItemEntity[] = [];
  const recipes: RecipeRecord[] = [];

  for (const entity of pack.entities) {
    if (entity.kind !== "protocol") {
      continue;
    }

    const payload = assertContract(protocolUpsertPayloadSchema, entity.payload, `protocol ${entity.ref}`);
    const protocolId = generateRecordId("prot");
    const result = await upsertProtocolItem({
      vaultRoot: input.vaultRoot,
      ...payload,
      protocolId,
      slug: buildImportedSlug(payload.slug ?? payload.title, protocolId),
    });

    protocolIdsByRef.set(entity.ref, result.record.entity.protocolId);
    protocols.push(result.record.entity);
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

    const attachedProtocolIds = (entity.payload.attachedProtocolRefs ?? []).map((ref) => {
      const protocolId = protocolIdsByRef.get(ref);

      if (!protocolId) {
        throw new TypeError(`Food share entity ${entity.ref} references missing protocol ref ${ref}.`);
      }

      return protocolId;
    });
    const { attachedProtocolRefs, ...foodPayload } = entity.payload;
    const payload = assertContract(
      foodUpsertPayloadSchema,
      stripUndefined({
        ...foodPayload,
        attachedProtocolIds: attachedProtocolIds.length > 0 ? attachedProtocolIds : undefined,
      }),
      `food ${entity.ref}`,
    );
    const foodId = generateRecordId("food");
    const result = await upsertFood({
      vaultRoot: input.vaultRoot,
      ...payload,
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
    protocols,
    recipes,
    meal,
  };
}

function buildFoodRef(record: FoodRecord): string {
  return `food:${sanitizeRefSegment(record.slug || record.foodId)}`;
}

function buildRecipeRef(record: RecipeRecord): string {
  return `recipe:${sanitizeRefSegment(record.slug || record.recipeId)}`;
}

function buildProtocolRef(record: ProtocolItemStoredDocument): string {
  return `protocol:${sanitizeRefSegment(record.entity.group)}:${sanitizeRefSegment(record.entity.slug || record.entity.protocolId)}`;
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
