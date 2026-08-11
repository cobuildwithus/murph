import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  claimHostedSignupReferralLink: vi.fn(),
  readHostedSignupReferralLink: vi.fn(),
}));

vi.mock("@/src/lib/hosted-growth/signup-referral", () => ({
  claimHostedSignupReferralLink: mocks.claimHostedSignupReferralLink,
  readHostedSignupReferralLink: mocks.readHostedSignupReferralLink,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readHostedSignupReferralLink.mockResolvedValue({
    expiresAt: new Date("2099-12-31T23:59:59.999Z"),
  });
  mocks.claimHostedSignupReferralLink.mockResolvedValue({
    expiresAt: new Date("2026-08-08T12:00:00.000Z"),
    signupUrl: "https://www.withmurph.ai/join/fresh_invite",
  });
});

test("the referral landing page validates without claiming", async () => {
  const page = await import("../app/r/[referralCode]/page");
  const result = await page.default({
    params: Promise.resolve({ referralCode: "stable_referral" }),
  });

  expect(result).toBeTruthy();
  expect(mocks.readHostedSignupReferralLink).toHaveBeenCalledWith({
    referralCode: "stable_referral",
  });
  expect(mocks.claimHostedSignupReferralLink).not.toHaveBeenCalled();
});

test("an explicit same-origin POST claims and redirects", async () => {
  const route = await import("../app/r/[referralCode]/claim/route");
  const request = new Request(
    "https://www.withmurph.ai/r/stable_referral/claim",
    {
      headers: { Origin: "https://www.withmurph.ai" },
      method: "POST",
    },
  );
  const response = await route.POST(request, {
    params: Promise.resolve({ referralCode: "stable_referral" }),
  });

  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
    request,
  );
  expect(mocks.claimHostedSignupReferralLink).toHaveBeenCalledWith({
    referralCode: "stable_referral",
  });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://www.withmurph.ai/join/fresh_invite",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
