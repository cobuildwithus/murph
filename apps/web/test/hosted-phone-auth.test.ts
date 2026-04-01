import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWallet: vi.fn(),
  loginWithCode: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useCreateWallet() {
    return {
      createWallet: mocks.createWallet,
    };
  },
  useLoginWithSms() {
    return {
      loginWithCode: mocks.loginWithCode,
      sendCode: mocks.sendCode,
    };
  },
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({
  HostedPrivyProvider(input: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, input.children);
  },
}));

describe("HostedPhoneAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePrivy.mockReturnValue({
      authenticated: false,
      logout: mocks.logout,
      ready: true,
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });
  });

  it("renders the real closed country picker as a button with +1 by default", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
        mode: "public",
        privyAppId: "privy-app-id",
        privyClientId: "privy-client-id",
      }),
    );

    assert.match(markup, /data-slot="combobox-trigger"/);
    assert.match(markup, />\+1</);
    assert.match(markup, /placeholder="\((?:415|416)\) 555-(?:2671|0123)"/);
    assert.doesNotMatch(markup, /Defaulting to United States/);
  });

  it("removes the authenticated-session banner copy from the rendered markup", async () => {
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      logout: mocks.logout,
      ready: true,
    });
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
        mode: "invite",
        phoneHint: "+1 (415) 555-2671",
        privyAppId: "privy-app-id",
        privyClientId: "privy-client-id",
      }),
    );

    assert.doesNotMatch(markup, /Verified Privy session found/);
    assert.doesNotMatch(markup, /Finishing setup with your current verified phone number now/);
    assert.match(markup, /Preparing your account/);
    assert.doesNotMatch(markup, /Use a different number/);
  });

  it("keeps the public homepage in a manual resume state for authenticated sessions", async () => {
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      logout: mocks.logout,
      ready: true,
    });
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
        mode: "public",
        privyAppId: "privy-app-id",
        privyClientId: "privy-client-id",
      }),
    );

    assert.match(markup, /You already started signup in this browser/);
    assert.match(markup, /Continue signup/);
    assert.match(markup, /Use a different number/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("keeps invite-mode authenticated sessions in the loading state instead of rendering the manual resume banner", async () => {
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      logout: mocks.logout,
      ready: true,
    });
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
        mode: "invite",
        privyAppId: "privy-app-id",
        privyClientId: "privy-client-id",
      }),
    );

    assert.match(markup, /Preparing your account/);
    assert.doesNotMatch(markup, /You already started signup in this browser/);
    assert.doesNotMatch(markup, /Continue signup/);
  });
});
