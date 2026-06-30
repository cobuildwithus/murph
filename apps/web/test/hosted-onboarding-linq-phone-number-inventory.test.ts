import { describe, expect, it } from "vitest";

import { parseHostedLinqPhoneNumberInventory } from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";

describe("parseHostedLinqPhoneNumberInventory", () => {
  it("normalizes common provider response shapes and deduplicates phone numbers", () => {
    expect(
      parseHostedLinqPhoneNumberInventory({
        phone_numbers: [
          {
            id: "line_1",
            phone_number: "+1 (555) 000-0001",
            reputation: {
              status: "AT_RISK",
            },
            status_reason: "warmup",
          },
          {
            id: "duplicate",
            number: "+15550000001",
            status: "ACTIVE",
          },
          {
            phoneNumberId: "line_2",
            phoneNumber: "+15550000002",
            status: "ACTIVE",
          },
          {
            phone_number: "not-a-phone",
            status: "ACTIVE",
          },
        ],
      }),
    ).toEqual([
      {
        phoneNumber: "+15550000001",
        providerPhoneNumberId: "line_1",
        providerReason: "warmup",
        providerStatus: "AT_RISK",
      },
      {
        phoneNumber: "+15550000002",
        providerPhoneNumberId: "line_2",
        providerReason: null,
        providerStatus: "ACTIVE",
      },
    ]);
  });
});
