export const PUBLIC_HEALTH_GOAL_CATEGORIES = [
  "biomarkers",
  "cardio",
  "life-stages",
  "mind",
  "nutrition",
  "sleep",
  "strength",
] as const;

export const PUBLIC_HEALTH_GOAL_MINIMUM_COUNT = 250;

const PUBLIC_HEALTH_GOAL_REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PUBLIC_HEALTH_GOAL_REQUIRED_COMPACT_TEXT_FIELDS = [
  "goalPhrase",
  "outcomeKind",
  "quality",
  "safetyTier",
  "slug",
  "startPrompt",
  "status",
  "summary",
  "title",
] as const;

interface PublicHealthGoalCatalogEntry {
  readonly category?: unknown;
  readonly goalPhrase?: unknown;
  readonly key?: unknown;
  readonly outcomeKind?: unknown;
  readonly quality?: unknown;
  readonly revision?: unknown;
  readonly routeId?: unknown;
  readonly safetyTier?: unknown;
  readonly slug?: unknown;
  readonly startPrompt?: unknown;
  readonly status?: unknown;
  readonly summary?: unknown;
  readonly title?: unknown;
}

export function hasCompletePublicHealthGoalCatalog(
  goals: readonly PublicHealthGoalCatalogEntry[],
): boolean {
  if (goals.length < PUBLIC_HEALTH_GOAL_MINIMUM_COUNT) {
    return false;
  }

  const allowedCategories = new Set<string>(PUBLIC_HEALTH_GOAL_CATEGORIES);
  const actualCategories = new Set<string>();
  const keys = new Set<string>();
  const routeIds = new Set<string>();

  for (const goal of goals) {
    const key = goal.key;
    const routeId = goal.routeId;
    if (
      typeof goal.category !== "string"
      || !allowedCategories.has(goal.category)
      || !isNonEmptyString(key)
      || !isNonEmptyString(routeId)
      || PUBLIC_HEALTH_GOAL_REQUIRED_COMPACT_TEXT_FIELDS.some(
        (field) => !isNonEmptyString(goal[field]),
      )
      || !hasExactPublicHealthGoalRevision(goal.revision)
    ) {
      return false;
    }

    if (keys.has(key) || routeIds.has(routeId)) {
      return false;
    }

    actualCategories.add(goal.category);
    keys.add(key);
    routeIds.add(routeId);
  }

  return actualCategories.size === PUBLIC_HEALTH_GOAL_CATEGORIES.length;
}

function hasExactPublicHealthGoalRevision(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const revision = value as Record<string, unknown>;
  return typeof revision["pageRevisionId"] === "string"
    && PUBLIC_HEALTH_GOAL_REVISION_PATTERN.test(revision["pageRevisionId"])
    && typeof revision["workflowSpecRevisionId"] === "string"
    && PUBLIC_HEALTH_GOAL_REVISION_PATTERN.test(
      revision["workflowSpecRevisionId"],
    );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
