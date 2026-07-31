import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LinkAccountCallbacks = {
  onError?: (error: unknown, details?: { linkMethod?: string }) => void;
  onSuccess?: (params: {
    linkedAccount: unknown;
    linkMethod: string;
    user: { linkedAccounts?: unknown };
  }) => void;
};

type UpdateAccountCallbacks = {
  onError?: (error: unknown, details?: { linkMethod?: string }) => void;
  onSuccess?: (params: {
    updateMethod: string;
    updatedAccount: unknown;
    user: { linkedAccounts?: unknown };
  }) => void;
};

const mocks = vi.hoisted(() => ({
  finalizeHostedPhoneLink: vi.fn(),
  linkAccountCallbacks: null as LinkAccountCallbacks | null,
  linkPhone: vi.fn(),
  reportHostedPhoneLinkDiagnostic: vi.fn(),
  refreshUser: vi.fn(),
  useLinkAccount: vi.fn(),
  usePrivy: vi.fn(),
  updateAccountCallbacks: null as UpdateAccountCallbacks | null,
  updatePhone: vi.fn(),
  useUpdateAccount: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLinkAccount: mocks.useLinkAccount,
  usePrivy: mocks.usePrivy,
  useUpdateAccount: mocks.useUpdateAccount,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth-support", () => ({
  finalizeHostedPhoneLink: mocks.finalizeHostedPhoneLink,
  reportHostedPhoneLinkDiagnostic: mocks.reportHostedPhoneLinkDiagnostic,
}));

let cleanupRender: (() => Promise<void>) | null = null;

describe("HostedPhoneSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkAccountCallbacks = null;
    mocks.updateAccountCallbacks = null;
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      ready: true,
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        id: "privy-user-a",
        linkedAccounts: [],
      },
    });
    mocks.useLinkAccount.mockImplementation((callbacks: LinkAccountCallbacks) => {
      mocks.linkAccountCallbacks = callbacks;
      return {
        linkPhone: mocks.linkPhone,
      };
    });
    mocks.useUpdateAccount.mockImplementation((callbacks: UpdateAccountCallbacks) => {
      mocks.updateAccountCallbacks = callbacks;
      return {
        updatePhone: mocks.updatePhone,
      };
    });
    mocks.refreshUser.mockResolvedValue({
      id: "privy-user-a",
      linkedAccounts: [],
    });
    mocks.reportHostedPhoneLinkDiagnostic.mockResolvedValue(undefined);
    mocks.finalizeHostedPhoneLink.mockImplementation(async (input: {
      onLinked?: (payload: { phoneNumber: string; phoneNumberHint: string }) => Promise<void> | void;
    }) => {
      await input.onLinked?.({
        phoneNumber: "+15550100002",
        phoneNumberHint: "*** 0002",
      });
    });
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
  });

  it("renders the member's routed Murph SMS link when available", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: "+15550100002",
        murphPhoneNumber: "+15550100001",
        privySessionMatchesAppSession: true,
      }),
    );

    expect(markup).toContain("•••• 0002");
    expect(markup).toContain("Text Murph");
    expect(markup).toContain('href="sms:+15550100001"');
  });

  it("omits the Murph SMS link when no routed number is available", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: "+15550100002",
        murphPhoneNumber: null,
        privySessionMatchesAppSession: true,
      }),
    );

    expect(markup).not.toContain("href=\"sms:");
  });

  it("keeps an unconnected phone number compact until the member opens Privy linking", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: null,
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Phone");
    expect(container.textContent).toContain("Not connected");
    expect(container.textContent).toContain("Link phone");
    expect(container.textContent).not.toContain("Verify phone");

    const linkButton = findButton(container, "Link phone");
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Verify phone");
    expect(mocks.linkPhone).not.toHaveBeenCalled();
  });

  it.each([
    [null, "Verify phone"],
    ["+15550100002", "Verify a new phone"],
  ] as const)(
    "opens the dialog phone action directly without a duplicate account card for %s",
    async (initialPhoneNumber, actionLabel) => {
      const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

      const { cleanup, container } = await renderClientComponent(
        createElement(HostedPhoneSettings, {
          authenticated: true,
          autoOpen: true,
          diagnosticSurface: "settings",
          expectedPrivyUserId: "privy-user-a",
          initialPhoneNumber,
          privySessionMatchesAppSession: true,
        }),
        { requireButton: false },
      );
      cleanupRender = cleanup;

      expect(container.textContent).toContain(actionLabel);
      expect(container.textContent).not.toContain("Not connected");
      expect(container.textContent).not.toContain("•••• 0002");
    },
  );

  it("uses Privy's link-phone flow and syncs the linked account exactly once", async () => {
    const onLinked = vi.fn();
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        autoOpen: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: null,
        onLinked,
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    expect(mocks.updatePhone).not.toHaveBeenCalled();

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          phoneNumber: "+15550100002",
          type: "phone",
        },
        linkMethod: "sms",
        user: {
          linkedAccounts: [],
        },
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          phoneNumber: "+15550100002",
          type: "phone",
        },
        linkMethod: "sms",
        user: {
          linkedAccounts: [],
        },
      });
      await Promise.resolve();
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(readDiagnosticEvents()).toEqual(expect.arrayContaining([
      "surface_loaded",
      "provider_started",
      "provider_succeeded",
      "sync_succeeded",
    ]));
    const serializedDiagnostics = JSON.stringify(mocks.reportHostedPhoneLinkDiagnostic.mock.calls);
    expect(serializedDiagnostics).not.toContain("privy-user-a");
    expect(serializedDiagnostics).not.toContain("+15550100002");
  });

  it("uses Privy's update-phone flow when the matched account already has a phone", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        id: "privy-user-a",
        linkedAccounts: [],
        phone: {
          number: "+15550100002",
        },
      },
    });
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        autoOpen: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: "+15550100002",
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
    });

    expect(mocks.updatePhone).toHaveBeenCalledTimes(1);
    expect(mocks.linkPhone).not.toHaveBeenCalled();

    await act(async () => {
      mocks.updateAccountCallbacks?.onSuccess?.({
        updateMethod: "sms",
        updatedAccount: {
          phoneNumber: "+15550100003",
          type: "phone",
        },
        user: {
          linkedAccounts: [],
        },
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
    });
  });

  it("uses link-phone when only the Murph snapshot has a phone", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        autoOpen: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: "+15550100002",
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
    });

    expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    expect(mocks.updatePhone).not.toHaveBeenCalled();
  });

  it("blocks provider mutation when the client Privy user differs from the app session", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        id: "privy-user-b",
        linkedAccounts: [],
      },
    });
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        autoOpen: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: null,
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    const verifyButton = findButton(container, "Verify phone");
    expect(verifyButton?.disabled).toBe(true);
    expect(container.textContent).toContain(
      "Your sign-in changed. Refresh this page before linking a phone.",
    );
    expect(mocks.linkPhone).not.toHaveBeenCalled();
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();
    expect(mocks.reportHostedPhoneLinkDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        clientState: "provider_user_mismatch",
        event: "surface_blocked",
      }),
    );
  });

  it("blocks provider mutation when the server could not prove the Privy session match", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        autoOpen: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: null,
        privySessionMatchesAppSession: false,
      }),
    );
    cleanupRender = cleanup;

    expect(findButton(container, "Verify phone")?.disabled).toBe(true);
    expect(mocks.linkPhone).not.toHaveBeenCalled();
    expect(mocks.updatePhone).not.toHaveBeenCalled();
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();
    expect(mocks.reportHostedPhoneLinkDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        clientState: "server_session_mismatch",
        event: "surface_blocked",
      }),
    );
  });

  it.each([
    "linked_to_another_user",
    "account_transfer_required",
  ])("explains provider phone ownership conflicts for %s", async (errorCode) => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        autoOpen: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: null,
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      mocks.linkAccountCallbacks?.onError?.(errorCode, {
        linkMethod: "sms",
      });
    });

    expect(container.textContent).toContain(
      "That phone number belongs to another account. Sign in to that account or contact support.",
    );
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();
    expect(mocks.reportHostedPhoneLinkDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        detailCode: errorCode,
        event: "provider_failed",
      }),
    );
  });

  it("records client refresh and Murph sync failures without serializing the error", async () => {
    mocks.refreshUser.mockRejectedValueOnce(new Error("provider payload must stay private"));
    mocks.finalizeHostedPhoneLink.mockRejectedValueOnce(
      new Error("server response must stay private"),
    );
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        autoOpen: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: null,
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: { type: "phone" },
        linkMethod: "sms",
        user: { linkedAccounts: [] },
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(readDiagnosticEvents()).toEqual(expect.arrayContaining([
        "client_refresh_failed",
        "sync_failed",
      ]));
    });
    const serializedDiagnostics = JSON.stringify(mocks.reportHostedPhoneLinkDiagnostic.mock.calls);
    expect(serializedDiagnostics).not.toContain("provider payload must stay private");
    expect(serializedDiagnostics).not.toContain("server response must stay private");
  });

  it("does not use Privy client phone state as the displayed phone authority", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        id: "privy-user-a",
        linkedAccounts: [
          {
            latest_verified_at: 1771977600,
            phone_number: "+15550100002",
            type: "phone",
          },
        ],
      },
    });

    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const markup = renderToStaticMarkup(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        diagnosticSurface: "settings",
        expectedPrivyUserId: "privy-user-a",
        initialPhoneNumber: null,
        privySessionMatchesAppSession: true,
      }),
    );

    expect(markup).toContain("Not connected");
    expect(markup).not.toContain("•••• 0002");
  });
});

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
}

function readDiagnosticEvents(): unknown[] {
  return mocks.reportHostedPhoneLinkDiagnostic.mock.calls.map(
    ([diagnostic]) => diagnostic?.event,
  );
}
