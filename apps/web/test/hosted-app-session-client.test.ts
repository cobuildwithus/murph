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

  it("keeps every tab cleared when logout and its authority fence both fail in transport", async () => {
    const events: string[] = [];
    mocks.publishBrowserVaultSessionEnding.mockImplementation(() => {
      events.push("clear");
    });
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async () => {
      events.push("logout");
      throw new TypeError("network unavailable");
    }).mockImplementationOnce(async () => {
      events.push("fence");
      throw new TypeError("still unavailable");
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
    expect(events).toEqual(["clear", "logout", "fence"]);
    expect(mocks.publishBrowserVaultSessionInvalidation).not.toHaveBeenCalled();
    expect(mocks.reloadCurrentHostedAuthDocument).not.toHaveBeenCalled();
  });

  it("releases cleared tabs only after the retry fence receives replacement headers", async () => {
    const events: string[] = [];
    mocks.publishBrowserVaultSessionEnding.mockImplementation(() => {
      events.push("clear");
    });
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async () => {
      events.push("logout");
      throw new TypeError("network unavailable");
    }).mockImplementationOnce(async (input: {
      onSuccessfulResponseHeaders?: () => void;
    }) => {
      events.push("fence");
      input.onSuccessfulResponseHeaders?.();
      return { ok: true };
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
    expect(events).toEqual([
      "clear",
      "logout",
      "fence",
      "revalidate",
      "reload",
    ]);
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
