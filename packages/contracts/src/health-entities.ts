import { ID_PREFIXES } from "./constants.js";

export type HealthEntityKind =
  | "assessment"
  | "profile"
  | "goal"
  | "condition"
  | "allergy"
  | "regimen"
  | "history"
  | "blood_test"
  | "family"
  | "genetics";

export type HealthEntitySortBehavior = "priority-title" | "title";

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

export interface HealthEntityRegistryMetadata {
  directory: string;
  idKeys: readonly string[];
  titleKeys: readonly string[];
  statusKeys: readonly string[];
  sortBehavior?: HealthEntitySortBehavior;
  transform?(
    context: HealthEntityRegistryProjectionContext,
  ): Record<string, unknown>;
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

export function deriveRegimenGroupFromRelativePath(relativePath: string): string | null {
  const directories = relativePath.split("/").slice(0, -1);

  return directories.length > 2 ? directories.slice(2).join("/") : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSupplementIngredients(
  value: unknown,
): Array<Record<string, unknown>> {
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

    return [
      Object.fromEntries(
        Object.entries({
          compound,
          label: typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : undefined,
          amount: typeof entry.amount === "number" && Number.isFinite(entry.amount) ? entry.amount : undefined,
          unit: typeof entry.unit === "string" && entry.unit.trim().length > 0 ? entry.unit.trim() : undefined,
          active: typeof entry.active === "boolean" ? entry.active : undefined,
          note: typeof entry.note === "string" && entry.note.trim().length > 0 ? entry.note.trim() : undefined,
        }).filter(([, entryValue]) => entryValue !== undefined),
      ),
    ];
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
  {
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
      directory: "bank/goals",
      idKeys: ["goalId"],
      titleKeys: ["title"],
      statusKeys: ["status"],
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
  },
  {
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
      directory: "bank/conditions",
      idKeys: ["conditionId"],
      titleKeys: ["title"],
      statusKeys: ["clinicalStatus"],
      transform({ attributes, helpers }) {
        return {
          clinicalStatus: helpers.firstString(attributes, ["clinicalStatus"]),
          verificationStatus: helpers.firstString(attributes, ["verificationStatus"]),
          assertedOn: helpers.firstString(attributes, ["assertedOn"]),
          resolvedOn: helpers.firstString(attributes, ["resolvedOn"]),
          severity: helpers.firstString(attributes, ["severity"]),
          bodySites: helpers.firstStringArray(attributes, ["bodySites"]),
          relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
          relatedRegimenIds: helpers.firstStringArray(attributes, ["relatedRegimenIds"]),
          note: helpers.firstString(attributes, ["note"]),
        };
      },
    },
  },
  {
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
      directory: "bank/allergies",
      idKeys: ["allergyId"],
      titleKeys: ["title"],
      statusKeys: ["status"],
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
  },
  {
    kind: "regimen",
    listKinds: ["regimen"],
    noun: "regimen",
    plural: "regimens",
    prefixes: [`${ID_PREFIXES.regimen}_`],
    scaffoldTemplate: {
      title: "Magnesium glycinate",
      kind: "supplement",
      status: "active",
      startedOn: "2026-03-12",
      group: "sleep",
    },
    registry: {
      directory: "bank/regimens",
      idKeys: ["regimenId"],
      titleKeys: ["title"],
      statusKeys: ["status"],
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
          relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
          relatedConditionIds: helpers.firstStringArray(attributes, ["relatedConditionIds"]),
          group: deriveRegimenGroupFromRelativePath(relativePath),
        };
      },
    },
  },
  {
    kind: "history",
    listKinds: ["encounter", "procedure", "test", "adverse_effect", "exposure"],
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
  {
    kind: "family",
    listKinds: ["family"],
    noun: "family",
    plural: "families",
    prefixes: [`${ID_PREFIXES.family}_`],
    scaffoldTemplate: {
      title: "Mother",
      relationship: "mother",
      conditions: ["hypertension"],
    },
    registry: {
      directory: "bank/family",
      idKeys: ["familyMemberId", "memberId"],
      titleKeys: ["title", "name"],
      statusKeys: [],
      transform({ attributes, helpers }) {
        return {
          relationship: helpers.firstString(attributes, ["relationship", "relation"]),
          deceased: helpers.firstBoolean(attributes, ["deceased"]),
          conditions: helpers.firstStringArray(attributes, ["conditions"]),
          relatedVariantIds: helpers.firstStringArray(attributes, ["relatedVariantIds"]),
          note: helpers.firstString(attributes, ["note", "summary", "notes"]),
          lineage: helpers.firstString(attributes, ["lineage"]),
          updatedAt: helpers.firstString(attributes, ["updatedAt"]),
        };
      },
    },
  },
  {
    kind: "genetics",
    listKinds: ["genetics"],
    noun: "genetics",
    plural: "genetics",
    prefixes: [`${ID_PREFIXES.variant}_`],
    scaffoldTemplate: {
      title: "MTHFR C677T",
      gene: "MTHFR",
      significance: "risk_factor",
    },
    registry: {
      directory: "bank/genetics",
      idKeys: ["variantId"],
      titleKeys: ["title", "label"],
      statusKeys: ["significance"],
      transform({ attributes, helpers }) {
        return {
          gene: helpers.firstString(attributes, ["gene"]),
          zygosity: helpers.firstString(attributes, ["zygosity"]),
          significance: helpers.firstString(attributes, ["significance"]),
          inheritance: helpers.firstString(attributes, ["inheritance"]),
          sourceFamilyMemberIds: helpers.firstStringArray(attributes, ["sourceFamilyMemberIds", "familyMemberIds"]),
          note: helpers.firstString(attributes, ["note", "summary", "actionability", "notes"]),
          updatedAt: helpers.firstString(attributes, ["updatedAt"]),
        };
      },
    },
  },
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
