import {
  CANONICAL_RELATION_LINK_TYPES,
  extractIsoDatePrefix,
  type BankEntityKind,
  type CanonicalRelationLinkType,
} from "@murphai/contracts";

export type CanonicalRecordClass = "bank" | "ledger" | "sample" | "snapshot";

export type CanonicalEntityFamily =
  | BankEntityKind
  | "assessment"
  | "audit"
  | "core"
  | "event"
  | "experiment"
  | "journal"
  | "sample";

export interface CanonicalEntity {
  entityId: string;
  primaryLookupId: string;
  lookupIds: string[];
  family: CanonicalEntityFamily;
  recordClass: CanonicalRecordClass;
  kind: string;
  status: string | null;
  occurredAt: string | null;
  date: string | null;
  path: string;
  title: string | null;
  body: string | null;
  attributes: Record<string, unknown>;
  frontmatter: Record<string, unknown> | null;
  links: CanonicalEntityLink[];
  relatedIds: string[];
  stream: string | null;
  experimentSlug: string | null;
  tags: string[];
}

export const canonicalEntityLinkTypes = CANONICAL_RELATION_LINK_TYPES;

export type CanonicalEntityLinkType = CanonicalRelationLinkType;

export interface CanonicalEntityLink {
  type: CanonicalEntityLinkType;
  targetId: string;
}

export function resolveCanonicalRecordClass(
  family: CanonicalEntityFamily,
): CanonicalRecordClass {
  switch (family) {
    case "allergy":
    case "condition":
    case "experiment":
    case "family":
    case "food":
    case "genetics":
    case "goal":
    case "protocol":
    case "provider":
    case "recipe":
    case "workout_format":
      return "bank";
    case "sample":
      return "sample";
    case "assessment":
    case "core":
      return "snapshot";
    case "audit":
    case "event":
    case "journal":
      return "ledger";
  }
}

export function normalizeCanonicalDate(
  value: string | null | undefined,
): string | null {
  return extractIsoDatePrefix(value);
}

export function uniqueStrings(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    ),
  ];
}

export function normalizeUniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function linkTargetIds(
  links: readonly CanonicalEntityLink[],
): string[] {
  return uniqueStrings(links.map((link) => link.targetId));
}

export function normalizeCanonicalLinks(
  links: readonly (CanonicalEntityLink | null | undefined)[],
): CanonicalEntityLink[] {
  const normalized: CanonicalEntityLink[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    if (!link) {
      continue;
    }

    const targetId = link.targetId.trim();
    if (!targetId) {
      continue;
    }

    const dedupeKey = `${link.type}:${targetId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      type: link.type,
      targetId,
    });
  }

  return normalized;
}

export function isCanonicalEntityLinkType(
  value: string,
): value is CanonicalEntityLinkType {
  return (canonicalEntityLinkTypes as readonly string[]).includes(value);
}

export function relatedToLinks(
  targetIds: readonly string[],
): CanonicalEntityLink[] {
  return normalizeCanonicalLinks(
    targetIds.map((targetId) => ({
      type: "related_to" as const,
      targetId,
    })),
  );
}

export function compareCanonicalEntities(
  left: CanonicalEntity,
  right: CanonicalEntity,
): number {
  const leftSortKey = left.occurredAt ?? left.date ?? left.entityId;
  const rightSortKey = right.occurredAt ?? right.date ?? right.entityId;

  if (leftSortKey < rightSortKey) {
    return -1;
  }

  if (leftSortKey > rightSortKey) {
    return 1;
  }

  return left.entityId.localeCompare(right.entityId);
}
