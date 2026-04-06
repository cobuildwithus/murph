import type { ZodTypeAny } from "zod";
import type { JsonObject } from "./zod.ts";

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

export type HealthEntityRegistryProjectionSortBehavior = "gene-title" | "priority-title" | "title";

export interface HealthEntityRegistryProjectionHelpers {
  firstBoolean(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): boolean | null;
  firstNumber(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): number | null;
  firstObject(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): Record<string, unknown> | null;
  firstString(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): string | null;
  firstStringArray(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): string[];
}

export interface HealthEntityRegistryProjectionContext {
  attributes: Record<string, unknown>;
  helpers: HealthEntityRegistryProjectionHelpers;
  relativePath: string;
}

export interface HealthEntityRegistryProjectionMetadata {
  sortBehavior?: HealthEntityRegistryProjectionSortBehavior;
  transform(
    context: HealthEntityRegistryProjectionContext,
  ): Record<string, unknown>;
}

export interface HealthEntityRegistryCommandMetadata {
  commandDescription?: string;
  payloadFile?: string;
  runtimeMethodName?: string;
}

export interface ResolvedHealthEntityRegistryCommandMetadata {
  commandDescription: string;
  commandName: HealthEntityRegistryKind;
  listServiceMethodName: string;
  listStatusDescription?: string;
  payloadFile: string;
  runtimeListMethodName: string;
  runtimeMethodName: string;
  runtimeShowMethodName: string;
  scaffoldServiceMethodName: string;
  showId: {
    description: string;
    example: string;
  };
  showServiceMethodName: string;
  upsertServiceMethodName: string;
}

export interface HealthEntityRegistryMetadata {
  command?: HealthEntityRegistryCommandMetadata;
  directory: string;
  idField?: string;
  idKeys: readonly string[];
  slugKeys?: readonly string[];
  titleKeys: readonly string[];
  statusKeys: readonly string[];
  frontmatterSchema?: ZodTypeAny;
  patchPayloadSchema?: ZodTypeAny;
  projection?: HealthEntityRegistryProjectionMetadata;
  upsertPayloadSchema?: ZodTypeAny;
  relationKeys?: readonly HealthEntityRegistryLinkMetadata[];
}

export interface HealthEntityDefinition {
  kind: HealthEntityKind;
  noun: string;
  plural: string;
  prefixes?: readonly string[];
  lookupAliases?: readonly string[];
  listKinds?: readonly string[];
  scaffoldTemplate?: JsonObject;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSupplementIngredients(
  value: unknown,
): Array<{
  compound: string;
  label: string | null;
  amount: number | null;
  unit: string | null;
  active: boolean;
  note: string | null;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }

    const compound = typeof entry.compound === "string" ? entry.compound.trim() : "";
    if (!compound) {
      return [];
    }

    return [{
      compound,
      label:
        typeof entry.label === "string" && entry.label.trim().length > 0
          ? entry.label.trim()
          : null,
      amount:
        typeof entry.amount === "number" && Number.isFinite(entry.amount)
          ? entry.amount
          : null,
      unit:
        typeof entry.unit === "string" && entry.unit.trim().length > 0
          ? entry.unit.trim()
          : null,
      active: typeof entry.active === "boolean" ? entry.active : true,
      note:
        typeof entry.note === "string" && entry.note.trim().length > 0
          ? entry.note.trim()
          : null,
    }];
  });
}

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
      projection: {
        sortBehavior: "priority-title",
        transform({ attributes, helpers }) {
          const window = helpers.firstObject(attributes, ["window"]);

          return {
            horizon: helpers.firstString(attributes, ["horizon"]),
            priority: helpers.firstNumber(attributes, ["priority"]),
            windowStartAt: window ? helpers.firstString(window, ["startAt"]) : null,
            windowTargetAt: window ? helpers.firstString(window, ["targetAt"]) : null,
            parentGoalId: helpers.firstString(attributes, ["parentGoalId"]),
            relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
            relatedExperimentIds: helpers.firstStringArray(attributes, ["relatedExperimentIds"]),
            domains: helpers.firstStringArray(attributes, ["domains"]),
          };
        },
      },
      upsertPayloadSchema: goalUpsertPayloadSchema,
      relationKeys: [
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
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            clinicalStatus: helpers.firstString(attributes, ["clinicalStatus"]),
            verificationStatus: helpers.firstString(attributes, ["verificationStatus"]),
            assertedOn: helpers.firstString(attributes, ["assertedOn"]),
            resolvedOn: helpers.firstString(attributes, ["resolvedOn"]),
            severity: helpers.firstString(attributes, ["severity"]),
            bodySites: helpers.firstStringArray(attributes, ["bodySites"]),
            relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
            relatedProtocolIds: helpers.firstStringArray(attributes, ["relatedProtocolIds"]),
            note: helpers.firstString(attributes, ["note"]),
          };
        },
      },
      upsertPayloadSchema: conditionUpsertPayloadSchema,
      relationKeys: [
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
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            substance: helpers.firstString(attributes, ["substance"]),
            criticality: helpers.firstString(attributes, ["criticality"]),
            reaction: helpers.firstString(attributes, ["reaction"]),
            recordedOn: helpers.firstString(attributes, ["recordedOn"]),
            relatedConditionIds: helpers.firstStringArray(attributes, ["relatedConditionIds"]),
            note: helpers.firstString(attributes, ["note"]),
          };
        },
      },
      upsertPayloadSchema: allergyUpsertPayloadSchema,
      relationKeys: [
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
      command: {
        runtimeMethodName: "upsertProtocolItem",
      },
      frontmatterSchema: protocolFrontmatterSchema,
      directory: "bank/protocols",
      idField: "protocolId",
      projection: {
        transform({ attributes, helpers, relativePath }) {
          return {
            kind: helpers.firstString(attributes, ["kind"]),
            startedOn: helpers.firstString(attributes, ["startedOn"]),
            stoppedOn: helpers.firstString(attributes, ["stoppedOn"]),
            substance: helpers.firstString(attributes, ["substance"]),
            dose: helpers.firstNumber(attributes, ["dose"]),
            unit: helpers.firstString(attributes, ["unit"]),
            schedule: helpers.firstString(attributes, ["schedule"]),
            brand: helpers.firstString(attributes, ["brand"]),
            manufacturer: helpers.firstString(attributes, ["manufacturer"]),
            servingSize: helpers.firstString(attributes, ["servingSize"]),
            ingredients: projectSupplementIngredients(attributes.ingredients),
            relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds", "goalIds"]),
            relatedConditionIds: helpers.firstStringArray(attributes, ["relatedConditionIds", "conditionIds"]),
            group:
              helpers.firstString(attributes, ["group"])
              ?? deriveProtocolGroupFromRelativePath(relativePath),
          };
        },
      },
      upsertPayloadSchema: protocolUpsertPayloadSchema,
      relationKeys: [
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
      projection: {
        sortBehavior: "title",
        transform({ attributes, helpers }) {
          return {
            relationship: helpers.firstString(attributes, ["relationship"]),
            deceased: helpers.firstBoolean(attributes, ["deceased"]),
            conditions: helpers.firstStringArray(attributes, ["conditions"]),
            relatedVariantIds: helpers.firstStringArray(attributes, ["relatedVariantIds"]),
            note: helpers.firstString(attributes, ["note"]),
          };
        },
      },
      upsertPayloadSchema: familyMemberUpsertPayloadSchema,
      relationKeys: [
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
      projection: {
        sortBehavior: "gene-title",
        transform({ attributes, helpers }) {
          return {
            gene: helpers.firstString(attributes, ["gene"]),
            zygosity: helpers.firstString(attributes, ["zygosity"]),
            significance: helpers.firstString(attributes, ["significance"]),
            inheritance: helpers.firstString(attributes, ["inheritance"]),
            sourceFamilyMemberIds: helpers.firstStringArray(attributes, ["sourceFamilyMemberIds"]),
            note: helpers.firstString(attributes, ["note"]),
          };
        },
      },
      upsertPayloadSchema: geneticVariantUpsertPayloadSchema,
      relationKeys: [
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

export type HealthEntityRegistryKind = Extract<
  HealthEntityKind,
  "goal" | "condition" | "allergy" | "protocol" | "family" | "genetics"
>;

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

export function getHealthEntityRegistryProjectionMetadata(
  kind: HealthEntityRegistryKind,
): HealthEntityRegistryProjectionMetadata {
  const projection = requireHealthEntityRegistryDefinition(kind).registry.projection;

  if (!projection) {
    throw new Error(`Health entity "${kind}" is missing shared registry projection metadata.`);
  }

  return projection;
}

export function getHealthEntityRegistryCommandMetadata(
  kind: HealthEntityRegistryKind,
): ResolvedHealthEntityRegistryCommandMetadata {
  const definition = requireHealthEntityRegistryDefinition(kind);
  const command = definition.registry.command;
  const singularMethodStem = toHealthRegistryMethodStem(definition.noun);
  const pluralMethodStem = toHealthRegistryMethodStem(definition.plural);

  return {
    commandDescription:
      command?.commandDescription
      ?? `${capitalize(definition.noun)} registry commands for the health extension surface.`,
    commandName: kind,
    listServiceMethodName: `list${pluralMethodStem}`,
    ...(definition.registry.statusKeys.length > 0
      ? {
          listStatusDescription: `Optional ${toHealthRegistryStatusLabel(definition.noun)} status to filter by.`,
        }
      : {}),
    payloadFile: command?.payloadFile ?? `${kind}.json`,
    runtimeListMethodName: `list${pluralMethodStem}`,
    runtimeMethodName:
      command?.runtimeMethodName
      ?? `upsert${singularMethodStem}`,
    runtimeShowMethodName: `show${singularMethodStem}`,
    scaffoldServiceMethodName: `scaffold${singularMethodStem}`,
    showId: {
      description: `${capitalize(definition.noun)} id or slug to show.`,
      example: `<${toCommandIdExample(definition.noun)}-id>`,
    },
    showServiceMethodName: `show${singularMethodStem}`,
    upsertServiceMethodName: `upsert${singularMethodStem}`,
  };
}

export function deriveProtocolGroupFromRelativePath(
  relativePath: string,
  rootDirectory = "bank/protocols",
): string | null {
  const normalizedRelativePath = normalizeHealthEntityRelativePath(relativePath);
  const normalizedRootDirectory = normalizeHealthEntityRelativePath(rootDirectory);
  const rootPrefix = `${normalizedRootDirectory}/`;

  if (!normalizedRelativePath.startsWith(rootPrefix)) {
    return null;
  }

  const relativeToRoot = normalizedRelativePath.slice(rootPrefix.length);
  const lastSeparatorIndex = relativeToRoot.lastIndexOf("/");

  if (lastSeparatorIndex <= 0) {
    return null;
  }

  const group = relativeToRoot.slice(0, lastSeparatorIndex).replace(/^\/+|\/+$/gu, "");
  return group.length > 0 ? group : null;
}

function normalizeHealthEntityRelativePath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "");
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function toHealthRegistryMethodStem(value: string): string {
  return value
    .trim()
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map(capitalize)
    .join("");
}

function toHealthRegistryStatusLabel(value: string): string {
  return value.trim().replace(/[\s_]+/gu, "-");
}

function toCommandIdExample(noun: string): string {
  return noun.trim().replace(/\s+/gu, "-");
}

export const goalRegistryEntityDefinition = requireHealthEntityRegistryDefinition("goal");
export const conditionRegistryEntityDefinition = requireHealthEntityRegistryDefinition("condition");
export const allergyRegistryEntityDefinition = requireHealthEntityRegistryDefinition("allergy");
export const protocolRegistryEntityDefinition = requireHealthEntityRegistryDefinition("protocol");
export const familyRegistryEntityDefinition = requireHealthEntityRegistryDefinition("family");
export const geneticsRegistryEntityDefinition = requireHealthEntityRegistryDefinition("genetics");
