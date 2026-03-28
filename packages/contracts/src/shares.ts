import * as z from "zod";

import {
  ALLERGY_CRITICALITIES,
  ALLERGY_STATUSES,
  CONDITION_CLINICAL_STATUSES,
  CONDITION_SEVERITIES,
  CONDITION_VERIFICATION_STATUSES,
  CONTRACT_SCHEMA_VERSION,
  FOOD_STATUSES,
  GOAL_HORIZONS,
  GOAL_STATUSES,
  PROTOCOL_KINDS,
  PROTOCOL_STATUSES,
  RECIPE_STATUSES,
  VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES,
  WORKOUT_FORMAT_STATUSES,
  ID_PREFIXES,
} from "./constants.ts";
import {
  activityStrengthExerciseSchema,
  FAMILY_MEMBER_LIMITS,
  GENETIC_VARIANT_LIMITS,
} from "./zod.ts";
import { idPattern } from "./ids.ts";
import { isStrictIsoDate, isStrictIsoDateTime } from "./time.ts";

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
const allergyIdSchema = patternedString(idPattern(ID_PREFIXES.allergy));
const familyMemberIdSchema = patternedString(idPattern(ID_PREFIXES.family));
const goalIdSchema = patternedString(idPattern(ID_PREFIXES.goal));
const conditionIdSchema = patternedString(idPattern(ID_PREFIXES.condition));
const protocolIdSchema = patternedString(idPattern(ID_PREFIXES.protocol));
const experimentIdSchema = patternedString(idPattern(ID_PREFIXES.experiment));
const variantIdSchema = patternedString(idPattern(ID_PREFIXES.variant));
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
  "@murph/contracts/food-upsert-payload.schema.json",
  "Murph Food Upsert Payload",
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
  "@murph/contracts/recipe-upsert-payload.schema.json",
  "Murph Recipe Upsert Payload",
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
  "@murph/contracts/workout-format-upsert-payload.schema.json",
  "Murph Workout Format Upsert Payload",
);

export const goalUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      goalId: goalIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160),
      status: z.enum(GOAL_STATUSES).default("active"),
      horizon: z.enum(GOAL_HORIZONS).default("ongoing"),
      priority: integerSchema(1, 10).optional(),
      window: z
        .object({
          startAt: isoDateString().optional(),
          targetAt: isoDateString().optional(),
        })
        .strict()
        .optional(),
      parentGoalId: goalIdSchema.nullable().optional(),
      relatedGoalIds: uniqueArray(goalIdSchema, { uniqueItems: true }).optional(),
      relatedExperimentIds: uniqueArray(experimentIdSchema, {
        uniqueItems: true,
      }).optional(),
      domains: uniqueArray(boundedString(1, 80), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murph/contracts/goal-upsert-payload.schema.json",
  "Murph Goal Upsert Payload",
);

export const goalUpsertPatchPayloadSchema = withContractMetadata(
  z
    .object({
      goalId: goalIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160).optional(),
      status: z.enum(GOAL_STATUSES).optional(),
      horizon: z.enum(GOAL_HORIZONS).optional(),
      priority: integerSchema(1, 10).optional(),
      window: z
        .object({
          startAt: isoDateString().optional(),
          targetAt: isoDateString().optional(),
        })
        .strict()
        .optional(),
      parentGoalId: goalIdSchema.nullable().optional(),
      relatedGoalIds: uniqueArray(goalIdSchema, { uniqueItems: true }).optional(),
      relatedExperimentIds: uniqueArray(experimentIdSchema, {
        uniqueItems: true,
      }).optional(),
      domains: uniqueArray(boundedString(1, 80), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murph/contracts/goal-upsert-patch-payload.schema.json",
  "Murph Goal Upsert Patch Payload",
);

export const conditionUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      conditionId: conditionIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160),
      clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES).default("active"),
      verificationStatus: z.enum(CONDITION_VERIFICATION_STATUSES).optional(),
      assertedOn: isoDateString().optional(),
      resolvedOn: isoDateString().optional(),
      severity: z.enum(CONDITION_SEVERITIES).optional(),
      bodySites: uniqueArray(boundedString(1, 120), { uniqueItems: true }).optional(),
      relatedGoalIds: uniqueArray(goalIdSchema, { uniqueItems: true }).optional(),
      relatedProtocolIds: uniqueArray(protocolIdSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@murph/contracts/condition-upsert-payload.schema.json",
  "Murph Condition Upsert Payload",
);

export const conditionUpsertPatchPayloadSchema = withContractMetadata(
  z
    .object({
      conditionId: conditionIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160).optional(),
      clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES).optional(),
      verificationStatus: z.enum(CONDITION_VERIFICATION_STATUSES).nullable().optional(),
      assertedOn: isoDateString().nullable().optional(),
      resolvedOn: isoDateString().nullable().optional(),
      severity: z.enum(CONDITION_SEVERITIES).nullable().optional(),
      bodySites: uniqueArray(boundedString(1, 120), { uniqueItems: true }).nullable().optional(),
      relatedGoalIds: uniqueArray(goalIdSchema, { uniqueItems: true }).nullable().optional(),
      relatedProtocolIds: uniqueArray(protocolIdSchema, { uniqueItems: true }).nullable().optional(),
      note: boundedString(1, 4000).nullable().optional(),
    })
    .strict(),
  "@murph/contracts/condition-upsert-patch-payload.schema.json",
  "Murph Condition Upsert Patch Payload",
);

export const allergyUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      allergyId: allergyIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160),
      substance: boundedString(1, 160),
      status: z.enum(ALLERGY_STATUSES).default("active"),
      criticality: z.enum(ALLERGY_CRITICALITIES).optional(),
      reaction: boundedString(1, 160).optional(),
      recordedOn: isoDateString().optional(),
      relatedConditionIds: uniqueArray(conditionIdSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@murph/contracts/allergy-upsert-payload.schema.json",
  "Murph Allergy Upsert Payload",
);

export const allergyUpsertPatchPayloadSchema = withContractMetadata(
  z
    .object({
      allergyId: allergyIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, 160).optional(),
      substance: boundedString(1, 160).optional(),
      status: z.enum(ALLERGY_STATUSES).optional(),
      criticality: z.enum(ALLERGY_CRITICALITIES).nullable().optional(),
      reaction: boundedString(1, 160).nullable().optional(),
      recordedOn: isoDateString().nullable().optional(),
      relatedConditionIds: uniqueArray(conditionIdSchema, { uniqueItems: true }).nullable().optional(),
      note: boundedString(1, 4000).nullable().optional(),
    })
    .strict(),
  "@murph/contracts/allergy-upsert-patch-payload.schema.json",
  "Murph Allergy Upsert Patch Payload",
);

export const familyMemberUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      familyMemberId: familyMemberIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, FAMILY_MEMBER_LIMITS.title),
      relationship: boundedString(1, FAMILY_MEMBER_LIMITS.relationship),
      conditions: uniqueArray(boundedString(1, FAMILY_MEMBER_LIMITS.condition), {
        uniqueItems: true,
      }).optional(),
      deceased: z.boolean().optional(),
      note: boundedString(1, FAMILY_MEMBER_LIMITS.note).optional(),
      relatedVariantIds: uniqueArray(variantIdSchema, { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murph/contracts/family-member-upsert-payload.schema.json",
  "Murph Family Member Upsert Payload",
);

export const familyMemberUpsertPatchPayloadSchema = withContractMetadata(
  z
    .object({
      familyMemberId: familyMemberIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, FAMILY_MEMBER_LIMITS.title).optional(),
      relationship: boundedString(1, FAMILY_MEMBER_LIMITS.relationship).optional(),
      conditions: uniqueArray(boundedString(1, FAMILY_MEMBER_LIMITS.condition), {
        uniqueItems: true,
      }).nullable().optional(),
      deceased: z.boolean().nullable().optional(),
      note: boundedString(1, FAMILY_MEMBER_LIMITS.note).nullable().optional(),
      relatedVariantIds: uniqueArray(variantIdSchema, { uniqueItems: true }).nullable().optional(),
    })
    .strict(),
  "@murph/contracts/family-member-upsert-patch-payload.schema.json",
  "Murph Family Member Upsert Patch Payload",
);

export const geneticVariantUpsertPayloadSchema = withContractMetadata(
  z
    .object({
      variantId: variantIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, GENETIC_VARIANT_LIMITS.title),
      gene: boundedString(1, GENETIC_VARIANT_LIMITS.gene),
      zygosity: z.enum(VARIANT_ZYGOSITIES).optional(),
      significance: z.enum(VARIANT_SIGNIFICANCES).optional(),
      inheritance: boundedString(1, GENETIC_VARIANT_LIMITS.inheritance).optional(),
      sourceFamilyMemberIds: uniqueArray(familyMemberIdSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, GENETIC_VARIANT_LIMITS.note).optional(),
    })
    .strict(),
  "@murph/contracts/genetic-variant-upsert-payload.schema.json",
  "Murph Genetic Variant Upsert Payload",
);

export const geneticVariantUpsertPatchPayloadSchema = withContractMetadata(
  z
    .object({
      variantId: variantIdSchema.optional(),
      slug: slugSchema.optional(),
      title: boundedString(1, GENETIC_VARIANT_LIMITS.title).optional(),
      gene: boundedString(1, GENETIC_VARIANT_LIMITS.gene).optional(),
      zygosity: z.enum(VARIANT_ZYGOSITIES).nullable().optional(),
      significance: z.enum(VARIANT_SIGNIFICANCES).nullable().optional(),
      inheritance: boundedString(1, GENETIC_VARIANT_LIMITS.inheritance).nullable().optional(),
      sourceFamilyMemberIds: uniqueArray(familyMemberIdSchema, { uniqueItems: true }).nullable().optional(),
      note: boundedString(1, GENETIC_VARIANT_LIMITS.note).nullable().optional(),
    })
    .strict(),
  "@murph/contracts/genetic-variant-upsert-patch-payload.schema.json",
  "Murph Genetic Variant Upsert Patch Payload",
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
  "@murph/contracts/protocol-upsert-payload.schema.json",
  "Murph Protocol Upsert Payload",
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
  "@murph/contracts/share-pack-food-payload.schema.json",
  "Murph Share Pack Food Payload",
);

export const sharePackRecipePayloadSchema = withContractMetadata(
  recipeUpsertPayloadSchema.omit({ recipeId: true }).strict(),
  "@murph/contracts/share-pack-recipe-payload.schema.json",
  "Murph Share Pack Recipe Payload",
);

export const sharePackProtocolPayloadSchema = withContractMetadata(
  protocolUpsertPayloadSchema.omit({ protocolId: true }).strict(),
  "@murph/contracts/share-pack-protocol-payload.schema.json",
  "Murph Share Pack Protocol Payload",
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
  "@murph/contracts/share-pack-entity.schema.json",
  "Murph Share Pack Entity",
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
  "@murph/contracts/share-pack.schema.json",
  "Murph Share Pack",
);

export type FoodUpsertPayload = z.infer<typeof foodUpsertPayloadSchema>;
export type RecipeUpsertPayload = z.infer<typeof recipeUpsertPayloadSchema>;
export type WorkoutFormatUpsertPayload = z.infer<typeof workoutFormatUpsertPayloadSchema>;
export type ConditionUpsertPayload = z.infer<typeof conditionUpsertPayloadSchema>;
export type ConditionUpsertPatchPayload = z.infer<typeof conditionUpsertPatchPayloadSchema>;
export type AllergyUpsertPayload = z.infer<typeof allergyUpsertPayloadSchema>;
export type AllergyUpsertPatchPayload = z.infer<typeof allergyUpsertPatchPayloadSchema>;
export type ProtocolUpsertPayload = z.infer<typeof protocolUpsertPayloadSchema>;
export type FamilyMemberUpsertPayload = z.infer<typeof familyMemberUpsertPayloadSchema>;
export type FamilyMemberUpsertPatchPayload = z.infer<typeof familyMemberUpsertPatchPayloadSchema>;
export type GeneticVariantUpsertPayload = z.infer<typeof geneticVariantUpsertPayloadSchema>;
export type GeneticVariantUpsertPatchPayload = z.infer<typeof geneticVariantUpsertPatchPayloadSchema>;
export type SharePackFoodPayload = z.infer<typeof sharePackFoodPayloadSchema>;
export type SharePackRecipePayload = z.infer<typeof sharePackRecipePayloadSchema>;
export type SharePackProtocolPayload = z.infer<typeof sharePackProtocolPayloadSchema>;
export type SharePackEntity = z.infer<typeof sharePackEntitySchema>;
export type SharePack = z.infer<typeof sharePackSchema>;
