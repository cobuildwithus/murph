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
});

function createHostedOnboardingEnvironment(
  overrides: Partial<HostedOnboardingEnvironment>,
): HostedOnboardingEnvironment {
  return {
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
    linqWebhookSecret: null,
    linqWebhookTimestampToleranceMs: 300_000,
    privyAppId: null,
    privyVerificationKey: null,
    publicBaseUrl: null,
    stripePriceId: null,
    stripeSecretKey: null,
    stripeWebhookSecret: null,
    telegramBotUsername: null,
    telegramWebhookSecret: null,
    ...overrides,
  };
}
