import type { ZodTypeAny } from "zod";
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
  | "protocol"
  | "provider"
  | "recipe"
  | "workout_format";

export type BankEntityRegistryLink = HealthEntityRegistryLink;
export type BankEntityRegistryLinkCardinality = HealthEntityRegistryLinkCardinality;
export type BankEntityRegistryLinkMetadata = HealthEntityRegistryLinkMetadata;

// Health-backed bank entities inherit shared registry command/projection metadata
// from `health-entities.ts`. Non-health bank families still add any extra
// read-model projection metadata in their owning adapter layers until they are
// ported onto the same shared definition shape.
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
  "protocol",
  "family",
  "genetics",
] as const satisfies readonly HealthBackedBankEntityKind[];

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
      relationKeys: [
        {
          type: "related_protocol",
          keys: ["attachedProtocolIds"],
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
export const protocolBankEntityDefinition = requireBankEntityRegistryDefinition("protocol");
export const familyBankEntityDefinition = requireBankEntityRegistryDefinition("family");
export const geneticsBankEntityDefinition = requireBankEntityRegistryDefinition("genetics");
export const foodBankEntityDefinition = requireBankEntityRegistryDefinition("food");
export const recipeBankEntityDefinition = requireBankEntityRegistryDefinition("recipe");
export const providerBankEntityDefinition = requireBankEntityRegistryDefinition("provider");
export const workoutFormatBankEntityDefinition = requireBankEntityRegistryDefinition("workout_format");
