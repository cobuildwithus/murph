import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const ORIGINAL_PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const ORIGINAL_PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

const mocks = vi.hoisted(() => ({
  onOpenChange: vi.fn(),
  openAuthDialog: vi.fn(),
  privyLogout: vi.fn(),
  privyProvider: vi.fn((props: { children: ReactNode }) =>
    createElement("div", null, props.children)),
  refresh: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
  phoneSettingsProps: [] as Array<{
    autoOpen?: boolean;
    onAborted?: () => void;
  }>,
  telegramCardProps: [] as Array<{
    autoLink?: boolean;
    initialTelegramAccount?: { telegramUserId: string; username: string | null } | null;
    showHeading?: boolean;
  }>,
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    openAuthDialog: mocks.openAuthDialog,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({
  HostedPrivyProvider: mocks.privyProvider,
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog(props: { children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
    return createElement("section", {
      "data-dialog-open": String(props.open ?? false),
    }, props.children);
  },
  DialogContent(props: { children?: ReactNode }) {
    return createElement("div", null, props.children);
  },
  DialogDescription(props: { children?: ReactNode }) {
    return createElement("p", null, props.children);
  },
  DialogHeader(props: { children?: ReactNode }) {
    return createElement("div", null, props.children);
  },
  DialogTitle(props: { children?: ReactNode }) {
    return createElement("h2", null, props.children);
  },
}));

vi.mock("@/src/components/settings/hosted-phone-settings", () => ({
  HostedPhoneSettings(props: {
    autoOpen?: boolean;
    onAborted?: () => void;
    onLinked?: (payload: { mode: string }) => void;
  }) {
    mocks.phoneSettingsProps.push({
      autoOpen: props.autoOpen,
      onAborted: props.onAborted,
    });

    return createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onLinked?.({ mode: "phone" }),
      },
      "Link phone child",
    );
  },
}));

vi.mock("@/src/components/settings/hosted-email-settings", () => ({
  HostedEmailSettings(props: { onSynced?: (payload: { mode: string }) => void }) {
    return createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onSynced?.({ mode: "email" }),
      },
      "Link email child",
    );
  },
}));

vi.mock("@/src/components/settings/hosted-email-privy-link-hand-off", () => ({
  HostedEmailPrivyLinkHandOff(props: {
    onAborted: () => void;
    onSynced?: (payload: { mode: string }) => void;
  }) {
    return createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onSynced?.({ mode: "email" }),
      },
      "Privy hand-off child",
    );
  },
}));

vi.mock("@/src/components/settings/hosted-telegram-card-settings", () => ({
  HostedTelegramCardSettings(props: {
    autoLink?: boolean;
    initialTelegramAccount?: { telegramUserId: string; username: string | null } | null;
    onSynced?: (payload: { mode: string }) => void;
    showHeading?: boolean;
  }) {
    mocks.telegramCardProps.push({
      autoLink: props.autoLink,
      initialTelegramAccount: props.initialTelegramAccount,
      showHeading: props.showHeading,
    });

    return createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onSynced?.({ mode: "telegram" }),
      },
      "Link telegram child",
    );
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phoneSettingsProps = [];
  mocks.telegramCardProps = [];
  mocks.usePrivy.mockReturnValue({
    authenticated: true,
    logout: mocks.privyLogout,
    ready: true,
  });
  mocks.privyLogout.mockResolvedValue(undefined);
  mocks.useUser.mockReturnValue({
    user: {
      id: "privy-user-a",
    },
  });
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app_test";
  process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID = "client_test";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = ORIGINAL_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID = ORIGINAL_PRIVY_CLIENT_ID;
});

describe("HostedSettingsIdentityLinkDialog", () => {
  it.each([
    ["email", "Link email child"],
    ["telegram", "Link telegram child"],
  ] as const)("closes and refreshes after %s sync succeeds", async (initialMode, buttonLabel) => {
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: makeAccountSnapshot(),
        expectedPrivyUserId: "privy-user-a",
        initialMode,
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      expect(container.querySelector('[data-dialog-open="true"]')).toBeTruthy();

      const triggerButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes(buttonLabel),
      );
      expect(triggerButton).toBeTruthy();

      await act(async () => {
        triggerButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("skips the Murph dialog and hands the matched phone action directly to Privy", async () => {
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: makeAccountSnapshot(),
        expectedPrivyUserId: "privy-user-a",
        initialMode: "phone",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      expect(container.querySelector("[data-dialog-open]")).toBeNull();
      expect(container.textContent).toContain("Link phone child");
      expect(mocks.phoneSettingsProps).toHaveLength(1);
      expect(mocks.phoneSettingsProps[0]?.autoOpen).toBe(true);
      expect(mocks.privyProvider).not.toHaveBeenCalled();

      const handOffButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Link phone child"),
      );

      await act(async () => {
        handOffButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);

      mocks.phoneSettingsProps[0]?.onAborted?.();
      expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      await cleanup();
    }
  });

  it("hands projection recovery to the phone sync boundary", async () => {
    mocks.useUser.mockReturnValue({
      user: {
        id: "privy-user-a",
        phone: {
          number: "+15550100002",
        },
      },
    });
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: {
          ...makeAccountSnapshot(),
          phone: {
            number: null,
            verifiedAt: null,
          },
        },
        expectedPrivyUserId: "privy-user-a",
        initialMode: "phone",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      expect(mocks.phoneSettingsProps).toHaveLength(1);
      expect(mocks.phoneSettingsProps[0]?.autoOpen).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it.each([
    ["phone server session mismatch", "phone", false, "privy-user-a"],
    ["email client user mismatch", "email", true, "privy-user-b"],
    ["Telegram server session mismatch", "telegram", false, "privy-user-a"],
  ] as const)("does not mount provider mutation children on %s", async (
    _case,
    initialMode,
    privySessionMatchesAppSession,
    clientUserId,
  ) => {
    mocks.useUser.mockReturnValue({
      user: {
        id: clientUserId,
      },
    });
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: {
          ...makeAccountSnapshot(),
          email: {
            address: "member@example.com",
            privyEmailLinked: false,
            verifiedAt: null,
          },
          telegram: {
            telegramUserId: null,
          },
        },
        expectedPrivyUserId: "privy-user-a",
        initialMode,
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession,
      }),
    );

    try {
      expect(container.textContent).toContain(
        "Your sign-in changed. Sign in again using a login method already linked to this Murph account before changing a linked account.",
      );
      expect(container.textContent).not.toContain("Link phone child");
      expect(container.textContent).not.toContain("Link email child");
      expect(container.textContent).not.toContain("Privy hand-off child");
      expect(container.textContent).not.toContain("Link telegram child");
      expect(mocks.telegramCardProps).toEqual([]);

      const signInAgainButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Sign in again"),
      );
      expect(signInAgainButton).toBeTruthy();

      await act(async () => {
        signInAgainButton?.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(mocks.privyLogout).toHaveBeenCalledTimes(1);
      expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
      expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
      expect(mocks.privyLogout.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.openAuthDialog.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    } finally {
      await cleanup();
    }
  });

  it.each([
    ["before Privy is ready", false, false, null],
    ["while an authenticated Privy user snapshot hydrates", true, true, null],
  ] as const)("shows a loading state %s without mounting mutation children", async (
    _case,
    authenticated,
    ready,
    user,
  ) => {
    mocks.usePrivy.mockReturnValue({
      authenticated,
      logout: mocks.privyLogout,
      ready,
    });
    mocks.useUser.mockReturnValue({ user });
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: makeAccountSnapshot(),
        expectedPrivyUserId: "privy-user-a",
        initialMode: "phone",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
      { requireButton: false },
    );

    try {
      expect(container.textContent).toContain("Preparing secure account linking");
      expect(container.textContent).not.toContain("Link phone child");
      expect(container.textContent).not.toContain("Sign in again");
    } finally {
      await cleanup();
    }
  });

  it("keeps the mismatch gate closed when the stale Privy session cannot sign out", async () => {
    mocks.useUser.mockReturnValue({
      user: {
        id: "privy-user-b",
      },
    });
    mocks.privyLogout.mockRejectedValueOnce(new Error("logout unavailable"));
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: makeAccountSnapshot(),
        expectedPrivyUserId: "privy-user-a",
        initialMode: "phone",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      const signInAgainButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Sign in again"),
      );

      await act(async () => {
        signInAgainButton?.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "Sign out did not finish. Try again.",
      );
      expect(mocks.openAuthDialog).not.toHaveBeenCalled();
      expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    } finally {
      await cleanup();
    }
  });

  it("skips the Murph dialog and hands off to Privy when the Privy user has no email", async () => {
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: {
          ...makeAccountSnapshot(),
          email: {
            address: "member@example.com",
            privyEmailLinked: false,
            verifiedAt: null,
          },
        },
        expectedPrivyUserId: "privy-user-a",
        initialMode: "email",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      expect(container.querySelector("[data-dialog-open]")).toBeNull();
      expect(container.textContent).toContain("Privy hand-off child");
      expect(container.textContent).not.toContain("Link email child");

      const handOffButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Privy hand-off child"),
      );

      await act(async () => {
        handOffButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("keeps the inline email dialog when the Privy user already has an email", async () => {
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: {
          ...makeAccountSnapshot(),
          email: {
            address: "member@example.com",
            privyEmailLinked: true,
            verifiedAt: "2026-05-02T00:00:00.000Z",
          },
        },
        expectedPrivyUserId: "privy-user-a",
        initialMode: "email",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      expect(container.querySelector('[data-dialog-open="true"]')).toBeTruthy();
      expect(container.textContent).toContain("Link email child");
      expect(container.textContent).not.toContain("Privy hand-off child");
    } finally {
      await cleanup();
    }
  });

  it("passes auto-link to the Telegram card when the account has no Telegram snapshot", async () => {
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: {
          ...makeAccountSnapshot(),
          telegram: {
            telegramUserId: null,
          },
        },
        expectedPrivyUserId: "privy-user-a",
        initialMode: "telegram",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      expect(mocks.telegramCardProps).toEqual([
        {
          autoLink: true,
          initialTelegramAccount: null,
          showHeading: false,
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("seeds the Telegram dialog card from the account snapshot username", async () => {
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: {
          ...makeAccountSnapshot(),
          telegram: {
            telegramUserId: "12345",
            username: "sample_user",
          },
        },
        expectedPrivyUserId: "privy-user-a",
        initialMode: "telegram",
        onOpenChange: mocks.onOpenChange,
        privySessionMatchesAppSession: true,
      }),
    );

    try {
      expect(mocks.telegramCardProps).toEqual([
        {
          autoLink: false,
          initialTelegramAccount: {
            telegramUserId: "12345",
            username: "sample_user",
          },
          showHeading: false,
        },
      ]);
    } finally {
      await cleanup();
    }
  });
});

function makeAccountSnapshot() {
  return {
    email: {
      address: "member@example.com",
      verifiedAt: "2026-05-02T00:00:00.000Z",
    },
    phone: {
      number: "+14045550123",
      verifiedAt: "2026-05-02T00:00:00.000Z",
    },
    telegram: {
      telegramUserId: "12345",
    },
  };
}
