// The hosted runner imports this bounded Zod surface as a namespace so its
// schema call sites keep the ordinary `z.object(...)` API without retaining
// Zod's top-level locale catalog and unrelated helpers in the boot closure.
// Keep this list limited to members used by production workspace packages;
// the runner bundle guard rejects locale modules if a direct root import
// reaches the static graph again.
import {
  iso as zodIso,
  toJSONSchema as convertToJsonSchema,
  union as zodUnion,
  type ZodType,
} from "zod/v4";

export {
  NEVER,
  ZodError,
  ZodIssueCode,
  ZodObject,
  any,
  array,
  boolean,
  custom,
  date,
  discriminatedUnion,
  enum,
  intersection,
  iso,
  json,
  lazy,
  literal,
  null,
  number,
  object,
  partialRecord,
  preprocess,
  record,
  strictObject,
  string,
  tuple,
  union,
  unknown,
} from "zod/v4";

export type {
  RefinementCtx,
  ZodArray,
  ZodIssue,
  ZodNumber,
  ZodOptional,
  ZodRawShape,
  ZodString,
  ZodType,
  ZodTypeAny,
  infer,
  input,
  output,
} from "zod/v4";

export type ZodJsonSchema = Record<string, unknown>;

export interface ZodJsonSchemaOptions {
  io?: "input" | "output";
}

// Persisted contracts accepted minute precision before Zod 4.5. Keep those
// values readable without rewriting strings used for schedule identity.
export function isoDateTime(options: { offset?: boolean } = {}) {
  return zodUnion([
    zodIso.datetime(options),
    zodIso.datetime({ ...options, precision: -1 }),
  ]);
}

export function toJSONSchema(
  schema: ZodType,
  options?: ZodJsonSchemaOptions,
): ZodJsonSchema {
  return convertToJsonSchema(schema, options) as ZodJsonSchema;
}
