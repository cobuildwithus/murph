import { VaultError } from "./errors.ts";

export interface CanonicalEventLink {
  type: string;
  targetId: string;
}

export function assertNoLegacyRelatedIds({
  value,
  errorCode,
  errorMessage,
}: {
  value: unknown;
  errorCode: string;
  errorMessage: string;
}): void {
  if (value === undefined) {
    return;
  }

  throw new VaultError(errorCode, errorMessage);
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
