import assert from "node:assert/strict";

import * as React from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type SmsLoginCallbacks = {
  onComplete?: (params: { user: { linkedAccounts?: unknown } }) => void;
};

const mocks = vi.hoisted(() => ({
  createWallet: vi.fn(),
  loginCallbacks: null as SmsLoginCallbacks | null,
  loginWithCode: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

type TestLinkedAccount = Record<string, unknown> & { type?: unknown };

function readHostedPrivyClientSessionStateForTest(input: {
  user: { linkedAccounts?: unknown } | null;
}) {
  const linkedAccounts = Array.isArray(input.user?.linkedAccounts)
    ? input.user.linkedAccounts.filter(isTestLinkedAccount)
    : [];

  return {
    linkedAccounts,
    phone: linkedAccounts.some((account) => account.type === "phone")
      ? {
          number: "+15555551212",
          verifiedAt: 1771977600,
        }
      : null,
    wallet: null,
  };
}

function isTestLinkedAccount(value: unknown): value is TestLinkedAccount {
  return typeof value === "object" && value !== null;
}

vi.mock("@privy-io/react-auth", () => ({
  Captcha() {
    return React.createElement("div", { "data-privy-captcha": "mounted" });
  },
  useCreateWallet() {
    return {
      createWallet: mocks.createWallet,
    };
  },
  useLoginWithSms(callbacks?: SmsLoginCallbacks) {
    mocks.loginCallbacks = callbacks ?? null;

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
    mocks.loginCallbacks = null;
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
      /data-slot="input"[^>]*class="[^"]*\bh-14\b[^"]*\brounded-2xl\b[^"]*\bpx-5\b[^"]*\bpy-3\.5\b/,
    );
    assert.doesNotMatch(markup, /Defaulting to United States/);
  });

  it("seeds the initial country picker from the hosted phone country hint", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { PhoneCountryCodeClientProvider } = await import(
      "@/src/components/hosted-onboarding/phone-country-code-client-provider"
    );

    const markup = renderToStaticMarkup(
      React.createElement(
        PhoneCountryCodeClientProvider,
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
    const { PhoneCountryCodeClientProvider } = await import(
      "@/src/components/hosted-onboarding/phone-country-code-client-provider"
    );

    const { cleanup, container } = await renderClientComponent(
      React.createElement(
        PhoneCountryCodeClientProvider,
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

  it("does not render passive legal consent copy inside the phone auth form", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuth),
    );

    assert.match(markup, /Send verification code/);
    assert.doesNotMatch(markup, /By continuing, you agree to our/);
  });

  it("uses unique phone input ids for separate public auth instances", async () => {
    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(React.Fragment, null,
        React.createElement(HostedPhoneAuth, {
        }),
        React.createElement(HostedPhoneAuth, {
          intent: "auth",
        }),
      ),
    );

    const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    const phoneIds = ids.filter((id) => id.startsWith("_R"));

    assert.equal(phoneIds.length, 2);
    assert.notEqual(phoneIds[0], phoneIds[1]);
  });

  it("passes no-signup mode to Privy when requesting a public login SMS code", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow(props: {
        activeAttempt: { maskedPhoneNumber: string; phoneNumber: string } | null;
        code: string;
        onCodeChange: (value: string) => void;
        onPhoneNumberChange: (value: string) => void;
        onVerifyCode: () => void;
        phoneNumber: string;
        sendCodeDisabled: boolean;
        onSubmitPhoneEntry: (event?: React.FormEvent<HTMLFormElement>) => void;
      }) {
        return React.createElement(
          "div",
          {
            "data-active-attempt": props.activeAttempt?.maskedPhoneNumber ?? "",
            "data-phone-number": props.phoneNumber,
            "data-send-disabled": props.sendCodeDisabled ? "yes" : "no",
          },
          React.createElement(
            "button",
            {
              type: "button",
              "data-set-phone": "true",
              onClick: () => props.onPhoneNumberChange("4155552671"),
            },
            "Set phone",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-send-code": "true",
              disabled: props.sendCodeDisabled,
              onClick: () => props.onSubmitPhoneEntry(),
            },
            "Send verification code",
          ),
          props.activeAttempt
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement(
                  "button",
                  {
                    type: "button",
                    "data-enter-code": "true",
                    onClick: () => props.onCodeChange("123456"),
                  },
                  "Enter code",
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    "data-verify-code": "true",
                    onClick: props.onVerifyCode,
                  },
                  "Verify phone",
                ),
              )
            : null,
        );
      },
      HostedPhoneAuthScaffold({
        children,
        errorMessage,
      }: {
        children: React.ReactNode;
        errorMessage: string | null;
      }) {
        return React.createElement(
          React.Fragment,
          null,
          errorMessage ? React.createElement("p", null, errorMessage) : null,
          children,
        );
      },
    }));
    vi.doMock("@/src/components/hosted-onboarding/hosted-privy-captcha", () => ({
      HostedPrivyCaptcha() {
        return React.createElement("div", { "data-privy-captcha": "mounted" });
      },
    }));
    mocks.sendCode.mockRejectedValueOnce(new Error("No account for this phone"));

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedPhoneAuth, {
        disableSignup: true,
      }),
    );

    try {
      const setPhoneButton = container.querySelector(
        "[data-set-phone]",
      ) as HTMLButtonElement | null;
      const sendCodeButton = container.querySelector(
        "[data-send-code]",
      ) as HTMLButtonElement | null;
      assert.ok(setPhoneButton);
      assert.ok(sendCodeButton);

      await act(async () => {
        setPhoneButton.dispatchEvent(new Event("click", { bubbles: true }));
      });
      assert.equal(
        container.querySelector("[data-phone-number]")?.getAttribute("data-phone-number"),
        "4155552671",
      );
      assert.equal(
        container.querySelector("[data-phone-number]")?.getAttribute("data-send-disabled"),
        "no",
      );

      await act(async () => {
        sendCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(mocks.sendCode).toHaveBeenCalledWith({
        phoneNumber: "+14155552671",
        disableSignup: true,
      });
      assert.equal(
        container.querySelector("[data-active-attempt]")?.getAttribute("data-active-attempt"),
        "*** 2671",
      );
      assert.doesNotMatch(
        container.textContent ?? "",
        /No account for this phone/,
      );

      mocks.loginWithCode.mockRejectedValueOnce(new Error("No account for this phone"));
      const enterCodeButton = container.querySelector(
        "[data-enter-code]",
      ) as HTMLButtonElement | null;
      const verifyCodeButton = container.querySelector(
        "[data-verify-code]",
      ) as HTMLButtonElement | null;
      assert.ok(enterCodeButton);
      assert.ok(verifyCodeButton);

      await act(async () => {
        enterCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
      });

      await act(async () => {
        verifyCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(mocks.loginWithCode).toHaveBeenCalledWith({
        code: "123456",
      });
      assert.match(container.textContent ?? "", /We could not verify that code\./);
      assert.doesNotMatch(
        container.textContent ?? "",
        /No account for this phone/,
      );
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-privy-captcha");
      vi.resetModules();
    }
  });

  it("queues manual phone verification sends until Privy initializes", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow(props: {
        activeAttempt: { maskedPhoneNumber: string; phoneNumber: string } | null;
        onPhoneNumberChange: (value: string) => void;
        pendingAction: string | null;
        phoneNumber: string;
        sendCodeDisabled: boolean;
        onSubmitPhoneEntry: (event?: React.FormEvent<HTMLFormElement>) => void;
      }) {
        return React.createElement(
          "div",
          {
            "data-active-attempt": props.activeAttempt?.maskedPhoneNumber ?? "",
            "data-pending-action": props.pendingAction ?? "",
            "data-phone-number": props.phoneNumber,
            "data-send-disabled": props.sendCodeDisabled ? "yes" : "no",
          },
          React.createElement(
            "button",
            {
              type: "button",
              "data-set-phone": "true",
              onClick: () => props.onPhoneNumberChange("4155552671"),
            },
            "Set phone",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-send-code": "true",
              disabled: props.sendCodeDisabled,
              onClick: () => props.onSubmitPhoneEntry(),
            },
            props.pendingAction === "send-code"
              ? "Sending code..."
              : "Send verification code",
          ),
        );
      },
      HostedPhoneAuthScaffold({
        children,
        errorMessage,
      }: {
        children: React.ReactNode;
        errorMessage: string | null;
      }) {
        return React.createElement(
          React.Fragment,
          null,
          errorMessage ? React.createElement("p", null, errorMessage) : null,
          children,
        );
      },
    }));
    vi.doMock("@/src/components/hosted-onboarding/hosted-privy-captcha", () => ({
      HostedPrivyCaptcha() {
        return React.createElement("div", { "data-privy-captcha": "mounted" });
      },
    }));
    mocks.sendCode.mockResolvedValue(undefined);

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const readyHarnessState: {
      setPrivyReady: React.Dispatch<React.SetStateAction<boolean>> | null;
    } = {
      setPrivyReady: null,
    };
    function ReadyHarness() {
      const [privyReady, setReady] = React.useState(false);
      readyHarnessState.setPrivyReady = setReady;
      mocks.usePrivy.mockReturnValue({
        authenticated: false,
        logout: mocks.logout,
        ready: privyReady,
      });
      return React.createElement(HostedPhoneAuth, null);
    }

    const { cleanup, container } = await renderClientComponent(
      React.createElement(ReadyHarness),
    );

    try {
      const setPhoneButton = container.querySelector(
        "[data-set-phone]",
      ) as HTMLButtonElement | null;
      assert.ok(setPhoneButton);

      await act(async () => {
        setPhoneButton.dispatchEvent(new Event("click", { bubbles: true }));
      });

      assert.equal(
        container.querySelector("[data-phone-number]")?.getAttribute("data-phone-number"),
        "4155552671",
      );
      assert.equal(
        container.querySelector("[data-send-disabled]")?.getAttribute("data-send-disabled"),
        "no",
      );

      const sendCodeButton = container.querySelector(
        "[data-send-code]",
      ) as HTMLButtonElement | null;
      assert.ok(sendCodeButton);
      assert.equal(sendCodeButton.disabled, false);

      await act(async () => {
        sendCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        sendCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await flushHostedPhoneAuthEffects(2);
      });

      expect(mocks.sendCode).not.toHaveBeenCalled();
      assert.equal(
        container.querySelector("[data-pending-action]")?.getAttribute("data-pending-action"),
        "",
      );
      assert.doesNotMatch(container.textContent ?? "", /Sending code\.\.\./);

      const updatePrivyReady = readyHarnessState.setPrivyReady;
      assert.ok(updatePrivyReady);
      await act(async () => {
        updatePrivyReady(true);
        await flushHostedPhoneAuthEffects();
      });

      expect(mocks.sendCode).toHaveBeenCalledTimes(1);
      expect(mocks.sendCode).toHaveBeenCalledWith({
        phoneNumber: "+14155552671",
      });
      assert.equal(
        container.querySelector("[data-active-attempt]")?.getAttribute("data-active-attempt"),
        "*** 2671",
      );
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-privy-captcha");
      vi.resetModules();
    }
  });

  it("drops queued manual auth sends when Privy resolves to an authenticated resume state", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow(props: {
        onPhoneNumberChange: (value: string) => void;
        sendCodeDisabled: boolean;
        onSubmitPhoneEntry: (event?: React.FormEvent<HTMLFormElement>) => void;
      }) {
        return React.createElement(
          "div",
          {
            "data-send-disabled": props.sendCodeDisabled ? "yes" : "no",
          },
          React.createElement(
            "button",
            {
              type: "button",
              "data-set-phone": "true",
              onClick: () => props.onPhoneNumberChange("4155552671"),
            },
            "Set phone",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-send-code": "true",
              disabled: props.sendCodeDisabled,
              onClick: () => props.onSubmitPhoneEntry(),
            },
            "Send verification code",
          ),
        );
      },
      HostedPhoneAuthScaffold({
        children,
        errorMessage,
        view,
      }: {
        children: React.ReactNode;
        errorMessage: string | null;
        view: string | null;
      }) {
        if (view) {
          return React.createElement("div", { "data-auth-view": view });
        }

        return React.createElement(
          React.Fragment,
          null,
          errorMessage ? React.createElement("p", null, errorMessage) : null,
          children,
        );
      },
    }));
    vi.doMock("@/src/components/hosted-onboarding/hosted-privy-captcha", () => ({
      HostedPrivyCaptcha() {
        return React.createElement("div", { "data-privy-captcha": "mounted" });
      },
    }));
    mocks.sendCode.mockResolvedValue(undefined);

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const readyHarnessState: {
      setAuthenticated: React.Dispatch<React.SetStateAction<boolean>> | null;
      setPrivyReady: React.Dispatch<React.SetStateAction<boolean>> | null;
    } = {
      setAuthenticated: null,
      setPrivyReady: null,
    };
    function ReadyHarness() {
      const [authenticated, setAuthenticated] = React.useState(false);
      const [privyReady, setReady] = React.useState(false);
      readyHarnessState.setAuthenticated = setAuthenticated;
      readyHarnessState.setPrivyReady = setReady;
      mocks.usePrivy.mockReturnValue({
        authenticated,
        logout: mocks.logout,
        ready: privyReady,
      });
      return React.createElement(HostedPhoneAuth, null);
    }

    const { cleanup, container } = await renderClientComponent(
      React.createElement(ReadyHarness),
    );

    try {
      const setPhoneButton = container.querySelector(
        "[data-set-phone]",
      ) as HTMLButtonElement | null;
      const sendCodeButton = container.querySelector(
        "[data-send-code]",
      ) as HTMLButtonElement | null;
      assert.ok(setPhoneButton);
      assert.ok(sendCodeButton);

      await act(async () => {
        setPhoneButton.dispatchEvent(new Event("click", { bubbles: true }));
      });

      assert.equal(
        container.querySelector("[data-send-disabled]")?.getAttribute("data-send-disabled"),
        "no",
      );

      await act(async () => {
        sendCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await flushHostedPhoneAuthEffects(2);
      });

      expect(mocks.sendCode).not.toHaveBeenCalled();

      const updateAuthenticated = readyHarnessState.setAuthenticated;
      const updatePrivyReady = readyHarnessState.setPrivyReady;
      assert.ok(updateAuthenticated);
      assert.ok(updatePrivyReady);
      await act(async () => {
        updateAuthenticated(true);
        updatePrivyReady(true);
        await flushHostedPhoneAuthEffects();
      });

      expect(mocks.sendCode).not.toHaveBeenCalled();
      assert.equal(
        container.querySelector("[data-auth-view]")?.getAttribute("data-auth-view"),
        "manual-resume",
      );
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-privy-captcha");
      vi.resetModules();
    }
  });

  it("drains queued manual link-phone sends when Privy initializes while authenticated", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow(props: {
        activeAttempt: { maskedPhoneNumber: string; phoneNumber: string } | null;
        onPhoneNumberChange: (value: string) => void;
        sendCodeDisabled: boolean;
        onSubmitPhoneEntry: (event?: React.FormEvent<HTMLFormElement>) => void;
      }) {
        return React.createElement(
          "div",
          {
            "data-active-attempt": props.activeAttempt?.maskedPhoneNumber ?? "",
            "data-send-disabled": props.sendCodeDisabled ? "yes" : "no",
          },
          React.createElement(
            "button",
            {
              type: "button",
              "data-set-phone": "true",
              onClick: () => props.onPhoneNumberChange("4155552671"),
            },
            "Set phone",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-send-code": "true",
              disabled: props.sendCodeDisabled,
              onClick: () => props.onSubmitPhoneEntry(),
            },
            "Send verification code",
          ),
        );
      },
      HostedPhoneAuthScaffold({
        children,
        view,
      }: {
        children: React.ReactNode;
        view: string | null;
      }) {
        if (view) {
          return React.createElement("div", { "data-auth-view": view });
        }

        return React.createElement(React.Fragment, null, children);
      },
    }));
    vi.doMock("@/src/components/hosted-onboarding/hosted-privy-captcha", () => ({
      HostedPrivyCaptcha() {
        return React.createElement("div", { "data-privy-captcha": "mounted" });
      },
    }));
    mocks.sendCode.mockResolvedValue(undefined);

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const readyHarnessState: {
      setPrivyReady: React.Dispatch<React.SetStateAction<boolean>> | null;
    } = {
      setPrivyReady: null,
    };
    function ReadyHarness() {
      const [privyReady, setReady] = React.useState(false);
      readyHarnessState.setPrivyReady = setReady;
      mocks.usePrivy.mockReturnValue({
        authenticated: true,
        logout: mocks.logout,
        ready: privyReady,
      });
      return React.createElement(HostedPhoneAuth, {
        intent: "link",
      });
    }

    const { cleanup, container } = await renderClientComponent(
      React.createElement(ReadyHarness),
    );

    try {
      const setPhoneButton = container.querySelector(
        "[data-set-phone]",
      ) as HTMLButtonElement | null;
      const sendCodeButton = container.querySelector(
        "[data-send-code]",
      ) as HTMLButtonElement | null;
      assert.ok(setPhoneButton);
      assert.ok(sendCodeButton);
      assert.equal(container.querySelector("[data-auth-view]"), null);

      await act(async () => {
        setPhoneButton.dispatchEvent(new Event("click", { bubbles: true }));
      });

      assert.equal(
        container.querySelector("[data-send-disabled]")?.getAttribute("data-send-disabled"),
        "no",
      );

      await act(async () => {
        sendCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await flushHostedPhoneAuthEffects(2);
      });

      expect(mocks.sendCode).not.toHaveBeenCalled();

      const updatePrivyReady = readyHarnessState.setPrivyReady;
      assert.ok(updatePrivyReady);
      await act(async () => {
        updatePrivyReady(true);
        await flushHostedPhoneAuthEffects();
      });

      expect(mocks.sendCode).toHaveBeenCalledTimes(1);
      expect(mocks.sendCode).toHaveBeenCalledWith({
        phoneNumber: "+14155552671",
      });
      assert.equal(
        container.querySelector("[data-active-attempt]")?.getAttribute("data-active-attempt"),
        "*** 2671",
      );
      assert.equal(container.querySelector("[data-auth-view]"), null);
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-privy-captcha");
      vi.resetModules();
    }
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

    assert.match(markup, /You already started logging in or signing up\./);
    assert.match(markup, /Continue/);
    assert.match(markup, /Use a different number/);
    assert.doesNotMatch(markup, /data-privy-captcha="mounted"/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("keeps recovery action errors visible on the manual-resume card", async () => {
    const { HostedPhoneAuthScaffold } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-auth-views"
    );

    const markup = renderToStaticMarkup(
      React.createElement(
        HostedPhoneAuthScaffold,
        {
          body: "Keep this tab open.",
          description: "Continue or sign out.",
          disabled: false,
          errorMessage: "We could not sign you out cleanly.",
          pendingAction: null,
          secondaryActionSize: "lg",
          title: "Signing you in...",
          view: "manual-resume",
          onContinue: () => {},
          onUseDifferentNumber: () => {},
        },
        React.createElement("div", null, "Phone entry"),
      ),
    );

    assert.match(markup, /Unable to continue/);
    assert.match(markup, /We could not sign you out cleanly\./);
    assert.match(markup, /You already started logging in or signing up\./);
    assert.doesNotMatch(markup, /Keep going with this number/);
    assert.match(markup, /Continue/);
    assert.match(markup, /Use a different number/);
  });

  it("renders invite signup as manual phone entry without exposing the phone hint", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.match(markup, /Phone number/);
    assert.doesNotMatch(markup, /Enter the number that received your Murph invite\./);
    assert.match(markup, /Send verification code/);
    assert.doesNotMatch(markup, /By continuing, you agree to our/);
    assert.match(markup, /data-privy-captcha="mounted"/);
    assert.doesNotMatch(markup, /text a 6-digit code to your phone\./);
    assert.doesNotMatch(markup, /\*\*\* 4567/);
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
        intent: "auth",
        pendingAction: null,
        phoneFieldDescription: "Enter the number that received your Murph invite.",
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
    assert.match(markup, /class="[^"]*h-16[^"]*text-xl[^"]*"/);
    assert.match(markup, /We texted the latest code to \*\*\* 2671\./);
  });

  it("uses neutral code-entry copy for no-signup public login phone checks", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: {
          maskedPhoneNumber: "*** 2671",
          phoneNumber: "+14155552671",
        },
        code: "",
        disableSignup: true,
        disabled: false,
        intent: "auth",
        pendingAction: null,
        phoneFieldDescription: null,
        phoneFieldLabel: null,
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

    assert.match(
      markup,
      /If an account exists for \*\*\* 2671, we texted the latest code there\./,
    );
    assert.doesNotMatch(markup, /We texted the latest code to \*\*\* 2671\./);
  });

  it("disables invite manual-entry send-code submit until the phone number is valid", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        intent: "auth",
        pendingAction: null,
        phoneFieldDescription: "Enter the number that received your Murph invite.",
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
    assert.match(markup, /Send verification code/);
    assert.doesNotMatch(markup, /By continuing, you agree to our/);
    assert.match(markup, /disabled=""/);
  });

  it("enables invite manual-entry send-code submit once the phone number is valid", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        intent: "auth",
        pendingAction: null,
        phoneFieldDescription: "Enter the number that received your Murph invite.",
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
    assert.match(markup, /Send verification code/);
    assert.doesNotMatch(markup, /By continuing, you agree to our/);
    assert.doesNotMatch(markup, /disabled=""/);
  });

  it("shows an invite masked phone hint without rendering the raw phone input", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 2671",
      }),
    );

    assert.match(markup, /\*\*\* 2671/);
    assert.match(markup, /Send verification code/);
    assert.match(markup, /Use a different number/);
    assert.doesNotMatch(markup, /name="phone-number"/);
    assert.doesNotMatch(markup, /\+14155552671/);
    assert.doesNotMatch(markup, /disabled=""/);
  });

  it("defensively masks invite phone hints before rendering them", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "+14155552671",
      }),
    );

    assert.match(markup, /\*\*\* 2671/);
    assert.doesNotMatch(markup, /\+14155552671/);
    assert.doesNotMatch(markup, /name="phone-number"/);
  });

  it("requests a code for the stored invite phone without showing the raw number", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-verification-code-step", () => ({
      HostedVerificationCodeStep({ description }: { description: string }) {
        return React.createElement(
          "div",
          null,
          React.createElement("p", null, "Verification code"),
          React.createElement("p", null, description),
        );
      },
    }));
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = typeof url === "string" ? url : url.toString();

      if (requestUrl.endsWith("/send-code")) {
        return new Response(JSON.stringify({
          phoneHint: "*** 0123",
          phoneNumber: "+12025550123",
          sendAttemptId: "send_attempt_123",
        }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        });
      }

      if (requestUrl.endsWith("/send-code/confirm")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetch);
    mocks.sendCode.mockResolvedValue(undefined);

    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");
    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 0123",
      }),
    );

    try {
      const sendButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Send verification code") as
          | HTMLButtonElement
          | undefined;
      assert.ok(sendButton);

      await act(async () => {
        sendButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.sendCode).toHaveBeenCalledWith({
        phoneNumber: "+12025550123",
      });
      const requestedUrls = fetch.mock.calls.map(([url]) =>
        typeof url === "string" ? url : url.toString(),
      );
      assert.deepEqual(requestedUrls, [
        "/api/hosted-onboarding/invites/invite-code/send-code",
        "/api/hosted-onboarding/invites/invite-code/send-code/confirm",
      ]);
      assert.match(container.textContent ?? "", /Verification code/);
      assert.match(container.textContent ?? "", /\*\*\* 0123/);
      assert.doesNotMatch(container.textContent ?? "", /\+12025550123/);
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-verification-code-step");
      vi.resetModules();
    }
  });

  it("queues saved invite phone verification sends until Privy initializes", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-verification-code-step", () => ({
      HostedVerificationCodeStep({ description }: { description: string }) {
        return React.createElement(
          "div",
          null,
          React.createElement("p", null, "Verification code"),
          React.createElement("p", null, description),
        );
      },
    }));
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = typeof url === "string" ? url : url.toString();

      if (requestUrl.endsWith("/send-code")) {
        return new Response(JSON.stringify({
          phoneHint: "*** 0123",
          phoneNumber: "+12025550123",
          sendAttemptId: "send_attempt_123",
        }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        });
      }

      if (requestUrl.endsWith("/send-code/confirm")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetch);
    mocks.sendCode.mockResolvedValue(undefined);

    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");
    const readyHarnessState: {
      setPrivyReady: React.Dispatch<React.SetStateAction<boolean>> | null;
    } = {
      setPrivyReady: null,
    };
    function ReadyHarness() {
      const [privyReady, setReady] = React.useState(false);
      readyHarnessState.setPrivyReady = setReady;
      mocks.usePrivy.mockReturnValue({
        authenticated: false,
        logout: mocks.logout,
        ready: privyReady,
      });
      return React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 0123",
      });
    }

    const { cleanup, container } = await renderClientComponent(
      React.createElement(ReadyHarness),
    );

    try {
      assert.match(container.textContent ?? "", /\*\*\* 0123/);
      const sendButton = findSendVerificationCodeButton(container);
      assert.equal(sendButton.disabled, false);
      assert.doesNotMatch(container.textContent ?? "", /Setting up\.\.\./);
      expect(fetch).not.toHaveBeenCalled();

      await act(async () => {
        sendButton.dispatchEvent(new Event("click", { bubbles: true }));
        sendButton.dispatchEvent(new Event("click", { bubbles: true }));
        await flushHostedPhoneAuthEffects(2);
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.sendCode).not.toHaveBeenCalled();
      assert.equal(sendButton.disabled, true);
      assert.match(container.textContent ?? "", /Sending code\.\.\./);

      const updatePrivyReady = readyHarnessState.setPrivyReady;
      assert.ok(updatePrivyReady);
      await act(async () => {
        updatePrivyReady(true);
        await flushHostedPhoneAuthEffects();
      });

      expect(mocks.sendCode).toHaveBeenCalledTimes(1);
      expect(mocks.sendCode).toHaveBeenCalledWith({
        phoneNumber: "+12025550123",
      });
      assert.deepEqual(fetch.mock.calls.map(([url]) =>
        typeof url === "string" ? url : url.toString(),
      ), [
        "/api/hosted-onboarding/invites/invite-code/send-code",
        "/api/hosted-onboarding/invites/invite-code/send-code/confirm",
      ]);
      assert.match(container.textContent ?? "", /Verification code/);
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-verification-code-step");
      vi.resetModules();
      vi.unstubAllGlobals();
    }
  });

  it("drops queued saved invite sends when Privy resolves to an authenticated resume state", async () => {
    vi.resetModules();
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = typeof url === "string" ? url : url.toString();

      throw new Error(`Unexpected fetch ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetch);

    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");
    const readyHarnessState: {
      setAuthenticated: React.Dispatch<React.SetStateAction<boolean>> | null;
      setPrivyReady: React.Dispatch<React.SetStateAction<boolean>> | null;
    } = {
      setAuthenticated: null,
      setPrivyReady: null,
    };
    function ReadyHarness() {
      const [authenticated, setAuthenticated] = React.useState(false);
      const [privyReady, setReady] = React.useState(false);
      readyHarnessState.setAuthenticated = setAuthenticated;
      readyHarnessState.setPrivyReady = setReady;
      mocks.usePrivy.mockReturnValue({
        authenticated,
        logout: mocks.logout,
        ready: privyReady,
      });
      return React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 0123",
      });
    }

    const { cleanup, container } = await renderClientComponent(
      React.createElement(ReadyHarness),
    );

    try {
      const sendButton = findSendVerificationCodeButton(container);
      assert.equal(sendButton.disabled, false);

      await act(async () => {
        sendButton.dispatchEvent(new Event("click", { bubbles: true }));
        await flushHostedPhoneAuthEffects(2);
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.sendCode).not.toHaveBeenCalled();

      const updateAuthenticated = readyHarnessState.setAuthenticated;
      const updatePrivyReady = readyHarnessState.setPrivyReady;
      assert.ok(updateAuthenticated);
      assert.ok(updatePrivyReady);
      await act(async () => {
        updateAuthenticated(true);
        updatePrivyReady(true);
        await flushHostedPhoneAuthEffects();
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.sendCode).not.toHaveBeenCalled();
      assert.match(container.textContent ?? "", /You already started logging in or signing up\./);
      assert.doesNotMatch(container.textContent ?? "", /Verification code/);
    } finally {
      await cleanup();
      vi.resetModules();
      vi.unstubAllGlobals();
    }
  });

  it("drops queued saved invite sends when the invite target changes before Privy initializes", async () => {
    vi.resetModules();
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = typeof url === "string" ? url : url.toString();

      throw new Error(`Unexpected fetch ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetch);

    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");
    const readyHarnessState: {
      setInviteTarget: React.Dispatch<React.SetStateAction<{
        inviteCode: string;
        phoneHint: string;
      }>> | null;
      setPrivyReady: React.Dispatch<React.SetStateAction<boolean>> | null;
    } = {
      setInviteTarget: null,
      setPrivyReady: null,
    };
    function ReadyHarness() {
      const [privyReady, setReady] = React.useState(false);
      const [inviteTarget, setInviteTarget] = React.useState({
        inviteCode: "invite-code",
        phoneHint: "*** 0123",
      });
      readyHarnessState.setInviteTarget = setInviteTarget;
      readyHarnessState.setPrivyReady = setReady;
      mocks.usePrivy.mockReturnValue({
        authenticated: false,
        logout: mocks.logout,
        ready: privyReady,
      });
      return React.createElement(HostedInvitePhoneAuth, inviteTarget);
    }

    const { cleanup, container } = await renderClientComponent(
      React.createElement(ReadyHarness),
    );

    try {
      const sendButton = findSendVerificationCodeButton(container);
      assert.match(container.textContent ?? "", /\*\*\* 0123/);

      await act(async () => {
        sendButton.dispatchEvent(new Event("click", { bubbles: true }));
        await flushHostedPhoneAuthEffects(2);
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.sendCode).not.toHaveBeenCalled();

      const updateInviteTarget = readyHarnessState.setInviteTarget;
      const updatePrivyReady = readyHarnessState.setPrivyReady;
      assert.ok(updateInviteTarget);
      assert.ok(updatePrivyReady);
      await act(async () => {
        updateInviteTarget({
          inviteCode: "next-invite-code",
          phoneHint: "*** 9999",
        });
        await flushHostedPhoneAuthEffects(2);
      });

      assert.match(container.textContent ?? "", /\*\*\* 9999/);
      assert.doesNotMatch(container.textContent ?? "", /\*\*\* 0123/);

      await act(async () => {
        updatePrivyReady(true);
        await flushHostedPhoneAuthEffects();
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.sendCode).not.toHaveBeenCalled();
      assert.match(container.textContent ?? "", /\*\*\* 9999/);
      assert.doesNotMatch(container.textContent ?? "", /Verification code/);
    } finally {
      await cleanup();
      vi.resetModules();
      vi.unstubAllGlobals();
    }
  });

  it("falls back to manual entry when the stored invite phone is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow() {
        return React.createElement(
          "div",
          null,
          React.createElement("label", null, "Phone number"),
          React.createElement("input", { name: "phone-number" }),
        );
      },
      HostedPhoneAuthScaffold({
        children,
        errorMessage,
      }: {
        children: React.ReactNode;
        errorMessage: string | null;
      }) {
        return React.createElement(
          "div",
          null,
          errorMessage
            ? React.createElement(
                "div",
                null,
                React.createElement("p", null, "Unable to continue"),
                React.createElement("p", null, errorMessage),
              )
            : null,
          children,
        );
      },
    }));
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = typeof url === "string" ? url : url.toString();

      if (requestUrl.endsWith("/send-code")) {
        return new Response(JSON.stringify({
          error: {
            code: "SIGNUP_PHONE_UNAVAILABLE",
            message: "Invite phone unavailable.",
          },
        }), {
          headers: {
            "content-type": "application/json",
          },
          status: 409,
        });
      }

      throw new Error(`Unexpected fetch ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetch);
    mocks.sendCode.mockResolvedValue(undefined);

    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");
    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 2671",
      }),
    );

    try {
      const sendButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Send verification code") as
          | HTMLButtonElement
          | undefined;
      assert.ok(sendButton);

      await act(async () => {
        sendButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.sendCode).not.toHaveBeenCalled();
      assert.deepEqual(fetch.mock.calls.map(([url]) =>
        typeof url === "string" ? url : url.toString(),
      ), [
        "/api/hosted-onboarding/invites/invite-code/send-code",
      ]);
      assert.match(container.textContent ?? "", /Unable to continue/);
      assert.match(container.textContent ?? "", /Enter the number that messaged Murph to continue\./);
      assert.equal(container.querySelector("[name='phone-number']") !== null, true);
      assert.doesNotMatch(container.textContent ?? "", /\*\*\* 2671/);
      assert.doesNotMatch(container.textContent ?? "", /\+14155552671/);
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.resetModules();
    }
  });

  it("does not render malformed masked invite phone hints verbatim", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 2671 +14155552671",
      }),
    );

    assert.match(markup, /name="phone-number"/);
    assert.doesNotMatch(markup, /\*\*\* 2671 \+14155552671/);
    assert.doesNotMatch(markup, /\+14155552671/);
  });

  it("falls back to manual invite phone entry for the generic phone hint", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const markup = renderToStaticMarkup(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "your number",
      }),
    );

    assert.match(markup, /name="phone-number"/);
    assert.doesNotMatch(markup, /Use a different number/);
  });

  it("falls back to manual invite phone entry when there is no masked hint", async () => {
    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");
    const { PhoneCountryCodeClientProvider } = await import(
      "@/src/components/hosted-onboarding/phone-country-code-client-provider"
    );

    const markup = renderToStaticMarkup(
      React.createElement(
        PhoneCountryCodeClientProvider,
        {
          countryCode: "US",
        },
        React.createElement(HostedInvitePhoneAuth, {
          inviteCode: "invite-code",
        }),
      ),
    );

    assert.match(markup, />\+1</);
    assert.match(markup, /name="phone-number"/);
    assert.match(markup, /value=""/);
  });

  it("returns to the masked invite phone hint after signing out of an interrupted session", async () => {
    vi.resetModules();

    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow(props: {
        onPhoneNumberChange: (value: string) => void;
        phoneInputAutoFocus?: boolean;
        phoneNumber: string;
      }) {
        return React.createElement(
          "div",
          {
            "data-phone-input-autofocus": props.phoneInputAutoFocus
              ? "true"
              : "false",
            "data-phone-number": props.phoneNumber,
          },
          React.createElement(
            "button",
            {
              type: "button",
              "data-change-phone": "true",
              onClick: () => props.onPhoneNumberChange("9995552671"),
            },
            "Change phone",
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

    const { HostedInvitePhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-invite-phone-auth");

    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 2671",
      }),
    );

    try {
      assert.match(container.textContent ?? "", /\*\*\* 2671/);
      assert.equal(container.querySelector("[data-phone-number]"), null);

      const useDifferentNumberButton = [
        ...container.querySelectorAll("button"),
      ].find(
        (button) =>
          button.textContent === "Use a different number"
          && !button.hasAttribute("data-sign-out"),
      ) as HTMLButtonElement | undefined;
      assert.ok(useDifferentNumberButton);

      await act(async () => {
        useDifferentNumberButton.dispatchEvent(
          new Event("click", { bubbles: true }),
        );
      });

      assert.equal(
        container.querySelector("[data-phone-number]")?.getAttribute("data-phone-number"),
        "",
      );
      assert.equal(
        container.querySelector("[data-phone-number]")?.getAttribute("data-phone-input-autofocus"),
        "true",
      );

      const changePhoneButton = container.querySelector(
        "[data-change-phone]",
      ) as HTMLButtonElement | null;
      const signOutButton = container.querySelector(
        "[data-sign-out]",
      ) as HTMLButtonElement | null;

      assert.ok(changePhoneButton);
      assert.ok(signOutButton);

      await act(async () => {
        changePhoneButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      assert.equal(
        container.querySelector("[data-phone-number]")?.getAttribute("data-phone-number"),
        "9995552671",
      );

      await act(async () => {
        signOutButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      assert.equal(container.querySelector("[data-phone-number]"), null);
      assert.match(container.textContent ?? "", /\*\*\* 2671/);
      expect(mocks.logout).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-privy-captcha");
      vi.resetModules();
    }
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

    assert.match(markup, /You already started logging in or signing up\./);
    assert.match(markup, /Continue/);
    assert.match(markup, /Use a different number/);
    assert.match(markup, /class="[^"]*h-11[^"]*w-full[^"]*"/);
    assert.doesNotMatch(markup, /Preparing your account/);
  });

  it("switches from manual resume to sign-out recovery when the Privy account conflicts", async () => {
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
            latest_verified_at: 1741194420,
            phone_number: "+14155552671",
            type: "phone",
          },
          {
            address: "0x0000000000000000000000000000000000000001",
            chain_type: "ethereum",
            connector_type: "embedded",
            wallet_client: "privy",
            type: "wallet",
          },
        ],
      },
    });
    mocks.refreshUser.mockResolvedValue({
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+14155552671",
          type: "phone",
        },
        {
          address: "0x0000000000000000000000000000000000000001",
          chain_type: "ethereum",
          connector_type: "embedded",
          wallet_client: "privy",
          type: "wallet",
        },
      ],
    });
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          code: "PRIVY_USER_MISMATCH",
          message: "This phone number is already linked to a different Privy account.",
        },
      }), {
        headers: { "content-type": "application/json" },
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedPhoneAuth, {
        intent: "auth",
      }),
    );

    try {
      assert.match(container.textContent ?? "", /You already started logging in or signing up\./);

      const continueButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue") as
          | HTMLButtonElement
          | undefined;
      assert.ok(continueButton);

      await act(async () => {
        continueButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      assert.doesNotMatch(container.textContent ?? "", /Unable to continue/);
      assert.doesNotMatch(container.textContent ?? "", /different Privy account/);
      assert.doesNotMatch(container.textContent ?? "", /Continue/);
      assert.match(container.textContent ?? "", /Sign in with this phone again/);
      assert.match(container.textContent ?? "", /signed into a different Murph account/);

      const resetButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Sign out") as
          | HTMLButtonElement
          | undefined;
      assert.ok(resetButton);

      await act(async () => {
        resetButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(mocks.logout).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("switches from manual resume to sign-out recovery when the verified identity conflicts", async () => {
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
            latest_verified_at: 1741194420,
            phone_number: "+14155552671",
            type: "phone",
          },
          {
            address: "0x0000000000000000000000000000000000000001",
            chain_type: "ethereum",
            connector_type: "embedded",
            wallet_client: "privy",
            type: "wallet",
          },
        ],
      },
    });
    mocks.refreshUser.mockResolvedValue({
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+14155552671",
          type: "phone",
        },
        {
          address: "0x0000000000000000000000000000000000000001",
          chain_type: "ethereum",
          connector_type: "embedded",
          wallet_client: "privy",
          type: "wallet",
        },
      ],
    });
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          code: "PRIVY_IDENTITY_CONFLICT",
          message: "This phone number is already linked to a different Privy account.",
        },
      }), {
        headers: { "content-type": "application/json" },
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedPhoneAuth, {
        intent: "auth",
      }),
    );

    try {
      assert.match(container.textContent ?? "", /You already started logging in or signing up\./);

      const continueButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue") as
          | HTMLButtonElement
          | undefined;
      assert.ok(continueButton);

      await act(async () => {
        continueButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      assert.doesNotMatch(container.textContent ?? "", /Unable to continue/);
      assert.doesNotMatch(container.textContent ?? "", /different Privy account/);
      assert.doesNotMatch(container.textContent ?? "", /Continue/);
      assert.match(container.textContent ?? "", /Sign in with this phone again/);
      assert.match(container.textContent ?? "", /signed into a different Murph account/);

      const resetButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Sign out") as
          | HTMLButtonElement
          | undefined;
      assert.ok(resetButton);

      await act(async () => {
        resetButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(mocks.logout).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("switches to sign-out recovery when account conflict follows SMS code verification", async () => {
    vi.resetModules();
    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", async () => {
      const actual = await vi.importActual<
        typeof import("@/src/components/hosted-onboarding/hosted-phone-auth-views")
      >("@/src/components/hosted-onboarding/hosted-phone-auth-views");

      return {
        ...actual,
        HostedPhoneAuthFlow(props: {
          activeAttempt: { maskedPhoneNumber: string } | null;
          onCodeChange: (value: string) => void;
          onPhoneNumberChange: (value: string) => void;
          onSubmitPhoneEntry: () => void;
          onVerifyCode: () => void;
        }) {
          if (props.activeAttempt) {
            return React.createElement(
              "div",
              null,
              React.createElement("p", null, props.activeAttempt.maskedPhoneNumber),
              React.createElement(
                "button",
                {
                  type: "button",
                  onClick: () => props.onCodeChange("123456"),
                },
                "Enter code",
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  onClick: props.onVerifyCode,
                },
                "Verify code",
              ),
            );
          }

          return React.createElement(
            "div",
            null,
            React.createElement(
              "button",
              {
                type: "button",
                onClick: () => props.onPhoneNumberChange("4155552671"),
              },
              "Enter phone",
            ),
            React.createElement(
              "button",
              {
                type: "button",
                onClick: () => props.onSubmitPhoneEntry(),
              },
              "Send verification code",
            ),
          );
        },
      };
    });
    mocks.usePrivy.mockReturnValue({
      authenticated: false,
      logout: mocks.logout,
      ready: true,
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });
    mocks.refreshUser.mockResolvedValue({
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+14155552671",
          type: "phone",
        },
        {
          address: "0x0000000000000000000000000000000000000001",
          chain_type: "ethereum",
          connector_type: "embedded",
          wallet_client: "privy",
          type: "wallet",
        },
      ],
    });
    mocks.sendCode.mockResolvedValue(undefined);
    mocks.loginWithCode.mockResolvedValue(undefined);
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          code: "PRIVY_USER_MISMATCH",
          message: "This phone number is already linked to a different Privy account.",
        },
      }), {
        headers: { "content-type": "application/json" },
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedPhoneAuth, {
        intent: "auth",
      }),
    );

    try {
      const enterPhoneButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Enter phone") as
          | HTMLButtonElement
          | undefined;
      assert.ok(enterPhoneButton);

      await act(async () => {
        enterPhoneButton.dispatchEvent(new Event("click", { bubbles: true }));
      });

      const sendCodeButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Send verification code") as
          | HTMLButtonElement
          | undefined;
      assert.ok(sendCodeButton);

      await act(async () => {
        sendCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      const enterCodeButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Enter code") as
          | HTMLButtonElement
          | undefined;
      assert.ok(enterCodeButton);

      await act(async () => {
        enterCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.loginWithCode).toHaveBeenCalledWith({ code: "123456" });
      assert.doesNotMatch(container.textContent ?? "", /Unable to continue/);
      assert.doesNotMatch(container.textContent ?? "", /different Privy account/);
      assert.doesNotMatch(container.textContent ?? "", /Continue/);
      assert.match(container.textContent ?? "", /Sign in with this phone again/);
      assert.match(container.textContent ?? "", /signed into a different Murph account/);
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("passes Privy's completed SMS user into hosted phone finalization", async () => {
    vi.resetModules();
    const completedUser = {
      linkedAccounts: [
        {
          latest_verified_at: 1771977600,
          number: "+14155552671",
          type: "phone",
        },
      ],
    };
    const finalizeHostedPrivyVerification = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-support", async () => {
      const actual = await vi.importActual<
        typeof import("@/src/components/hosted-onboarding/hosted-phone-auth-support")
      >("@/src/components/hosted-onboarding/hosted-phone-auth-support");

      return {
        ...actual,
        finalizeHostedPrivyVerification,
      };
    });
    vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-views", () => ({
      HostedPhoneAuthFlow(props: {
        activeAttempt: { maskedPhoneNumber: string; phoneNumber: string } | null;
        onCodeChange: (code: string) => void;
        onPhoneNumberChange: (phoneNumber: string) => void;
        onSubmitPhoneEntry: () => void;
        onVerifyCode: () => void;
      }) {
        if (props.activeAttempt) {
          return React.createElement(
            "div",
            null,
            React.createElement(
              "button",
              {
                type: "button",
                onClick: () => props.onCodeChange("123456"),
              },
              "Enter code",
            ),
            React.createElement(
              "button",
              {
                type: "button",
                onClick: props.onVerifyCode,
              },
              "Verify code",
            ),
          );
        }

        return React.createElement(
          "div",
          null,
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => props.onPhoneNumberChange("4155552671"),
            },
            "Enter phone",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => props.onSubmitPhoneEntry(),
            },
            "Send verification code",
          ),
        );
      },
      HostedPhoneAuthScaffold({ children }: { children: React.ReactNode }) {
        return React.createElement(React.Fragment, null, children);
      },
    }));
    vi.doMock("@/src/components/hosted-onboarding/hosted-privy-captcha", () => ({
      HostedPrivyCaptcha() {
        return React.createElement("div", { "data-privy-captcha": "mounted" });
      },
    }));

    mocks.usePrivy.mockReturnValue({
      authenticated: false,
      logout: mocks.logout,
      ready: true,
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });
    mocks.refreshUser.mockResolvedValue({
      linkedAccounts: [],
    });
    mocks.sendCode.mockResolvedValue(undefined);
    mocks.loginWithCode.mockImplementationOnce(async () => {
      mocks.loginCallbacks?.onComplete?.({
        user: completedUser,
      });
    });

    const { HostedPhoneAuth } = await import("@/src/components/hosted-onboarding/hosted-phone-auth");
    const { cleanup, container } = await renderClientComponent(
      React.createElement(HostedPhoneAuth, {
        intent: "auth",
      }),
    );

    try {
      const enterPhoneButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Enter phone") as
          | HTMLButtonElement
          | undefined;
      assert.ok(enterPhoneButton);

      await act(async () => {
        enterPhoneButton.dispatchEvent(new Event("click", { bubbles: true }));
      });

      const sendCodeButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Send verification code") as
          | HTMLButtonElement
          | undefined;
      assert.ok(sendCodeButton);

      await act(async () => {
        sendCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      const enterCodeButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Enter code") as
          | HTMLButtonElement
          | undefined;
      assert.ok(enterCodeButton);

      await act(async () => {
        enterCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
      });

      const verifyCodeButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Verify code") as
          | HTMLButtonElement
          | undefined;
      assert.ok(verifyCodeButton);

      await act(async () => {
        verifyCodeButton.dispatchEvent(new Event("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(finalizeHostedPrivyVerification).toHaveBeenCalledWith(expect.objectContaining({
        completedUser,
        refreshUser: mocks.refreshUser,
        user: null,
      }));
    } finally {
      await cleanup();
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-support");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-phone-auth-views");
      vi.doUnmock("@/src/components/hosted-onboarding/hosted-privy-captcha");
      vi.resetModules();
    }
  });

  it("uses full-size code entry controls for the public homepage code step", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const markup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: {
          maskedPhoneNumber: "*** 2671",
          phoneNumber: "+14155552671",
        },
        code: "",
        disabled: false,
        intent: "auth",
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
    assert.ok((markup.match(/h-16/g)?.length ?? 0) >= 6);
    assert.match(markup, /We texted the latest code to \*\*\* 2671\./);
  });

  it("switches the public homepage copy into unified auth language", async () => {
    const { HostedPhoneAuthFlow } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-views");

    const phoneEntryMarkup = renderToStaticMarkup(
      React.createElement(HostedPhoneAuthFlow, {
        activeAttempt: null,
        code: "",
        disabled: false,
        intent: "auth",
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
        intent: "auth",
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

    assert.match(phoneEntryMarkup, /Your phone/);
    assert.doesNotMatch(phoneEntryMarkup, /Phone number on your account/);
    assert.match(phoneEntryMarkup, /Send verification code/);
    assert.doesNotMatch(phoneEntryMarkup, /Text me a sign-in code/);
    assert.match(codeEntryMarkup, /We texted the latest code to \*\*\* 2671\./);
    assert.match(codeEntryMarkup, />Verify phone</);
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

    assert.match(markup, /You already started logging in or signing up\./);
    assert.match(markup, /Continue/);
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

  it("keeps the pending action after successful finalization until the route changes", async () => {
    const { runHostedPrivyFinalizationAttempt } = await import("@/src/components/hosted-onboarding/hosted-phone-auth-support");

    let finalizationState: "idle" | "running" | "completed" = "idle";
    const pendingActions: Array<string | null> = [];

    await runHostedPrivyFinalizationAttempt({
      action: "verify-code",
      finalize: async () => {},
      getFinalizationState: () => finalizationState,
      setPendingAction(action) {
        pendingActions.push(action);
      },
      updateFinalizationState(nextState) {
        finalizationState = nextState;
      },
    });

    assert.equal(finalizationState, "completed");
    assert.deepEqual(pendingActions, ["verify-code"]);
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

  it("includes the selected auth intent in hosted Privy completion requests", async () => {
    const { buildHostedPrivyCompletionRequestPayload } = await import("@/src/components/hosted-onboarding/hosted-privy-auth-support");

    assert.deepEqual(
      buildHostedPrivyCompletionRequestPayload({
        authMethod: "phone",
      }),
      {
        authIntent: {
          method: "phone",
        },
      },
    );
    assert.deepEqual(
      buildHostedPrivyCompletionRequestPayload({
        authMethod: "telegram",
        inviteCode: "invite-code",
      }),
      {
        authIntent: {
          method: "telegram",
        },
        inviteCode: "invite-code",
      },
    );
  });

  it("includes the browser timezone when hosted Privy completion runs in a browser", async () => {
    const { buildHostedPrivyCompletionRequestPayload } = await import("@/src/components/hosted-onboarding/hosted-privy-auth-support");

    vi.stubGlobal("window", {
      Intl: {
        DateTimeFormat: () => ({
          resolvedOptions: () => ({
            timeZone: "America/Los_Angeles",
          }),
        }),
      },
    });

    try {
      assert.deepEqual(
        buildHostedPrivyCompletionRequestPayload({
          authMethod: "email",
        }),
        {
          authIntent: {
            method: "email",
          },
          timeZone: "America/Los_Angeles",
        },
      );
    } finally {
      vi.unstubAllGlobals();
    }
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
      readHostedPrivyClientSessionState: readHostedPrivyClientSessionStateForTest,
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
        user: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    assert.equal(ensureHostedPrivyPhoneReady.mock.calls.length, 1);
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 1);
    assert.equal(requestHostedOnboardingJson.mock.calls[0]?.[0]?.url, "/api/hosted-onboarding/privy/complete");
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      authIntent: {
        method: "phone",
      },
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
      readHostedPrivyClientSessionState: readHostedPrivyClientSessionStateForTest,
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
        refreshUser,
        user: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    assert.equal(refreshUser.mock.calls.length, 1);
    assert.equal(ensureHostedPrivyPhoneReady.mock.calls.length, 1);
    assert.equal(typeof ensureHostedPrivyPhoneReady.mock.calls[0]?.[0]?.createWallet, "function");
    assert.deepEqual(ensureHostedPrivyPhoneReady.mock.calls[0]?.[0]?.user, {
      linkedAccounts: [{ type: "phone" }],
    });
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 1);
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      authIntent: {
        method: "phone",
      },
    });
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "/home");
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
      readHostedPrivyClientSessionState: readHostedPrivyClientSessionStateForTest,
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
        user: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    assert.equal(ensureHostedPrivyPhoneReady.mock.calls.length, 1);
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 2);
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      authIntent: {
        method: "phone",
      },
    });
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload, {
      authIntent: {
        method: "phone",
      },
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
      readHostedPrivyClientSessionState: readHostedPrivyClientSessionStateForTest,
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
        user: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    assert.equal(ensureHostedPrivyPhoneReady.mock.calls.length, 1);
    assert.equal(requestHostedOnboardingJson.mock.calls.length, 2);
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload, {
      authIntent: {
        method: "phone",
      },
    });
    assert.deepEqual(requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload, {
      authIntent: {
        method: "phone",
      },
    });
    assert.equal(assign.mock.calls.length, 1);
    assert.equal(assign.mock.calls[0]?.[0], "/join/invite-code");
  });

  it("starts invite signup in manual entry when no masked phone hint exists", async () => {
    const harness = await loadHostedInvitePhoneAuthHarness();

    renderToStaticMarkup(
      React.createElement(harness.HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.equal(harness.flowProps.length, 1);
    assert.equal(harness.controller.handleResendCode.mock.calls.length, 0);
  });

  it("starts invite signup with the stored masked phone shortcut when a hint exists", async () => {
    const harness = await loadHostedInvitePhoneAuthHarness();

    const markup = renderToStaticMarkup(
      React.createElement(harness.HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
        phoneHint: "*** 2523",
      }),
    );

    assert.equal(harness.flowProps.length, 0);
    assert.match(markup, /\*\*\* 2523/);
    assert.match(markup, /Send verification code/);
  });

  it("uses the manual-entry resend path while an invite code attempt is active", async () => {
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

    assert.equal(harness.controller.handleResendCode.mock.calls.length, 1);
  });

  it("resets the phone auth flow from invite manual entry without calling the stored-phone shortcut", async () => {
    const harness = await loadHostedInvitePhoneAuthHarness();

    renderToStaticMarkup(
      React.createElement(harness.HostedInvitePhoneAuth, {
        inviteCode: "invite-code",
      }),
    );

    assert.equal(harness.flowProps.length, 1);
    harness.flowProps[0].onUseDifferentNumber();

    assert.equal(harness.controller.resetPhoneAuthFlow.mock.calls.length, 1);
  });
});

async function flushHostedPhoneAuthEffects(cycles = 4) {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
}

function findSendVerificationCodeButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent === "Send verification code");

  assert.ok(button);
  return button;
}

async function loadHostedInvitePhoneAuthHarness(input?: {
  activeAttempt?: { maskedPhoneNumber: string; phoneNumber: string } | null;
  ReactMock?: () => Promise<Record<string, unknown>>;
}) {
  vi.resetModules();

  if (input?.ReactMock) {
    vi.doMock("react", input.ReactMock);
  }

  const flowProps: Array<{ onResendCode: () => Promise<void>; onUseDifferentNumber: () => void }> = [];
  const controller = createHostedInvitePhoneAuthControllerHarness(
    input?.activeAttempt ?? null,
  );
  const flushPendingInvitePhoneCodeMutation = vi.fn().mockResolvedValue(undefined);

  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-controller", () => ({
    useHostedPhoneAuthController: () => controller,
  }));
  vi.doMock("@/src/components/hosted-onboarding/hosted-phone-auth-support", () => ({
    flushPendingInvitePhoneCodeMutation,
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
    privyReady: true,
    handleResetPhoneAuthFlow: vi.fn(),
    resetPhoneAuthFlow: vi.fn(),
    sendVerificationCode: vi.fn(),
    setErrorMessage: vi.fn(),
    setPendingAction: vi.fn(),
    sharedFlowProps: {
      activeAttempt,
      code: "",
      disabled: false,
      intent: "auth" as const,
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
