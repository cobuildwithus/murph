export function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function isBrowserSafeJson(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isBrowserSafeJson);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isBrowserSafeJson);
  }

  return false;
}
