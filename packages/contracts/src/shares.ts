import * as z from "zod";

import {
  CONTRACT_SCHEMA_VERSION,
  FOOD_STATUSES,
  PROTOCOL_KINDS,
  PROTOCOL_STATUSES,
  RECIPE_STATUSES,
  WORKOUT_FORMAT_STATUSES,
  ID_PREFIXES,
} from "./constants.js";
import { activityStrengthExerciseSchema } from "./zod.js";
import { idPattern } from "./ids.js";
import { isStrictIsoDate, isStrictIsoDateTime } from "./time.js";

function withContractMetadata<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  id: string,
  title: string,
): TSchema {
  return schema.meta({
    $id: id,
    title,
  }) as TSchema;
}

function boundedString(minLength: number, maxLength: number): z.ZodString {
  return z.string().min(minLength).max(maxLength);
}

function patternedString(pattern: string, minLength?: number, maxLength?: number): z.ZodString {
  let schema = z.string();

  if (minLength !== undefined) {
    schema = schema.min(minLength);
  }

  if (maxLength !== undefined) {
    schema = schema.max(maxLength);
  }

  return schema.regex(new RegExp(pattern, "u"));
}

function isoDateString(): z.ZodType<string> {
  return z
    .string()
    .meta({ format: "date" })
    .refine((value) => isStrictIsoDate(value), "Invalid ISO date string.");
}

function isoDateTimeString(): z.ZodType<string> {
  return z
    .string()
    .meta({ format: "date-time" })
    .refine((value) => isStrictIsoDateTime(value), "Invalid ISO date-time string.");
}

function integerSchema(minimum?: number, maximum?: number): z.ZodType<number> {
  let schema = z.number();

  if (minimum !== undefined) {
    schema = schema.min(minimum);
  }

  if (maximum !== undefined) {
    schema = schema.max(maximum);
  }

  return schema
    .meta({ type: "integer" })
    .refine((value) => Number.isInteger(value), "Expected an integer.");
}

function numberSchema(minimum?: number, maximum?: number): z.ZodNumber {
  let schema = z.number();

  if (minimum !== undefined) {
    schema = schema.min(minimum);
  }

  if (maximum !== undefined) {
    schema = schema.max(maximum);
  }

  return schema;
}

function uniqueArray<TSchema extends z.ZodTypeAny>(
  itemSchema: TSchema,
  options: {
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  } = {},
): z.ZodType<z.output<TSchema>[]> {
  let schema = z.array(itemSchema);

  if (options.minItems !== undefined) {
    schema = schema.min(options.minItems);
  }

  if (options.maxItems !== undefined) {
    schema = schema.max(options.maxItems);
  }

  if (options.uniqueItems) {
    schema = schema
      .meta({ uniqueItems: true })
      .superRefine((values, context) => {
        const serialized = values.map((value) => JSON.stringify(value));

        if (new Set(serialized).size !== serialized.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Expected unique array items.",
          });
        }
      });
  }

  return schema;
}

const SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const DAILY_TIME_PATTERN = "^(?:[01]\\d|2[0-3]):[0-5]\\d$";
const UNIT_PATTERN = "^[A-Za-z0-9._/%-]+$";
const GROUP_PATTERN = "^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$";
const SHARE_ENTITY_REF_PATTERN = "^[a-z][a-z0-9:._-]{1,79}$";

const slugSchema = patternedString(SLUG_PATTERN);
const goalIdSchema = patternedString(idPattern(ID_PREFIXES.goal));
const conditionIdSchema = patternedString(idPattern(ID_PREFIXES.condition));
const protocolIdSchema = patternedString(idPattern(ID_PREFIXES.protocol));
const shareEntityRefSchema = patternedString(SHARE_ENTITY_REF_PATTERN);

export const attachedProtocolIdsSchema = uniqueArray(protocolIdSchema, {
  maxItems: 32,
  uniqueItems: true,
}).optional();

export const foodAutoLogDailySchema = z
  .object({
    time: patternedString(DAILY_TIME_PATTERN),
  })
  .strict();

export const supplementIngredientPayloadSchema = z
  .object({
    compound: boundedString(1, 160),
    label: boundedString(1, 160).optional(),
    amount: numberSchema(0).optional(),
    unit: patternedString(UNIT_PATTERN).optional(),
    active: z.boolean().optional(),
    note: boundedString(1, 4000).optional(),
  })
  .strict();

export const foodUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      foodId: patternedString(idPattern(ID_PREFIXES.food)).optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160),
      status: z.enum(FOOD_STATUSES).default("active"),
      summary: boundedString(1, 4000).optional(),
      kind: boundedString(1, 160).optional(),
      brand: boundedString(1, 160).optional(),
      vendor: boundedString(1, 160).optional(),
      location: boundedString(1, 160).optional(),
      serving: boundedString(1, 160).optional(),
      aliases: uniqueArray(boundedString(1, 160), { uniqueItems: true }).optional(),
      ingredients: uniqueArray(boundedString(1, 4000), { maxItems: 100 }).optional(),
      tags: uniqueArray(slugSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
      autoLogDaily: foodAutoLogDailySchema.optional(),
      attachedProtocolIds: attachedProtocolIdsSchema,
    })
    .strict(),
  "@healthybob/contracts/food-upsert-payload.schema.json",
  "Healthy Bob Food Upsert Payload",
);

export const recipeUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      recipeId: patternedString(idPattern(ID_PREFIXES.recipe)).optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160),
      status: z.enum(RECIPE_STATUSES).default("saved"),
      summary: boundedString(1, 4000).optional(),
      cuisine: boundedString(1, 160).optional(),
      dishType: boundedString(1, 160).optional(),
      source: boundedString(1, 240).optional(),
      servings: numberSchema(0).optional(),
      prepTimeMinutes: integerSchema(0).optional(),
      cookTimeMinutes: integerSchema(0).optional(),
      totalTimeMinutes: integerSchema(0).optional(),
      tags: uniqueArray(slugSchema, { uniqueItems: true }).optional(),
      ingredients: uniqueArray(boundedString(1, 4000), { maxItems: 100 }).optional(),
      steps: uniqueArray(boundedString(1, 4000), { maxItems: 100 }).optional(),
      relatedGoalIds: uniqueArray(goalIdSchema, { uniqueItems: true }).optional(),
      relatedConditionIds: uniqueArray(conditionIdSchema, { uniqueItems: true }).optional(),
    })
    .strict(),
  "@healthybob/contracts/recipe-upsert-payload.schema.json",
  "Healthy Bob Recipe Upsert Payload",
);

export const workoutFormatUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      workoutFormatId: patternedString(idPattern(ID_PREFIXES.workoutFormat)).optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160),
      status: z.enum(WORKOUT_FORMAT_STATUSES).default("active"),
      summary: boundedString(1, 4000).optional(),
      activityType: slugSchema,
      durationMinutes: integerSchema(1, 24 * 60).optional(),
      distanceKm: numberSchema(0, 1_000).optional(),
      strengthExercises: uniqueArray(activityStrengthExerciseSchema, {
        maxItems: 50,
      }).optional(),
      tags: uniqueArray(slugSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@healthybob/contracts/workout-format-upsert-payload.schema.json",
  "Healthy Bob Workout Format Upsert Payload",
);

export const protocolUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      protocolId: protocolIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160),
      kind: z.enum(PROTOCOL_KINDS).default("supplement"),
      status: z.enum(PROTOCOL_STATUSES).default("active"),
      startedOn: isoDateString().optional(),
      stoppedOn: isoDateString().optional(),
      substance: boundedString(1, 160).optional(),
      dose: numberSchema(0).optional(),
      unit: patternedString(UNIT_PATTERN).optional(),
      schedule: boundedString(1, 160).optional(),
      brand: boundedString(1, 160).optional(),
      manufacturer: boundedString(1, 160).optional(),
      servingSize: boundedString(1, 160).optional(),
      ingredients: uniqueArray(supplementIngredientPayloadSchema, { maxItems: 64 }).optional(),
      relatedGoalIds: uniqueArray(goalIdSchema, { uniqueItems: true }).optional(),
      relatedConditionIds: uniqueArray(conditionIdSchema, { uniqueItems: true }).optional(),
      group: patternedString(GROUP_PATTERN, 1, 160).optional(),
    })
    .strict(),
  "@healthybob/contracts/protocol-upsert-payload.schema.json",
  "Healthy Bob Protocol Upsert Payload",
);

export const sharePackFoodPayloadSchema = withContractMetadata(
  foodUpsertPayloadSchema
    .omit({
      attachedProtocolIds: true,
      foodId: true,
    })
    .extend({
      attachedProtocolRefs: uniqueArray(shareEntityRefSchema, {
        maxItems: 32,
        uniqueItems: true,
      }).optional(),
    })
    .strict(),
  "@healthybob/contracts/share-pack-food-payload.schema.json",
  "Healthy Bob Share Pack Food Payload",
);

export const sharePackRecipePayloadSchema = withContractMetadata(
  recipeUpsertPayloadSchema.omit({ recipeId: true }).strict(),
  "@healthybob/contracts/share-pack-recipe-payload.schema.json",
  "Healthy Bob Share Pack Recipe Payload",
);

export const sharePackProtocolPayloadSchema = withContractMetadata(
  protocolUpsertPayloadSchema.omit({ protocolId: true }).strict(),
  "@healthybob/contracts/share-pack-protocol-payload.schema.json",
  "Healthy Bob Share Pack Protocol Payload",
);

export const sharePackEntitySchema = withContractMetadata(
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("food"),
        ref: shareEntityRefSchema,
        payload: sharePackFoodPayloadSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("recipe"),
        ref: shareEntityRefSchema,
        payload: sharePackRecipePayloadSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("protocol"),
        ref: shareEntityRefSchema,
        payload: sharePackProtocolPayloadSchema,
      })
      .strict(),
  ]),
  "@healthybob/contracts/share-pack-entity.schema.json",
  "Healthy Bob Share Pack Entity",
);

export const sharePackSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.sharePack),
      title: boundedString(1, 160),
      createdAt: isoDateTimeString().optional(),
      entities: uniqueArray(sharePackEntitySchema, {
        minItems: 1,
        maxItems: 32,
      }),
      afterImport: z
        .object({
          logMeal: z
            .object({
              foodRef: shareEntityRefSchema,
              occurredAt: isoDateTimeString().optional(),
              note: boundedString(1, 4000).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const refs = value.entities.map((entity) => entity.ref);
      const duplicateRefs = refs.filter((ref, index) => refs.indexOf(ref) !== index);

      if (duplicateRefs.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate share entity refs are not allowed: ${[...new Set(duplicateRefs)].join(", ")}.`,
          path: ["entities"],
        });
      }

      const refKinds = new Map(value.entities.map((entity) => [entity.ref, entity.kind] as const));
      value.entities.forEach((entity, index) => {
        if (entity.kind === "food") {
          for (const [attachedIndex, attachedRef] of (entity.payload.attachedProtocolRefs ?? []).entries()) {
            const attachedKind = refKinds.get(attachedRef);

            if (!attachedKind) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Food entity references unknown protocol ref \"${attachedRef}\".`,
                path: ["entities", index, "payload", "attachedProtocolRefs", attachedIndex],
              });
              continue;
            }

            if (attachedKind !== "protocol") {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Food entity refs must target protocol share entities, but \"${attachedRef}\" is a ${attachedKind}.`,
                path: ["entities", index, "payload", "attachedProtocolRefs", attachedIndex],
              });
            }
          }
        }
      });

      const logMealRef = value.afterImport?.logMeal?.foodRef;

      if (logMealRef) {
        const logMealKind = refKinds.get(logMealRef);

        if (!logMealKind) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `afterImport.logMeal.foodRef references unknown share entity ref \"${logMealRef}\".`,
            path: ["afterImport", "logMeal", "foodRef"],
          });
        } else if (logMealKind !== "food") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `afterImport.logMeal.foodRef must target a food share entity, but \"${logMealRef}\" is a ${logMealKind}.`,
            path: ["afterImport", "logMeal", "foodRef"],
          });
        }
      }
    }),
  "@healthybob/contracts/share-pack.schema.json",
  "Healthy Bob Share Pack",
);

export type FoodUpsertPayload = z.infer<typeof foodUpsertPayloadSchema>;
export type RecipeUpsertPayload = z.infer<typeof recipeUpsertPayloadSchema>;
export type WorkoutFormatUpsertPayload = z.infer<typeof workoutFormatUpsertPayloadSchema>;
export type ProtocolUpsertPayload = z.infer<typeof protocolUpsertPayloadSchema>;
export type SharePackFoodPayload = z.infer<typeof sharePackFoodPayloadSchema>;
export type SharePackRecipePayload = z.infer<typeof sharePackRecipePayloadSchema>;
export type SharePackProtocolPayload = z.infer<typeof sharePackProtocolPayloadSchema>;
export type SharePackEntity = z.infer<typeof sharePackEntitySchema>;
export type SharePack = z.infer<typeof sharePackSchema>;
