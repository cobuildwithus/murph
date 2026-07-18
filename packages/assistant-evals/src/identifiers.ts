const EVAL_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

export function assertEvalIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !EVAL_IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(
      `${label} must use lowercase letters, numbers, dots, underscores, or hyphens without repeated separators.`,
    );
  }
}

export function compareEvalIdentifiers(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function assertPositiveInteger(
  value: number,
  label: string,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}.`);
  }
}

export function assertNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

export function normalizeIdentifierList(
  values: readonly string[],
  label: string,
  options: {
    allowEmpty?: boolean;
  } = {},
): readonly string[] {
  if (values.length === 0 && options.allowEmpty !== true) {
    throw new TypeError(`${label} must contain at least one value.`);
  }

  const normalized = values.map((value, index) => {
    assertEvalIdentifier(value, `${label}[${index}]`);
    return value;
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must not contain duplicate values.`);
  }

  return Object.freeze([...normalized]);
}
