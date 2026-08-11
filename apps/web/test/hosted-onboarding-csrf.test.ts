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

  it("allows an explicitly configured local development mutation origin", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue(createHostedOnboardingEnvironment({
      allowedMutationOrigins: ["http://127.0.0.2:3000"],
      publicBaseUrl: "https://app.example.test",
    }));

    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("http://127.0.0.2:3000/api/hosted-onboarding/invites", {
          method: "POST",
          headers: {
            origin: "http://127.0.0.2:3000",
          },
        }),
      )
    ).not.toThrow();
  });

  it("rejects unconfigured localhost development origins when a canonical public origin is configured", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue(createHostedOnboardingEnvironment({
      publicBaseUrl: "https://app.example.test",
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
      code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
      httpStatus: 403,
    }));
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

  it("rejects opaque browser origins", async () => {
    const { assertHostedOnboardingMutationOrigin } = await import("@/src/lib/hosted-onboarding/csrf");

    expect(() =>
      assertHostedOnboardingMutationOrigin(
        new Request("https://app.example.test/api/hosted-onboarding/invites", {
          method: "POST",
          headers: {
            origin: "null",
          },
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

  it("allows explicitly configured localhost origins when no canonical origin is configured", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue(createHostedOnboardingEnvironment({
      allowedMutationOrigins: ["http://localhost:3000"],
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

  it("rejects unconfigured localhost origins when no canonical origin is configured", async () => {
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
    linqFirstContactAdmissionMode: "off",
    linqFirstContactAdmissionModel: "gpt-5.4-nano",
    linqFirstContactAdmissionOpenAiApiKey: null,
    linqInstantStartPhonePrefixes: ["+1"],
    linqMaxActiveMembersPerConversationPhone: null,
    linqWebhookSecret: null,
    linqWebhookTimestampToleranceMs: 300_000,
    privyAppId: null,
    privyAppSecret: null,
    privyVerificationKey: null,
    publicBaseUrl: null,
    stripeFamilyPriceIdsByPlan: {
      edge: null,
      max: null,
      pulse: null,
    },
    stripePriceIdsByPlan: {
      launch_edge_monthly: null,
      launch_group_monthly: null,
      launch_max_monthly: null,
      launch_monthly: null,
    },
    stripeUsageCreditPriceIdsByOffer: {
      usage_5_usd: null,
      usage_10_usd: null,
      usage_20_usd: null,
      usage_25_usd: null,
    },
    stripeSecretKey: null,
    stripeWebhookSecret: null,
    telegramBotUsername: null,
    telegramBotToken: null,
    telegramWebhookSecret: null,
    ...overrides,
  };
}
