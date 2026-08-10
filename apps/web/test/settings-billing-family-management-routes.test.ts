import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedFamilyInviteAcceptUrl: vi.fn(),
  resolveHostedFamilyTelegramInviteUrl: vi.fn(),
  ensureHostedAccountGroupForOwnerTx: vi.fn(),
  getPrisma: vi.fn(),
  hostedFamilyInviteHasReusableTarget: vi.fn(),
  hostedAccountGroupFindUnique: vi.fn(),
  issueHostedFamilyInviteTx: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  readHostedOnboardingEnvironment: vi.fn(),
  removeHostedFamilyMemberTx: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  revokeHostedFamilyInviteTx: vi.fn(),
  updateHostedFamilyMemberPlan: vi.fn(),
  updateHostedFamilyPlanCapacities: vi.fn(),
  waitForHostedFamilyPlanCapacities: vi.fn(),
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
  resolveHostedFamilyTelegramInviteUrl: mocks.resolveHostedFamilyTelegramInviteUrl,
  ensureHostedAccountGroupForOwnerTx: mocks.ensureHostedAccountGroupForOwnerTx,
  hostedFamilyInviteHasReusableTarget: mocks.hostedFamilyInviteHasReusableTarget,
  issueHostedFamilyInviteTx: mocks.issueHostedFamilyInviteTx,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
  removeHostedFamilyMemberTx: mocks.removeHostedFamilyMemberTx,
  revokeHostedFamilyInviteTx: mocks.revokeHostedFamilyInviteTx,
  updateHostedFamilyMemberPlan: mocks.updateHostedFamilyMemberPlan,
  updateHostedFamilyPlanCapacities: mocks.updateHostedFamilyPlanCapacities,
  waitForHostedFamilyPlanCapacities: mocks.waitForHostedFamilyPlanCapacities,
}));

let inviteRoute: typeof import("../app/api/settings/billing/family/invite/route");
let inviteCancelRoute: typeof import("../app/api/settings/billing/family/invite/[inviteId]/route");
let memberRemoveRoute: typeof import("../app/api/settings/billing/family/members/[memberId]/route");

const ownerSnapshot = {
  billingActive: true,
  groupId: "hbag_family",
  members: [],
  plans: {
    edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
    max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
    pulse: { active: 2, billed: 2, invited: 0, remaining: 0, used: 2 },
  },
  seats: { active: 2, billed: 2, invited: 0, max: 6, min: 2, remaining: 0, used: 2 },
};

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
  mocks.ensureHostedAccountGroupForOwnerTx.mockResolvedValue({
    id: "hbag_family",
    ownerMemberId: "member_owner",
  });
  mocks.issueHostedFamilyInviteTx.mockResolvedValue({
    channel: "family",
    expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    id: "inv_new",
    inviteCode: "NEWCODE",
    planCode: "pulse",
    status: "pending",
    targetLabel: "Mom",
    targetPhoneHint: "+48 6** *** ***",
    targetTelegramUsername: null,
  });
  mocks.buildHostedFamilyInviteAcceptUrl.mockReturnValue(
    "https://app.murph.test/family/accept/NEWCODE",
  );
  // Mirror the real gate: a Telegram link only for a Telegram-bound invite.
  mocks.resolveHostedFamilyTelegramInviteUrl.mockImplementation(
    (input: { inviteCode: string; isTelegramBound: boolean }) =>
      input.isTelegramBound
        ? `https://t.me/withmurph_bot?start=family_${input.inviteCode}`
        : null,
  );
  mocks.revokeHostedFamilyInviteTx.mockResolvedValue(true);
  mocks.removeHostedFamilyMemberTx.mockResolvedValue(true);
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(ownerSnapshot);
  mocks.updateHostedFamilyMemberPlan.mockResolvedValue({
    snapshot: ownerSnapshot,
    syncing: false,
  });
  mocks.updateHostedFamilyPlanCapacities.mockResolvedValue(ownerSnapshot);
  mocks.waitForHostedFamilyPlanCapacities.mockResolvedValue(true);
  mocks.hostedFamilyInviteHasReusableTarget.mockReturnValue(true);

  inviteRoute = await import("../app/api/settings/billing/family/invite/route");
  inviteCancelRoute = await import("../app/api/settings/billing/family/invite/[inviteId]/route");
  memberRemoveRoute = await import("../app/api/settings/billing/family/members/[memberId]/route");
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
      planCode: "pulse",
      status: "pending",
      targetLabel: "Mom",
      targetPhoneHint: "+48 6** *** ***",
      // Phone-bound invite: no Telegram link even though a bot is configured.
      telegramInviteUrl: null,
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

test("returns a Telegram share link only for a Telegram-bound invite", async () => {
  mocks.issueHostedFamilyInviteTx.mockResolvedValueOnce({
    channel: "family",
    expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    id: "inv_new",
    inviteCode: "NEWCODE",
    planCode: "pulse",
    status: "pending",
    targetLabel: "Uncle",
    targetPhoneHint: null,
    targetTelegramUsername: "uncle",
  });

  const response = await inviteRoute.POST(
    inviteRequest({ targetLabel: "Uncle", targetTelegramUsername: "@uncle" }),
  );

  expect(response.status).toBe(200);
  const payload = (await response.json()) as { invite: { telegramInviteUrl: string | null } };
  expect(payload.invite.telegramInviteUrl).toBe(
    "https://t.me/withmurph_bot?start=family_NEWCODE",
  );
});

test("does not return a Telegram share link when the stored invite is not Telegram-bound", async () => {
  mocks.issueHostedFamilyInviteTx.mockResolvedValueOnce({
    channel: "family",
    expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    id: "inv_new",
    inviteCode: "NEWCODE",
    planCode: "pulse",
    status: "pending",
    targetLabel: "Uncle",
    targetPhoneHint: "+48 6** *** ***",
    targetTelegramUsername: null,
  });

  const response = await inviteRoute.POST(
    inviteRequest({
      targetLabel: "Uncle",
      targetPhoneNumber: "+48600000000",
      targetTelegramUsername: " ",
    }),
  );

  expect(response.status).toBe(200);
  const payload = (await response.json()) as { invite: { telegramInviteUrl: string | null } };
  expect(payload.invite.telegramInviteUrl).toBeNull();
  expect(mocks.resolveHostedFamilyTelegramInviteUrl).toHaveBeenCalledWith({
    inviteCode: "NEWCODE",
    isTelegramBound: false,
    telegramBotUsername: "withmurph_bot",
  });
});

test("adds one paid seat and retries when the plan is full", async () => {
  const seatLimit = () =>
    hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats.",
    });
  // Initial attempt and the pre-buy re-check both hit the limit, then it lands.
  mocks.issueHostedFamilyInviteTx
    .mockRejectedValueOnce(seatLimit())
    .mockRejectedValueOnce(seatLimit())
    .mockResolvedValueOnce({
      channel: "family",
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
      id: "inv_new",
      inviteCode: "NEWCODE",
      planCode: "pulse",
      status: "pending",
      targetLabel: "Dad",
      targetPhoneHint: "+48 6** *** ***",
      targetTelegramUsername: null,
    });

  const response = await inviteRoute.POST(
    inviteRequest({ addSeatIfNeeded: true, targetLabel: "Dad", targetPhoneNumber: "+48600000001" }),
  );

  expect(response.status).toBe(200);
  expect(mocks.updateHostedFamilyPlanCapacities).toHaveBeenCalledWith({
    autoSeatInviteTarget: {
      targetEmail: null,
      targetPhoneNumber: "+48600000001",
    },
    groupId: "hbag_family",
    ownerMemberId: "member_owner",
    prisma: expect.any(Object),
    targetCapacities: { edge: 0, max: 0, pulse: 3 },
  });
  expect(mocks.issueHostedFamilyInviteTx).toHaveBeenCalledTimes(3);
});

test("reuses a concurrently-created invite on the pre-buy re-check (no purchase)", async () => {
  mocks.issueHostedFamilyInviteTx
    .mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
        httpStatus: 409,
        message: "This Family plan has no open paid seats.",
      }),
    )
    .mockResolvedValueOnce({
      channel: "family",
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
      id: "inv_new",
      inviteCode: "NEWCODE",
      planCode: "pulse",
      status: "pending",
      targetLabel: "Dad",
      targetPhoneHint: "+48 6** *** ***",
      targetTelegramUsername: null,
    });

  const response = await inviteRoute.POST(
    inviteRequest({ addSeatIfNeeded: true, targetLabel: "Dad", targetPhoneNumber: "+48600000001" }),
  );

  expect(response.status).toBe(200);
  expect(mocks.updateHostedFamilyPlanCapacities).not.toHaveBeenCalled();
  expect(mocks.issueHostedFamilyInviteTx).toHaveBeenCalledTimes(2);
});

test("uses a seat freed before the purchase instead of buying another", async () => {
  const seatLimit = () =>
    hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats.",
    });
  // Initial attempt and pre-buy re-check fail, but the snapshot then shows a seat
  // freed up (cancel/remove), so the invite lands without a purchase.
  mocks.issueHostedFamilyInviteTx
    .mockRejectedValueOnce(seatLimit())
    .mockRejectedValueOnce(seatLimit())
    .mockResolvedValueOnce({
      channel: "family",
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
      id: "inv_new",
      inviteCode: "NEWCODE",
      planCode: "pulse",
      status: "pending",
      targetLabel: "Dad",
      targetPhoneHint: "+48 6** *** ***",
      targetTelegramUsername: null,
    });
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce({
    billingActive: true,
    groupId: "hbag_family",
    plans: {
      edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
      max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
      pulse: { active: 1, billed: 2, invited: 0, remaining: 1, used: 1 },
    },
    seats: { active: 1, billed: 2, invited: 0, max: 6, min: 2, remaining: 1, used: 1 },
  });

  const response = await inviteRoute.POST(
    inviteRequest({ addSeatIfNeeded: true, targetLabel: "Dad", targetPhoneNumber: "+48600000001" }),
  );

  expect(response.status).toBe(200);
  expect(mocks.updateHostedFamilyPlanCapacities).not.toHaveBeenCalled();
  expect(mocks.issueHostedFamilyInviteTx).toHaveBeenCalledTimes(3);
});

test("adds one seat then reports syncing if the invite still cannot land", async () => {
  // Every attempt (initial, pre-buy re-check, post-buy) hits the limit, e.g. a
  // slow webhook or a concurrent grab. Exactly one seat is purchased and the
  // owner is told it is syncing rather than seeing a bare seat-limit error.
  mocks.issueHostedFamilyInviteTx.mockRejectedValue(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats.",
    }),
  );

  const response = await inviteRoute.POST(
    inviteRequest({ addSeatIfNeeded: true, targetLabel: "Dad", targetPhoneNumber: "+48600000001" }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_SEAT_ADDED_SYNCING" },
  });
  expect(mocks.updateHostedFamilyPlanCapacities).toHaveBeenCalledTimes(1);
  expect(mocks.issueHostedFamilyInviteTx).toHaveBeenCalledTimes(3);
});

test("does not buy a seat when a full-plan invite is reused (no seat-limit error)", async () => {
  const response = await inviteRoute.POST(
    inviteRequest({ addSeatIfNeeded: true, targetLabel: "Mom", targetPhoneNumber: "+48600000000" }),
  );

  expect(response.status).toBe(200);
  expect(mocks.updateHostedFamilyPlanCapacities).not.toHaveBeenCalled();
  expect(mocks.issueHostedFamilyInviteTx).toHaveBeenCalledTimes(1);
});

test("does not buy an orphaned seat when a reused invite needs a tier rebalance", async () => {
  mocks.issueHostedFamilyInviteTx.mockRejectedValueOnce(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_PLAN_CAPACITY_REQUIRED",
      httpStatus: 409,
      message: "Change the Family plan mix before moving this invite.",
    }),
  );

  const response = await inviteRoute.POST(
    inviteRequest({
      addSeatIfNeeded: true,
      planCode: "edge",
      targetEmail: "relative@example.test",
      targetLabel: "Relative",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_INVITE_PLAN_CAPACITY_REQUIRED" },
  });
  expect(mocks.updateHostedFamilyPlanCapacities).not.toHaveBeenCalled();
});

test("does not auto-add a seat for a label-only invite (no dedup key)", async () => {
  mocks.issueHostedFamilyInviteTx.mockRejectedValueOnce(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats.",
    }),
  );

  mocks.hostedFamilyInviteHasReusableTarget.mockReturnValueOnce(false);

  const response = await inviteRoute.POST(
    inviteRequest({ addSeatIfNeeded: true, targetLabel: "Grandpa" }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED" },
  });
  expect(mocks.updateHostedFamilyPlanCapacities).not.toHaveBeenCalled();
});

test("does not auto-add a paid seat for a Telegram-only invite", async () => {
  mocks.issueHostedFamilyInviteTx.mockRejectedValueOnce(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats.",
    }),
  );

  const response = await inviteRoute.POST(
    inviteRequest({
      addSeatIfNeeded: true,
      targetLabel: "Relative",
      targetTelegramUsername: "@relative",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED" },
  });
  expect(mocks.updateHostedFamilyPlanCapacities).not.toHaveBeenCalled();
  expect(mocks.issueHostedFamilyInviteTx).toHaveBeenCalledTimes(1);
});

test("does not add a seat when the seat limit is hit but addSeatIfNeeded is off", async () => {
  mocks.issueHostedFamilyInviteTx.mockRejectedValueOnce(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats.",
    }),
  );

  const response = await inviteRoute.POST(
    inviteRequest({ targetLabel: "Dad", targetPhoneNumber: "+48600000001" }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED" },
  });
  expect(mocks.updateHostedFamilyPlanCapacities).not.toHaveBeenCalled();
});

test("changes an active Family member tier to Max", async () => {
  const response = await memberRemoveRoute.PATCH(
    new Request("https://join.example.test/api/settings/billing/family/members/member_child", {
      body: JSON.stringify({ planCode: "max" }),
      headers: { "content-type": "application/json", origin: "https://join.example.test" },
      method: "PATCH",
    }),
    { params: Promise.resolve({ memberId: "member_child" }) },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    members: [],
    syncing: false,
  });
  expect(mocks.updateHostedFamilyMemberPlan).toHaveBeenCalledWith({
    groupId: "hbag_family",
    memberId: "member_child",
    ownerMemberId: "member_owner",
    planCode: "max",
    prisma: expect.any(Object),
  });
});

test("reports a member tier change that is still syncing", async () => {
  mocks.updateHostedFamilyMemberPlan.mockResolvedValueOnce({
    snapshot: ownerSnapshot,
    syncing: true,
  });

  const response = await memberRemoveRoute.PATCH(
    new Request("https://join.example.test/api/settings/billing/family/members/member_child", {
      body: JSON.stringify({ planCode: "edge" }),
      headers: { "content-type": "application/json", origin: "https://join.example.test" },
      method: "PATCH",
    }),
    { params: Promise.resolve({ memberId: "member_child" }) },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ syncing: true });
});

test("rejects an empty invite target", async () => {
  const response = await inviteRoute.POST(inviteRequest({}));

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_INVITE_TARGET_REQUIRED" },
  });
  expect(mocks.issueHostedFamilyInviteTx).not.toHaveBeenCalled();
});

test("delegates sponsored-member rejection to the owner group service before issuing an invite", async () => {
  mocks.ensureHostedAccountGroupForOwnerTx.mockRejectedValueOnce(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
      httpStatus: 409,
      message: "This member is already in another active family plan.",
    }),
  );

  const response = await inviteRoute.POST(inviteRequest({ targetLabel: "Mom" }));

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED" },
  });
  expect(mocks.ensureHostedAccountGroupForOwnerTx).toHaveBeenCalledWith({
    ownerMemberId: "member_owner",
    tx: {
      hostedAccountGroup: {
        findUnique: mocks.hostedAccountGroupFindUnique,
      },
    },
  });
  expect(mocks.issueHostedFamilyInviteTx).not.toHaveBeenCalled();
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
