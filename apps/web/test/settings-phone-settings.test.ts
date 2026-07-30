import { act, createElement } from "react";
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

  it("renders the provider action directly with a stable status region", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        expectedPrivyUserId: "privy-user-a",
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Verify phone");
    expect(container.textContent).not.toContain("Not connected");
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
  });

  it("uses Privy's link-phone flow and syncs the linked account exactly once", async () => {
    const onLinked = vi.fn();
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        expectedPrivyUserId: "privy-user-a",
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
    expect(findButton(container, "Opening")?.getAttribute("aria-busy")).toBe("true");

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
        expectedPrivyUserId: "privy-user-a",
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
        expectedPrivyUserId: "privy-user-a",
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
  });

  it("blocks provider mutation when the server could not prove the Privy session match", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        expectedPrivyUserId: "privy-user-a",
        privySessionMatchesAppSession: false,
      }),
    );
    cleanupRender = cleanup;

    expect(findButton(container, "Verify phone")?.disabled).toBe(true);
    expect(mocks.linkPhone).not.toHaveBeenCalled();
    expect(mocks.updatePhone).not.toHaveBeenCalled();
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();
  });

  it.each([
    "linked_to_another_user",
    "account_transfer_required",
  ])("explains provider phone ownership conflicts for %s", async (errorCode) => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        expectedPrivyUserId: "privy-user-a",
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
  });

  it("does not infer an update flow from linked-account projections alone", async () => {
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
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        expectedPrivyUserId: "privy-user-a",
        privySessionMatchesAppSession: true,
      }),
    );
    cleanupRender = cleanup;

    expect(findButton(container, "Verify phone")).toBeTruthy();
    expect(findButton(container, "Verify a new phone")).toBeUndefined();
  });
});

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
}
