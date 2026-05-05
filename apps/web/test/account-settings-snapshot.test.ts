import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
  };
});

import { readHostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

describe("hosted account settings snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({
      readonly: true,
    });
  });

  it("prefills settings from the unverified Stripe checkout email when no verified email exists", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      emailAuthorization: {
        directPublicSender: null,
        memberId: "member_123",
        stripeCheckoutEmail: {
          address: "payer@example.com",
          collectedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
        verifiedEmail: null,
      },
      identity: null,
      routing: null,
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      email: {
        address: "payer@example.com",
        verifiedAt: null,
      },
    });
  });

  it("prefers the verified email over the Stripe checkout email", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      emailAuthorization: {
        directPublicSender: null,
        memberId: "member_123",
        stripeCheckoutEmail: {
          address: "payer@example.com",
          collectedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
        verifiedEmail: {
          address: "verified@example.com",
          lookupKey: "lookup_verified",
          verifiedAt: new Date("2026-05-02T00:00:00.000Z"),
        },
      },
      identity: null,
      routing: null,
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      email: {
        address: "verified@example.com",
        verifiedAt: "2026-05-02T00:00:00.000Z",
      },
    });
  });
});
