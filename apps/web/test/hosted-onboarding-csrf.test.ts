import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";

const mocks = vi.hoisted(() => ({
  getHostedOnboardingEnvironment: vi.fn<() => HostedOnboardingEnvironment>(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
}));

describe("assertHostedOnboardingMutationOrigin", () => {
  beforeEach(() => {
    mocks.getHostedOnboardingEnvironment.mockReset();
    mocks.getHostedOnboardingEnvironment.mockReturnValue(createHostedOnboardingEnvironment({
      publicBaseUrl: "https://app.example.test/join",
    }));
  });

  it("rejects request-host origins when a canonical public origin is configured", async () => {
    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("https://preview.example.test/api/hosted-onboarding/invites", {
          method: "POST",
          headers: {
            origin: "https://preview.example.test",
          },
        }),
      )
    ).toThrowError(expect.objectContaining({
      code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
      httpStatus: 403,
    }));
  });

  it("allows the configured canonical public origin", async () => {
    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("https://preview.example.test/api/hosted-onboarding/invites", {
          method: "POST",
          headers: {
            origin: "https://app.example.test",
          },
        }),
      )
    ).not.toThrow();
  });

  it("rejects requests without an Origin header", async () => {
    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("https://app.example.test/api/hosted-onboarding/invites", {
          method: "POST",
        }),
      )
    ).toThrowError(expect.objectContaining({
      code: "HOSTED_ONBOARDING_ORIGIN_REQUIRED",
      httpStatus: 403,
    }));
  });

  it("fails closed on non-loopback hosts when no canonical public origin is configured", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue(createHostedOnboardingEnvironment({
      publicBaseUrl: null,
    }));

    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("https://preview.example.test/api/hosted-onboarding/invites", {
          method: "POST",
          headers: {
            origin: "https://preview.example.test",
          },
        }),
      )
    ).toThrowError(expect.objectContaining({
      code: "HOSTED_ONBOARDING_ORIGIN_NOT_CONFIGURED",
      httpStatus: 500,
    }));
  });

  it("allows matching localhost origins in non-production when no canonical origin is configured", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue(createHostedOnboardingEnvironment({
      publicBaseUrl: null,
    }));

    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("http://localhost:3000/api/hosted-onboarding/invites", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
          },
        }),
      )
    ).not.toThrow();
  });

  it("rejects localhost fallback in production when no canonical origin is configured", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue(createHostedOnboardingEnvironment({
      isProduction: true,
      publicBaseUrl: null,
    }));

    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("http://localhost:3000/api/hosted-onboarding/invites", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
          },
        }),
      )
    ).toThrowError(expect.objectContaining({
      code: "HOSTED_ONBOARDING_ORIGIN_NOT_CONFIGURED",
      httpStatus: 500,
    }));
  });
});

function createHostedOnboardingEnvironment(
  overrides: Partial<HostedOnboardingEnvironment>,
): HostedOnboardingEnvironment {
  return {
    aiUsageBillingMode: "disabled",
    contactPrivacyKeyring: {
      currentVersion: "v1",
      keysByVersion: {
        v1: Buffer.alloc(32, 0),
      },
      readVersions: ["v1"],
    },
    inviteTtlHours: 168,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: null,
    linqConversationPhoneNumbers: [],
    linqMaxActiveMembersPerConversationPhone: null,
    linqWebhookSecret: null,
    linqWebhookTimestampToleranceMs: 300_000,
    privyAppId: null,
    privyAppSecret: null,
    privyVerificationKey: null,
    publicBaseUrl: null,
    stripePriceIdsByPlan: {
      launch_edge_monthly: null,
      launch_monthly: null,
    },
    stripeSecretKey: null,
    stripeUsageMeterEventName: null,
    stripeUsagePriceIdsByPlan: {
      launch_edge_monthly: null,
      launch_monthly: null,
    },
    stripeWebhookSecret: null,
    telegramBotUsername: null,
    telegramWebhookSecret: null,
    ...overrides,
  };
}
