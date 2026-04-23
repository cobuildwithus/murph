import { VaultError } from "./errors.ts";

export interface CanonicalEventLink {
  type: string;
  targetId: string;
}

export function normalizeCanonicalEventLinks({
  value,
  errorCode,
  errorMessage,
}: {
  value: unknown;
  errorCode: string;
  errorMessage: string;
}): CanonicalEventLink[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VaultError(errorCode, errorMessage);
  }

  const links: CanonicalEventLink[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new VaultError(errorCode, errorMessage);
    }

    const candidate = entry as Record<string, unknown>;
    const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
    const targetId = typeof candidate.targetId === "string" ? candidate.targetId.trim() : "";

    if (!type || !targetId) {
      throw new VaultError(errorCode, errorMessage);
    }

    const dedupeKey = `${type}:${targetId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    links.push({ type, targetId });
  }

  return links.length > 0 ? links : [];
}

export function canonicalizeEventRelations({
  links,
  relatedIds,
  normalizeStringList,
  errorCode,
  errorMessage,
}: {
  links: unknown;
  relatedIds: unknown;
  normalizeStringList: (value: unknown) => string[] | undefined;
  errorCode: string;
  errorMessage: string;
}): {
  links: CanonicalEventLink[] | undefined;
} {
  const normalizedLinks = normalizeCanonicalEventLinks({
    value: links,
    errorCode,
    errorMessage,
  });
  const normalizedRelatedIds = normalizeStringList(relatedIds);
  const canonicalLinks =
    normalizedLinks !== undefined
      ? normalizedLinks
      : normalizedRelatedIds?.map((targetId) => ({
          type: "related_to",
          targetId,
        }));

  return {
    links: canonicalLinks,
  };
}
