import * as z from "@murphai/contracts/zod-runtime";
import { describe, expect, it } from "vitest";

import { hostedPhoneCallResultSchema } from "../src/phone-calls.js";

const previousStrictResultSchema = z
  .object({
    followUp: z.string().trim().max(1_000).optional(),
    outcome: z.enum(["completed", "not_completed", "needs_user"]),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

const LEGACY_RESULT = {
  outcome: "needs_user",
  summary: "The human conversation ended after Murph completed the handoff.",
} as const;

describe("hosted phone-call result schema evolution", () => {
  it("keeps the consumer-first reader compatible with legacy results", () => {
    expect(hostedPhoneCallResultSchema.parse(LEGACY_RESULT)).toEqual(
      LEGACY_RESULT,
    );
  });

  it("accepts only the bounded transfer follow-up policy", () => {
    expect(hostedPhoneCallResultSchema.parse({
      ...LEGACY_RESULT,
      completionPolicy: "transfer_follow_up_required",
    }).completionPolicy).toBe("transfer_follow_up_required");

    expect(() => hostedPhoneCallResultSchema.parse({
      ...LEGACY_RESULT,
      completionPolicy: "provider_decides",
    })).toThrow();
  });

  it("proves the previous strict reader rejects policy-bearing results", () => {
    expect(() => previousStrictResultSchema.parse({
      ...LEGACY_RESULT,
      completionPolicy: "transfer_follow_up_required",
    })).toThrow();
  });
});
