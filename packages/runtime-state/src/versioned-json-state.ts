export interface VersionedJsonStateEnvelope<T> {
  schema: string;
  schemaVersion: number;
  value: T;
}

export interface ParseVersionedJsonStateEnvelopeInput<T> {
  label: string;
  legacyParseValue?: (value: unknown) => T;
  parseValue: (value: unknown) => T;
  schema: string;
  schemaVersion: number;
}

export function createVersionedJsonStateEnvelope<T>(input: {
  schema: string;
  schemaVersion: number;
  value: T;
}): VersionedJsonStateEnvelope<T> {
  return {
    schema: input.schema,
    schemaVersion: input.schemaVersion,
    value: input.value,
  };
}

export function parseVersionedJsonStateEnvelope<T>(
  value: unknown,
  input: ParseVersionedJsonStateEnvelopeInput<T>,
): T {
  if (isPlainObject(value) && "schema" in value && "schemaVersion" in value && "value" in value) {
    const schema = typeof value.schema === "string" ? value.schema.trim() : "";
    const schemaVersion = typeof value.schemaVersion === "number" ? value.schemaVersion : NaN;

    if (schema !== input.schema) {
      throw new TypeError(`${input.label} schema must be ${input.schema}.`);
    }

    if (schemaVersion !== input.schemaVersion) {
      throw new TypeError(`${input.label} schemaVersion must be ${input.schemaVersion}.`);
    }

    return input.parseValue(value.value);
  }

  if (input.legacyParseValue) {
    return input.legacyParseValue(value);
  }

  throw new TypeError(`${input.label} must be a versioned ${input.schema} envelope.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
