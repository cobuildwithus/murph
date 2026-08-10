import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  deleteHostedInferenceConnection: vi.fn(),
  getPrisma: vi.fn(),
  readHostedInferenceConnectionView: vi.fn(),
  replaceHostedInferenceConnection: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  requirePersonalHostedInferenceMember: vi.fn(),
  scheduleHostedInferenceRuntimeWake: vi.fn(),
  verifyHostedInferenceConnectionCandidate: vi.fn(),
}));

vi.mock(
  "@/src/lib/hosted-inference/connection-store",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/src/lib/hosted-inference/connection-store")
    >()),
    deleteHostedInferenceConnection: mocks.deleteHostedInferenceConnection,
    readHostedInferenceConnectionView:
      mocks.readHostedInferenceConnectionView,
    replaceHostedInferenceConnection:
      mocks.replaceHostedInferenceConnection,
    requirePersonalHostedInferenceMember:
      mocks.requirePersonalHostedInferenceMember,
  }),
);

vi.mock("@/src/lib/hosted-inference/runtime-wake", () => ({
  scheduleHostedInferenceRuntimeWake:
    mocks.scheduleHostedInferenceRuntimeWake,
}));

vi.mock("@/src/lib/hosted-inference/verification-client", () => ({
  verifyHostedInferenceConnectionCandidate:
    mocks.verifyHostedInferenceConnectionCandidate,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule =
  typeof import("../app/api/settings/inference-connection/route");

const CONNECTION_VIEW = {
  contextWindowTokens: 131_072,
  endpointHost: "inference.example.test",
  model: "example-model",
  protocol: "responses" as const,
  revision: 3,
  selected: false,
  supportsImages: false,
  verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
  verifiedAt: "2026-07-30T12:00:00.000Z",
};

const CANDIDATE = {
  auth: {
    kind: "bearer" as const,
    secret: "synthetic-route-secret",
  },
  contextWindowTokens: 131_072,
  endpointUrl: "https://inference.example.test/v1/responses",
  model: "example-model",
  protocol: "responses" as const,
  supportsImages: false,
};

let route: RouteModule;

describe("custom inference connection settings route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/inference-connection/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_CUSTOM_INFERENCE_ENABLED", "1");
    vi.stubEnv("HOSTED_CUSTOM_CHAT_COMPLETIONS_ENABLED", "1");
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.readHostedInferenceConnectionView.mockResolvedValue(CONNECTION_VIEW);
    mocks.replaceHostedInferenceConnection.mockResolvedValue(CONNECTION_VIEW);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_inference_settings" },
    });
    mocks.requirePersonalHostedInferenceMember.mockResolvedValue(undefined);
    mocks.verifyHostedInferenceConnectionCandidate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns only the sanitized connection view", async () => {
    const response = await route.GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connection: CONNECTION_VIEW,
    });
    expect(JSON.stringify(CONNECTION_VIEW)).not.toContain(
      CANDIDATE.auth.secret,
    );
  });

  it("verifies a candidate before replacing the durable connection", async () => {
    const response = await route.PUT(request("PUT", {
      ...CANDIDATE,
      expectedRevision: 2,
    }));

    expect(response.status).toBe(200);
    expect(mocks.verifyHostedInferenceConnectionCandidate).toHaveBeenCalledWith(
      {
        candidate: CANDIDATE,
        memberId: "member_inference_settings",
      },
    );
    expect(mocks.replaceHostedInferenceConnection).toHaveBeenCalledWith({
      candidate: CANDIDATE,
      expectedRevision: 2,
      memberId: "member_inference_settings",
      prisma: { prisma: true },
    });
    expect(
      mocks.verifyHostedInferenceConnectionCandidate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.replaceHostedInferenceConnection.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.scheduleHostedInferenceRuntimeWake).toHaveBeenCalledWith(
      "member_inference_settings",
    );
  });

  it("preserves the current connection when verification fails", async () => {
    mocks.verifyHostedInferenceConnectionCandidate.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_INFERENCE_VERIFICATION_FAILED",
        httpStatus: 422,
        message: "Synthetic compatibility check failed.",
      }),
    );

    const response = await route.PUT(request("PUT", {
      ...CANDIDATE,
      expectedRevision: 2,
    }));

    expect(response.status).toBe(422);
    expect(mocks.replaceHostedInferenceConnection).not.toHaveBeenCalled();
    expect(mocks.scheduleHostedInferenceRuntimeWake).not.toHaveBeenCalled();
  });

  it("wakes the runtime only when deleting the active connection", async () => {
    mocks.deleteHostedInferenceConnection
      .mockResolvedValueOnce({ deleted: true, selected: false })
      .mockResolvedValueOnce({ deleted: true, selected: true });

    const dormant = await route.DELETE(request("DELETE", {
      expectedRevision: 3,
    }));
    const active = await route.DELETE(request("DELETE", {
      expectedRevision: 3,
    }));

    expect(dormant.status).toBe(200);
    expect(active.status).toBe(200);
    expect(mocks.scheduleHostedInferenceRuntimeWake).toHaveBeenCalledOnce();
  });

  it("keeps the API unavailable while the rollout flag is off", async () => {
    vi.stubEnv("HOSTED_CUSTOM_INFERENCE_ENABLED", "0");

    const response = await route.GET(request("GET"));

    expect(response.status).toBe(404);
    expect(mocks.readHostedInferenceConnectionView).not.toHaveBeenCalled();
  });
});

function request(
  method: "DELETE" | "GET" | "PUT",
  body?: Record<string, unknown>,
): Request {
  return new Request(
    "https://join.example.test/api/settings/inference-connection",
    {
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { "content-type": "application/json" } : undefined,
      method,
    },
  );
}
