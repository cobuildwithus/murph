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
      }),
    );

    assert.match(markup, /data-slot="combobox-trigger"/);
    assert.match(markup, />\+1</);
    assert.match(markup, /placeholder="\((?:415|416)\) 555-(?:2671|0123)"/);
    assert.doesNotMatch(markup, /Defaulting to United States/);
  });

  it("uses unique phone input ids for separate public auth instances", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(React.Fragment, null,
        React.createElement(HostedPhoneAuth, {
        }),
        React.createElement(HostedPhoneAuth, {
          intent: "signin",
        }),
      ),
    );

    const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    const phoneIds = ids.filter((id) => id.startsWith("_R"));

    assert.equal(phoneIds.length, 2);
    assert.notEqual(phoneIds[0], phoneIds[1]);
  });

  it("renders the explicit manual-resume banner for authenticated invite sessions", async () => {
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      logout: mocks.logout,
      ready: true,
    });
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.match(markup, /You already started signup\./);
    assert.match(markup, /Continue signup/);
    assert.match(markup, /Use a different number/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("renders the one-tap invite send-code shortcut without exposing the phone hint", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
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
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: {
          maskedPhoneNumber: "*** 2671",
          phoneNumber: "+14155552671",
        },
        code: "",
        disabled: false,
        intent: "signup",
        pendingAction: null,
        phoneFieldDescription: "Enter the number that messaged Murph.",
        phoneFieldLabel: "Phone number",
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "",
        sendCodeDisabled: false,
        secondaryActionSize: "sm",
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
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
    const { HostedInviteShortcutStep } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-step-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInviteShortcutStep, {
        disabled: false,
        pendingAction: null,
        onSendCode() {},
        onUseDifferentNumber() {},
      }),
    );

    assert.match(markup, /Send me a code/);
    assert.match(markup, /Use a different number/);
    assert.match(markup, /By signing up, you agree to our/);
    assert.match(markup, /\/legal\/terms\.pdf/);
    assert.match(markup, /\/legal\/privacy\.pdf/);
    assert.match(markup, /underline-offset-4/);
    assert.equal(markup.match(/w-full/g)?.length ?? 0, 2);
  });

  it("disables invite manual-entry send-code submit until the phone number is valid", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        intent: "signup",
        pendingAction: null,
        phoneFieldDescription: "Enter the number that messaged Murph.",
        phoneFieldLabel: "Phone number",
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "",
        sendCodeDisabled: true,
        secondaryActionSize: "sm",
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(markup, /Phone number/);
    assert.match(markup, /Text me a code/);
    assert.match(markup, /By signing up, you agree to our/);
    assert.match(markup, /disabled=""/);
  });

  it("enables invite manual-entry send-code submit once the phone number is valid", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        intent: "signup",
        pendingAction: null,
        phoneFieldDescription: "Enter the number that messaged Murph.",
        phoneFieldLabel: "Phone number",
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "4155552671",
        sendCodeDisabled: false,
        secondaryActionSize: "sm",
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(markup, /Phone number/);
    assert.match(markup, /Text me a code/);
    assert.match(markup, /By signing up, you agree to our/);
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
      }),
    );

    assert.match(markup, /You already started signup\./);
    assert.match(markup, /Continue signup/);
    assert.match(markup, /Use a different number/);
    assert.ok((markup.match(/h-14/g)?.length ?? 0) >= 2);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("uses tall secondary actions for the public homepage code step", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: {
          maskedPhoneNumber: "*** 2671",
          phoneNumber: "+14155552671",
        },
        code: "",
        disabled: false,
        intent: "signup",
        pendingAction: null,
        phoneFieldDescription: null,
        phoneFieldLabel: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "4155552671",
        sendCodeDisabled: false,
        secondaryActionSize: "lg",
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
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

  it("switches the public homepage copy into sign-in language", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const phoneEntryMarkup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        intent: "signin",
        pendingAction: null,
        phoneFieldDescription: null,
        phoneFieldLabel: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "4155552671",
        sendCodeDisabled: false,
        secondaryActionSize: "lg",
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    const codeEntryMarkup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: {
          maskedPhoneNumber: "*** 2671",
          phoneNumber: "+14155552671",
        },
        code: "",
        disabled: false,
        intent: "signin",
        pendingAction: null,
        phoneFieldDescription: null,
        phoneFieldLabel: null,
        phoneCountryOptions: [{ code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" }],
        phoneNumber: "4155552671",
        sendCodeDisabled: false,
        secondaryActionSize: "lg",
        selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
        onCodeChange() {},
        onPhoneCountryChange() {},
        onPhoneNumberChange() {},
        onResendCode() {},
        onSubmitPhoneEntry() {},
        onUseDifferentNumber() {},
        onVerifyCode() {},
      }),
    );

    assert.match(phoneEntryMarkup, /Phone number/);
    assert.doesNotMatch(phoneEntryMarkup, /Phone number on your account/);
    assert.match(phoneEntryMarkup, /Text me a code/);
    assert.doesNotMatch(phoneEntryMarkup, /Text me a sign-in code/);
    assert.match(codeEntryMarkup, /We texted the latest sign-in code to \*\*\* 2671\./);
    assert.match(codeEntryMarkup, />Sign in</);
  });

  it("builds the active verification attempt with a masked phone hint", async () => {
    const { createHostedPhoneVerificationAttempt } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

    assert.deepEqual(
      createHostedPhoneVerificationAttempt("+14155552671"),
      {
        maskedPhoneNumber: "*** 2671",
        phoneNumber: "+14155552671",
      },
    );
  });

  it("prefers the just-submitted phone input over a stale draft value", async () => {
    const { resolveHostedPhoneSubmission } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

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

  it("normalizes verification codes to six digits for auto-submit", async () => {
    const {
      isHostedPhoneVerificationCodeComplete,
      normalizeHostedPhoneVerificationCode,
    } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

    assert.equal(normalizeHostedPhoneVerificationCode("12 34-56 78"), "123456");
    assert.equal(isHostedPhoneVerificationCodeComplete("12345"), false);
    assert.equal(isHostedPhoneVerificationCodeComplete("123456"), true);
  });

  it("resends from the active attempt number when a verification attempt already exists", async () => {
    const { resolveHostedPhoneResendTarget } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

    assert.deepEqual(
      resolveHostedPhoneResendTarget({
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

  it("falls back to the draft-submit resend path when no active attempt exists", async () => {
    const { resolveHostedPhoneResendTarget } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

    assert.deepEqual(
      resolveHostedPhoneResendTarget({
        phoneVerificationAttempt: null,
      }),
      { kind: "draft-submit" },
    );
  });

  it("keeps invite authenticated sessions in the manual resume state instead of auto-loading", async () => {
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      logout: mocks.logout,
      ready: true,
    });
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.match(markup, /You already started signup\./);
    assert.match(markup, /Continue signup/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("clears the pending action after a failed manual continue finalization attempt", async () => {
    const { runHostedPrivyFinalizationAttempt } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

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
    const { finalizeInvitePhoneCodeSendConfirmation } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

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
    const { finalizeInvitePhoneCodeSendConfirmation } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

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
    const { finalizeInvitePhoneCodeSendConfirmation } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

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
    const { resolveHostedAuthenticatedPhoneAuthView } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-controller");

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

  it("sends active existing-account sign-ins straight to settings", async () => {
    const { resolveHostedPrivyCompletionRedirectUrl } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

    assert.equal(
      resolveHostedPrivyCompletionRedirectUrl({
        intent: "signin",
        payload: {
          inviteCode: "invite-code",
          joinUrl: "/join/invite-code",
          stage: "active",
        },
      }),
      "/settings",
    );
    assert.equal(
      resolveHostedPrivyCompletionRedirectUrl({
        intent: "signup",
        payload: {
          inviteCode: "invite-code",
          joinUrl: "/join/invite-code",
          stage: "active",
        },
      }),
      "/join/invite-code",
    );
    assert.equal(
      resolveHostedPrivyCompletionRedirectUrl({
        intent: "signup",
        payload: {
          inviteCode: "invite-code",
          joinUrl: "https://www.withmurph.ai/join/invite-code",
          stage: "checkout",
        },
      }),
      "/join/invite-code",
    );
  });

  it("sends checkout-stage homepage verification straight to Stripe checkout", async () => {
    vi.resetModules();

    const ensureHostedPrivyPhoneReady = vi.fn().mockResolvedValue(undefined);
    const requestHostedOnboardingJson = vi.fn()
      .mockResolvedValueOnce({
        inviteCode: "invite-code",
        joinUrl: "/join/invite-code",
        stage: "checkout",
      })
      .mockResolvedValueOnce({
        alreadyActive: false,
        url: "https://stripe.example.test/checkout",
      });
    const assign = vi.fn();

    vi.doMock("@/src/lib/hosted-onboarding/privy-client", () => ({
      HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS: [0],
      ensureHostedPrivyPhoneReady,
    }));
    vi.doMock("@/src/components/hosted-onboarding/client-api", () => ({
      HostedOnboardingApiError: class HostedOnboardingApiError extends Error {
        code: string | null = null;
        retryable = false;
      },
      requestHostedBillingCheckout(input: { inviteCode: string }) {
        return requestHostedOnboardingJson({
          payload: input,
          url: "/api/hosted-onboarding/billing/checkout",
        });
      },
      requestHostedOnboardingJson,
    }));
    vi.stubGlobal("window", {
      location: {
        assign,
      },
    });

    try {
      const { finalizeHostedPrivyVerification } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

      await finalizeHostedPrivyVerification({
        createWallet: vi.fn(),
        intent: "signup",
        user: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    assert.equal(ensureHostedPrivyPhoneReady.mock.calls.length, 1);
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 2);
    assert.equal(requestHostedOnboardingJson.mock.calls[0]?.[0]?.url, "/api/hosted-onboarding/privy/complete");
    assert.equal(requestHostedOnboardingJson.mock.calls[1]?.[0]?.url, "/api/hosted-onboarding/billing/checkout");
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload, {
      inviteCode: "invite-code",
    });
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "https://stripe.example.test/checkout");
  });

  it("retries hosted completion once when the Privy cookie has not propagated yet", async () => {
    vi.resetModules();

    const ensureHostedPrivyPhoneReady = vi.fn().mockResolvedValue(undefined);
    class TestHostedOnboardingApiError extends Error {
      code: string | null;
      retryable: boolean;

      constructor(code: string | null, message: string, retryable = false) {
        super(message);
        this.code = code;
        this.retryable = retryable;
      }
    }
    const requestHostedOnboardingJson = vi.fn()
      .mockRejectedValueOnce(new TestHostedOnboardingApiError("AUTH_REQUIRED", "Verify your phone to continue."))
      .mockResolvedValueOnce({
        inviteCode: "invite-code",
        joinUrl: "/join/invite-code",
        stage: "checkout",
      })
      .mockResolvedValueOnce({
        alreadyActive: false,
        url: "https://stripe.example.test/retry-checkout",
      });
    const assign = vi.fn();

    vi.doMock("@/src/lib/hosted-onboarding/privy-client", () => ({
      HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS: [0, 0],
      ensureHostedPrivyPhoneReady,
    }));
    vi.doMock("@/src/components/hosted-onboarding/client-api", () => ({
      HostedOnboardingApiError: TestHostedOnboardingApiError,
      requestHostedBillingCheckout(input: { inviteCode: string }) {
        return requestHostedOnboardingJson({
          payload: input,
          url: "/api/hosted-onboarding/billing/checkout",
        });
      },
      requestHostedOnboardingJson,
    }));
    vi.stubGlobal("window", {
      location: {
        assign,
      },
    });

    try {
      const { finalizeHostedPrivyVerification } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

      await finalizeHostedPrivyVerification({
        createWallet: vi.fn(),
        intent: "signup",
        user: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    assert.equal(ensureHostedPrivyPhoneReady.mock.calls.length, 1);
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 3);
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "https://stripe.example.test/retry-checkout");
  });

  it("uses the invite shortcut route for the first invite send-code request", async () => {
    const harness = await loadHostedInvitePhoneAuthHarness();

    renderToStaticMarkup(
      React.createElement(harness.HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.equal(harness.shortcutProps.length, 1);
    await harness.shortcutProps[0].onSendCode();

    assert.equal(harness.requestHostedOnboardingJson.mock.calls.length, 1);
    assert.match(String(harness.requestHostedOnboardingJson.mock.calls[0]?.[0]?.url), /\/invites\/invite-code\/send-code$/);
    assert.equal(harness.controller.sendVerificationCode.mock.calls[0]?.[0], "+14044092523");
    assert.equal(harness.finalizeInvitePhoneCodeSendConfirmation.mock.calls[0]?.[0]?.sendAttemptId, "attempt-id");
    assert.equal(harness.controller.handleResendCode.mock.calls.length, 0);
  });

  it("keeps resend on the invite shortcut path while the invite code step is active", async () => {
    const harness = await loadHostedInvitePhoneAuthHarness({
      activeAttempt: {
        maskedPhoneNumber: "*** 2523",
        phoneNumber: "+14044092523",
      },
    });

    renderToStaticMarkup(
      React.createElement(harness.HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.equal(harness.flowProps.length, 1);
    await harness.flowProps[0].onResendCode();

    assert.equal(harness.requestHostedOnboardingJson.mock.calls.length, 1);
    assert.match(String(harness.requestHostedOnboardingJson.mock.calls[0]?.[0]?.url), /\/invites\/invite-code\/send-code$/);
    assert.equal(harness.controller.sendVerificationCode.mock.calls[0]?.[0], "+14044092523");
    assert.equal(harness.controller.handleResendCode.mock.calls.length, 0);
  });

  it("falls back to manual entry when the invite shortcut phone is unavailable", async () => {
    const setManualEntryVisible = vi.fn();
    const harness = await loadHostedInvitePhoneAuthHarness({
      ReactMock: async () => {
        const actual = await vi.importActual<typeof import("react")>("react");
        return {
          ...actual,
          useState(initialValue: boolean) {
            return [initialValue, setManualEntryVisible] as const;
          },
        };
      },
      requestErrorFactory: (HostedOnboardingApiError) =>
        new HostedOnboardingApiError({
          code: "SIGNUP_PHONE_UNAVAILABLE",
          message: "Enter the number that messaged Murph to continue.",
        }),
    });

    renderToStaticMarkup(
      React.createElement(harness.HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.equal(harness.shortcutProps.length, 1);
    await harness.shortcutProps[0].onSendCode();

    assert.deepEqual(harness.controller.resetPhoneAuthFlow.mock.calls.length, 1);
    assert.deepEqual(setManualEntryVisible.mock.calls, [[true]]);
    assert.equal(
      harness.controller.setErrorMessage.mock.calls.at(-1)?.[0],
      "Enter the number that messaged Murph to continue.",
    );
  });
});

async function loadHostedInvitePhoneAuthHarness(input?: {
  activeAttempt?: { maskedPhoneNumber: string; phoneNumber: string } | null;
  ReactMock?: () => Promise<Record<string, unknown>>;
  requestErrorFactory?: (HostedOnboardingApiError: new (input: { code?: string | null; message: string }) => Error) => Error;
}) {
  vi.resetModules();

  if (input?.ReactMock) {
    vi.doMock("react", input.ReactMock);
  }

  const shortcutProps: Array<{ onSendCode: () => Promise<void>; onUseDifferentNumber: () => void }> = [];
  const flowProps: Array<{ onResendCode: () => Promise<void>; onUseDifferentNumber: () => void }> = [];
  const controller = createHostedInvitePhoneAuthControllerHarness(input?.activeAttempt ?? null);

  class HostedOnboardingApiError extends Error {
    readonly code: string | null;

    constructor(input: { code?: string | null; message: string }) {
      super(input.message);
      this.name = "HostedOnboardingApiError";
      this.code = input.code ?? null;
    }
  }

  const requestHostedOnboardingJson = vi.fn();
  if (input?.requestErrorFactory) {
    requestHostedOnboardingJson.mockRejectedValue(input.requestErrorFactory(HostedOnboardingApiError));
  } else {
    requestHostedOnboardingJson.mockResolvedValue({
      phoneNumber: "+14044092523",
      sendAttemptId: "attempt-id",
    });
  }

  const abortInvitePhoneCodeSend = vi.fn().mockResolvedValue(true);
  const finalizeInvitePhoneCodeSendConfirmation = vi.fn().mockResolvedValue(undefined);
  const flushPendingInvitePhoneCodeMutation = vi.fn().mockResolvedValue(undefined);
  const queuePendingInvitePhoneCodeMutation = vi.fn();

  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-controller", () => ({
    useHostedPhoneAuthController: () => controller,
  }));
  vi.doMock("@/src/components/hosted-onboarding/client-api", () => ({
    HostedOnboardingApiError,
    requestHostedOnboardingJson,
  }));
  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-support", () => ({
    abortInvitePhoneCodeSend,
    finalizeInvitePhoneCodeSendConfirmation,
    flushPendingInvitePhoneCodeMutation,
    queuePendingInvitePhoneCodeMutation,
    toErrorMessage(error: unknown, fallback: string) {
      return error instanceof Error && error.message ? error.message : fallback;
    },
  }));
  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-step-views", () => ({
    HostedInviteShortcutStep(props: { onSendCode: () => Promise<void>; onUseDifferentNumber: () => void }) {
      shortcutProps.push(props);
      return React.createElement("div", { "data-shortcut-step": "true" });
    },
  }));
  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
    HostedPhoneAuthFlow(props: { onResendCode: () => Promise<void>; onUseDifferentNumber: () => void }) {
      flowProps.push(props);
      return React.createElement("div", { "data-phone-auth-flow": "true" });
    },
    HostedPhoneAuthScaffold({ children }: { children: React.ReactNode }) {
      return React.createElement(React.Fragment, null, children);
    },
  }));

  const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

  return {
    HostedInvitePhoneAuth,
    abortInvitePhoneCodeSend,
    controller,
    finalizeInvitePhoneCodeSendConfirmation,
    flowProps,
    flushPendingInvitePhoneCodeMutation,
    queuePendingInvitePhoneCodeMutation,
    requestHostedOnboardingJson,
    shortcutProps,
  };
}

function createHostedInvitePhoneAuthControllerHarness(
  activeAttempt: { maskedPhoneNumber: string; phoneNumber: string } | null,
) {
  return {
    authenticatedLoadingBody: "loading body",
    authenticatedLoadingTitle: "loading title",
    authenticatedSessionDescription: "session description",
    authenticatedView: null,
    errorMessage: null,
    flowDisabled: false,
    handleContinueAuthenticated: vi.fn(),
    handleLogout: vi.fn(),
    handleResendCode: vi.fn(),
    pendingAction: null,
    resetPhoneAuthFlow: vi.fn(),
    sendVerificationCode: vi.fn().mockResolvedValue(undefined),
    setErrorMessage: vi.fn(),
    setPendingAction: vi.fn(),
    sharedFlowProps: {
      activeAttempt,
      code: "",
      disabled: false,
      intent: "signup" as const,
      onCodeChange: vi.fn(),
      onPhoneCountryChange: vi.fn(),
      onPhoneNumberChange: vi.fn(),
      onResendCode: vi.fn(),
      onSubmitPhoneEntry: vi.fn(),
      onUseDifferentNumber: vi.fn(),
      onVerifyCode: vi.fn(),
      pendingAction: null,
      phoneCountryOptions: [],
      phoneFieldDescription: null,
      phoneFieldLabel: null,
      phoneNumber: "",
      secondaryActionSize: "lg" as const,
      selectedPhoneCountry: { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
      sendCodeDisabled: false,
    },
  };
}
