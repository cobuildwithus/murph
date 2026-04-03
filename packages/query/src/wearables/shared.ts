export function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeLowercaseString(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeUnit(value: unknown): string | null {
  return normalizeNullableString(value);
}

export function buildCandidateId(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0).join(":");
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function latestIsoTimestamp(values: readonly (string | null | undefined)[]): string | null {
  const normalized = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  if (normalized.length === 0) {
    return null;
  }

  return normalized.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export function compareIsoDesc(
  left: string | null,
  right: string | null,
): number {
  return (right ?? "").localeCompare(left ?? "");
}

export function collectSortedDatesDesc(values: readonly string[]): string[] {
  return uniqueStrings(values).sort((left, right) => right.localeCompare(left));
}

export function collectLatestDate(values: readonly (string | null | undefined)[]): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export function normalizeActivityTypeFromTitle(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/^(garmin|oura|whoop)\s+/iu, "")
    .replace(/\s+session$/iu, "")
    .trim() || null;
}

export function metersToKilometers(value: number): number {
  return Number((value / 1000).toFixed(4));
}

export function ageInMilliseconds(value: string | null, now: Date): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, now.getTime() - parsed) : null;
}

export function isIsoTimestampNewer(left: string | null, right: string | null): boolean {
  if (!left) {
    return false;
  }

  if (!right) {
    return true;
  }

  return left > right;
}

export function daysBetweenIsoDates(left: string, right: string): number {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`);
  const rightTime = Date.parse(`${right}T00:00:00.000Z`);

  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return 0;
  }

  return Math.round((rightTime - leftTime) / 86_400_000);
}
