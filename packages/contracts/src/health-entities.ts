import type { ZodTypeAny } from "zod";

import { HEALTH_HISTORY_EVENT_KINDS, ID_PREFIXES } from "./constants.ts";
import {
  applyRegistryMetadataDefaults,
  extractRegistryLinks,
  extractRegistryRelatedIds,
} from "./registry-helpers.ts";
import {
  allergyUpsertPatchPayloadSchema,
  allergyUpsertPayloadSchema,
  conditionUpsertPatchPayloadSchema,
  conditionUpsertPayloadSchema,
  familyMemberUpsertPatchPayloadSchema,
  familyMemberUpsertPayloadSchema,
  geneticVariantUpsertPatchPayloadSchema,
  geneticVariantUpsertPayloadSchema,
  goalUpsertPatchPayloadSchema,
  goalUpsertPayloadSchema,
  protocolUpsertPayloadSchema,
} from "./shares.ts";
import {
  allergyFrontmatterSchema,
  conditionFrontmatterSchema,
  familyMemberFrontmatterSchema,
  geneticVariantFrontmatterSchema,
  goalFrontmatterSchema,
  protocolFrontmatterSchema,
} from "./zod.ts";

export type HealthEntityKind =
  | "assessment"
  | "profile"
  | "goal"
  | "condition"
  | "allergy"
  | "protocol"
  | "history"
  | "blood_test"
  | "family"
  | "genetics";

export type HealthEntityRegistryLinkCardinality = "one" | "many";

export interface HealthEntityRegistryLink {
  type: string;
  targetId: string;
  sourceKeys: readonly string[];
}

export interface HealthEntityRegistryLinkMetadata {
  type: string;
  keys: readonly string[];
  cardinality: HealthEntityRegistryLinkCardinality;
}

export interface HealthEntityRegistryMetadata {
  directory: string;
  idField?: string;
  idKeys: readonly string[];
  slugKeys?: readonly string[];
  titleKeys: readonly string[];
  statusKeys: readonly string[];
  frontmatterSchema?: ZodTypeAny;
  upsertPayloadSchema?: ZodTypeAny;
  patchPayloadSchema?: ZodTypeAny;
  relationKeys?: readonly HealthEntityRegistryLinkMetadata[];
}

export interface HealthEntityDefinition {
  kind: HealthEntityKind;
  noun: string;
  plural: string;
  prefixes?: readonly string[];
  lookupAliases?: readonly string[];
  listKinds?: readonly string[];
  scaffoldTemplate?: Record<string, unknown>;
  registry?: HealthEntityRegistryMetadata;
}

export interface DefineRegistryEntityInput extends Omit<HealthEntityDefinition, "registry"> {
  registry: Omit<HealthEntityRegistryMetadata, "idKeys"> & {
    idField: string;
    idKeys?: readonly string[];
  };
}

export function defineRegistryEntity(
  input: DefineRegistryEntityInput,
): HealthEntityDefinitionWithRegistry {
  const registry: HealthEntityRegistryMetadata = applyRegistryMetadataDefaults(
    input.registry,
  );

  return {
    ...input,
    registry,
  };
}

const RELATED_IDS_COMPATIBILITY_RELATION: HealthEntityRegistryLinkMetadata = {
  type: "related_to",
  keys: ["relatedIds"],
  cardinality: "many",
};

const checkedHealthEntityDefinitions = [
  {
    kind: "assessment",
    listKinds: ["assessment"],
    noun: "assessment",
    plural: "assessments",
    prefixes: [`${ID_PREFIXES.assessment}_`],
  },
  {
    kind: "profile",
    listKinds: ["profile"],
    lookupAliases: ["current"],
    noun: "profile",
    plural: "profiles",
    prefixes: [`${ID_PREFIXES.profileSnapshot}_`],
    scaffoldTemplate: {
      source: "manual",
      profile: {
        domains: [],
        topGoalIds: [],
      },
    },
  },
  defineRegistryEntity({
    kind: "goal",
    listKinds: ["goal"],
    noun: "goal",
    plural: "goals",
    prefixes: [`${ID_PREFIXES.goal}_`],
    scaffoldTemplate: {
      title: "Improve sleep quality and duration",
      status: "active",
      horizon: "long_term",
      priority: 1,
      window: {
        startAt: "2026-03-12",
        targetAt: "2026-06-01",
      },
      domains: ["sleep"],
    },
    registry: {
      frontmatterSchema: goalFrontmatterSchema,
      directory: "bank/goals",
      idField: "goalId",
      patchPayloadSchema: goalUpsertPatchPayloadSchema,
      upsertPayloadSchema: goalUpsertPayloadSchema,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "parent_goal",
          keys: ["parentGoalId"],
          cardinality: "one",
        },
        {
          type: "related_goal",
          keys: ["relatedGoalIds"],
          cardinality: "many",
        },
        {
          type: "related_experiment",
          keys: ["relatedExperimentIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
  defineRegistryEntity({
    kind: "condition",
    listKinds: ["condition"],
    noun: "condition",
    plural: "conditions",
    prefixes: [`${ID_PREFIXES.condition}_`],
    scaffoldTemplate: {
      title: "Insomnia symptoms",
      clinicalStatus: "active",
      verificationStatus: "provisional",
      assertedOn: "2026-03-12",
    },
    registry: {
      frontmatterSchema: conditionFrontmatterSchema,
      directory: "bank/conditions",
      idField: "conditionId",
      patchPayloadSchema: conditionUpsertPatchPayloadSchema,
      upsertPayloadSchema: conditionUpsertPayloadSchema,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "related_goal",
          keys: ["relatedGoalIds"],
          cardinality: "many",
        },
        {
          type: "related_protocol",
          keys: ["relatedProtocolIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["clinicalStatus"],
    },
  }),
  defineRegistryEntity({
    kind: "allergy",
    listKinds: ["allergy"],
    noun: "allergy",
    plural: "allergies",
    prefixes: [`${ID_PREFIXES.allergy}_`],
    scaffoldTemplate: {
      title: "Penicillin intolerance",
      substance: "Penicillin",
      status: "active",
    },
    registry: {
      frontmatterSchema: allergyFrontmatterSchema,
      directory: "bank/allergies",
      idField: "allergyId",
      patchPayloadSchema: allergyUpsertPatchPayloadSchema,
      upsertPayloadSchema: allergyUpsertPayloadSchema,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "related_condition",
          keys: ["relatedConditionIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
  defineRegistryEntity({
    kind: "protocol",
    listKinds: ["protocol"],
    noun: "protocol",
    plural: "protocols",
    prefixes: [`${ID_PREFIXES.protocol}_`],
    scaffoldTemplate: {
      title: "Magnesium glycinate",
      kind: "supplement",
      status: "active",
      startedOn: "2026-03-12",
      group: "sleep",
    },
    registry: {
      frontmatterSchema: protocolFrontmatterSchema,
      directory: "bank/protocols",
      idField: "protocolId",
      upsertPayloadSchema: protocolUpsertPayloadSchema,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "supports_goal",
          keys: ["goalIds", "relatedGoalIds"],
          cardinality: "many",
        },
        {
          type: "supports_goal",
          keys: ["goalId"],
          cardinality: "one",
        },
        {
          type: "addresses_condition",
          keys: ["conditionIds", "relatedConditionIds"],
          cardinality: "many",
        },
        {
          type: "addresses_condition",
          keys: ["conditionId"],
          cardinality: "one",
        },
        {
          type: "related_protocol",
          keys: ["protocolIds", "relatedProtocolIds"],
          cardinality: "many",
        },
        {
          type: "related_protocol",
          keys: ["protocolId"],
          cardinality: "one",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["status"],
    },
  }),
  {
    kind: "history",
    listKinds: HEALTH_HISTORY_EVENT_KINDS,
    noun: "history",
    plural: "history",
    scaffoldTemplate: {
      kind: "encounter",
      occurredAt: "2026-03-12T09:00:00.000Z",
      title: "Primary care visit",
      encounterType: "office_visit",
      location: "Primary care clinic",
    },
  },
  {
    kind: "blood_test",
    listKinds: ["blood_test"],
    noun: "blood test",
    plural: "blood tests",
    scaffoldTemplate: {
      occurredAt: "2026-03-12T11:15:00.000Z",
      title: "Functional health panel",
      testName: "functional_health_panel",
      labName: "Function Health",
      specimenType: "blood",
      fastingStatus: "fasting",
      results: [
        {
          analyte: "Apolipoprotein B",
          value: 87,
          unit: "mg/dL",
          referenceRange: {
            text: "<90",
          },
          flag: "normal",
        },
      ],
    },
  },
  defineRegistryEntity({
    kind: "family",
    listKinds: ["family"],
    noun: "family member",
    plural: "family members",
    prefixes: [`${ID_PREFIXES.family}_`],
    scaffoldTemplate: {
      title: "Mother",
      relationship: "mother",
      conditions: ["hypertension"],
    },
    registry: {
      frontmatterSchema: familyMemberFrontmatterSchema,
      directory: "bank/family",
      idField: "familyMemberId",
      patchPayloadSchema: familyMemberUpsertPatchPayloadSchema,
      upsertPayloadSchema: familyMemberUpsertPayloadSchema,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "related_variant",
          keys: ["relatedVariantIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: [],
    },
  }),
  defineRegistryEntity({
    kind: "genetics",
    listKinds: ["genetics"],
    noun: "genetic variant",
    plural: "genetic variants",
    prefixes: [`${ID_PREFIXES.variant}_`],
    scaffoldTemplate: {
      title: "MTHFR C677T",
      gene: "MTHFR",
      significance: "risk_factor",
    },
    registry: {
      frontmatterSchema: geneticVariantFrontmatterSchema,
      directory: "bank/genetics",
      idField: "variantId",
      patchPayloadSchema: geneticVariantUpsertPatchPayloadSchema,
      upsertPayloadSchema: geneticVariantUpsertPayloadSchema,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "source_family_member",
          keys: ["sourceFamilyMemberIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["significance"],
    },
  }),
] as const satisfies readonly HealthEntityDefinition[];

export const healthEntityDefinitions: readonly HealthEntityDefinition[] =
  checkedHealthEntityDefinitions;

export type HealthEntityDefinitionWithRegistry = HealthEntityDefinition & {
  registry: HealthEntityRegistryMetadata;
};

export const healthEntityDefinitionByKind = new Map<HealthEntityKind, HealthEntityDefinition>(
  healthEntityDefinitions.map((definition) => [definition.kind, definition]),
);

export function hasHealthEntityRegistry(
  definition: HealthEntityDefinition,
): definition is HealthEntityDefinitionWithRegistry {
  return Boolean(definition.registry);
}

export function requireHealthEntityRegistryDefinition<TKind extends HealthEntityKind>(
  kind: TKind,
): HealthEntityDefinitionWithRegistry & { kind: TKind } {
  const definition = healthEntityDefinitionByKind.get(kind);

  if (!definition || !hasHealthEntityRegistry(definition)) {
    throw new Error(`Health entity "${kind}" does not define a registry projection.`);
  }

  return definition as HealthEntityDefinitionWithRegistry & { kind: TKind };
}

export function extractHealthEntityRegistryLinks(
  kind: HealthEntityKind,
  attributes: Record<string, unknown>,
): HealthEntityRegistryLink[] {
  const definition = requireHealthEntityRegistryDefinition(kind);
  const relationKeys = definition.registry.relationKeys ?? [];

  return extractRegistryLinks(attributes, relationKeys);
}

export function extractHealthEntityRegistryRelatedIds(
  kind: HealthEntityKind,
  attributes: Record<string, unknown>,
): string[] {
  return extractRegistryRelatedIds(extractHealthEntityRegistryLinks(kind, attributes));
}

export const goalRegistryEntityDefinition = requireHealthEntityRegistryDefinition("goal");
export const conditionRegistryEntityDefinition = requireHealthEntityRegistryDefinition("condition");
export const allergyRegistryEntityDefinition = requireHealthEntityRegistryDefinition("allergy");
export const protocolRegistryEntityDefinition = requireHealthEntityRegistryDefinition("protocol");
export const familyRegistryEntityDefinition = requireHealthEntityRegistryDefinition("family");
export const geneticsRegistryEntityDefinition = requireHealthEntityRegistryDefinition("genetics");
