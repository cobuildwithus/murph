import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed:
    mocks.assertActiveHostedMemberAccessAllowed,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted:
    mocks.assertHostedLaunchRequiredConsentGranted,
}));

describe("browser-vault member authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
  });

  it("checks active access before current launch consent", async () => {
    const { assertBrowserVaultMemberAuthority } = await import(
      "@/src/lib/browser-vault/authority"
    );
    const prisma = createPrismaTestDouble();

    await assertBrowserVaultMemberAuthority({
      memberId: "member_123",
      prisma,
    });

    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(
      mocks.assertActiveHostedMemberAccessAllowed.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.assertHostedLaunchRequiredConsentGranted.mock.invocationCallOrder[0],
    );
  });

  it("does not query consent after active access is denied", async () => {
    const error = new Error("access denied");
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(error);
    const { assertBrowserVaultMemberAuthority } = await import(
      "@/src/lib/browser-vault/authority"
    );

    await expect(assertBrowserVaultMemberAuthority({
      memberId: "member_123",
      prisma: createPrismaTestDouble(),
    })).rejects.toBe(error);
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
  });
});

function createPrismaTestDouble(): Prisma.TransactionClient {
  // Authority dependencies are mocked; the object is only an identity token
  // proving that both checks receive the same transaction boundary.
  return {} as Prisma.TransactionClient;
}
