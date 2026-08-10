import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HostedInferenceConnectionError,
} from "@/src/lib/hosted-inference/connection-store";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  readHostedInferenceConnectionView: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  scheduleHostedInferenceRuntimeWake: vi.fn(),
  setHostedInferenceConnectionSelected: vi.fn(),
}));

vi.mock(
  "@/src/lib/hosted-inference/connection-store",
  async (importOriginal) => ({
    ...await importOriginal<
      typeof import("@/src/lib/hosted-inference/connection-store")
    >(),
    readHostedInferenceConnectionView:
      mocks.readHostedInferenceConnectionView,
    setHostedInferenceConnectionSelected:
      mocks.setHostedInferenceConnectionSelected,
  }),
);

vi.mock("@/src/lib/hosted-inference/runtime-wake", () => ({
  scheduleHostedInferenceRuntimeWake:
    mocks.scheduleHostedInferenceRuntimeWake,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

type RouteModule = typeof import("../app/api/settings/assistant/route");

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

let route: RouteModule;

describe("assistant inference mode settings route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/assistant/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_CUSTOM_INFERENCE_ENABLED", "1");
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.readHostedInferenceConnectionView.mockResolvedValue(CONNECTION_VIEW);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_assistant_mode" },
    });
    mocks.setHostedInferenceConnectionSelected.mockImplementation(
      async (input: { selected: boolean }) => ({
        ...CONNECTION_VIEW,
        selected: input.selected,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects a verified custom connection and wakes the runtime", async () => {
    const response = await route.POST(request({ mode: "custom" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mode: "custom",
      updated: true,
    });
    expect(mocks.setHostedInferenceConnectionSelected).toHaveBeenCalledWith({
      expectedRevision: CONNECTION_VIEW.revision,
      memberId: "member_assistant_mode",
      selected: true,
    });
    expect(mocks.scheduleHostedInferenceRuntimeWake).toHaveBeenCalledWith(
      "member_assistant_mode",
    );
  });

  it("leaves managed mode unchanged when no custom connection exists", async () => {
    mocks.readHostedInferenceConnectionView.mockResolvedValueOnce(null);

    const response = await route.POST(request({ mode: "managed" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mode: "managed",
      updated: false,
    });
    expect(mocks.setHostedInferenceConnectionSelected).not.toHaveBeenCalled();
    expect(mocks.scheduleHostedInferenceRuntimeWake).not.toHaveBeenCalled();
  });

  it("does not select a Chat Completions connection while that adapter is disabled", async () => {
    mocks.readHostedInferenceConnectionView.mockResolvedValueOnce({
      ...CONNECTION_VIEW,
      protocol: "chat_completions",
    });

    const response = await route.POST(request({ mode: "custom" }));

    expect(response.status).toBe(403);
    expect(mocks.setHostedInferenceConnectionSelected).not.toHaveBeenCalled();
    expect(mocks.scheduleHostedInferenceRuntimeWake).not.toHaveBeenCalled();
  });

  it("returns a conflict when the connection changed between read and select", async () => {
    mocks.setHostedInferenceConnectionSelected.mockRejectedValueOnce(
      new HostedInferenceConnectionError(
        "HOSTED_INFERENCE_CONNECTION_CONFLICT",
        "The custom inference connection changed. Refresh Settings and try again.",
      ),
    );

    const response = await route.POST(request({ mode: "custom" }));

    expect(response.status).toBe(409);
    expect(mocks.scheduleHostedInferenceRuntimeWake).not.toHaveBeenCalled();
  });

  it("rejects extra routing fields instead of accepting hidden state", async () => {
    const response = await route.POST(request({
      connectionId: "unexpected",
      mode: "custom",
    }));

    expect(response.status).toBe(400);
    expect(mocks.setHostedInferenceConnectionSelected).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>): Request {
  return new Request("https://join.example.test/api/settings/assistant", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
