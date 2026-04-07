import {
  getHealthEntityRegistryProjectionMetadata,
  type BankEntityKind,
  type HealthEntityRegistryKind,
  type HealthEntityRegistryProjectionContext as BankEntityRegistryProjectionContext,
  type HealthEntityRegistryProjectionHelpers as BankEntityRegistryProjectionHelpers,
  type HealthEntityRegistryProjectionMetadata as BankRegistryQueryMetadata,
  type HealthEntityRegistryProjectionSortBehavior as BankEntitySortBehavior,
} from "@murphai/contracts";

export type {
  BankEntityRegistryProjectionContext,
  BankEntityRegistryProjectionHelpers,
  BankEntitySortBehavior,
  BankRegistryQueryMetadata,
};

export type HealthRegistryProjectionKind = HealthEntityRegistryKind;

type NonHealthBankEntityKind = Exclude<BankEntityKind, HealthRegistryProjectionKind>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

const bankRegistryQueryMetadataByKind: Record<NonHealthBankEntityKind, BankRegistryQueryMetadata> = {
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
        template: helpers.firstObject(attributes, ["template"]),
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
  return isHealthRegistryProjectionKind(kind)
    ? getHealthEntityRegistryProjectionMetadata(kind)
    : bankRegistryQueryMetadataByKind[kind];
}

export function getHealthRegistryQueryMetadata(
  kind: HealthRegistryProjectionKind,
): BankRegistryQueryMetadata {
  return getHealthEntityRegistryProjectionMetadata(kind);
}

function isHealthRegistryProjectionKind(
  kind: BankEntityKind,
): kind is HealthRegistryProjectionKind {
  return kind === "goal"
    || kind === "condition"
    || kind === "allergy"
    || kind === "protocol"
    || kind === "family"
    || kind === "genetics";
}
