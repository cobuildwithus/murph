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
  it("clears the pending action after a handled pending-action failure", async () => {
    const { runHostedPhonePendingAction } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-auth-support"
    );
    const pendingActions: Array<string | null> = [];
    const errors: unknown[] = [];

    const result = await runHostedPhonePendingAction({
      action: "send-code",
      onError(error) {
        errors.push(error);
      },
      run: async () => {
        throw new Error("send failed");
      },
      setPendingAction(action) {
        pendingActions.push(action);
      },
    });

    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
    expect(pendingActions).toEqual(["send-code", null]);
  });

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
