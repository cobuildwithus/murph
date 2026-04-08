import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

import {
  fetchHostedInviteStatus,
  resolveHostedInviteStatusAuthMode,
} from "@/src/components/hosted-onboarding/invite-status-client";

describe("invite status client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses required auth once the client is already authenticated", () => {
    expect(resolveHostedInviteStatusAuthMode(true)).toBe("required");
    expect(resolveHostedInviteStatusAuthMode(false)).toBe("optional");
  });

  it("forwards the selected auth mode to the invite status request", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: null,
      session: {
        authenticated: false,
        expiresAt: null,
        matchesInvite: false,
      },
      stage: "invalid",
    });

    await fetchHostedInviteStatus("invite-code", "required");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      auth: "required",
      url: "/api/hosted-onboarding/invites/invite-code/status",
    });
  });
});
