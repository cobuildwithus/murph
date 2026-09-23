import { expectNumber, expectString, type DatabaseSync } from "./schema.ts";

// Only this derived SQLite representation uses tags. Public summary JSON and
// the semantic summary codec keep their existing contracts.
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function readWearableSummaryShapes(database: DatabaseSync): Map<number, string[]> {
  return new Map(database.prepare(`
    SELECT shape_id, keys_json FROM query_wearable_summary_shapes
  `).all().map((row) => {
    const id = expectNumber(row.shape_id, "query_wearable_summary_shapes.shape_id");
    const keys: unknown = JSON.parse(expectString(row.keys_json, "query_wearable_summary_shapes.keys_json"));
    if (!Array.isArray(keys) || !keys.every((key): key is string => typeof key === "string")
      || new Set(keys).size !== keys.length) {
      throw new Error("Invalid wearable summary field dictionary. Rebuild the query projection.");
    }
    return [id, keys];
  }));
}

export function createWearableSummaryEncoder(database: DatabaseSync): (json: string) => string {
  const shapes = readWearableSummaryShapes(database);
  const idsByKeys = new Map([...shapes].map(([id, keys]) => [JSON.stringify(keys), id]));
  let nextShapeId = Math.max(0, ...shapes.keys()) + 1;
  const insertShape = database.prepare(`
    INSERT INTO query_wearable_summary_shapes (shape_id, keys_json) VALUES (?, ?)
  `);
  const registerShape = (keys: string[]): number => {
    const keysJson = JSON.stringify(keys);
    const existing = idsByKeys.get(keysJson);
    if (existing !== undefined) return existing;
    const id = nextShapeId++;
    insertShape.run(id, keysJson);
    idsByKeys.set(keysJson, id);
    return id;
  };
  return (json) => JSON.stringify(encode(JSON.parse(json) as JsonValue, registerShape));
}

function encode(value: JsonValue, registerShape: (keys: string[]) => number): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return [1, ...value.map((item) => encode(item, registerShape))];
  const keys = Object.keys(value);
  return [0, registerShape(keys), ...keys.map((key) => encode(value[key]!, registerShape))];
}

export function decodeWearableSummaryJson(json: string, shapes: ReadonlyMap<number, string[]>): string {
  return JSON.stringify(decode(JSON.parse(json) as JsonValue, shapes));
}

function decode(value: JsonValue, shapes: ReadonlyMap<number, string[]>): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (!Array.isArray(value)) throw invalidEncoding();
  if (value[0] === 1) return value.slice(1).map((item) => decode(item, shapes));
  const keys = value[0] === 0 && typeof value[1] === "number" ? shapes.get(value[1]) : undefined;
  if (!keys || value.length !== keys.length + 2) throw invalidEncoding();
  // Own data properties preserve keys such as __proto__ without invoking setters.
  return Object.fromEntries(keys.map((key, index) => [key, decode(value[index + 2]!, shapes)]));
}

function invalidEncoding(): Error {
  return new Error("Invalid wearable summary encoding. Rebuild the query projection.");
}
