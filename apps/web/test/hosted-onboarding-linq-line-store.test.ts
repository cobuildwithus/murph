import { describe, expect, it, vi } from "vitest";

import {
  listHostedLinqContactCardLines,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import {
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";

describe("listHostedLinqContactCardLines", () => {
  it("fills the contact-card batch with configured sending lines before provider-only inventory", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([
        buildLineRow("+15550100001", {
          providerLastSeenAt: new Date("2026-06-30T12:00:00.000Z"),
          providerStatus: "ACTIVE",
        }),
      ])
      .mockResolvedValueOnce([
        buildLineRow("+15550100002", {
          providerLastSeenAt: new Date("2026-06-30T12:10:00.000Z"),
          providerStatus: "ACTIVE",
        }),
      ]);
    const prisma = {
      hostedLinqLine: {
        findMany,
      },
    } as never;

    await expect(
      listHostedLinqContactCardLines({
        limit: 2,
        prisma,
      }),
    ).resolves.toMatchObject([
      {
        phoneNumber: "+15550100001",
        phoneNumberHint: "*** 0001",
      },
      {
        phoneNumber: "+15550100002",
        phoneNumberHint: "*** 0002",
      },
    ]);

    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      take: 2,
      where: {
        configuredAt: { not: null },
        phoneNumberEncrypted: { not: null },
      },
    }));
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      take: 1,
      where: {
        configuredAt: null,
        phoneNumberEncrypted: { not: null },
        providerSeenAt: { not: null },
      },
    }));
  });
});

function buildLineRow(
  phoneNumber: string,
  input: {
    providerLastSeenAt: Date;
    providerStatus: string;
  },
) {
  return {
    phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
    providerLastSeenAt: input.providerLastSeenAt,
    providerStatus: input.providerStatus,
  };
}
