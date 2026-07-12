import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publishBrowserVaultSessionEnding: vi.fn(),
  publishBrowserVaultSessionInvalidation: vi.fn(),
  reloadCurrentHostedAuthDocument: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  publishBrowserVaultSessionEnding:
    mocks.publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation:
    mocks.publishBrowserVaultSessionInvalidation,
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  reloadCurrentHostedAuthDocument: mocks.reloadCurrentHostedAuthDocument,
}));

describe("logoutHostedAppSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears decrypted browser-vault memory in every tab before invalidating the server session", async () => {
    const events: string[] = [];
    mocks.publishBrowserVaultSessionEnding.mockImplementation(() => {
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

    expect(events).toEqual(["clear", "logout", "publish"]);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      onSuccessfulResponseError: mocks.reloadCurrentHostedAuthDocument,
      onSuccessfulResponseHeaders: expect.any(Function),
      url: "/api/hosted-onboarding/session/logout",
    });
  });

  it("revalidates every tab when logout rejects before replacement headers arrive", async () => {
    const events: string[] = [];
    mocks.publishBrowserVaultSessionEnding.mockImplementation(() => {
      events.push("clear");
    });
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async () => {
      events.push("logout");
      throw new TypeError("network unavailable");
    });
    mocks.publishBrowserVaultSessionInvalidation.mockImplementation(() => {
      events.push("revalidate");
    });
    mocks.reloadCurrentHostedAuthDocument.mockImplementation(() => {
      events.push("reload");
    });

    const { logoutHostedAppSession } = await import(
      "@/src/components/hosted-onboarding/hosted-app-session-client"
    );

    await expect(logoutHostedAppSession()).rejects.toThrow("network unavailable");
    expect(events).toEqual(["clear", "logout", "revalidate", "reload"]);
  });

  it("publishes again when successful logout headers precede a body-read failure", async () => {
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async (input: {
      onSuccessfulResponseError?: () => void;
      onSuccessfulResponseHeaders?: () => void;
    }) => {
      input.onSuccessfulResponseHeaders?.();
      input.onSuccessfulResponseError?.();
      throw new Error("response body unavailable");
    });

    const { logoutHostedAppSession } = await import(
      "@/src/components/hosted-onboarding/hosted-app-session-client"
    );

    await expect(logoutHostedAppSession()).rejects.toThrow("response body unavailable");
    expect(mocks.publishBrowserVaultSessionEnding).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).toHaveBeenCalledTimes(1);
  });
});
