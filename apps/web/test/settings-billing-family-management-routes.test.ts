import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedFamilyInviteAcceptUrl: vi.fn(),
  buildHostedFamilyTelegramInviteUrl: vi.fn(),
  ensureHostedAccountGroupForOwnerTx: vi.fn(),
  getPrisma: vi.fn(),
  hostedAccountGroupFindUnique: vi.fn(),
  hasActiveHostedFamilyAccess: vi.fn(),
  issueHostedFamilyInviteTx: vi.fn(),
  readHostedOnboardingEnvironment: vi.fn(),
  removeHostedFamilyMemberTx: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  revokeHostedFamilyInviteTx: vi.fn(),
  updateHostedFamilySeatCount: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/env", () => ({
  readHostedOnboardingEnvironment: mocks.readHostedOnboardingEnvironment,
}));
vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  buildHostedFamilyInviteAcceptUrl: mocks.buildHostedFamilyInviteAcceptUrl,
  buildHostedFamilyTelegramInviteUrl: mocks.buildHostedFamilyTelegramInviteUrl,
  ensureHostedAccountGroupForOwnerTx: mocks.ensureHostedAccountGroupForOwnerTx,
  hasActiveHostedFamilyAccess: mocks.hasActiveHostedFamilyAccess,
  issueHostedFamilyInviteTx: mocks.issueHostedFamilyInviteTx,
  removeHostedFamilyMemberTx: mocks.removeHostedFamilyMemberTx,
  revokeHostedFamilyInviteTx: mocks.revokeHostedFamilyInviteTx,
  updateHostedFamilySeatCount: mocks.updateHostedFamilySeatCount,
}));

let inviteRoute: typeof import("../app/api/settings/billing/family/invite/route");
let inviteCancelRoute: typeof import("../app/api/settings/billing/family/invite/[inviteId]/route");
let memberRemoveRoute: typeof import("../app/api/settings/billing/family/members/[memberId]/route");
let seatsRoute: typeof import("../app/api/settings/billing/family/seats/route");

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.hostedAccountGroupFindUnique.mockResolvedValue({ id: "hbag_family" });
  mocks.getPrisma.mockReturnValue({
    hostedAccountGroup: {
      findUnique: mocks.hostedAccountGroupFindUnique,
    },
    $transaction: vi.fn((callback) =>
      callback({
        hostedAccountGroup: {
          findUnique: mocks.hostedAccountGroupFindUnique,
        },
      }),
    ),
  });
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: { billingStatus: "active", id: "member_owner", suspendedAt: null },
  });
  mocks.readHostedOnboardingEnvironment.mockReturnValue({
    publicBaseUrl: "https://app.murph.test",
    telegramBotUsername: "withmurph_bot",
  });
  mocks.hasActiveHostedFamilyAccess.mockResolvedValue(false);
  mocks.ensureHostedAccountGroupForOwnerTx.mockResolvedValue({
    id: "hbag_family",
    ownerMemberId: "member_owner",
  });
  mocks.issueHostedFamilyInviteTx.mockResolvedValue({
    channel: "family",
    expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    id: "inv_new",
    inviteCode: "NEWCODE",
    status: "pending",
    targetLabel: "Mom",
    targetPhoneHint: "+48 6** *** ***",
  });
  mocks.buildHostedFamilyInviteAcceptUrl.mockReturnValue(
    "https://app.murph.test/family/accept/NEWCODE",
  );
  mocks.buildHostedFamilyTelegramInviteUrl.mockReturnValue(
    "https://t.me/withmurph_bot?start=family_NEWCODE",
  );
  mocks.revokeHostedFamilyInviteTx.mockResolvedValue(true);
  mocks.removeHostedFamilyMemberTx.mockResolvedValue(true);
  mocks.updateHostedFamilySeatCount.mockResolvedValue({
    seats: {
      active: 1,
      billed: 3,
      invited: 1,
      max: 6,
      min: 2,
      remaining: 1,
      used: 2,
    },
  });

  inviteRoute = await import("../app/api/settings/billing/family/invite/route");
  inviteCancelRoute = await import("../app/api/settings/billing/family/invite/[inviteId]/route");
  memberRemoveRoute = await import("../app/api/settings/billing/family/members/[memberId]/route");
  seatsRoute = await import("../app/api/settings/billing/family/seats/route");
});

function inviteRequest(body: Record<string, unknown>) {
  return new Request("https://join.example.test/api/settings/billing/family/invite", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "https://join.example.test" },
    method: "POST",
  });
}

test("issues a family invite and returns safe share links", async () => {
  const response = await inviteRoute.POST(
    inviteRequest({ targetLabel: "Mom", targetPhoneNumber: "+48600000000" }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    invite: {
      acceptUrl: "https://app.murph.test/family/accept/NEWCODE",
      channel: "family",
      expiresAt: "2026-07-01T00:00:00.000Z",
      id: "inv_new",
      status: "pending",
      targetLabel: "Mom",
      targetPhoneHint: "+48 6** *** ***",
      telegramInviteUrl: "https://t.me/withmurph_bot?start=family_NEWCODE",
    },
  });
  expect(mocks.issueHostedFamilyInviteTx).toHaveBeenCalledWith(
    expect.objectContaining({
      groupId: "hbag_family",
      invitedByMemberId: "member_owner",
      targetLabel: "Mom",
      targetPhoneNumber: "+48600000000",
    }),
  );
});

test("updates paid Family seat count explicitly", async () => {
  const response = await seatsRoute.PATCH(
    new Request("https://join.example.test/api/settings/billing/family/seats", {
      body: JSON.stringify({ seatCount: 3 }),
      headers: { "content-type": "application/json", origin: "https://join.example.test" },
      method: "PATCH",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    seats: {
      active: 1,
      billed: 3,
      invited: 1,
      max: 6,
      min: 2,
      remaining: 1,
      used: 2,
    },
  });
  expect(mocks.updateHostedFamilySeatCount).toHaveBeenCalledWith({
    groupId: "hbag_family",
    ownerMemberId: "member_owner",
    prisma: expect.any(Object),
    targetSeatCount: 3,
  });
});

test("does not create a Family owner group from the seats route", async () => {
  mocks.hostedAccountGroupFindUnique.mockResolvedValueOnce(null);

  const response = await seatsRoute.PATCH(
    new Request("https://join.example.test/api/settings/billing/family/seats", {
      body: JSON.stringify({ seatCount: 3 }),
      headers: { "content-type": "application/json", origin: "https://join.example.test" },
      method: "PATCH",
    }),
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_GROUP_NOT_FOUND" },
  });
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
  expect(mocks.updateHostedFamilySeatCount).not.toHaveBeenCalled();
});

test("rejects an empty invite target", async () => {
  const response = await inviteRoute.POST(inviteRequest({}));

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_INVITE_TARGET_REQUIRED" },
  });
  expect(mocks.issueHostedFamilyInviteTx).not.toHaveBeenCalled();
});

test("rejects a sponsored member before issuing an invite", async () => {
  mocks.hasActiveHostedFamilyAccess.mockResolvedValueOnce(true);

  const response = await inviteRoute.POST(inviteRequest({ targetLabel: "Mom" }));

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED" },
  });
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
});

test("rejects cross-origin invite before reading the session", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });

  const response = await inviteRoute.POST(inviteRequest({ targetLabel: "Mom" }));

  expect(response.status).toBe(403);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
});

test("cancels a pending invite", async () => {
  const response = await inviteCancelRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/invite/inv_1", {
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
    { params: Promise.resolve({ inviteId: "inv_1" }) },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ revoked: true });
  expect(mocks.revokeHostedFamilyInviteTx).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: "hbag_family", inviteId: "inv_1", ownerMemberId: "member_owner" }),
  );
});

test("returns 404 when the invite is no longer pending", async () => {
  mocks.revokeHostedFamilyInviteTx.mockResolvedValueOnce(false);

  const response = await inviteCancelRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/invite/inv_1", {
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
    { params: Promise.resolve({ inviteId: "inv_1" }) },
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_INVITE_NOT_FOUND" },
  });
});

test("removes an active member", async () => {
  const response = await memberRemoveRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/members/m_mom", {
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
    { params: Promise.resolve({ memberId: "m_mom" }) },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ removed: true });
  expect(mocks.removeHostedFamilyMemberTx).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: "hbag_family", memberId: "m_mom", ownerMemberId: "member_owner" }),
  );
});

test("returns 404 when the member is not active", async () => {
  mocks.removeHostedFamilyMemberTx.mockResolvedValueOnce(false);

  const response = await memberRemoveRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/members/m_mom", {
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
    { params: Promise.resolve({ memberId: "m_mom" }) },
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_MEMBER_NOT_FOUND" },
  });
});
