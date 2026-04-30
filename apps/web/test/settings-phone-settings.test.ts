import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  refreshUser: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth() {
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
        initialLinkedAccounts: [
          {
            latest_verified_at: 1771977600,
            phone_number: "+14046257706",
            type: "phone",
          },
        ],
        murphPhoneNumber: "+15550100001",
      }),
    );

    expect(markup).toContain("•••• 7706");
    expect(markup).toContain("Message Murph");
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
        initialLinkedAccounts: [
          {
            latest_verified_at: 1771977600,
            phone_number: "+14046257706",
            type: "phone",
          },
        ],
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
        initialLinkedAccounts: [],
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
});
