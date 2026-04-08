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
    assert.match(markup, /We&#x27;ll text a verification code to your phone\./);
    assert.match(markup, /Use a different number/);
    assert.doesNotMatch(markup, /Phone number/);
    assert.doesNotMatch(markup, /Text me a code/);
    assert.doesNotMatch(markup, /\*\*\* 4567/);
    assert.doesNotMatch(markup, /Phone number that received this invite/);
  });

  it("autofocuses and enlarges the verification code input", async () => {
    const { HostedInvitePhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuthFlow, {
        activeAttempt: {
          maskedPhoneNumber: "*** 2671",
          phoneNumber: "+14155552671",
        },
        code: "",
        disabled: false,
        manualEntryVisible: false,
        mode: "invite",
        pendingAction: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "",
        sendCodeDisabled: false,
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(markup, /autofocus=""/);
    assert.match(markup, /class="[^"]*h-14[^"]*text-lg[^"]*"/);
    assert.match(markup, /We texted the latest code to \*\*\* 2671\./);
  });

  it("renders invite shortcut actions full width", async () => {
    const { HostedInvitePhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        manualEntryVisible: false,
        mode: "invite",
        pendingAction: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "",
        sendCodeDisabled: false,
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(markup, /Send me a code/);
    assert.match(markup, /Use a different number/);
    assert.match(markup, /underline-offset-4/);
    assert.equal(markup.match(/w-full/g)?.length ?? 0, 2);
  });

  it("disables invite manual-entry send-code submit until the phone number is valid", async () => {
    const { HostedInvitePhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        manualEntryVisible: true,
        mode: "invite",
        pendingAction: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "",
        sendCodeDisabled: true,
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(markup, /Phone number/);
    assert.match(markup, /Text me a code/);
    assert.match(markup, /disabled=""/);
  });

  it("enables invite manual-entry send-code submit once the phone number is valid", async () => {
    const { HostedInvitePhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        manualEntryVisible: true,
        mode: "invite",
        pendingAction: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "4155552671",
        sendCodeDisabled: false,
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(markup, /Phone number/);
    assert.match(markup, /Text me a code/);
    assert.doesNotMatch(markup, /disabled=""/);
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
    assert.ok((markup.match(/h-14/g)?.length ?? 0) >= 2);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("uses tall secondary actions for the public homepage code step", async () => {
    const { HostedPublicPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPublicPhoneAuthFlow, {
        activeAttempt: {
          maskedPhoneNumber: "*** 2671",
          phoneNumber: "+14155552671",
        },
        code: "",
        disabled: false,
        mode: "public",
        pendingAction: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "4155552671",
        sendCodeDisabled: false,
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(markup, /Verify phone/);
    assert.match(markup, /Use a different number/);
    assert.ok((markup.match(/h-14/g)?.length ?? 0) >= 3);
    assert.match(markup, /We texted the latest code to \*\*\* 2671\./);
  });

  it("builds the active verification attempt with a masked phone hint", async () => {
    const { createHostedPhoneVerificationAttempt } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    assert.deepEqual(
      createHostedPhoneVerificationAttempt("+14155552671"),
      {
        maskedPhoneNumber: "*** 2671",
        phoneNumber: "+14155552671",
      },
    );
  });

  it("prefers the just-submitted phone input over a stale draft value", async () => {
    const { resolveHostedPhoneSubmission } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    assert.deepEqual(
      resolveHostedPhoneSubmission({
        countryDialCode: "+1",
        draftPhoneNumber: "404409252",
        submittedPhoneNumber: "+1 (404) 409-2523",
      }),
      {
        draftPhoneNumber: "+1 (404) 409-2523",
        normalizedPhoneNumber: "+14044092523",
      },
    );
  });

  it("keeps invite shortcut resend on the server-backed invite path even after an active attempt exists", async () => {
    const { resolveHostedPhoneResendTarget } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    assert.deepEqual(
      resolveHostedPhoneResendTarget({
        inviteCode: "invite-code",
        manualEntryVisible: false,
        mode: "invite",
        phoneVerificationAttempt: {
          maskedPhoneNumber: "*** 2523",
          phoneNumber: "+14044092523",
        },
      }),
      { kind: "invite-shortcut" },
    );
  });

  it("resends from the active attempt number during manual entry flows", async () => {
    const { resolveHostedPhoneResendTarget } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    assert.deepEqual(
      resolveHostedPhoneResendTarget({
        inviteCode: "invite-code",
        manualEntryVisible: true,
        mode: "invite",
        phoneVerificationAttempt: {
          maskedPhoneNumber: "*** 2523",
          phoneNumber: "+14044092523",
        },
      }),
      {
        kind: "active-attempt",
        phoneNumber: "+14044092523",
      },
    );
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

  it("writes a queued confirm mutation when invite confirmation does not finish inline", async () => {
    const { finalizeInvitePhoneCodeSendConfirmation } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const queued: Array<{ inviteCode: string; kind: "abort" | "confirm"; sendAttemptId: string }> = [];

    await finalizeInvitePhoneCodeSendConfirmation({
      async confirm() {
        return false;
      },
      inviteCode: "invite-code",
      sendAttemptId: "attempt-id",
      writePending(input) {
        queued.push(input);
      },
    });

    assert.deepEqual(queued, [
      {
        inviteCode: "invite-code",
        kind: "confirm",
        sendAttemptId: "attempt-id",
      },
    ]);
  });

  it("skips queueing when invite confirmation finishes inline", async () => {
    const { finalizeInvitePhoneCodeSendConfirmation } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const queued: Array<{ inviteCode: string; kind: "abort" | "confirm"; sendAttemptId: string }> = [];

    await finalizeInvitePhoneCodeSendConfirmation({
      async confirm() {
        return true;
      },
      inviteCode: "invite-code",
      sendAttemptId: "attempt-id",
      writePending(input) {
        queued.push(input);
      },
    });

    assert.deepEqual(queued, []);
  });

  it("queues invite confirmation when the background confirm throws", async () => {
    const { finalizeInvitePhoneCodeSendConfirmation } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const queued: Array<{ inviteCode: string; kind: "abort" | "confirm"; sendAttemptId: string }> = [];

    await finalizeInvitePhoneCodeSendConfirmation({
      async confirm() {
        throw new Error("network");
      },
      inviteCode: "invite-code",
      sendAttemptId: "attempt-id",
      writePending(input) {
        queued.push(input);
      },
    });

    assert.deepEqual(queued, [
      {
        inviteCode: "invite-code",
        kind: "confirm",
        sendAttemptId: "attempt-id",
      },
    ]);
  });

  it("resolves authenticated phone auth recovery states in priority order", async () => {
    const { resolveHostedAuthenticatedPhoneAuthView } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    assert.equal(
      resolveHostedAuthenticatedPhoneAuthView({
        showAuthenticatedLoadingState: false,
        showAuthenticatedManualResumeState: false,
        showAuthenticatedRestartState: false,
      }),
      null,
    );
    assert.equal(
      resolveHostedAuthenticatedPhoneAuthView({
        showAuthenticatedLoadingState: false,
        showAuthenticatedManualResumeState: true,
        showAuthenticatedRestartState: false,
      }),
      "manual-resume",
    );
    assert.equal(
      resolveHostedAuthenticatedPhoneAuthView({
        showAuthenticatedLoadingState: true,
        showAuthenticatedManualResumeState: true,
        showAuthenticatedRestartState: true,
      }),
      "loading",
    );
  });
});
