import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const ORIGINAL_PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const ORIGINAL_PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

const mocks = vi.hoisted(() => ({
  onOpenChange: vi.fn(),
  openAuthDialog: vi.fn(),
  privyUserId: "privy-user-expected",
  refresh: vi.fn(),
  telegramCardProps: [] as Array<{
    autoLink?: boolean;
    initialTelegramAccount?: { telegramUserId: string; username: string | null } | null;
    showHeading?: boolean;
  }>,
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    authenticated: true,
    ready: true,
  }),
  useUser: () => ({
    user: mocks.privyUserId ? { id: mocks.privyUserId } : null,
  }),
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
  HostedPrivyProvider(props: { children: ReactNode }) {
    return createElement("div", null, props.children);
  },
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
  HostedPhoneSettings(props: { onLinked?: (payload: { mode: string }) => void }) {
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
  mocks.telegramCardProps = [];
  mocks.privyUserId = "privy-user-expected";
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app_test";
  process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID = "client_test";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = ORIGINAL_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID = ORIGINAL_PRIVY_CLIENT_ID;
});

describe("HostedSettingsIdentityLinkDialog", () => {
  it.each([
    ["phone", "Link phone child"],
    ["email", "Link email child"],
    ["telegram", "Link telegram child"],
  ] as const)("closes and refreshes after %s sync succeeds", async (initialMode, buttonLabel) => {
    const { HostedSettingsIdentityLinkDialog } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedSettingsIdentityLinkDialog, {
        account: makeAccountSnapshot(),
        expectedPrivyUserId: "privy-user-expected",
        initialMode,
        onOpenChange: mocks.onOpenChange,
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
        expectedPrivyUserId: "privy-user-expected",
        initialMode: "email",
        onOpenChange: mocks.onOpenChange,
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
        expectedPrivyUserId: "privy-user-expected",
        initialMode: "email",
        onOpenChange: mocks.onOpenChange,
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
        expectedPrivyUserId: "privy-user-expected",
        initialMode: "telegram",
        onOpenChange: mocks.onOpenChange,
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
        expectedPrivyUserId: "privy-user-expected",
        initialMode: "telegram",
        onOpenChange: mocks.onOpenChange,
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

  it.each(["phone", "email", "telegram"] as const)(
    "blocks %s provider mutation when the Privy principal does not match the app session",
    async (initialMode) => {
      mocks.privyUserId = "privy-user-other";
      const { HostedSettingsIdentityLinkDialog } = await import(
        "@/src/components/settings/hosted-settings-identity-link-dialog"
      );

      const { cleanup, container } = await renderClientComponent(
        createElement(HostedSettingsIdentityLinkDialog, {
          account: initialMode === "email"
            ? {
                ...makeAccountSnapshot(),
                email: {
                  address: "member@example.com",
                  privyEmailLinked: false,
                  verifiedAt: null,
                },
              }
            : makeAccountSnapshot(),
          expectedPrivyUserId: "privy-user-expected",
          initialMode,
          onOpenChange: mocks.onOpenChange,
        }),
      );

      try {
        expect(container.textContent).toContain("Sign in again before changing secure account settings.");
        expect(container.textContent).not.toContain("Link phone child");
        expect(container.textContent).not.toContain("Link email child");
        expect(container.textContent).not.toContain("Link telegram child");
        expect(container.textContent).not.toContain("Privy hand-off child");

        const signInButton = Array.from(container.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.includes("Sign in again"),
        );
        await act(async () => {
          signInButton?.dispatchEvent(new Event("click", { bubbles: true }));
        });

        expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
        expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
      } finally {
        await cleanup();
      }
    },
  );

  it("does not mount provider-mutating settings when the Privy principal is different", async () => {
    mocks.privyUserId = "privy-user-other";
    const providerMutationSurfaceMounted = vi.fn();
    function ProviderMutationSurfaceProbe() {
      providerMutationSurfaceMounted();
      return createElement("div", null, "Provider mutation surface");
    }
    const { HostedSettingsIdentityMutationGate } = await import(
      "@/src/components/settings/hosted-settings-identity-link-dialog"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(
        HostedSettingsIdentityMutationGate,
        { expectedPrivyUserId: "privy-user-expected" },
        createElement(ProviderMutationSurfaceProbe),
      ),
    );

    try {
      expect(container.textContent).toContain("Sign in again before changing secure account settings.");
      expect(container.textContent).not.toContain("Provider mutation surface");
      expect(providerMutationSurfaceMounted).not.toHaveBeenCalled();
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
