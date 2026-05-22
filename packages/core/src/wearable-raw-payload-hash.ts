import { createHash } from "node:crypto";

export type WearableRawPayloadJsonValue =
  | null
  | boolean
  | number
  | string
  | WearableRawPayloadJsonValue[]
  | { [key: string]: WearableRawPayloadJsonValue };

export function stableStringifyWearableRawPayload(value: unknown): string {
  return JSON.stringify(sortWearableRawPayloadValue(normalizeWearableRawPayload(value)));
}

export function hashWearableRawPayload(value: unknown): string {
  return createHash("sha256")
    .update(stableStringifyWearableRawPayload(value), "utf8")
    .digest("hex");
}

function normalizeWearableRawPayload(value: unknown): WearableRawPayloadJsonValue {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("Wearable raw ingest payload must contain only valid Dates.");
    }
    return value.toISOString();
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Wearable raw ingest payload must contain only finite JSON numbers.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeWearableRawPayload);
  }

  if (isPlainJsonObject(value)) {
    const normalized: Array<[string, WearableRawPayloadJsonValue]> = [];
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        normalized.push([key, normalizeWearableRawPayload(entry)]);
      }
    }
    return Object.fromEntries(normalized) as { [key: string]: WearableRawPayloadJsonValue };
  }

  throw new TypeError("Wearable raw ingest payload must be JSON-serializable.");
}

function sortWearableRawPayloadValue(
  value: WearableRawPayloadJsonValue,
): WearableRawPayloadJsonValue {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sortWearableRawPayloadValue(entry));
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortWearableRawPayloadValue(entry)]),
  );
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
