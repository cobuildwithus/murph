import type { ZodTypeAny } from "./zod-runtime.ts";
import type { JsonObject } from "./zod.ts";

import { ID_PREFIXES } from "./constants.ts";
import {
  extractHealthEntityRegistryLinks,
  requireHealthEntityRegistryDefinition,
  type HealthEntityKind,
  type HealthEntityRegistryLink,
  type HealthEntityRegistryLinkCardinality,
  type HealthEntityRegistryLinkMetadata,
  type HealthEntityRegistryMetadata,
  type HealthEntityRegistryProjectionContext,
  type HealthEntityRegistryProjectionHelpers,
  type HealthEntityRegistryProjectionMetadata,
  type HealthEntityRegistryProjectionSortBehavior,
} from "./health-entities.ts";
import {
  foodUpsertPayloadSchema,
  recipeUpsertPayloadSchema,
  workoutFormatUpsertPayloadSchema,
} from "./shares.ts";
import {
  applyRegistryMetadataDefaults,
  extractRegistryLinks,
  extractRegistryRelatedIds,
} from "./registry-helpers.ts";
import {
  foodFrontmatterSchema,
  habitatFrontmatterSchema,
  providerFrontmatterSchema,
  recipeFrontmatterSchema,
  workoutFormatFrontmatterSchema,
} from "./zod.ts";

export type BankEntityKind =
  | "allergy"
  | "condition"
  | "family"
  | "food"
  | "genetics"
  | "goal"
  | "habitat"
  | "provider"
  | "regimen"
  | "recipe"
  | "workout_format";

export type BankEntityRegistryLink = HealthEntityRegistryLink;
export type BankEntityRegistryLinkCardinality = HealthEntityRegistryLinkCardinality;
export type BankEntityRegistryLinkMetadata = HealthEntityRegistryLinkMetadata;
export type BankEntityRegistryProjectionContext = HealthEntityRegistryProjectionContext;
export type BankEntityRegistryProjectionHelpers = HealthEntityRegistryProjectionHelpers;
export type BankEntityRegistryProjectionMetadata = HealthEntityRegistryProjectionMetadata;
export type BankEntityRegistryProjectionSortBehavior =
  HealthEntityRegistryProjectionSortBehavior;

// Bank registry command/projection metadata should have one shared owner in
// contracts so query adapters can stay thin regardless of family.
export interface BankEntityRegistryMetadata extends HealthEntityRegistryMetadata {}

export type BankEntityDefinitionWithRegistry = BankEntityDefinition;

export interface BankEntityDefinition {
  kind: BankEntityKind;
  noun: string;
  plural: string;
  prefixes?: readonly string[];
  lookupAliases?: readonly string[];
  listKinds?: readonly string[];
  scaffoldTemplate?: JsonObject;
  registry: BankEntityRegistryMetadata;
}

interface DefineBankRegistryEntityInput extends Omit<BankEntityDefinition, "registry"> {
  registry: Omit<BankEntityRegistryMetadata, "idKeys"> & {
    idField: string;
    idKeys?: readonly string[];
  };
}

type HealthBackedBankEntityKind = Extract<BankEntityKind, HealthEntityKind>;

const HEALTH_BANK_ENTITY_KINDS = [
  "goal",
  "condition",
  "allergy",
  "regimen",
  "family",
  "genetics",
] as const satisfies readonly HealthBackedBankEntityKind[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectNutritionData(
  value: unknown,
  helpers: BankEntityRegistryProjectionHelpers,
): {
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  fiberGrams: number | null;
} | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const projected = {
    calories: helpers.firstNumber(value, ["calories"]),
    proteinGrams: helpers.firstNumber(value, ["proteinGrams"]),
    carbsGrams: helpers.firstNumber(value, ["carbsGrams"]),
    fatGrams: helpers.firstNumber(value, ["fatGrams"]),
    fiberGrams: helpers.firstNumber(value, ["fiberGrams"]),
  };

  return Object.values(projected).some((entry) => entry !== null) ? projected : null;
}

function projectNutritionProvenance(
  value: unknown,
  helpers: BankEntityRegistryProjectionHelpers,
): {
  source: string | null;
  confidence: string | null;
  sourceDetail: string | null;
} | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const source = helpers.firstString(value, ["source"]);
  if (!source) {
    return null;
  }

  return {
    source,
    confidence: helpers.firstString(value, ["confidence"]),
    sourceDetail: helpers.firstString(value, ["sourceDetail"]),
  };
}

function projectFoodNutrition(
  value: unknown,
  helpers: BankEntityRegistryProjectionHelpers,
): {
  perServing: {
    calories: number | null;
    proteinGrams: number | null;
    carbsGrams: number | null;
    fatGrams: number | null;
    fiberGrams: number | null;
  } | null;
  provenance: {
    source: string | null;
    confidence: string | null;
    sourceDetail: string | null;
  } | null;
} | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const perServing = projectNutritionData(helpers.firstObject(value, ["perServing"]), helpers);
  const provenance = projectNutritionProvenance(helpers.firstObject(value, ["provenance"]), helpers);

  return perServing || provenance ? { perServing, provenance } : null;
}

function defineBankRegistryEntity(
  input: DefineBankRegistryEntityInput,
): BankEntityDefinition {
  return {
    ...input,
    registry: applyRegistryMetadataDefaults(input.registry),
  };
}

const checkedBankEntityDefinitions = [
  ...HEALTH_BANK_ENTITY_KINDS.map((kind) => requireHealthEntityRegistryDefinition(kind)),
  defineBankRegistryEntity({
    kind: "food",
    listKinds: ["food"],
    noun: "food",
    plural: "foods",
    prefixes: [`${ID_PREFIXES.food}_`],
    scaffoldTemplate: {
      title: "Acai bowl",
      status: "active",
      kind: "meal",
      serving: "1 bowl",
      tags: ["breakfast"],
    },
    registry: {
      frontmatterSchema: foodFrontmatterSchema as ZodTypeAny,
      directory: "bank/foods",
      idField: "foodId",
      upsertPayloadSchema: foodUpsertPayloadSchema as ZodTypeAny,
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            summary: helpers.firstString(attributes, ["summary"]),
            kind: helpers.firstString(attributes, ["kind"]),
            brand: helpers.firstString(attributes, ["brand"]),
            vendor: helpers.firstString(attributes, ["vendor"]),
            location: helpers.firstString(attributes, ["location"]),
            serving: helpers.firstString(attributes, ["serving"]),
            nutrition: projectFoodNutrition(attributes.nutrition, helpers),
            aliases: helpers.firstStringArray(attributes, ["aliases"]),
            ingredients: helpers.firstStringArray(attributes, ["ingredients"]),
            tags: helpers.firstStringArray(attributes, ["tags"]),
            note: helpers.firstString(attributes, ["note"]),
            attachedRegimenIds: helpers.firstStringArray(attributes, ["attachedRegimenIds"]),
          };
        },
      },
      relationKeys: [
        {
          type: "related_regimen",
          keys: ["attachedRegimenIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
  defineBankRegistryEntity({
    kind: "recipe",
    listKinds: ["recipe"],
    noun: "recipe",
    plural: "recipes",
    prefixes: [`${ID_PREFIXES.recipe}_`],
    scaffoldTemplate: {
      title: "Salmon rice bowl",
      status: "saved",
      servings: 2,
      tags: ["weeknight"],
    },
    registry: {
      frontmatterSchema: recipeFrontmatterSchema as ZodTypeAny,
      directory: "bank/recipes",
      idField: "recipeId",
      upsertPayloadSchema: recipeUpsertPayloadSchema as ZodTypeAny,
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            summary: helpers.firstString(attributes, ["summary"]),
            cuisine: helpers.firstString(attributes, ["cuisine"]),
            dishType: helpers.firstString(attributes, ["dishType"]),
            source: helpers.firstString(attributes, ["source"]),
            servings: helpers.firstNumber(attributes, ["servings"]),
            prepTimeMinutes: helpers.firstNumber(attributes, ["prepTimeMinutes"]),
            cookTimeMinutes: helpers.firstNumber(attributes, ["cookTimeMinutes"]),
            totalTimeMinutes: helpers.firstNumber(attributes, ["totalTimeMinutes"]),
            tags: helpers.firstStringArray(attributes, ["tags"]),
            ingredients: helpers.firstStringArray(attributes, ["ingredients"]),
            steps: helpers.firstStringArray(attributes, ["steps"]),
            relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
            relatedConditionIds: helpers.firstStringArray(attributes, ["relatedConditionIds"]),
          };
        },
      },
      relationKeys: [
        {
          type: "supports_goal",
          keys: ["relatedGoalIds"],
          cardinality: "many",
        },
        {
          type: "addresses_condition",
          keys: ["relatedConditionIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
  defineBankRegistryEntity({
    kind: "provider",
    listKinds: ["provider"],
    noun: "provider",
    plural: "providers",
    prefixes: [`${ID_PREFIXES.provider}_`],
    scaffoldTemplate: {
      title: "Primary care physician",
      specialty: "primary-care",
      organization: "Neighborhood Clinic",
    },
    registry: {
      frontmatterSchema: providerFrontmatterSchema as ZodTypeAny,
      directory: "bank/providers",
      idField: "providerId",
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            specialty: helpers.firstString(attributes, ["specialty"]),
            organization: helpers.firstString(attributes, ["organization"]),
            location: helpers.firstString(attributes, ["location"]),
            website: helpers.firstString(attributes, ["website"]),
            phone: helpers.firstString(attributes, ["phone"]),
            note: helpers.firstString(attributes, ["note"]),
            aliases: helpers.firstStringArray(attributes, ["aliases"]),
          };
        },
      },
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
  defineBankRegistryEntity({
    kind: "habitat",
    listKinds: ["habitat"],
    noun: "habitat aspect",
    plural: "habitat aspects",
    prefixes: [`${ID_PREFIXES.habitat}_`],
    scaffoldTemplate: {
      title: "Bedroom & sleep",
      status: "active",
      domain: "environment",
      aspect: "sleep-environment",
      indicators: {
        window_at_night: "open",
        darkness: "blackout",
      },
    },
    registry: {
      frontmatterSchema: habitatFrontmatterSchema as ZodTypeAny,
      directory: "bank/habitat",
      idField: "habitatId",
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            domain: helpers.firstString(attributes, ["domain"]),
            aspect: helpers.firstString(attributes, ["aspect"]),
            indicators: helpers.firstObject(attributes, ["indicators"]),
            indicatorNotes: helpers.firstObject(attributes, ["indicatorNotes"]),
            indicatorRecordedAt: helpers.firstObject(attributes, ["indicatorRecordedAt"]),
            note: helpers.firstString(attributes, ["note"]),
          };
        },
      },
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
  defineBankRegistryEntity({
    kind: "workout_format",
    listKinds: ["workout_format"],
    noun: "workout format",
    plural: "workout formats",
    prefixes: [`${ID_PREFIXES.workoutFormat}_`],
    scaffoldTemplate: {
      title: "Push Day A",
      status: "active",
      activityType: "strength-training",
      durationMinutes: 45,
    },
    registry: {
      frontmatterSchema: workoutFormatFrontmatterSchema as ZodTypeAny,
      directory: "bank/workout-formats",
      idField: "workoutFormatId",
      upsertPayloadSchema: workoutFormatUpsertPayloadSchema as ZodTypeAny,
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            summary: helpers.firstString(attributes, ["summary"]),
            activityType: helpers.firstString(attributes, ["activityType"]),
            durationMinutes: helpers.firstNumber(attributes, ["durationMinutes"]),
            distanceKm: helpers.firstNumber(attributes, ["distanceKm"]),
            template: helpers.firstObject(attributes, ["template"]),
            tags: helpers.firstStringArray(attributes, ["tags"]),
            note: helpers.firstString(attributes, ["note"]),
            templateText: helpers.firstString(attributes, ["templateText"]),
          };
        },
      },
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
] as const satisfies readonly BankEntityDefinition[];

export const bankEntityDefinitions: readonly BankEntityDefinition[] =
  checkedBankEntityDefinitions;

export const bankEntityDefinitionByKind = new Map<BankEntityKind, BankEntityDefinition>(
  bankEntityDefinitions.map((definition) => [definition.kind, definition]),
);

export function requireBankEntityRegistryDefinition(
  kind: BankEntityKind,
): BankEntityDefinitionWithRegistry {
  const definition = bankEntityDefinitionByKind.get(kind);

  if (!definition) {
    throw new Error(`Bank entity "${kind}" does not define a registry projection.`);
  }

  return definition;
}

export function getBankEntityRegistryProjectionMetadata(
  kind: BankEntityKind,
): BankEntityRegistryProjectionMetadata {
  const projection = requireBankEntityRegistryDefinition(kind).registry.projection;

  if (!projection) {
    throw new Error(`Bank entity "${kind}" is missing shared registry projection metadata.`);
  }

  return projection;
}

function isHealthBackedBankEntityKind(kind: BankEntityKind): kind is HealthBackedBankEntityKind {
  return (HEALTH_BANK_ENTITY_KINDS as readonly string[]).includes(kind);
}

export function extractBankEntityRegistryLinks(
  kind: BankEntityKind,
  attributes: Record<string, unknown>,
): BankEntityRegistryLink[] {
  if (isHealthBackedBankEntityKind(kind)) {
    return extractHealthEntityRegistryLinks(kind, attributes);
  }

  return extractRegistryLinks(
    attributes,
    requireBankEntityRegistryDefinition(kind).registry.relationKeys ?? [],
  );
}

export function extractBankEntityRegistryRelatedIds(
  kind: BankEntityKind,
  attributes: Record<string, unknown>,
): string[] {
  return extractRegistryRelatedIds(extractBankEntityRegistryLinks(kind, attributes));
}

export const goalBankEntityDefinition = requireBankEntityRegistryDefinition("goal");
export const conditionBankEntityDefinition = requireBankEntityRegistryDefinition("condition");
export const allergyBankEntityDefinition = requireBankEntityRegistryDefinition("allergy");
export const regimenBankEntityDefinition = requireBankEntityRegistryDefinition("regimen");
export const familyBankEntityDefinition = requireBankEntityRegistryDefinition("family");
export const geneticsBankEntityDefinition = requireBankEntityRegistryDefinition("genetics");
export const foodBankEntityDefinition = requireBankEntityRegistryDefinition("food");
export const habitatBankEntityDefinition = requireBankEntityRegistryDefinition("habitat");
export const recipeBankEntityDefinition = requireBankEntityRegistryDefinition("recipe");
export const providerBankEntityDefinition = requireBankEntityRegistryDefinition("provider");
export const workoutFormatBankEntityDefinition = requireBankEntityRegistryDefinition("workout_format");
