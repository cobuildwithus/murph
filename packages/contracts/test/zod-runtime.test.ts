import { describe, expect, it } from "vitest";
import { z as fullZod } from "zod";

import * as z from "../src/zod-runtime.ts";

describe("bounded Zod runtime surface", () => {
  it("preserves schema parsing and the default English issue contract", () => {
    const compactSchema = z.object({
      count: z.number().int().positive(),
      label: z.string().min(2),
    });
    const fullSchema = fullZod.object({
      count: fullZod.number().int().positive(),
      label: fullZod.string().min(2),
    });
    const input = { count: 0, label: "x" };

    expect(compactSchema.safeParse(input)).toEqual(fullSchema.safeParse(input));
    expect(compactSchema).toBeInstanceOf(z.ZodObject);
  });

  it("keeps the public namespace bounded and converts schemas to JSON Schema", () => {
    expect(Object.hasOwn(z, "locales")).toBe(false);
    expect(Object.hasOwn(z, "core")).toBe(false);
    expect(z.toJSONSchema(z.strictObject({ value: z.string() }), { io: "input" })).toMatchObject({
      additionalProperties: false,
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
      type: "object",
    });
  });
});
