import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  completeHostedPrivyAuth: vi.fn(),
  createWallet: vi.fn(),
  hostedPhoneAuthProps: null as {
    onAuthCompleted?: (result: {
      payload: {
        activationPending: boolean;
        inviteCode: string;
        joinUrl: string;
        stage: string;
      };
      redirectUrl: string;
    }) => Promise<void> | void;
    onCompleted?: (payload: unknown) => Promise<void> | void;
  } | null,
  loginWithCode: vi.fn(),
  loginWithTelegram: vi.fn(),
  legalConsentCardProps: null as {
    mode?: string;
    onAccepted?: () => Promise<void> | void;
    onRequirementChange?: (required: boolean) => void;
    preferredScope?: string;
    source?: string;
  } | null,
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  Captcha() {
    return createElement("div", { "data-privy-captcha": "mounted" });
  },
  useCreateWallet() {
    return {
      createWallet: mocks.createWallet,
    };
  },
  useLoginWithEmail() {
    return {
      loginWithCode: mocks.loginWithCode,
      sendCode: mocks.sendCode,
      state: { status: "initial" },
    };
  },
  useLoginWithTelegram() {
    return {
      login: mocks.loginWithTelegram,
      state: { status: "initial" },
    };
  },
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-completion", () => ({
  completeHostedPrivyAuth: mocks.completeHostedPrivyAuth,
}));

vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({
  HostedLegalConsentCard(props: {
    onAccepted?: () => Promise<void> | void;
    onRequirementChange?: (required: boolean) => void;
    source: string;
  }) {
    mocks.legalConsentCardProps = props;
    return createElement(
      "div",
      { "data-hosted-legal-consent-card": "mounted" },
      createElement("p", null, "Hosted legal consent card"),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => void props.onAccepted?.(),
        },
        "Continue",
      ),
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth(input: {
    disableSignup?: boolean;
    onAuthCompleted?: unknown;
    onCompleted?: unknown;
    suppressAuthenticatedSessionIssue?: boolean;
  }) {
    mocks.hostedPhoneAuthProps = input as typeof mocks.hostedPhoneAuthProps;
    return createElement(
      "div",
      {
        "data-hosted-phone-auth": "mounted",
        "data-hosted-phone-auth-disable-signup":
          input.disableSignup ? "yes" : "no",
        "data-hosted-phone-auth-suppressed":
          input.suppressAuthenticatedSessionIssue ? "yes" : "no",
      },
      "Hosted phone auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-verification-code-step", () => ({
  HostedVerificationCodeStep({
    description,
    onResendCode,
  }: {
    description: string;
    onResendCode: () => void;
  }) {
    return createElement(
      "div",
      null,
      createElement("p", null, "Verify email"),
      createElement("p", null, description),
      createElement(
        "button",
        {
          type: "button",
          onClick: onResendCode,
        },
        "Resend code",
      ),
    );
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostedPhoneAuthProps = null;
  mocks.legalConsentCardProps = null;
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: vi.fn(),
    ready: true,
  });
  mocks.useUser.mockReturnValue({
    refreshUser: vi.fn(),
    user: null,
  });
  mocks.loginWithTelegram.mockResolvedValue(undefined);
  mocks.sendCode.mockResolvedValue(undefined);
  mocks.loginWithCode.mockResolvedValue(undefined);
  mocks.completeHostedPrivyAuth.mockResolvedValue({
    payload: {
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    },
    redirectUrl: "/home",
  });
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HostedAuthPanel resumes a phone-less Telegram Privy session without showing phone recovery", async () => {
  const privyUser = {
    linkedAccounts: [
      {
        id: "telegram-user-123",
        type: "telegram",
        username: "telegram_user",
      },
    ],
  };
  const refreshUser = vi.fn().mockResolvedValue(privyUser);
  const logout = vi.fn();

  mocks.usePrivy.mockReturnValue({
    authenticated: true,
    logout,
    ready: true,
  });
  mocks.useUser.mockReturnValue({
    refreshUser,
    user: privyUser,
  });

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  expect(container.textContent).toContain("Continue with Telegram");
  expect(container.textContent).toContain("You're signed in as @telegram_user.");
  expect(container.textContent).toContain("Use phone");
  expect(container.textContent).not.toContain("Sign in with this phone again");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeNull();

  const continueButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Continue",
  ) as HTMLButtonElement | undefined;

  await act(async () => {
    continueButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      authMethod: "telegram",
      completedUser: privyUser,
      user: privyUser,
    }),
  );
});

test("HostedAuthPanel keeps only one alternate auth method active at a time", async () => {
  mocks.loginWithTelegram.mockRejectedValue(new Error("Telegram popup closed"));

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  const [telegramButton, emailButton] = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];

  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-phone-auth-disable-signup="no"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-phone-auth-suppressed="no"]')).toBeTruthy();
  expect(container.querySelectorAll("[data-privy-captcha]").length).toBe(1);
  expect(telegramButton?.textContent).toContain("Telegram");
  expect(emailButton?.textContent).toContain("Email");
  expect(container.textContent).not.toContain("By continuing, you agree to our");

  await act(async () => {
    telegramButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('[data-hosted-phone-auth-suppressed="yes"]')).toBeTruthy();
  const telegramNotice = container.querySelector('[role="status"]');
  expect(telegramNotice?.textContent).toContain("Telegram sign-in was canceled");
  expect(telegramNotice?.className).toContain("text-muted-foreground");

  await act(async () => {
    emailButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('input[id="homepage-email-address"]')).toBeTruthy();

  await act(async () => {
    telegramButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(container.querySelector('input[id="homepage-email-address"]')).toBeNull();
});

test("HostedAuthPanel keeps split CTA presentation out of Privy auth behavior", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  expect(container.querySelector('[data-hosted-phone-auth-disable-signup="no"]')).toBeTruthy();

  const [telegramButton, emailButton] = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];

  await act(async () => {
    emailButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  const emailInput = container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = container.querySelector("form");

  await act(async () => {
    if (emailInput) {
      setInputValue(window, emailInput, " login@example.com ");
    }
    emailForm?.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });

  expect(mocks.sendCode).toHaveBeenCalledWith({
    email: "login@example.com",
  });

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.loginWithTelegram).toHaveBeenCalledWith(undefined);
});

test("HostedAuthPanel swaps to a finishing state while shared completion runs", async () => {
  mocks.completeHostedPrivyAuth.mockReturnValueOnce(new Promise(() => {}));

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  ) as HTMLButtonElement | undefined;

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("Finishing setup...");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeNull();
});

test("HostedAuthPanel surfaces shared completion failures and restores the auth methods", async () => {
  mocks.completeHostedPrivyAuth.mockRejectedValueOnce(
    new Error("Checkout did not return a redirect URL."),
  );

  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  ) as HTMLButtonElement | undefined;

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Checkout did not return a redirect URL.");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
});

test("HostedAuthPanel can require launch consent after homepage login completion", async () => {
  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  ) as HTMLButtonElement | undefined;

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.loginWithTelegram).toHaveBeenCalledWith(undefined);
  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Hosted legal consent card");
  expect(mocks.legalConsentCardProps).toMatchObject({
    mode: "compact",
    preferredScope: "launch.legal",
    source: "homepage-auth-dialog",
  });
});

test("HostedAuthPanel skips launch consent handoff when completion says launch consent is already granted", async () => {
  mocks.completeHostedPrivyAuth.mockResolvedValueOnce({
    payload: {
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      launchConsentGranted: true,
      stage: "active",
    },
    redirectUrl: "/home",
  });

  const { assign, cleanup, container, reload, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      requireLaunchConsentOnCompletion: true,
    }),
    {
      location: {
        hash: "#stale-auth-dialog-state",
        href: "https://join.example.test/home#stale-auth-dialog-state",
        origin: "https://join.example.test",
        pathname: "/home",
        search: "",
      },
    },
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  ) as HTMLButtonElement | undefined;

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(reload).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Hosted legal consent card");
  expect(mocks.legalConsentCardProps).toBeNull();
});

test("HostedAuthPanel shows launch consent after homepage signup auth before redirecting", async () => {
  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  ) as HTMLButtonElement | undefined;
  expect(telegramButton).toBeTruthy();

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Hosted legal consent card");
  expect(mocks.legalConsentCardProps).toMatchObject({
    mode: "compact",
    preferredScope: "launch.legal",
    source: "homepage-auth-dialog",
  });

  const continueButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Continue"),
  );
  await act(async () => {
    continueButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(assign).toHaveBeenCalledWith("/home");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeNull();
  expect(container.textContent).not.toContain("Hosted phone auth");
  expect(container.textContent).toContain("Hosted legal consent card");
});

test("HostedAuthPanel phone signup completion pauses on launch consent before redirecting", async () => {
  const onCompleted = vi.fn();
  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      onCompleted,
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  expect(mocks.hostedPhoneAuthProps?.onAuthCompleted).toBeTypeOf("function");

  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthCompleted?.({
      payload: {
        activationPending: false,
        inviteCode: "invite-code",
        joinUrl: "/join/invite-code",
        stage: "active",
      },
      redirectUrl: "/home",
    });
  });

  expect(assign).not.toHaveBeenCalled();
  expect(onCompleted).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Hosted legal consent card");
  expect(mocks.legalConsentCardProps).toMatchObject({
    mode: "compact",
    preferredScope: "launch.legal",
    source: "homepage-auth-dialog",
  });

  const continueButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Continue"),
  );
  await act(async () => {
    continueButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onCompleted).toHaveBeenCalledWith({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "/join/invite-code",
    stage: "active",
  });
  expect(onCompleted).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();

  await act(async () => {
    mocks.legalConsentCardProps?.onRequirementChange?.(false);
  });

  expect(onCompleted).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});

function setInputValue(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
) {
  const prototype = window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
