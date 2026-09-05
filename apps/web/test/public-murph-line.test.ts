import { describe, expect, it, vi } from "vitest";

import type { HostedLinqContactCardLine } from "@/src/lib/hosted-onboarding/linq-line-store";

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  listHostedLinqContactCardLines: async () => [],
}));

const {
  readConfiguredMurphConversationPhoneNumbers,
  selectPublicMurphLinePhoneNumber,
} = await import("@/src/lib/goals/public-murph-line");

function line(
  phoneNumber: string,
  overrides: Partial<HostedLinqContactCardLine> = {},
): HostedLinqContactCardLine {
  return {
    isConfigured: true,
    phoneNumber,
    phoneNumberHint: phoneNumber.slice(-4),
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
    providerReputationStatus: "HEALTHY",
    providerServiceStatus: "ACTIVE",
    ...overrides,
  };
}

describe("selectPublicMurphLinePhoneNumber", () => {
  it("prefers a configured conversation number the table confirms healthy", () => {
    expect(selectPublicMurphLinePhoneNumber({
      configuredConversationPhoneNumbers: ["+15550100001", "+15550100002"],
      lines: [line("+15550100009"), line("+15550100002")],
    })).toBe("+15550100002");
  });

  it("skips at-risk, critical, and flagged lines", () => {
    expect(selectPublicMurphLinePhoneNumber({
      configuredConversationPhoneNumbers: ["+15550100001"],
      lines: [
        line("+15550100001", { providerReputationStatus: "AT_RISK" }),
        line("+15550100003", { providerServiceStatus: "FLAGGED" }),
        line("+15550100004", { isConfigured: false }),
        line("+15550100005"),
      ],
    })).toBe("+15550100005");
  });

  it("falls back to the configured list, then null", () => {
    expect(selectPublicMurphLinePhoneNumber({
      configuredConversationPhoneNumbers: ["+15550100001"],
      lines: [],
    })).toBe("+15550100001");
    expect(selectPublicMurphLinePhoneNumber({
      configuredConversationPhoneNumbers: [],
      lines: [],
    })).toBeNull();
  });
});

describe("readConfiguredMurphConversationPhoneNumbers", () => {
  it("normalizes a comma-separated list and drops junk", () => {
    expect(readConfiguredMurphConversationPhoneNumbers({
      HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS: " +1 (555) 010-0001 ,, nope, +15550100002",
    })).toEqual(["+15550100001", "+15550100002"]);
    expect(readConfiguredMurphConversationPhoneNumbers({})).toEqual([]);
  });
});
