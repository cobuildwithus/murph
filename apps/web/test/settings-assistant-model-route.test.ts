import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  transaction: vi.fn(),
  updateHostedMemberAssistantModelPreferenceTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  updateHostedMemberAssistantModelPreferenceTx:
    mocks.updateHostedMemberAssistantModelPreferenceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
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
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockResolvedValue({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      solAvailable: true,
      updated: true,
    });
  });

  it("persists a validated model choice without a mailbox wake", async () => {
    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-sol",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      model: "gpt-5.6-sol",
      ok: true,
      solAvailable: true,
      updated: true,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.updateHostedMemberAssistantModelPreferenceTx).toHaveBeenCalledWith({
      memberId: "member_edge",
      model: "gpt-5.6-sol",
      prisma: { tx: true },
    });
  });

  it("returns the canonical idempotent result", async () => {
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: true,
      updated: false,
    });

    const response = await route.POST(jsonRequest({
      model: "gpt-5.6-terra",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      model: "gpt-5.6-terra",
      ok: true,
      solAvailable: true,
      updated: false,
    });
  });

  it("returns the stable Edge entitlement error", async () => {
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockRejectedValue(
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
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberAssistantModelPreferenceTx).not.toHaveBeenCalled();
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
    expect(mocks.updateHostedMemberAssistantModelPreferenceTx)
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
