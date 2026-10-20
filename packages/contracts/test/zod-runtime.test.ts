import { describe, expect, it } from "vitest";
import { z as fullZod } from "zod";

import * as z from "../src/zod-runtime.ts";

describe("bounded Zod runtime surface", () => {
  it.each([
    "2026-10-20T09:00Z",
    "2026-10-20T09:00-04:00",
    "2026-10-20T09:00+05:30",
    "2026-10-20T09:00:00Z",
    "2026-10-20T09:00:00.123456-04:00",
    "2028-02-29T09:00Z",
  ])("preserves previously accepted timestamp text: %s", (timestamp) => {
    expect(z.isoDateTime({ offset: true }).parse(timestamp)).toBe(timestamp);
  });

  it.each([
    "2026-02-29T09:00Z",
    "2026-10-20T24:00Z",
    "2026-10-20T09:60Z",
    "2026-10-20T09:00+24:00",
    "2026-10-20T09:00",
    "2026-10-20",
  ])("rejects malformed or unqualified timestamps: %s", (timestamp) => {
    expect(z.isoDateTime({ offset: true }).safeParse(timestamp).success).toBe(false);
  });

  it("retains UTC-only validation unless offsets are explicitly allowed", () => {
    const schema = z.isoDateTime();
    expect(schema.parse("2026-10-20T09:00Z")).toBe("2026-10-20T09:00Z");
    expect(schema.parse("2026-10-20T09:00:00Z")).toBe("2026-10-20T09:00:00Z");
    expect(schema.safeParse("2026-10-20T09:00-04:00").success).toBe(false);
    expect(schema.safeParse("2026-10-20T09:00:00-04:00").success).toBe(false);
  });

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
