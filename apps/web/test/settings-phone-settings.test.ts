import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshUser: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useUser: mocks.useUser,
}));

describe("HostedPhoneSettings", () => {
  it("renders the member's routed Murph SMS number when available", async () => {
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
    expect(markup).toContain("Message +1 555 010 0001");
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
});
