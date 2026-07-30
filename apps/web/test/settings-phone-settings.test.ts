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
  updateAccountCallbacks: null as UpdateAccountCallbacks | null,
  updatePhone: vi.fn(),
  useUpdateAccount: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLinkAccount: mocks.useLinkAccount,
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
      createElement(HostedPhoneSettings, {}),
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
        onLinked,
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

  it("auto-opens Privy's phone flow once without rendering a second action", async () => {
    const onAborted = vi.fn();
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        autoOpen: true,
        onAborted,
      }),
      { requireButton: false },
    );
    cleanupRender = cleanup;

    await vi.waitFor(() => {
      expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updatePhone).not.toHaveBeenCalled();
    expect(container.querySelector("button")).toBeNull();

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
    });

    expect(onAborted).toHaveBeenCalledTimes(1);
    expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
  });

  it("syncs an existing verified Privy phone without opening another provider mutation", async () => {
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
    const onLinked = vi.fn();
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        autoOpen: true,
        onLinked,
        syncExistingPhone: true,
      }),
      { requireButton: false },
    );
    cleanupRender = cleanup;

    await vi.waitFor(() => {
      expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    expect(mocks.linkPhone).not.toHaveBeenCalled();
    expect(mocks.updatePhone).not.toHaveBeenCalled();
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
      createElement(HostedPhoneSettings, {}),
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

  it("reconciles a completed account transfer after Privy closes the link flow", async () => {
    const onLinked = vi.fn();
    mocks.refreshUser.mockResolvedValue({
      id: "privy-user-a",
      linkedAccounts: [],
      phone: {
        number: "+15550100002",
      },
    });
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        onLinked,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      mocks.linkAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
    });

    expect(container.textContent).not.toContain("belongs to another account");
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
      expect(onLinked).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
  });

  it("closes without syncing when an offered account transfer is declined", async () => {
    const onAborted = vi.fn();
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        onAborted,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      mocks.linkAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
      expect(onAborted).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();
  });

  it("uses the server as transfer authority when the client user refresh fails", async () => {
    mocks.refreshUser.mockRejectedValueOnce(new Error("refresh unavailable"));
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {}),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      mocks.linkAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
    });
  });

  it("reconciles a completed account transfer from Privy's update-phone flow", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        id: "privy-user-a",
        linkedAccounts: [],
        phone: {
          number: "+15550100001",
        },
      },
    });
    mocks.refreshUser.mockResolvedValue({
      id: "privy-user-a",
      linkedAccounts: [],
      phone: {
        number: "+15550100002",
      },
    });
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {}),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      mocks.updateAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.updateAccountCallbacks?.onError?.("exited_update_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
    });
  });

  it("explains a terminal provider phone ownership conflict", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {}),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      mocks.linkAccountCallbacks?.onError?.("linked_to_another_user", {
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
      createElement(HostedPhoneSettings, {}),
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
