import type { BankEntityKind } from "@murph/contracts";

export type BankEntitySortBehavior = "gene-title" | "priority-title" | "title";

export interface BankEntityRegistryProjectionHelpers {
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

export interface BankEntityRegistryProjectionContext {
  attributes: Record<string, unknown>;
  helpers: BankEntityRegistryProjectionHelpers;
  relativePath: string;
}

export interface BankRegistryQueryMetadata {
  sortBehavior?: BankEntitySortBehavior;
  transform(
    context: BankEntityRegistryProjectionContext,
  ): Record<string, unknown>;
}

export type HealthRegistryProjectionKind = Extract<
  BankEntityKind,
  "goal" | "condition" | "allergy" | "protocol" | "family" | "genetics"
>;

function deriveProtocolGroupFromRelativePath(relativePath: string): string | null {
  const directories = relativePath.split("/").slice(0, -1);

  return directories.length > 2 ? directories.slice(2).join("/") : null;
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

function projectFoodAutoLogDaily(
  value: unknown,
  helpers: BankEntityRegistryProjectionHelpers,
): { time: string } | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const time = helpers.firstString(value, ["time"]);
  return time ? { time } : null;
}

function projectWorkoutStrengthExercises(
  value: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

const bankRegistryQueryMetadataByKind: Record<BankEntityKind, BankRegistryQueryMetadata> = {
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
  food: {
    sortBehavior: "title",
    transform({ attributes, helpers }) {
      return {
        summary: helpers.firstString(attributes, ["summary"]),
        kind: helpers.firstString(attributes, ["kind"]),
        brand: helpers.firstString(attributes, ["brand"]),
        vendor: helpers.firstString(attributes, ["vendor"]),
        location: helpers.firstString(attributes, ["location"]),
        serving: helpers.firstString(attributes, ["serving"]),
        aliases: helpers.firstStringArray(attributes, ["aliases"]),
        ingredients: helpers.firstStringArray(attributes, ["ingredients"]),
        tags: helpers.firstStringArray(attributes, ["tags"]),
        note: helpers.firstString(attributes, ["note"]),
        attachedProtocolIds: helpers.firstStringArray(attributes, ["attachedProtocolIds"]),
        autoLogDaily: projectFoodAutoLogDaily(attributes.autoLogDaily, helpers),
      };
    },
  },
  recipe: {
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
  provider: {
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
  workout_format: {
    sortBehavior: "title",
    transform({ attributes, helpers }) {
      return {
        summary: helpers.firstString(attributes, ["summary"]),
        activityType: helpers.firstString(attributes, ["activityType"]),
        durationMinutes: helpers.firstNumber(attributes, ["durationMinutes"]),
        distanceKm: helpers.firstNumber(attributes, ["distanceKm"]),
        strengthExercises: projectWorkoutStrengthExercises(attributes.strengthExercises),
        tags: helpers.firstStringArray(attributes, ["tags"]),
        note: helpers.firstString(attributes, ["note"]),
        templateText: helpers.firstString(attributes, ["templateText"]),
      };
    },
  },
};

export function getBankRegistryQueryMetadata(
  kind: BankEntityKind,
): BankRegistryQueryMetadata {
  return bankRegistryQueryMetadataByKind[kind];
}

export function getHealthRegistryQueryMetadata(
  kind: HealthRegistryProjectionKind,
): BankRegistryQueryMetadata {
  return getBankRegistryQueryMetadata(kind);
}
