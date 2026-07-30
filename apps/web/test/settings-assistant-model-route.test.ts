import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
  transaction: vi.fn(),
  updateHostedMemberAssistantConfigurationTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  isHostedVeniceAssistantEnabled: () =>
    process.env.HOSTED_VENICE_ENABLED === "1",
  updateHostedMemberAssistantConfigurationTx:
    mocks.updateHostedMemberAssistantConfigurationTx,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime:
    mocks.signalHostedRuntimeRecheckRuntime,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

type AssistantModelRouteModule =
  typeof import("../app/api/settings/assistant-model/route");

let route: AssistantModelRouteModule;

describe("assistant model settings route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/assistant-model/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HOSTED_VENICE_ENABLED;
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_edge",
      },
    });
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback({ tx: true }),
    );
    mocks.getPrisma.mockReturnValue({
      $transaction: mocks.transaction,
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_edge",
    });
    mocks.updateHostedMemberAssistantConfigurationTx.mockResolvedValue({
      dormantSolPreference: false,
      effectiveProviderUpdated: false,
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      provider: "venice",
      solAvailable: true,
      updated: true,
    });
  });

  afterEach(() => {
    delete process.env.HOSTED_VENICE_ENABLED;
  });

  it("persists a validated model choice without a mailbox wake", async () => {
    mocks.updateHostedMemberAssistantConfigurationTx.mockResolvedValueOnce({
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      provider: "openai",
      solAvailable: true,
      updated: true,
    });
    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-sol",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dormantSolPreference: false,
      model: "gpt-5.6-sol",
      ok: true,
      provider: "openai",
      solAvailable: true,
      updated: true,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.updateHostedMemberAssistantConfigurationTx).toHaveBeenCalledWith({
      memberId: "member_edge",
      model: "gpt-5.6-sol",
      prisma: { tx: true },
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("persists Venice alongside the same Terra product model", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    mocks.updateHostedMemberAssistantConfigurationTx.mockResolvedValueOnce({
      dormantSolPreference: false,
      effectiveProviderUpdated: true,
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      provider: "venice",
      solAvailable: true,
      updated: true,
    });
    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-terra",
      provider: "venice",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dormantSolPreference: false,
      model: "gpt-5.6-terra",
      ok: true,
      provider: "venice",
      solAvailable: true,
      updated: true,
    });
    expect(mocks.updateHostedMemberAssistantConfigurationTx).toHaveBeenCalledWith({
      memberId: "member_edge",
      model: "gpt-5.6-terra",
      prisma: { tx: true },
      provider: "venice",
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      userId: "member_edge",
    });
  });

  it("persists a provider-only change without rewriting model intent", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    mocks.updateHostedMemberAssistantConfigurationTx.mockResolvedValueOnce({
      dormantSolPreference: true,
      effectiveProviderUpdated: true,
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      provider: "venice",
      solAvailable: false,
      updated: true,
    });

    const response = await route.POST(jsonRequest({
      provider: "venice",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dormantSolPreference: true,
      model: "gpt-5.6-terra",
      ok: true,
      provider: "venice",
      solAvailable: false,
      updated: true,
    });
    expect(mocks.updateHostedMemberAssistantConfigurationTx).toHaveBeenCalledWith({
      memberId: "member_edge",
      prisma: { tx: true },
      provider: "venice",
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledOnce();
  });

  it("keeps a committed provider change successful when the recheck signal fails", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(
      new Error("orchestration unavailable"),
    );
    mocks.updateHostedMemberAssistantConfigurationTx.mockResolvedValueOnce({
      dormantSolPreference: false,
      effectiveProviderUpdated: true,
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      provider: "venice",
      solAvailable: true,
      updated: true,
    });

    const response = await route.POST(jsonRequest({
      provider: "venice",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: "venice",
      updated: true,
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledOnce();
  });

  it("rejects Venice before the rollout gate opens", async () => {
    mocks.updateHostedMemberAssistantConfigurationTx.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE",
        httpStatus: 403,
        message: "Venice is not available for this Murph deployment.",
      }),
    );
    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-terra",
      provider: "venice",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE",
      },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("returns the canonical idempotent result", async () => {
    mocks.updateHostedMemberAssistantConfigurationTx.mockResolvedValue({
      dormantSolPreference: false,
      effectiveProviderUpdated: false,
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      provider: "openai",
      solAvailable: true,
      updated: false,
    });

    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-terra",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dormantSolPreference: false,
      model: "gpt-5.6-terra",
      ok: true,
      provider: "openai",
      solAvailable: true,
      updated: false,
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("returns the stable Edge entitlement error", async () => {
    mocks.updateHostedMemberAssistantConfigurationTx.mockRejectedValue(
      hostedOnboardingError({
        code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
        httpStatus: 403,
        message: "GPT-5.6 Sol requires an active paid Edge plan.",
      }),
    );

    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-sol",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
        message: "GPT-5.6 Sol requires an active paid Edge plan.",
        retryable: false,
      },
    });
  });

  it("rejects invalid, missing, and extra request fields before persistence", async () => {
    const invalidModelResponse = await route.POST(jsonRequest({
      model: "retired-model",
    }));
    expect(invalidModelResponse.status).toBe(400);
    await expect(invalidModelResponse.json()).resolves.toMatchObject({
      error: {
        code: "ASSISTANT_MODEL_INVALID_MODEL",
      },
    });

    const missingModelResponse = await route.POST(jsonRequest({}));
    expect(missingModelResponse.status).toBe(400);
    await expect(missingModelResponse.json()).resolves.toMatchObject({
      error: {
        code: "ASSISTANT_MODEL_INVALID_REQUEST",
      },
    });

    const extraFieldResponse = await route.POST(jsonRequest({
      model: "gpt-5.6-terra",
      unexpected: true,
    }));
    expect(extraFieldResponse.status).toBe(400);
    await expect(extraFieldResponse.json()).resolves.toMatchObject({
      error: {
        code: "ASSISTANT_MODEL_INVALID_REQUEST",
      },
    });

    const invalidProviderResponse = await route.POST(jsonRequest({
      model: "gpt-5.6-terra",
      provider: "unknown",
    }));
    expect(invalidProviderResponse.status).toBe(400);
    await expect(invalidProviderResponse.json()).resolves.toMatchObject({
      error: {
        code: "ASSISTANT_MODEL_INVALID_PROVIDER",
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberAssistantConfigurationTx).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before persistence", async () => {
    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-sol",
      padding: "x".repeat(1_100),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "ASSISTANT_MODEL_BODY_TOO_LARGE",
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("enforces mutation origin before authentication or parsing", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_REQUEST_ORIGIN_REJECTED",
        httpStatus: 403,
        message: "Request origin is not allowed.",
      });
    });

    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-sol",
    }));

    expect(response.status).toBe(403);
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests before opening a transaction", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_APP_SESSION_REQUIRED",
        httpStatus: 401,
        message: "Sign in before continuing.",
      }),
    );

    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-sol",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_APP_SESSION_REQUIRED",
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberAssistantConfigurationTx)
      .not.toHaveBeenCalled();
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://join.example.test/api/settings/assistant-model", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
