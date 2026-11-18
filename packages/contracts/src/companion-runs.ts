import * as z from "./zod-runtime.ts";

/**
 * Each local day's run distance in the vault, for the last year. Absent on
 * replicas built before it shipped, which means unknown, never zero.
 */
export const companionRunsProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  days: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    km: z.number().positive().max(1_000),
  }).strict()),
}).strict();

export type CompanionRunsProjection = z.infer<typeof companionRunsProjectionSchema>;
