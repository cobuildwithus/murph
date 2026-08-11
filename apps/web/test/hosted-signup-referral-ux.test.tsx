import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("keeps stable links out of indexes while preserving same-origin claim proof", async () => {
    const page = await import("../app/r/[referralCode]/page");

    expect(page.metadata).toMatchObject({
      referrer: "strict-origin",
      robots: {
        follow: false,
        index: false,
      },
    });
  });

  it("explains attribution without implying shared health access", async () => {
    const page = await import("../app/r/[referralCode]/page");
    const markup = renderToStaticMarkup(await page.default({
      params: Promise.resolve({ referralCode: "stable_referral" }),
    }));

    assert.match(markup, /You&#x27;re invited/);
    assert.match(markup, />Join Murph</);
    assert.match(markup, /This link tells Murph who introduced you/);
    assert.match(markup, /cannot see your conversations or health information/);
    assert.doesNotMatch(markup, /credits whoever shared|extra usage|reward/i);
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

  it("keeps the bounded claim limit directly retryable", async () => {
    const page = await import("../app/r/[referralCode]/page");
    const markup = renderToStaticMarkup(await page.default({
      params: Promise.resolve({ referralCode: "busy_referral" }),
      searchParams: Promise.resolve({ status: "busy" }),
    }));

    assert.match(markup, /Try again soon/);
    assert.match(markup, /Wait a moment/);
    assert.match(markup, /try this link again/);
    assert.match(markup, /action="\/r\/busy_referral\/claim"/);
    assert.match(markup, />Try again<\/button>/);
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

  it("keeps an unexpected claim failure in the retryable HTML journey", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.claimHostedSignupReferralLink.mockRejectedValueOnce(
      new Error("Synthetic control-root KMS timeout. Bearer route-secret"),
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
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "application/json",
    );
    expect(response.headers.get("location")).toBe(
      "https://www.withmurph.ai/r/stable_referral?status=busy",
    );
    const page = await import("../app/r/[referralCode]/page");
    const markup = renderToStaticMarkup(await page.default({
      params: Promise.resolve({ referralCode: "stable_referral" }),
      searchParams: Promise.resolve({ status: "busy" }),
    }));
    assert.match(markup, /Try again soon/);
    assert.match(markup, /action="\/r\/stable_referral\/claim"/);
    assert.match(markup, />Try again<\/button>/);
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted onboarding route failed.",
      expect.objectContaining({
        errorMessage:
          "Synthetic control-root KMS timeout. Bearer <redacted-secret>",
        operationName: "signup-referral.claim",
        requestMethod: "POST",
      }),
    );
  });

  it("keeps origin configuration failures in the retryable HTML journey", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw new TypeError(
        "Synthetic allowed-origin configuration failure. Bearer route-secret",
      );
    });
    const route = await import("../app/r/[referralCode]/claim/route");
    const response = await route.POST(
      new Request(
        "https://www.withmurph.ai/r/stable_referral/claim",
        {
          headers: { Origin: "https://www.withmurph.ai" },
          method: "POST",
        },
      ),
      {
        params: Promise.resolve({ referralCode: "stable_referral" }),
      },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "application/json",
    );
    expect(response.headers.get("location")).toBe(
      "https://www.withmurph.ai/r/stable_referral?status=busy",
    );
    expect(mocks.claimHostedSignupReferralLink).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted onboarding route failed.",
      expect.objectContaining({
        errorMessage:
          "Synthetic allowed-origin configuration failure. Bearer <redacted-secret>",
        operationName: "signup-referral.origin",
        requestMethod: "POST",
      }),
    );
  });

  it("keeps typed server claim failures retryable while permanent links stay unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = await import("../app/r/[referralCode]/claim/route");
    const request = () => new Request(
      "https://www.withmurph.ai/r/stable_referral/claim",
      {
        headers: { Origin: "https://www.withmurph.ai" },
        method: "POST",
      },
    );
    mocks.claimHostedSignupReferralLink.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_ONBOARDING_PUBLIC_BASE_URL_REQUIRED",
        httpStatus: 500,
        message: "The public base URL is unavailable.",
      }),
    );

    const retryable = await route.POST(request(), {
      params: Promise.resolve({ referralCode: "stable_referral" }),
    });
    expect(retryable.status).toBe(303);
    expect(retryable.headers.get("location")).toBe(
      "https://www.withmurph.ai/r/stable_referral?status=busy",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted onboarding route failed.",
      expect.objectContaining({
        operationName: "signup-referral.claim",
        requestMethod: "POST",
      }),
    );

    mocks.claimHostedSignupReferralLink.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_SIGNUP_REFERRAL_LINK_NOT_FOUND",
        httpStatus: 404,
        message: "That Murph referral link is no longer available.",
      }),
    );
    const permanent = await route.POST(request(), {
      params: Promise.resolve({ referralCode: "stable_referral" }),
    });
    expect(permanent.status).toBe(303);
    expect(permanent.headers.get("location")).toBe(
      "https://www.withmurph.ai/r/stable_referral?status=unavailable",
    );
  });

  it("renders the retryable landing when referral validation is temporarily unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readHostedSignupReferralLink.mockRejectedValueOnce(
      new Error("Synthetic Prisma acquisition timeout."),
    );
    const page = await import("../app/r/[referralCode]/page");
    const markup = renderToStaticMarkup(await page.default({
      params: Promise.resolve({ referralCode: "stable_referral" }),
    }));

    assert.match(markup, /Try again soon/);
    assert.match(markup, /action="\/r\/stable_referral\/claim"/);
    assert.doesNotMatch(markup, />Join Murph</);
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted onboarding route failed.",
      expect.objectContaining({
        operationName: "signup-referral.read",
        requestMethod: "GET",
      }),
    );
  });

  it("keeps invalid claim origins as hard authorization failures", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });
    const route = await import("../app/r/[referralCode]/claim/route");
    const response = await route.POST(
      new Request(
        "https://www.withmurph.ai/r/stable_referral/claim",
        {
          headers: { Origin: "https://attacker.example" },
          method: "POST",
        },
      ),
      {
        params: Promise.resolve({ referralCode: "stable_referral" }),
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.claimHostedSignupReferralLink).not.toHaveBeenCalled();
  });
});
