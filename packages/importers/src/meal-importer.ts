import {
  type EventSource,
  type ExternalRef,
  type MealNutrition,
  mealNutritionSchema,
} from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";

import { assertCanonicalWritePort } from "./core-port.ts";
import type { MealImportPayload } from "./core-port.ts";
import {
  inspectFileAsset,
  optionalEventSourceSchema,
  optionalStringListSchema,
  optionalTimestampSchema,
  optionalTrimmedStringSchema,
  parseInputObject,
  stripUndefined,
} from "./shared.ts";

export interface MealImportInput {
  photoPath?: string;
  audioPath?: string;
  vaultRoot?: string;
  occurredAt?: string | number | Date;
  note?: string;
  source?: EventSource;
  ingredients?: string[];
  nutrition?: MealNutrition;
  externalRef?: ExternalRef;
}

export interface ImporterExecutionOptions {
  corePort?: unknown;
}

const externalRefSchema = z
  .object({
    system: z.string().min(1),
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    version: z.string().min(1).optional(),
    facet: z.string().min(1).optional(),
  })
  .strict()

const mealImportInputSchema = z
  .object({
    photoPath: optionalTrimmedStringSchema("photoPath"),
    audioPath: optionalTrimmedStringSchema("audioPath"),
    vaultRoot: optionalTrimmedStringSchema("vaultRoot"),
    occurredAt: optionalTimestampSchema("occurredAt"),
    note: optionalTrimmedStringSchema("note"),
    source: optionalEventSourceSchema("source"),
    ingredients: optionalStringListSchema("ingredients"),
    nutrition: mealNutritionSchema.optional(),
    externalRef: externalRefSchema.optional(),
  })
  .passthrough();

function hasMealNutritionContent(nutrition: MealNutrition | undefined): boolean {
  if (!nutrition) {
    return false;
  }

  return Boolean(
    (nutrition.totals && Object.keys(nutrition.totals).length > 0)
    || (nutrition.provenance && Object.keys(nutrition.provenance).length > 0),
  );
}

export async function prepareMealImport(input: unknown): Promise<MealImportPayload> {
  const request = parseInputObject(
    input,
    "meal import input",
    mealImportInputSchema,
  );
  const hasIngredients = request.ingredients.length > 0;
  const hasNutrition = hasMealNutritionContent(request.nutrition);

  if (!request.photoPath && !request.audioPath && !request.note && !hasIngredients && !hasNutrition) {
    throw new TypeError(
      "meal import input requires at least one of photoPath, audioPath, note, ingredients, or nutrition",
    );
  }

  const photo = request.photoPath
    ? await inspectFileAsset(request.photoPath, "photo")
    : undefined;
  const audio = request.audioPath
    ? await inspectFileAsset(request.audioPath, "audio")
    : undefined;

  return stripUndefined({
    vaultRoot: request.vaultRoot,
    photoPath: photo?.sourcePath,
    audioPath: audio?.sourcePath,
    occurredAt: request.occurredAt,
    note: request.note,
    source: request.source,
    ingredients: hasIngredients ? request.ingredients : undefined,
    nutrition: hasNutrition ? request.nutrition : undefined,
    externalRef: request.externalRef,
  });
}

export async function addMeal<TResult = unknown>(
  input: unknown,
  { corePort }: ImporterExecutionOptions = {},
): Promise<TResult> {
  const writer = assertCanonicalWritePort(corePort, ["addMeal"]);
  const payload = await prepareMealImport(input);
  return (await writer.addMeal(payload)) as TResult;
}
