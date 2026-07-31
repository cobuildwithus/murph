import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LinkAccountCallbacks = {
  onError?: (error: unknown, details?: { linkMethod?: string }) => void;
  onSuccess?: (params: {
    linkedAccount: { number: string; type: "phone" };
    linkMethod: string;
    user: { linkedAccounts?: unknown };
  }) => void;
};

type UpdateAccountCallbacks = {
  onError?: (error: unknown, details?: { linkMethod?: string }) => void;
  onSuccess?: (params: {
    updateMethod: string;
    updatedAccount: { number: string; type: "phone" };
    user: { linkedAccounts?: unknown };
  }) => void;
};

type SyncExpectation =
  | { kind: "changed-from"; phoneNumber: string | null }
  | { kind: "exact"; phoneNumber: string };

const mocks = vi.hoisted(() => ({
  finalizeHostedPhoneLink: vi.fn(),
  linkAccountCallbacks: null as LinkAccountCallbacks | null,
  linkPhone: vi.fn(),
  providerPhoneNumber: null as string | null,
  transferPhoneNumber: null as string | null,
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
    mocks.providerPhoneNumber = null;
    mocks.transferPhoneNumber = null;
    mocks.updateAccountCallbacks = null;
    mocks.useUser.mockImplementation(() => ({
      user: {
        id: "privy-user-a",
        linkedAccounts: [],
        ...(mocks.providerPhoneNumber
          ? {
              phone: {
                number: mocks.providerPhoneNumber,
              },
            }
          : {}),
      },
    }));
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
    mocks.finalizeHostedPhoneLink.mockImplementation(async (input: {
      expectation: SyncExpectation;
      onLinked?: (payload: {
        phoneNumber: string;
        phoneNumberHint: string;
      }) => Promise<void> | void;
    }) => {
      if (
        input.expectation.kind === "changed-from"
        && input.expectation.phoneNumber === mocks.transferPhoneNumber
      ) {
        return {
          status: "unchanged",
        };
      }

      const phoneNumber = input.expectation.kind === "changed-from"
        ? mocks.transferPhoneNumber
        : input.expectation.phoneNumber;
      if (!phoneNumber) {
        return {
          status: "unchanged",
        };
      }

      const result = {
        phoneNumber,
        phoneNumberHint: "*** 0002",
        status: "synced",
      } as const;
      await input.onLinked?.(result);
      return result;
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
    expect(mocks.useLinkAccount).toHaveBeenCalled();
    expect(mocks.useUpdateAccount).toHaveBeenCalled();
  });

  it("opens Privy directly and syncs the exact linked phone once", async () => {
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
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updatePhone).not.toHaveBeenCalled();

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          number: "+15550100002",
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
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledWith({
      expectation: {
        kind: "exact",
        phoneNumber: "+15550100002",
      },
      onLinked: expect.any(Function),
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          number: "+15550100002",
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
  });

  it("auto-opens Privy's phone flow once and treats an ordinary exit as cancellation", async () => {
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
    expect(container.querySelector("button")).toBeNull();

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
    });

    expect(onAborted).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();
  });

  it("repairs a completed provider transfer without reopening Privy", async () => {
    const onLinked = vi.fn();
    mocks.providerPhoneNumber = "+15550100002";
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        autoOpen: true,
        initialPhoneNumber: null,
        onLinked,
      }),
      { requireButton: false },
    );
    cleanupRender = cleanup;

    await vi.waitFor(() => {
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledWith({
      expectation: {
        kind: "exact",
        phoneNumber: "+15550100002",
      },
      onLinked: expect.any(Function),
    });
    expect(mocks.useLinkAccount).toHaveBeenCalled();
    expect(mocks.useUpdateAccount).toHaveBeenCalled();
    expect(mocks.linkPhone).not.toHaveBeenCalled();
    expect(mocks.updatePhone).not.toHaveBeenCalled();
  });

  it("retries a completed provider transfer save without reopening Privy", async () => {
    const onLinked = vi.fn();
    mocks.providerPhoneNumber = "+15550100002";
    let exactAttempts = 0;
    mocks.finalizeHostedPhoneLink.mockImplementation(async (input: {
      expectation: SyncExpectation;
      onLinked?: (payload: {
        phoneNumber: string;
        phoneNumberHint: string;
      }) => Promise<void> | void;
    }) => {
      exactAttempts += 1;
      if (exactAttempts === 1) {
        throw new Error("save unavailable");
      }
      const result = {
        phoneNumber: "+15550100002",
        phoneNumberHint: "*** 0002",
        status: "synced",
      } as const;
      await input.onLinked?.(result);
      return result;
    });
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        initialPhoneNumber: null,
        onLinked,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("save unavailable");
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenNthCalledWith(1, {
      expectation: {
        kind: "exact",
        phoneNumber: "+15550100002",
      },
      onLinked: expect.any(Function),
    });

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenNthCalledWith(2, {
      expectation: {
        kind: "exact",
        phoneNumber: "+15550100002",
      },
      onLinked: expect.any(Function),
    });
    expect(mocks.linkPhone).not.toHaveBeenCalled();
    expect(mocks.updatePhone).not.toHaveBeenCalled();
  });

  it("uses Privy's update-phone flow when Murph and Privy agree on the current phone", async () => {
    mocks.providerPhoneNumber = "+15550100001";
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        initialPhoneNumber: "+15550100001",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.updatePhone).toHaveBeenCalledTimes(1);
    });
    expect(mocks.linkPhone).not.toHaveBeenCalled();

    await act(async () => {
      mocks.updateAccountCallbacks?.onSuccess?.({
        updateMethod: "sms",
        updatedAccount: {
          number: "+15550100002",
          type: "phone",
        },
        user: {
          linkedAccounts: [],
        },
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenLastCalledWith({
        expectation: {
          kind: "exact",
          phoneNumber: "+15550100002",
        },
        onLinked: expect.any(Function),
      });
    });
  });

  it("reconciles a completed null-to-phone account transfer after Privy exits", async () => {
    const onLinked = vi.fn();
    mocks.transferPhoneNumber = "+15550100002";
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        onLinked,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenLastCalledWith({
      expectation: {
        kind: "changed-from",
        phoneNumber: null,
      },
      onLinked: expect.any(Function),
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it("closes quietly when a null-to-null account transfer is declined", async () => {
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
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.linkAccountCallbacks?.onError?.("exited_link_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(onAborted).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
    expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
  });

  it("closes quietly when an existing-phone account transfer is declined", async () => {
    const onAborted = vi.fn();
    mocks.providerPhoneNumber = "+15550100001";
    mocks.transferPhoneNumber = "+15550100001";
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        initialPhoneNumber: "+15550100001",
        onAborted,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mocks.updatePhone).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.updateAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.updateAccountCallbacks?.onError?.("exited_update_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(onAborted).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenLastCalledWith({
      expectation: {
        kind: "changed-from",
        phoneNumber: "+15550100001",
      },
      onLinked: expect.any(Function),
    });
  });

  it("reconciles an existing-phone transfer without a second provider mutation", async () => {
    mocks.providerPhoneNumber = "+15550100001";
    mocks.transferPhoneNumber = "+15550100002";
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        initialPhoneNumber: "+15550100001",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mocks.updatePhone).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.updateAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.updateAccountCallbacks?.onError?.("exited_update_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updatePhone).toHaveBeenCalledTimes(1);
    expect(mocks.linkPhone).not.toHaveBeenCalled();
  });

  it("retries a failed post-transfer save without reopening Privy", async () => {
    mocks.providerPhoneNumber = "+15550100001";
    mocks.transferPhoneNumber = "+15550100002";
    let transferSyncAttempts = 0;
    mocks.finalizeHostedPhoneLink.mockImplementation(async (input: {
      expectation: SyncExpectation;
      onLinked?: (payload: {
        phoneNumber: string;
        phoneNumberHint: string;
      }) => Promise<void> | void;
    }) => {
      transferSyncAttempts += 1;
      if (transferSyncAttempts === 1) {
        throw new Error("save unavailable");
      }
      const result = {
        phoneNumber: "+15550100002",
        phoneNumberHint: "*** 0002",
        status: "synced",
      } as const;
      await input.onLinked?.(result);
      return result;
    });
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        initialPhoneNumber: "+15550100001",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mocks.updatePhone).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      mocks.updateAccountCallbacks?.onError?.("account_transfer_required", {
        linkMethod: "sms",
      });
      mocks.updateAccountCallbacks?.onError?.("exited_update_flow", {
        linkMethod: "sms",
      });
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("save unavailable");
    });

    await act(async () => {
      findButton(container, "Verify a new phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mocks.finalizeHostedPhoneLink).toHaveBeenCalledTimes(2);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenNthCalledWith(1, {
      expectation: {
        kind: "changed-from",
        phoneNumber: "+15550100001",
      },
      onLinked: expect.any(Function),
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenNthCalledWith(2, {
      expectation: {
        kind: "changed-from",
        phoneNumber: "+15550100001",
      },
      onLinked: expect.any(Function),
    });
    expect(mocks.updatePhone).toHaveBeenCalledTimes(1);
    expect(mocks.linkPhone).not.toHaveBeenCalled();
  });

  it("retries an ambiguous exact sync without reopening Privy", async () => {
    const onLinked = vi.fn();
    let exactSyncAttempts = 0;
    mocks.finalizeHostedPhoneLink.mockImplementation(async (input: {
      expectation: SyncExpectation;
      onLinked?: (payload: {
        phoneNumber: string;
        phoneNumberHint: string;
      }) => Promise<void> | void;
    }) => {
      if (input.expectation.kind !== "exact") {
        return {
          status: "unchanged",
        };
      }

      exactSyncAttempts += 1;
      if (exactSyncAttempts === 1) {
        throw new Error("save unavailable");
      }

      const result = {
        phoneNumber: input.expectation.phoneNumber,
        phoneNumberHint: "*** 0002",
        status: "synced",
      } as const;
      await input.onLinked?.(result);
      return result;
    });
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        onLinked,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          number: "+15550100002",
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
      expect(container.textContent).toContain("save unavailable");
    });

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(
        new Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenNthCalledWith(1, {
      expectation: {
        kind: "exact",
        phoneNumber: "+15550100002",
      },
      onLinked: expect.any(Function),
    });
    expect(mocks.finalizeHostedPhoneLink).toHaveBeenNthCalledWith(2, {
      expectation: {
        kind: "exact",
        phoneNumber: "+15550100002",
      },
      onLinked: expect.any(Function),
    });
    expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    expect(mocks.updatePhone).not.toHaveBeenCalled();
  });

  it("explains a terminal provider phone ownership conflict", async () => {
    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {}),
    );
    cleanupRender = cleanup;

    await act(async () => {
      findButton(container, "Verify phone")?.dispatchEvent(new Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mocks.linkPhone).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.("linked_to_another_user", {
        linkMethod: "sms",
      });
    });

    expect(container.textContent).toContain(
      "That phone number belongs to another account. Sign in to that account or contact support.",
    );
    const supportLink = container.querySelector('a[href^="mailto:support@withmurph.ai"]');
    expect(supportLink?.textContent).toContain("Contact support");
    expect(supportLink?.getAttribute("href")).toContain("subject=Help+linking+my+phone");
    expect(supportLink?.getAttribute("href")).not.toContain("privy-user-a");
    expect(mocks.finalizeHostedPhoneLink).not.toHaveBeenCalled();
  });

  it("does not infer an update flow from linked-account projections alone", async () => {
    mocks.useUser.mockReturnValue({
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
