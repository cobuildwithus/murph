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

  it("renders the explicit manual-resume banner for authenticated invite sessions", async () => {
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

    assert.match(markup, /You already started signup in this browser/);
    assert.match(markup, /Continue signup/);
    assert.match(markup, /Use a different number/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("renders the one-tap invite send-code shortcut without exposing the phone hint", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
        inviteCode: "invite-code",
        mode: "invite",
        phoneHint: "*** 4567",
        privyAppId: "privy-app-id",
        privyClientId: "privy-client-id",
      }),
    );

    assert.match(markup, /Send me a code/);
    assert.match(markup, /We&#x27;ll text a verification code to the number that messaged Murph\./);
    assert.match(markup, /Use a different number/);
    assert.doesNotMatch(markup, /\*\*\* 4567/);
    assert.doesNotMatch(markup, /Phone number that received this invite/);
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

  it("keeps invite-mode authenticated sessions in the manual resume state instead of auto-loading", async () => {
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

    assert.match(markup, /You already started signup in this browser/);
    assert.match(markup, /Continue signup/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("clears the pending action after a failed manual continue finalization attempt", async () => {
    const { runHostedPrivyFinalizationAttempt } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    let finalizationState: "idle" | "running" | "completed" = "idle";
    const pendingActions: Array<string | null> = [];

    await assert.rejects(
      () => runHostedPrivyFinalizationAttempt({
        action: "continue",
        finalize: async () => {
          throw new Error("Privy lag");
        },
        getFinalizationState: () => finalizationState,
        setPendingAction(action) {
          pendingActions.push(action);
        },
        updateFinalizationState(nextState) {
          finalizationState = nextState;
        },
      }),
      /Privy lag/,
    );

    assert.equal(finalizationState, "idle");
    assert.deepEqual(pendingActions, ["continue", null]);
  });
});
