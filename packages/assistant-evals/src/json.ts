export type JsonPrimitive = boolean | null | number | string;

export type JsonArray = readonly JsonValue[];

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export function assertJsonValue(
  value: unknown,
  label = "value",
): asserts value is JsonValue {
  visitJsonValue(value, label, new WeakSet<object>());
}

export function cloneJsonValue<TValue extends JsonValue>(
  value: TValue,
  label = "value",
): TValue {
  assertJsonValue(value, label);

  // JSON.parse is intentionally isolated at this already-validated JSON boundary.
  return JSON.parse(JSON.stringify(value)) as TValue;
}

export function freezeJsonValue<TValue extends JsonValue>(
  value: TValue,
): TValue {
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeJsonValue(item);
    }
    Object.freeze(value);
    return value;
  }

  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      freezeJsonValue(item);
    }
    Object.freeze(value);
  }

  return value;
}

function visitJsonValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): void {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite JSON numbers.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new TypeError(`${path} must be JSON-serializable.`);
  }

  if (seen.has(value)) {
    throw new TypeError(`${path} must not contain circular references.`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitJsonValue(item, `${path}[${index}]`, seen);
    });
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain JSON objects.`);
  }

  for (const [key, item] of Object.entries(value)) {
    visitJsonValue(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}
