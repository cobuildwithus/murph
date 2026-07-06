export const activityKindAliasGroups = [
  ["walk", "walking"],
  ["run", "running"],
  ["bike", "biking", "cycle", "cycling", "ride"],
  ["dance", "dancing"],
  ["surf", "surfing"],
  ["swim", "swimming"],
  ["hike", "hiking"],
  ["row", "rowing"],
  ["strength", "strength-training", "weightlifting", "weights"],
  ["sleep", "sleep-session", "sleep-summary", "sleep-cycle"],
] as const satisfies readonly (readonly string[])[];

export function normalizeActivityKindToken(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized && normalized.length > 0 ? normalized : null;
}

export function activityTextMatchesKind(
  text: string | null | undefined,
  requestedKind: string,
): boolean {
  const normalized = normalizeActivityKindToken(text);
  const requested = normalizeActivityKindToken(requestedKind);
  if (!normalized || !requested) {
    return false;
  }

  if (activityKindsEquivalent(normalized, requested)) {
    return true;
  }

  const requestedAliases = activityKindAliasSet(requested);
  return normalized.split("-").some((part) => requestedAliases.has(part));
}

function activityKindsEquivalent(left: string, right: string): boolean {
  return left === right ||
    activityKindAliasSet(left).has(right) ||
    activityKindAliasSet(right).has(left);
}

function activityKindAliasSet(value: string): Set<string> {
  const aliases = new Set([value]);
  for (const group of activityKindAliasGroups) {
    if ((group as readonly string[]).includes(value)) {
      for (const alias of group) {
        aliases.add(alias);
      }
    }
  }
  return aliases;
}
