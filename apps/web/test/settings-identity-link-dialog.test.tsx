import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const ORIGINAL_PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const ORIGINAL_PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

const mocks = vi.hoisted(() => ({
  onOpenChange: vi.fn(),
  refresh: vi.fn(),
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

vi.mock("@/src/components/settings/hosted-telegram-card-settings", () => ({
  HostedTelegramCardSettings(props: { onSynced?: (payload: { mode: string }) => void }) {
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
