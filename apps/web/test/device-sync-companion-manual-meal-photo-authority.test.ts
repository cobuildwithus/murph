import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
  assertHostedNativeMemberAuthCurrentTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));

vi.mock("@/src/lib/better-auth/native-auth", () => ({
  assertHostedNativeMemberAuthCurrentTx: mocks.assertHostedNativeMemberAuthCurrentTx,
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
const AUTH = { member: { id: MEMBER_ID } } as never;
const PRISMA = { label: "transaction" };

describe("manual meal photo final authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedNativeMemberAuthCurrentTx.mockResolvedValue(undefined);
  });

  it("rechecks the current credential under its member lock before access and historical consent", async () => {
    await expect(assertCurrentManualMealPhotoUploadAuthorityTx({
      auth: AUTH,
      prisma: PRISMA as never,
    })).resolves.toBeUndefined();

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(PRISMA, MEMBER_ID);
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      PRISMA,
      MEMBER_ID,
    );
    expect(mocks.assertHostedNativeMemberAuthCurrentTx).toHaveBeenCalledWith(AUTH, PRISMA);
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
    expect(mocks.assertHostedNativeMemberAuthCurrentTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0],
    );
  });

  it("rejects a revoked credential before protected-state checks", async () => {
    mocks.assertHostedNativeMemberAuthCurrentTx.mockRejectedValueOnce({ code: "AUTH_REQUIRED", httpStatus: 401 });

    await expect(assertCurrentManualMealPhotoUploadAuthorityTx({
      auth: AUTH,
      prisma: PRISMA as never,
    })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
  });
});
