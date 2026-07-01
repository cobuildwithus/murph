import { describe, expect, it } from "vitest";

import { parseHostedLinqPhoneNumberInventory } from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";

describe("parseHostedLinqPhoneNumberInventory", () => {
  it("normalizes the documented provider response shape and deduplicates phone numbers", () => {
    expect(
      parseHostedLinqPhoneNumberInventory({
        phone_numbers: [
          {
            id: "line_1",
            phone_number: "+1 (555) 000-0001",
            reputation: {
              reason: "warmup",
              status: "AT_RISK",
            },
          },
          {
            id: "duplicate",
            phone_number: "+15550000001",
            reputation: {
              status: "HEALTHY",
            },
          },
          {
            health_status: "HEALTHY",
            id: "line_2",
            phone_number: "+15550000002",
          },
          {
            phone_number: "not-a-phone",
            reputation: {
              status: "HEALTHY",
            },
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
        providerStatus: "HEALTHY",
      },
    ]);
  });

  it("does not accept ad hoc collection or phone field aliases", () => {
    expect(
      parseHostedLinqPhoneNumberInventory({
        data: [
          {
            id: "line_1",
            number: "+15550000001",
            status: "ACTIVE",
          },
        ],
      }),
    ).toEqual([]);
  });
});
