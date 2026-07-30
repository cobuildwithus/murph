import { describe, expect, it } from "vitest";

import { parseHostedLinqPhoneNumberInventory } from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";

describe("parseHostedLinqPhoneNumberInventory", () => {
  it("keeps line service and reputation independent", () => {
    expect(
      parseHostedLinqPhoneNumberInventory({
        phone_numbers: [
          {
            id: "line_1",
            phone_number: "+1 (555) 000-0001",
            reputation: {
              doc_url: "https://docs.example.test/reputation",
              status: "AT_RISK",
            },
            status: "ACTIVE",
          },
          {
            id: "duplicate",
            phone_number: "+15550000001",
            reputation: { status: "HEALTHY" },
          },
          {
            health_status: {
              status: "HEALTHY",
            },
            id: "line_2",
            phone_number: "+15550000002",
            status: "FLAGGED",
          },
          {
            phone_number: "not-a-phone",
            reputation: { status: "HEALTHY" },
          },
        ],
      }),
    ).toEqual([
      {
        phoneNumber: "+15550000001",
        providerPhoneNumberId: "line_1",
        providerReputationStatus: "AT_RISK",
        providerServiceStatus: "ACTIVE",
      },
      {
        phoneNumber: "+15550000002",
        providerPhoneNumberId: "line_2",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "FLAGGED",
      },
    ]);
  });

  it("does not coerce unknown provider states", () => {
    expect(parseHostedLinqPhoneNumberInventory({
      phone_numbers: [{
        id: "line_future",
        phone_number: "+15550000003",
        reputation: { status: "PAUSED" },
        status: "WARMING",
      }],
    })).toEqual([{
      phoneNumber: "+15550000003",
      providerPhoneNumberId: "line_future",
      providerReputationStatus: null,
      providerServiceStatus: null,
    }]);
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

  it("fails visibly when provider inventory exceeds the configured sync limit", () => {
    expect(() => parseHostedLinqPhoneNumberInventory({
      phone_numbers: [
        { id: "line_1", phone_number: "+15550000001" },
        { id: "line_2", phone_number: "+15550000002" },
      ],
    }, {
      maxLines: 1,
    })).toThrow(/exceeds the configured 1 line limit/u);
  });
});
