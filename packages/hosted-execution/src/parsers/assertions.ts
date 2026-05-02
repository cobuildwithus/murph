export function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function rejectLegacyAliases(
  record: Record<string, unknown>,
  label: string,
  removedAliases: Readonly<Record<string, string>>,
): void {
  // Greenfield hard-cut guard: these keys are rejected, not translated.
  for (const [legacyKey, activeContract] of Object.entries(removedAliases)) {
    if (Object.prototype.hasOwnProperty.call(record, legacyKey)) {
      throw new TypeError(
        `${label} must not include legacy ${legacyKey}; use ${activeContract}.`,
      );
    }
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

export function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

export function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

export function readNullableStringValue(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}

export function readNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNumber(value, label);
}

export function readOptionalNullableString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readNullableString(value, label);
}

export function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

export function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

export function readOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireStringArray(value, label);
}

export function readNullableBigIntString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireBigIntString(value, label);
}

export function requireBigIntString(value: unknown, label: string): string {
  const text = requireString(value, label);

  try {
    BigInt(text);
  } catch {
    throw new TypeError(`${label} must be a base-10 integer string.`);
  }

  return text;
}
