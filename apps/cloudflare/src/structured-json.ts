export function stringifyStructuredJson(value: unknown): string {
  return JSON.stringify(canonicalizeStructuredJson(value));
}

export function sameStructuredJsonValue(left: unknown, right: unknown): boolean {
  return stringifyStructuredJson(left) === stringifyStructuredJson(right);
}

function canonicalizeStructuredJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeStructuredJson(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeStructuredJson(entry)]),
  );
}
