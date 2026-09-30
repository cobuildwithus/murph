import * as z from "./zod-runtime.ts";

/** A source statement, not a current diagnosis, normalized metric or dose taken. */
export const clinicalFactSchema = z.object({
  category: z.enum([
    "observation", "exam-finding", "social-history", "family-history",
    "condition-history", "medication-order", "medication-history", "medication-dispense",
    "procedure-history", "immunization-history", "encounter-history", "care-plan",
    "service-order", "allergy-history", "report-finding",
  ]),
  label: z.string().trim().min(1).max(240),
  subject: z.enum(["member", "family", "unknown"]),
  // The containing note's timestamp dates its documentation. Null here must
  // never be interpreted as a clinical event on that timestamp.
  clinicalDate: z.union([z.iso.date(), z.iso.datetime({ offset: true }), z.null()]),
  statement: z.string().trim().min(1).max(2_000),
  value: z.union([z.number().finite(), z.string().min(1).max(2_000), z.boolean()]).optional(),
  unit: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().min(1).max(240).optional(),
  codings: z.array(z.object({
    code: z.string().min(1).max(200),
    system: z.string().min(1).max(500),
    display: z.string().min(1).max(240).optional(),
  }).strict()).min(1).max(20).optional(),
  qualifiers: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(1_000),
  }).strict()).min(1).max(30).optional(),
}).strict();

export type ClinicalFact = z.infer<typeof clinicalFactSchema>;
