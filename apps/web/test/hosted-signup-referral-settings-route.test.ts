import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  issueHostedSignupReferralLink: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-growth/signup-referral", () => ({
  issueHostedSignupReferralLink: mocks.issueHostedSignupReferralLink,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest:
    mocks.requireHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      id: "member_referrer",
      suspendedAt: null,
    },
    sessionId: "session_1",
  });
  mocks.issueHostedSignupReferralLink.mockResolvedValue({
    expiresAt: new Date("2099-12-31T23:59:59.999Z"),
    signupUrl: "https://www.withmurph.ai/r/stable_referral",
  });
});

test("returns the signed-in member's stable referral link", async () => {
  const route = await import(
    "../app/api/settings/signup-referral-link/route"
  );
  const request = new Request(
    "https://www.withmurph.ai/api/settings/signup-referral-link",
  );
  const response = await route.GET(request);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    expiresAt: "2099-12-31T23:59:59.999Z",
    signupUrl: "https://www.withmurph.ai/r/stable_referral",
  });
  expect(mocks.issueHostedSignupReferralLink).toHaveBeenCalledWith({
    referrerMemberId: "member_referrer",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
