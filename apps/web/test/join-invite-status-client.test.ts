import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

import { fetchHostedInviteStatus } from "@/src/components/hosted-onboarding/invite-status-client";

describe("invite status client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests invite status from the same-origin hosted onboarding route", async () => {
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

    await fetchHostedInviteStatus("invite-code");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      url: "/api/hosted-onboarding/invites/invite-code/status",
    });
  });
});
