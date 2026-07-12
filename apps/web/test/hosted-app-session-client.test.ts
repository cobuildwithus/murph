import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearBrowserVaultWarmState: vi.fn(),
  publishBrowserVaultSessionInvalidation: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/warm-store", () => ({
  clearBrowserVaultWarmState: mocks.clearBrowserVaultWarmState,
}));

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  publishBrowserVaultSessionInvalidation:
    mocks.publishBrowserVaultSessionInvalidation,
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

describe("logoutHostedAppSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears decrypted browser-vault memory before invalidating the server session", async () => {
    const events: string[] = [];
    mocks.clearBrowserVaultWarmState.mockImplementation(() => {
      events.push("clear");
    });
    mocks.publishBrowserVaultSessionInvalidation.mockImplementation(() => {
      events.push("publish");
    });
    mocks.requestHostedOnboardingJson.mockImplementation(async (input: {
      onSuccessfulResponseHeaders?: () => void;
    }) => {
      events.push("logout");
      input.onSuccessfulResponseHeaders?.();
      return { ok: true };
    });

    const { logoutHostedAppSession } = await import(
      "@/src/components/hosted-onboarding/hosted-app-session-client"
    );

    await logoutHostedAppSession();

    expect(events).toEqual(["clear", "publish", "logout", "publish"]);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      onSuccessfulResponseHeaders: mocks.publishBrowserVaultSessionInvalidation,
      url: "/api/hosted-onboarding/session/logout",
    });
  });

  it("publishes again when successful logout headers precede a body-read failure", async () => {
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async (input: {
      onSuccessfulResponseHeaders?: () => void;
    }) => {
      input.onSuccessfulResponseHeaders?.();
      throw new Error("response body unavailable");
    });

    const { logoutHostedAppSession } = await import(
      "@/src/components/hosted-onboarding/hosted-app-session-client"
    );

    await expect(logoutHostedAppSession()).rejects.toThrow("response body unavailable");
    expect(mocks.clearBrowserVaultWarmState).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(2);
  });
});
