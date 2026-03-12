import type { JsonSchema, JsonSchemaTypeName, JsonValue } from "./types.js";

type FrontmatterValue = string | string[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(path: string, message: string): string {
  return `${path}: ${message}`;
}

function matchesType(value: unknown, type: JsonSchemaTypeName): boolean {
  if (type === "array") {
    return Array.isArray(value);
  }

  if (type === "integer") {
    return Number.isInteger(value);
  }

  if (type === "null") {
    return value === null;
  }

  if (type === "object") {
    return isPlainObject(value);
  }

  return typeof value === type;
}

function validateFormat(value: unknown, format: string): boolean {
  if (typeof value !== "string") {
    return false;
  }

  if (format === "date-time") {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return false;
    }

    return !Number.isNaN(Date.parse(value));
  }

  if (format === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  }

  return true;
}

export function validateAgainstSchema(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];

  if (schema.oneOf) {
    const passingVariants = schema.oneOf.filter((variant) => validateAgainstSchema(variant, value, path).length === 0);
    if (passingVariants.length !== 1) {
      errors.push(formatError(path, `expected exactly one matching schema variant, received ${passingVariants.length}`));
    }
    return errors;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(formatError(path, `expected constant ${JSON.stringify(schema.const)}`));
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value as JsonValue)) {
    errors.push(formatError(path, `expected one of ${schema.enum.join(", ")}`));
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((type) => matchesType(value, type))) {
      errors.push(formatError(path, `expected type ${allowedTypes.join(" | ")}`));
      return errors;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(formatError(path, `expected length >= ${schema.minLength}`));
    }

    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(formatError(path, `expected length <= ${schema.maxLength}`));
    }

    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(formatError(path, `expected to match ${schema.pattern}`));
    }

    if (schema.format && !validateFormat(value, schema.format)) {
      errors.push(formatError(path, `expected format ${schema.format}`));
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(formatError(path, `expected number >= ${schema.minimum}`));
    }

    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(formatError(path, `expected number <= ${schema.maximum}`));
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(formatError(path, `expected at least ${schema.minItems} item(s)`));
    }

    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(formatError(path, `expected at most ${schema.maxItems} item(s)`));
    }

    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) {
        errors.push(formatError(path, "expected unique array items"));
      }
    }

    const itemSchema = schema.items;
    if (itemSchema) {
      value.forEach((item, index) => {
        errors.push(...validateAgainstSchema(itemSchema, item, `${path}[${index}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];

    for (const key of required) {
      if (!(key in value)) {
        errors.push(formatError(path, `missing required property ${key}`));
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(formatError(path, `unexpected property ${key}`));
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) {
        errors.push(...validateAgainstSchema(propertySchema, value[key], `${path}.${key}`));
      }
    }
  }

  return errors;
}

export function assertValidAgainstSchema<T>(schema: JsonSchema, value: T, label = "value"): T {
  const errors = validateAgainstSchema(schema, value);
  if (errors.length > 0) {
    throw new TypeError(`${label} failed validation:\n${errors.join("\n")}`);
  }
  return value;
}

export function parseFrontmatterMarkdown(markdown: string): Record<string, FrontmatterValue> {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new TypeError("Frontmatter must start with ---");
  }

  const result: Record<string, FrontmatterValue> = {};
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "---") {
      return result;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const keyMatch = /^([A-Za-z0-9]+):(?:\s(.*))?$/.exec(line);
    if (!keyMatch) {
      throw new TypeError(`Unsupported frontmatter line: ${line}`);
    }

    const [, key, rawValue = ""] = keyMatch;

    if (rawValue === "") {
      const values: string[] = [];
      index += 1;
      while (index < lines.length && /^  - /.test(lines[index])) {
        values.push(lines[index].slice(4));
        index += 1;
      }
      result[key] = values;
      continue;
    }

    result[key] = rawValue;
    index += 1;
  }

  throw new TypeError("Frontmatter terminator --- not found");
}
