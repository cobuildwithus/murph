import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  phoneAuthProps: [] as Array<{
    phoneFieldLabel?: string | null;
    phoneInputAutoFocus?: boolean;
  }>,
  refreshUser: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth(props: {
    phoneFieldLabel?: string | null;
    phoneInputAutoFocus?: boolean;
  }) {
    mocks.phoneAuthProps.push({
      phoneFieldLabel: props.phoneFieldLabel,
      phoneInputAutoFocus: props.phoneInputAutoFocus,
    });
    return createElement(
      "div",
      {
        "data-testid": "hosted-phone-auth",
      },
      "Phone link form",
    );
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

describe("HostedPhoneSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phoneAuthProps = [];
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
  });

  it("renders the member's routed Murph SMS link when available", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });

    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        initialPhoneNumber: "+14046257706",
        murphPhoneNumber: "+15550100001",
      }),
    );

    expect(markup).toContain("•••• 7706");
    expect(markup).toContain("Text Murph");
    expect(markup).not.toContain("Message +1 555 010 0001");
    expect(markup).toContain('href="sms:+15550100001"');
  });

  it("omits the Murph SMS link when no routed number is available", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });

    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        initialPhoneNumber: "+14046257706",
        murphPhoneNumber: null,
      }),
    );

    expect(markup).not.toContain("href=\"sms:");
  });

  it("keeps an unconnected phone number in a compact link row until the member opens it", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });

    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        initialPhoneNumber: null,
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Phone");
    expect(container.textContent).toContain("Not connected");
    expect(container.textContent).toContain("Link phone");
    expect(container.textContent).not.toContain(
      "Add a phone number if you want Murph to text you directly.",
    );
    expect(container.querySelector('[data-testid="hosted-phone-auth"]')).toBeNull();

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link phone"),
    );
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="hosted-phone-auth"]')).toBeTruthy();
  });

  it.each([
    [null, undefined],
    ["+14046257706", "New phone number"],
  ] as const)(
    "opens the dialog phone form directly without a duplicate account card for %s",
    async (initialPhoneNumber, phoneFieldLabel) => {
      mocks.useUser.mockReturnValue({
        refreshUser: mocks.refreshUser,
        user: null,
      });

      const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

      const { cleanup, container } = await renderClientComponent(
        createElement(HostedPhoneSettings, {
          authenticated: true,
          autoOpen: true,
          initialPhoneNumber,
        }),
        { requireButton: false },
      );
      cleanupRender = cleanup;

      expect(container.querySelector('[data-testid="hosted-phone-auth"]')).toBeTruthy();
      expect(container.textContent).not.toContain("Not connected");
      expect(container.textContent).not.toContain("Link phone");
      expect(container.textContent).not.toContain("•••• 7706");
      expect(mocks.phoneAuthProps.at(-1)).toEqual({
        phoneFieldLabel,
        phoneInputAutoFocus: true,
      });
    },
  );

  it("does not use Privy client user state as the displayed phone authority", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            latest_verified_at: 1771977600,
            phone_number: "+14046257706",
            type: "phone",
          },
        ],
      },
    });

    const { HostedPhoneSettings } = await import("@/src/components/settings/hosted-phone-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedPhoneSettings, {
        authenticated: true,
        initialPhoneNumber: null,
      }),
    );

    expect(markup).toContain("Not connected");
    expect(markup).not.toContain("•••• 7706");
  });
});
