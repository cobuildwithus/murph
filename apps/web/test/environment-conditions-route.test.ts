import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  loadEnvironmentConditions: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/environment/conditions", () => ({
  loadEnvironmentConditions: mocks.loadEnvironmentConditions,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

import { POST } from "../app/api/environment/conditions/route";

describe("environment conditions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.loadEnvironmentConditions.mockResolvedValue({
      airQuality: null,
      locationLabel: "Warsaw, PL",
      weather: null,
    });
  });

  it("rejects a precise address before calling the provider owner", async () => {
    const response = await POST(createRequest(
      "123 Main Street, apartment 4, Warsaw 00-001",
    ));

    expect(response.status).toBe(400);
    expect(mocks.loadEnvironmentConditions).not.toHaveBeenCalled();
  });

  it("passes a normalized city or region to the provider owner", async () => {
    const response = await POST(createRequest("  Warsaw, Poland  "));

    expect(response.status).toBe(200);
    expect(mocks.loadEnvironmentConditions).toHaveBeenCalledWith({
      location: "Warsaw, Poland",
      memberId: "member_123",
    });
  });
});

function createRequest(location: string): Request {
  return new Request("https://local.withmurph.ai/api/environment/conditions", {
    body: JSON.stringify({ location }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
