import assert from "node:assert/strict";

import * as React from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

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
  Captcha() {
    return React.createElement("div", { "data-privy-captcha": "mounted" });
  },
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

  it("uses the Twilio-documented international region list for the real picker", async () => {
    const { HOSTED_PHONE_COUNTRY_OPTIONS } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-country-options"
    );

    assert.equal(HOSTED_PHONE_COUNTRY_OPTIONS.length, 217);
    assert.deepEqual(
      HOSTED_PHONE_COUNTRY_OPTIONS
        .filter((option) => ["US", "GB", "CN", "KR", "BR", "CI"].includes(option.code))
        .map((option) => option.code),
      ["BR", "CN", "CI", "KR", "GB", "US"],
    );
    assert.equal(
      HOSTED_PHONE_COUNTRY_OPTIONS.some((option) => option.code === "AX"),
      false,
    );
    assert.equal(
      HOSTED_PHONE_COUNTRY_OPTIONS.some((option) => option.code === "BQ"),
      false,
    );
  });

  it("renders the real closed country picker as a button with +1 by default", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
      }),
    );

    assert.match(markup, /data-slot="combobox-trigger"/);
    assert.match(markup, />\+1</);
    assert.match(markup, /placeholder="\(201\) 555-0123"/);
    assert.match(markup, /name="phone-number"/);
    assert.match(markup, /data-privy-captcha="mounted"/);
    assert.match(
      markup,
      /data-slot="input"[^>]*class="[^"]*\bh-11\b[^"]*\brounded-2xl\b[^"]*\bpx-4\b[^"]*\bpy-2\.5\b/,
    );
    assert.doesNotMatch(markup, /Defaulting to United States/);
  });

  it("seeds the initial country picker from the hosted phone country hint", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { HostedPhoneCountryCodeProvider } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-country-code-provider"
    );

    const markup = renderToStaticMarkup(
      React.createElement(
        HostedPhoneCountryCodeProvider,
        {
          countryCode: "GB",
        },
        React.createElement(HostedPhoneAuth, null),
      ),
    );

    assert.match(markup, />\+44</);
    assert.match(markup, /placeholder="07400 123456"/);
  });

  it("resets the selected phone country back to the geo-derived default after logout", async () => {
    vi.resetModules();

    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow(props: {
        onPhoneCountryChange: (code: string) => void;
        selectedPhoneCountry: { code: string };
      }) {
        return React.createElement(
          "div",
          {
            "data-selected-country": props.selectedPhoneCountry.code,
          },
          React.createElement(
            "button",
            {
              type: "button",
              "data-change-country": "true",
              onClick: () => props.onPhoneCountryChange("FR"),
            },
            "Change country",
          ),
        );
      },
      HostedPhoneAuthScaffold(props: {
        children: React.ReactNode;
        onUseDifferentNumber: () => void;
      }) {
        return React.createElement(
          "div",
          null,
          React.createElement(
            "button",
            {
              type: "button",
              "data-sign-out": "true",
              onClick: props.onUseDifferentNumber,
            },
            "Use a different number",
          ),
          props.children,
        );
      },
    }));
    vi.doMock("@/src/components/hosted-onboarding/hosted-privy-captcha", () => ({
      HostedPrivyCaptcha() {
        return React.createElement("div", { "data-privy-captcha": "mounted" });
      },
    }));

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { HostedPhoneCountryCodeProvider } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-country-code-provider"
    );

    const { cleanup, container } = await renderClientComponent(
      React.createElement(
        HostedPhoneCountryCodeProvider,
        {
          countryCode: "GB",
        },
        React.createElement(HostedPhoneAuth, null),
      ),
    );

    try {
      assert.equal(
        container.querySelector("[data-selected-country]")?.getAttribute("data-selected-country"),
        "GB",
      );

      const changeCountryButton = container.querySelector(
        "[data-change-country]",
      ) as HTMLButtonElement | null;
      const signOutButton = container.querySelector(
        "[data-sign-out]",
      ) as HTMLButtonElement | null;

      assert.ok(changeCountryButton);
      assert.ok(signOutButton);

      await act(async () => {
        changeCountryButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      assert.equal(
        container.querySelector("[data-selected-country]")?.getAttribute("data-selected-country"),
        "FR",
      );

      await act(async () => {
        signOutButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      assert.equal(
        container.querySelector("[data-selected-country]")?.getAttribute("data-selected-country"),
        "GB",
      );
      expect(mocks.logout).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-privy-captcha");
      vi.resetModules();
    }
  });

  it("can hide the passive consent notice for homepage layouts that render their own copy", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
        showPassiveConsentNotice: false,
      }),
    );

    assert.match(markup, /Text me a code/);
    assert.doesNotMatch(markup, /By signing up, you agree to our/);
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
    assert.doesNotMatch(markup, /data-privy-captcha="mounted"/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("renders the one-tap invite send-code shortcut without exposing the phone hint", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.match(markup, /Send code/);
    assert.match(markup, /text a 6-digit code to your phone\./);
    assert.match(markup, /Use a different number/);
    assert.match(markup, /data-privy-captcha="mounted"/);
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
    assert.match(markup, /class="[^"]*h-12[^"]*text-lg[^"]*"/);
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

    assert.match(markup, /Send code/);
    assert.match(markup, /Use a different number/);
    assert.match(markup, /By signing up, you agree to our/);
    assert.match(markup, /\/legal\/terms\.pdf/);
    assert.match(markup, /\/legal\/privacy\.pdf/);
    assert.match(markup, /underline-offset-4/);
    assert.match(markup, /class="[^"]*w-fit[^"]*"/);
    assert.equal(markup.match(/w-full/g)?.length ?? 0, 0);
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
    assert.match(markup, /class="[^"]*h-11[^"]*w-full[^"]*"/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("suppresses the phone-only restart banner while an alternate Privy method is active", async () => {
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      logout: mocks.logout,
      ready: true,
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: "telegram-user-1",
            telegramUserId: "telegram-user-1",
            type: "telegram",
            username: "murph_test",
          },
        ],
      },
    });

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const defaultMarkup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {}),
    );
    const suppressedMarkup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth, {
        suppressAuthenticatedSessionIssue: true,
      }),
    );

    assert.match(defaultMarkup, /This browser needs a fresh phone signup\./);
    assert.match(defaultMarkup, /Your current Privy session is missing a verified phone number\./);
    assert.doesNotMatch(suppressedMarkup, /This browser needs a fresh phone signup\./);
    assert.doesNotMatch(suppressedMarkup, /You already started signup\./);
    assert.match(suppressedMarkup, /Text me a code/);
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
    assert.ok((markup.match(/h-12/g)?.length ?? 0) >= 3);
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

  it("normalizes a non-US submitted number against the selected Twilio-supported country", async () => {
    const { resolveHostedPhoneSubmission } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

    assert.deepEqual(
      resolveHostedPhoneSubmission({
        countryDialCode: "+44",
        draftPhoneNumber: "07400 123456",
        submittedPhoneNumber: "07400 123456",
      }),
      {
        draftPhoneNumber: "07400 123456",
        normalizedPhoneNumber: "+447400123456",
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

  it("includes the auth intent in hosted Privy completion requests", async () => {
    const { buildHostedPrivyCompletionRequestPayload } = await import("@/src/components/hosted-onboarding/hosted-privy-auth-support");

    assert.deepEqual(
      buildHostedPrivyCompletionRequestPayload({
        intent: "signin",
      }),
      {
        intent: "signin",
      },
    );
    assert.deepEqual(
      buildHostedPrivyCompletionRequestPayload({
        intent: "signup",
        inviteCode: "invite-code",
      }),
      {
        intent: "signup",
        inviteCode: "invite-code",
      },
    );
  });

  it("sends checkout-stage homepage verification back to the invite join flow", async () => {
    vi.resetModules();

    const ensureHostedPrivyPhoneReady = vi.fn().mockResolvedValue(undefined);
    const requestHostedOnboardingJson = vi.fn()
      .mockResolvedValueOnce({
        activationPending: false,
        inviteCode: "invite-code",
        joinUrl: "/join/invite-code",
        messagingSetupRequired: false,
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
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 1);
    assert.equal(requestHostedOnboardingJson.mock.calls[0]?.[0]?.url, "/api/hosted-onboarding/privy/complete");
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      intent: "signup",
    });
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "/join/invite-code");
  });

  it("prefers a refreshed Privy user snapshot before checking SMS wallet readiness", async () => {
    vi.resetModules();

    const ensureHostedPrivyPhoneReady = vi.fn().mockResolvedValue(undefined);
    const requestHostedOnboardingJson = vi.fn()
      .mockResolvedValueOnce({
        activationPending: false,
        inviteCode: "invite-code",
        joinUrl: "/join/invite-code",
        stage: "active",
      });
    const refreshUser = vi.fn().mockResolvedValue({
      linkedAccounts: [{ type: "phone" }],
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
        refreshUser,
        user: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    assert.equal(refreshUser.mock.calls.length, 2);
    assert.equal(ensureHostedPrivyPhoneReady.mock.calls.length, 1);
    assert.equal(typeof ensureHostedPrivyPhoneReady.mock.calls[0]?.[0]?.createWallet, "function");
    assert.deepEqual(ensureHostedPrivyPhoneReady.mock.calls[0]?.[0]?.user, {
      linkedAccounts: [{ type: "phone" }],
    });
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 1);
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      intent: "signup",
    });
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "/settings");
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
        activationPending: false,
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
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 2);
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      intent: "signup",
    });
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload, {
      intent: "signup",
    });
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "/join/invite-code");
  });

  it("retries hosted completion once when the verified Telegram account has not reached the server-side session yet", async () => {
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
      .mockRejectedValueOnce(new TestHostedOnboardingApiError(
        "PRIVY_ACCOUNT_NOT_READY",
        "Your verified Privy account has not reached the server-side session yet.",
        true,
      ))
      .mockResolvedValueOnce({
        activationPending: false,
        inviteCode: "invite-code",
        joinUrl: "/join/invite-code",
        stage: "checkout",
      })
      .mockResolvedValueOnce({
        alreadyActive: false,
        url: "https://stripe.example.test/telegram-retry-checkout",
      });
    const assign = vi.fn();

    vi.doMock("@/src/lib/hosted-onboarding/privy-client", () => ({
      HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS: [0, 0],
      ensureHostedPrivyPhoneReady,
    }));
    vi.doMock("@/src/components/hosted-onboarding/client-api", () => ({
      HostedOnboardingApiError: TestHostedOnboardingApiError,
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
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      intent: "signup",
    });
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload, {
      intent: "signup",
    });
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "/join/invite-code");
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

    assert.equal(harness.controller.handleInviteSendCode.mock.calls.length, 1);
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

    assert.equal(harness.controller.handleInviteSendCode.mock.calls.length, 1);
    assert.equal(harness.controller.handleResendCode.mock.calls.length, 0);
  });

  it("falls back to manual entry when the invite shortcut phone is unavailable", async () => {
    const setManualEntryVisible = vi.fn();
    const harness = await loadHostedInvitePhoneAuthHarness({
      inviteSendResult: "manual-entry-required",
      ReactMock: async () => {
        const actual = await vi.importActual<typeof import("react")>("react");
        return {
          ...actual,
          useState(initialValue: boolean) {
            return [initialValue, setManualEntryVisible] as const;
          },
        };
      },
    });

    renderToStaticMarkup(
      React.createElement(harness.HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.equal(harness.shortcutProps.length, 1);
    await harness.shortcutProps[0].onSendCode();

    assert.deepEqual(harness.controller.handleInviteSendCode.mock.calls.length, 1);
    assert.deepEqual(setManualEntryVisible.mock.calls, [[true]]);
  });
});

async function loadHostedInvitePhoneAuthHarness(input?: {
  activeAttempt?: { maskedPhoneNumber: string; phoneNumber: string } | null;
  inviteSendResult?: "error" | "manual-entry-required" | "sent";
  ReactMock?: () => Promise<Record<string, unknown>>;
}) {
  vi.resetModules();

  if (input?.ReactMock) {
    vi.doMock("react", input.ReactMock);
  }

  const shortcutProps: Array<{ onSendCode: () => Promise<void>; onUseDifferentNumber: () => void }> = [];
  const flowProps: Array<{ onResendCode: () => Promise<void>; onUseDifferentNumber: () => void }> = [];
  const controller = createHostedInvitePhoneAuthControllerHarness(
    input?.activeAttempt ?? null,
    input?.inviteSendResult,
  );
  const flushPendingInvitePhoneCodeMutation = vi.fn().mockResolvedValue(undefined);

  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-controller", () => ({
    useHostedPhoneAuthController: () => controller,
  }));
  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-support", () => ({
    flushPendingInvitePhoneCodeMutation,
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
    controller,
    flowProps,
    flushPendingInvitePhoneCodeMutation,
    shortcutProps,
  };
}

function createHostedInvitePhoneAuthControllerHarness(
  activeAttempt: { maskedPhoneNumber: string; phoneNumber: string } | null,
  inviteSendResult: "error" | "manual-entry-required" | "sent" = "sent",
) {
  return {
    authenticatedLoadingBody: "loading body",
    authenticatedLoadingTitle: "loading title",
    authenticatedSessionDescription: "session description",
    authenticatedView: null,
    errorMessage: null,
    flowDisabled: false,
    handleContinueAuthenticated: vi.fn(),
    handleInviteSendCode: vi.fn().mockResolvedValue(inviteSendResult),
    handleLogout: vi.fn(),
    handleResendCode: vi.fn(),
    pendingAction: null,
    handleResetPhoneAuthFlow: vi.fn(),
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
