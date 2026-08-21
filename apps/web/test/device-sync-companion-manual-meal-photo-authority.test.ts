import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal: mocks.lookupHostedMemberForPrivyPrincipal,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: { maxWait: 5_000 },
  lockHostedMemberRow: mocks.lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows: mocks.lockHostedMemberSponsoredAccessRows,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
  readHostedHealthDataConsentState: vi.fn(),
}));

import {
  assertCurrentManualMealPhotoUploadAuthorityTx,
} from "../src/lib/device-sync/meal-photo-capture";

const MEMBER_ID = "member_1";
const IDENTITY_USER_ID = "privy_member_1";
const PRISMA = { label: "transaction" };

describe("manual meal photo final authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue({ id: MEMBER_ID });
  });

  it("locks before rechecking identity, access, and historical consent", async () => {
    await expect(assertCurrentManualMealPhotoUploadAuthorityTx({
      identityUserId: IDENTITY_USER_ID,
      memberId: MEMBER_ID,
      prisma: PRISMA as never,
    })).resolves.toBeUndefined();

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(PRISMA, MEMBER_ID);
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      PRISMA,
      MEMBER_ID,
    );
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledWith({
      identity: { userId: IDENTITY_USER_ID },
      prisma: PRISMA,
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: PRISMA,
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: PRISMA,
    });
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0]
        ?? Number.MAX_SAFE_INTEGER,
    );
    expect(
      mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.lookupHostedMemberForPrivyPrincipal.mock.invocationCallOrder[0]
        ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects a changed Privy binding before protected-state checks", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValueOnce({ id: "member_2" });

    await expect(assertCurrentManualMealPhotoUploadAuthorityTx({
      identityUserId: IDENTITY_USER_ID,
      memberId: MEMBER_ID,
      prisma: PRISMA as never,
    })).rejects.toMatchObject({
      code: "PRIVY_USER_MISMATCH",
      httpStatus: 409,
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
  });
});
