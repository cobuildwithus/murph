import {
  projectSupplementIngredients,
  type BankEntityRegistryProjectionHelpers,
  type BankEntitySortBehavior,
  type HealthEntityKind,
} from "@murph/contracts";

interface HealthRegistryProjectionContext {
  attributes: Record<string, unknown>;
  helpers: BankEntityRegistryProjectionHelpers;
  relativePath: string;
}

interface HealthRegistryQueryMetadata {
  sortBehavior?: BankEntitySortBehavior;
  transform(
    context: HealthRegistryProjectionContext,
  ): Record<string, unknown>;
}

type HealthRegistryProjectionKind = Extract<
  HealthEntityKind,
  "goal" | "condition" | "allergy" | "protocol" | "family" | "genetics"
>;

function deriveProtocolGroupFromRelativePath(relativePath: string): string | null {
  const directories = relativePath.split("/").slice(0, -1);

  return directories.length > 2 ? directories.slice(2).join("/") : null;
}

const healthRegistryQueryMetadataByKind: Record<
  HealthRegistryProjectionKind,
  HealthRegistryQueryMetadata
> = {
  goal: {
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
  condition: {
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
  allergy: {
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
  protocol: {
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
          helpers.firstString(attributes, ["group"]) ??
          deriveProtocolGroupFromRelativePath(relativePath),
      };
    },
  },
  family: {
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
  genetics: {
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
};

export function getHealthRegistryQueryMetadata(
  kind: HealthRegistryProjectionKind,
): HealthRegistryQueryMetadata {
  return healthRegistryQueryMetadataByKind[kind];
}

export type {
  HealthRegistryProjectionContext,
  HealthRegistryProjectionKind,
  HealthRegistryQueryMetadata,
};
