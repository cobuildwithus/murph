import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {
    readonly code: string | null;
    readonly retryable: boolean;

    constructor(input: { code: string | null; message: string; retryable?: boolean }) {
      super(input.message);
      this.code = input.code;
      this.retryable = input.retryable ?? false;
    }
  },
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

describe("hosted phone auth support", () => {
  it("syncs a linked phone from settings without client-authored email state", async () => {
    const { requestHostedPhoneLinkSyncWithRetry } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-auth-support"
    );
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
    });

    await expect(requestHostedPhoneLinkSyncWithRetry()).resolves.toEqual({
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      url: "/api/settings/phone/sync",
    });
  });
});
