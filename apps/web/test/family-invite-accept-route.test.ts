import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptHostedFamilyInvite: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  readHostedAccountSettingsSnapshot: vi.fn(),
  readHostedFamilyInviteAcceptanceView: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));
vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsSnapshot: mocks.readHostedAccountSettingsSnapshot,
}));
vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  acceptHostedFamilyInvite: mocks.acceptHostedFamilyInvite,
  readHostedFamilyInviteAcceptanceView: mocks.readHostedFamilyInviteAcceptanceView,
}));

let acceptRoute: typeof import("../app/api/family/invites/[inviteCode]/accept/route");

const ACTIVE_PHONE_BOUND = {
  groupActive: true,
  groupDisplayName: "Kim Family",
  inviteCode: "CODEDAD",
  isEmailBound: false,
  isPhoneBound: true,
  seatAvailable: true,
  status: "pending",
  targetLabel: "Dad",
  telegramInviteUrl: null,
  webAcceptable: true,
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({});
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: { billingStatus: "active", id: "member_mom", suspendedAt: null },
  });
  mocks.readHostedMemberIdentity.mockResolvedValue({ phoneNumber: "+48600000000" });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue({
    email: { address: "mom@example.com", verifiedAt: "2026-06-24T00:00:00.000Z" },
  });
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(ACTIVE_PHONE_BOUND);
  mocks.acceptHostedFamilyInvite.mockResolvedValue({});

  acceptRoute = await import("../app/api/family/invites/[inviteCode]/accept/route");
});

function postRequest() {
  return new Request("https://join.example.test/api/family/invites/CODEDAD/accept", {
    headers: { origin: "https://join.example.test" },
    method: "POST",
  });
}

const params = { params: Promise.resolve({ inviteCode: "CODEDAD" }) };

test("accepts a phone-bound invite to an active plan with phone binding required", async () => {
  const response = await acceptRoute.POST(postRequest(), params);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ accepted: true });
  expect(mocks.acceptHostedFamilyInvite).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedMemberId: "member_mom",
      email: "mom@example.com",
      inviteCode: "CODEDAD",
      phoneNumber: "+48600000000",
      requireWebBinding: true,
    }),
  );
});

test("accepts an email-bound invite to an active plan", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValueOnce({
    ...ACTIVE_PHONE_BOUND,
    isEmailBound: true,
    isPhoneBound: false,
  });

  const response = await acceptRoute.POST(postRequest(), params);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ accepted: true });
  expect(mocks.acceptHostedFamilyInvite).toHaveBeenCalledWith(
    expect.objectContaining({ email: "mom@example.com", requireWebBinding: true }),
  );
});

test("passes a null email when the member's email is not verified", async () => {
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValueOnce({
    email: { address: "unverified@example.com", verifiedAt: null },
  });

  const response = await acceptRoute.POST(postRequest(), params);

  expect(response.status).toBe(200);
  expect(mocks.acceptHostedFamilyInvite).toHaveBeenCalledWith(
    expect.objectContaining({ email: null, requireWebBinding: true }),
  );
});

test("rejects web acceptance of a Telegram/label-only invite (no phone or email)", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValueOnce({
    ...ACTIVE_PHONE_BOUND,
    isEmailBound: false,
    isPhoneBound: false,
    telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODEDAD",
    webAcceptable: false,
  });

  const response = await acceptRoute.POST(postRequest(), params);

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_WEB_ACCEPT_REQUIRES_CONTACT" },
  });
  expect(mocks.acceptHostedFamilyInvite).not.toHaveBeenCalled();
});

test("rejects acceptance into an inactive family group", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValueOnce({
    ...ACTIVE_PHONE_BOUND,
    groupActive: false,
    webAcceptable: false,
  });

  const response = await acceptRoute.POST(postRequest(), params);

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_GROUP_INACTIVE" },
  });
  expect(mocks.acceptHostedFamilyInvite).not.toHaveBeenCalled();
});

test("rejects an expired or already-used invite", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValueOnce({
    ...ACTIVE_PHONE_BOUND,
    status: "expired",
    webAcceptable: false,
  });

  const response = await acceptRoute.POST(postRequest(), params);

  expect(response.status).toBe(410);
  expect(mocks.acceptHostedFamilyInvite).not.toHaveBeenCalled();
});

test("allows already accepted invites to reach domain idempotency", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValueOnce({
    ...ACTIVE_PHONE_BOUND,
    seatAvailable: false,
    status: "accepted",
    webAcceptable: false,
  });

  const response = await acceptRoute.POST(postRequest(), params);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ accepted: true });
  expect(mocks.acceptHostedFamilyInvite).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedMemberId: "member_mom",
      inviteCode: "CODEDAD",
      requireWebBinding: true,
    }),
  );
});
