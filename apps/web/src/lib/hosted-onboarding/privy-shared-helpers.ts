import type { PrivyLinkedAccountLike } from "./privy-shared-types";

export function selectNewestTimestampedCandidate<T extends { verifiedAt: number }>(
  candidates: readonly T[],
  identityKey: (candidate: T) => string,
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  const deduped = new Map<string, T>();

  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const existing = deduped.get(key);

    if (!existing || candidate.verifiedAt > existing.verifiedAt) {
      deduped.set(key, candidate);
    }
  }

  let best: T | null = null;
  let bestKey: string | null = null;

  for (const [key, candidate] of deduped.entries()) {
    if (!best || candidate.verifiedAt > best.verifiedAt) {
      best = candidate;
      bestKey = key;
      continue;
    }

    if (best && candidate.verifiedAt === best.verifiedAt && key !== bestKey) {
      return null;
    }
  }

  return best;
}

export function selectLowestRankCandidate<T>(
  candidates: readonly T[],
  identityKey: (candidate: T) => string,
  rank: (candidate: T) => number,
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  const deduped = new Map<string, T>();

  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const existing = deduped.get(key);

    if (!existing || rank(candidate) < rank(existing)) {
      deduped.set(key, candidate);
    }
  }

  let best: T | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestKey: string | null = null;

  for (const [key, candidate] of deduped.entries()) {
    const candidateRank = rank(candidate);

    if (candidateRank < bestRank) {
      best = candidate;
      bestRank = candidateRank;
      bestKey = key;
      continue;
    }

    if (candidateRank === bestRank && key !== bestKey) {
      return null;
    }
  }

  return best;
}

export function parseLinkedAccounts(input: unknown): PrivyLinkedAccountLike[] {
  if (Array.isArray(input)) {
    return input.filter((value): value is PrivyLinkedAccountLike => Boolean(value) && typeof value === "object");
  }

  if (typeof input !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is PrivyLinkedAccountLike => Boolean(value) && typeof value === "object")
      : [];
  } catch {
    return [];
  }
}

export function firstTimestamp(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return Math.trunc(value.getTime() / 1000);
    }
  }

  return null;
}

export function firstInteger(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }

    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
      return Number.parseInt(value, 10);
    }
  }

  return null;
}

export function preferLongerString(current: string | null, next: string | null): string | null {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return next.length > current.length ? next : current;
}

export function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function firstNumberishString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === "bigint") {
      return String(value);
    }
  }

  return null;
}

export function hasAnyKey(record: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return true;
    }
  }

  return false;
}
