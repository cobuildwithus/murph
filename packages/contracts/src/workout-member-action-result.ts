import * as z from "./zod-runtime.ts";

const SINGLE_LINE_PATTERN = /^[^\u0000-\u001F\u007F\u2028\u2029\r\n]+$/u;

function singleLineText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: "Expected text without surrounding whitespace.",
    })
    .regex(SINGLE_LINE_PATTERN, "Expected one printable line of text.");
}

const canonicalNonnegativeIntegerSchema = z
  .number()
  .finite()
  .min(0)
  .refine((value) => Number.isInteger(value), "Expected an integer.");

export const workoutMemberActionExpectedSetResultV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("note"),
        note: singleLineText(400).nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("reps"),
        reps: canonicalNonnegativeIntegerSchema.nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("weight_reps"),
        reps: canonicalNonnegativeIntegerSchema.nullable(),
        weight: z.number().finite().min(0).nullable(),
        weightUnit: z.enum(["lb", "kg"]).nullable(),
      })
      .strict(),
  ],
);

export type WorkoutMemberActionExpectedSetResultV1 = z.infer<
  typeof workoutMemberActionExpectedSetResultV1Schema
>;
