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

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/components/hosted-onboarding/client-api")
  >();

  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

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

  it("does not replay destructive logout when ambient authority changes after a transport failure", async () => {
    const events: string[] = [];
    let ambientMember = "member_A";
    mocks.publishBrowserVaultSessionEnding.mockImplementation(() => {
      events.push("clear");
    });
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async () => {
      events.push("logout");
      ambientMember = "member_B";
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
    expect(ambientMember).toBe("member_B");
    expect(events).toEqual(["clear", "logout", "reload"]);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).not.toHaveBeenCalled();
    expect(mocks.reloadCurrentHostedAuthDocument).toHaveBeenCalledTimes(1);
  });

  it("revalidates current authority after an explicit HTTP rejection", async () => {
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new HostedOnboardingApiError({
        code: "LOGOUT_REJECTED",
        message: "Logout was rejected.",
      }),
    );

    const { logoutHostedAppSession } = await import(
      "@/src/components/hosted-onboarding/hosted-app-session-client"
    );

    await expect(logoutHostedAppSession()).rejects.toThrow("Logout was rejected.");
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).toHaveBeenCalledTimes(1);
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
