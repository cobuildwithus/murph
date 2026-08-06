import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

describe("hosted signup referral UX", () => {
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

  it("explains attribution without implying shared health access", async () => {
    const page = await import("../app/r/[referralCode]/page");
    const markup = renderToStaticMarkup(await page.default({
      params: Promise.resolve({ referralCode: "stable_referral" }),
    }));

    assert.match(markup, /You&#x27;re invited/);
    assert.match(markup, />Join Murph</);
    assert.match(markup, /only for referral attribution/);
    assert.match(markup, /cannot see your conversations or health information/);
    expect(mocks.claimHostedSignupReferralLink).not.toHaveBeenCalled();
  });

  it("renders a useful unavailable state instead of a generic 404", async () => {
    mocks.readHostedSignupReferralLink.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_SIGNUP_REFERRAL_LINK_NOT_FOUND",
        httpStatus: 404,
        message: "That Murph referral link is no longer available.",
      }),
    );
    const page = await import("../app/r/[referralCode]/page");
    const markup = renderToStaticMarkup(await page.default({
      params: Promise.resolve({ referralCode: "expired_referral" }),
    }));

    assert.match(markup, /This link isn’t available/);
    assert.match(markup, /send their current Murph link/);
    assert.doesNotMatch(markup, />Join Murph</);
  });

  it("renders a retry-later state after the bounded claim limit", async () => {
    const page = await import("../app/r/[referralCode]/page");
    const markup = renderToStaticMarkup(await page.default({
      params: Promise.resolve({ referralCode: "busy_referral" }),
      searchParams: Promise.resolve({ status: "busy" }),
    }));

    assert.match(markup, /Try again soon/);
    assert.match(markup, /Wait a little while/);
    assert.doesNotMatch(markup, />Join Murph</);
  });

  it("redirects a claim-limit failure back to the human-readable landing", async () => {
    mocks.claimHostedSignupReferralLink.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED",
        httpStatus: 429,
        message: "That referral link has been used too many times recently.",
        retryable: true,
      }),
    );
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

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://www.withmurph.ai/r/stable_referral?status=busy",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
