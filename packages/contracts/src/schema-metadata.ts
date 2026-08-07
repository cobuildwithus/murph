import type { ZodTypeAny } from "./zod-runtime.ts";

export function withContractMetadata<TSchema extends ZodTypeAny>(
  schema: TSchema,
  id: string,
  title: string,
): TSchema {
  return schema.meta({
    $id: id,
    title,
  }) as TSchema;
}
