import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  completeHostedPrivyAuth: vi.fn(),
  hostedPhoneAuthProps: null as {
    autoSendPastedPhoneNumber?: boolean;
    interactionGated?: boolean;
    onAuthCancel?: () => void;
    onAuthQueue?: () => boolean;
    onAuthQueueCancel?: () => void;
    onAuthStart?: () => boolean;
    onAuthenticated?: (input: { authMethod: "phone" }) => Promise<void> | void;
    onCodeSent?: () => void;
    onCompleted?: (payload: unknown) => Promise<void> | void;
  } | null,
  loginWithCode: vi.fn(),
  loginWithTelegram: vi.fn(),
  legalConsentCardProps: null as {
    declinePending?: boolean;
    initialStatus?: unknown;
    mode?: string;
    onAccepted?: () => Promise<void> | void;
    onDecline?: () => void;
    onRequirementChange?: (required: boolean) => void;
    preferredScope?: string;
    source?: string;
  } | null,
  declineHostedLaunchConsent: vi.fn(),
  logoutHostedAppSession: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

const launchConsentStatus = {
  documents: [],
  generatedAt: "2026-07-29T12:00:00.000Z",
  launchGranted: false,
  launchScopes: [],
  ok: true,
  schema: "murph.hosted-consent-status.v1",
  scopes: [],
} as const;

vi.mock("@privy-io/react-auth", () => ({
  Captcha() {
    return createElement("div", { "data-privy-captcha": "mounted" });
  },
  useLoginWithEmail() {
    return {
      loginWithCode: mocks.loginWithCode,
      sendCode: mocks.sendCode,
      state: { status: "initial" },
    };
  },
  useLoginWithTelegram() {
    if (typeof window !== "undefined") {
      Reflect.set(window, "Telegram", {
        Login: {
          auth: () => {},
        },
      });
    }
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

vi.mock("@/src/components/hosted-onboarding/hosted-app-session-client", () => ({
  declineHostedLaunchConsent: mocks.declineHostedLaunchConsent,
  logoutHostedAppSession: mocks.logoutHostedAppSession,
}));

vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({
  HostedLegalConsentCard(props: {
    declinePending?: boolean;
    onAccepted?: () => Promise<void> | void;
    onDecline?: () => void;
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
      props.onDecline
        ? createElement(
            "button",
            {
              disabled: props.declinePending,
              type: "button",
              onClick: props.onDecline,
            },
            props.declinePending ? "Declining..." : "Decline",
          )
        : null,
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth(input: {
    autoSendPastedPhoneNumber?: boolean;
    disableSignup?: boolean;
    interactionGated?: boolean;
    onAuthCancel?: () => void;
    onAuthQueue?: () => boolean;
    onAuthQueueCancel?: () => void;
    onAuthStart?: () => boolean;
    onAuthenticated?: unknown;
    onCodeSent?: () => void;
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
  mocks.declineHostedLaunchConsent.mockImplementation(
    async ({ logoutPrivy }: { logoutPrivy?: () => Promise<void> | void }) => {
      await logoutPrivy?.();
    },
  );
  mocks.logoutHostedAppSession.mockImplementation(
    async ({ logoutPrivy }: { logoutPrivy?: () => Promise<void> | void }) => {
      await logoutPrivy?.();
    },
  );
  mocks.hostedPhoneAuthProps = null;
  mocks.legalConsentCardProps = null;
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: vi.fn(),
    ready: true,
  });
  mocks.useUser.mockReturnValue({
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
      launchConsentStatus,
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

test("HostedAuthPanel keeps a pre-ready method queued and dismissible until its provider call starts", async () => {
  const onPrivyWaitChange = vi.fn();
  const onViewChange = vi.fn();
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: vi.fn(),
    ready: false,
  });

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      onPrivyWaitChange,
      onViewChange,
    }),
  );
  cleanupRender = cleanup;

  const readAlternateButton = (label: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;

  expect(readAlternateButton("Telegram")?.disabled).toBe(false);
  expect(readAlternateButton("Email")?.disabled).toBe(false);
  expect(mocks.hostedPhoneAuthProps?.interactionGated).toBe(false);
  expect(onViewChange).toHaveBeenLastCalledWith("auth");

  let queued = false;
  await act(async () => {
    queued = mocks.hostedPhoneAuthProps?.onAuthQueue?.() ?? false;
  });

  expect(queued).toBe(true);
  expect(onPrivyWaitChange).toHaveBeenLastCalledWith("action");
  expect(onViewChange).toHaveBeenLastCalledWith("auth");
  expect(readAlternateButton("Telegram")?.disabled).toBe(true);
  expect(readAlternateButton("Email")?.disabled).toBe(true);
  expect(mocks.hostedPhoneAuthProps?.interactionGated).toBe(false);

  let started = false;
  await act(async () => {
    started = mocks.hostedPhoneAuthProps?.onAuthStart?.() ?? false;
  });

  expect(started).toBe(true);
  expect(onPrivyWaitChange).toHaveBeenLastCalledWith(null);
  expect(onViewChange).toHaveBeenLastCalledWith("auth-active");

  await act(async () => {
    mocks.hostedPhoneAuthProps?.onAuthCancel?.();
  });

  expect(onViewChange).toHaveBeenLastCalledWith("auth");
  expect(readAlternateButton("Telegram")?.disabled).toBe(false);
  expect(readAlternateButton("Email")?.disabled).toBe(false);
});

test("HostedAuthPanel gates a warm authenticated session until its user snapshot resolves", async () => {
  const onPrivyWaitChange = vi.fn();
  mocks.usePrivy.mockReturnValue({
    authenticated: true,
    logout: vi.fn(),
    ready: true,
  });
  mocks.useUser.mockReturnValue({ user: null });

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      onPrivyWaitChange,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("[data-privy-captcha]")).toBeNull();
  expect(onPrivyWaitChange).toHaveBeenLastCalledWith("session");
  expect(mocks.completeHostedPrivyAuth).not.toHaveBeenCalled();
});

test("HostedAuthPanel retires Telegram continuation when phone takes over", async () => {
  let privyReady = false;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated: false,
    logout: vi.fn(),
    ready: privyReady,
  }));
  const renderPanel = () => createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
  });
  const rendered = await renderClientComponent(renderPanel(), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;

  const readTelegramButton = () =>
    Array.from(rendered.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Telegram"),
    ) as HTMLButtonElement | undefined;
  const telegramButton = readTelegramButton();
  expect(telegramButton).toBeTruthy();

  await act(async () => {
    telegramButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(telegramButton?.textContent).toContain("Connecting...");
  expect(mocks.loginWithTelegram).not.toHaveBeenCalled();

  privyReady = true;
  await rendered.rerender(renderPanel());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(telegramButton?.textContent).toContain(
    "Continue with Telegram",
  );
  expect(rendered.container.textContent).toContain(
    "Telegram is ready. Continue to open sign in.",
  );

  let phoneStarted = false;
  await act(async () => {
    phoneStarted = mocks.hostedPhoneAuthProps?.onAuthStart?.() ?? false;
  });
  expect(phoneStarted).toBe(true);

  await act(async () => {
    mocks.hostedPhoneAuthProps?.onAuthCancel?.();
    await Promise.resolve();
  });

  expect(readTelegramButton()?.disabled).toBe(false);
  expect(readTelegramButton()?.textContent).toBe("Telegram");
  expect(rendered.container.textContent).not.toContain(
    "Telegram is ready. Continue to open sign in.",
  );
  expect(mocks.loginWithTelegram).not.toHaveBeenCalled();
});

test("HostedAuthPanel discards queued email when Privy hydrates an existing session", async () => {
  let authenticated = false;
  let ready = false;
  let user: { linkedAccounts?: unknown } | null = null;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated,
    logout: vi.fn(),
    ready,
  }));
  mocks.useUser.mockImplementation(() => ({ user }));
  const renderPanel = () => createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
  });
  const rendered = await renderClientComponent(renderPanel(), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;

  const emailButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.trim() === "Email");
  await act(async () => {
    emailButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const emailInput = rendered.container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  const emailForm = rendered.container.querySelector("form");
  await act(async () => {
    if (emailInput) {
      setInputValue(rendered.window, emailInput, "login@example.com");
    }
    emailForm?.dispatchEvent(
      new rendered.window.Event("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(mocks.sendCode).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Sending...");

  authenticated = true;
  ready = true;
  await rendered.rerender(renderPanel());

  expect(mocks.sendCode).not.toHaveBeenCalled();
  expect(rendered.container.textContent).not.toContain("Sending...");
  expect(rendered.container.querySelector("button")).toBeNull();

  user = {
    linkedAccounts: [
      {
        address: "login@example.com",
        latest_verified_at: 1741194420,
        type: "email",
      },
    ],
  };
  await rendered.rerender(renderPanel());

  expect(mocks.sendCode).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Continue with email");
  expect(rendered.container.textContent).toContain(
    "You're signed in as login@example.com.",
  );
  expect(rendered.container.textContent).not.toContain("Sending...");
});

test("HostedAuthPanel restores an existing email session over an unsubmitted pre-ready email selection", async () => {
  let authenticated = false;
  let ready = false;
  let user: { linkedAccounts?: unknown } | null = null;
  const onPrivyWaitChange = vi.fn();
  mocks.usePrivy.mockImplementation(() => ({
    authenticated,
    logout: vi.fn(),
    ready,
  }));
  mocks.useUser.mockImplementation(() => ({ user }));
  const renderPanel = () => createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
    onPrivyWaitChange,
  });
  const rendered = await renderClientComponent(renderPanel(), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;

  const emailButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.trim() === "Email");
  await act(async () => {
    emailButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  ready = true;
  await rendered.rerender(renderPanel());

  expect(
    rendered.container.querySelector('input[id="homepage-email-address"]'),
  ).toBeTruthy();

  authenticated = true;
  await rendered.rerender(renderPanel());

  expect(onPrivyWaitChange).toHaveBeenLastCalledWith("session");
  expect(rendered.container.querySelector("button")).toBeNull();
  expect(mocks.sendCode).not.toHaveBeenCalled();

  user = {
    linkedAccounts: [
      {
        address: "login@example.com",
        latest_verified_at: 1741194420,
        type: "email",
      },
    ],
  };
  await rendered.rerender(renderPanel());

  expect(onPrivyWaitChange).toHaveBeenLastCalledWith(null);
  const staleEmailInput = rendered.container.querySelector(
    'input[id="homepage-email-address"]',
  ) as HTMLInputElement | null;
  await act(async () => {
    if (staleEmailInput) {
      setInputValue(rendered.window, staleEmailInput, "login@example.com");
    }
  });

  const staleEmailForm = rendered.container.querySelector("form");
  await act(async () => {
    staleEmailForm?.dispatchEvent(
      new rendered.window.Event("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(mocks.sendCode).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Continue with email");
  expect(
    rendered.container.querySelector('input[id="homepage-email-address"]'),
  ).toBeNull();

  const continueButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.trim() === "Continue");
  await act(async () => {
    continueButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      authMethod: "email",
    }),
  );
});

test("HostedAuthPanel restores phone recovery once, then permits a deliberate email selection", async () => {
  let authenticated = false;
  let ready = false;
  let user: { linkedAccounts?: unknown } | null = null;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated,
    logout: vi.fn(),
    ready,
  }));
  mocks.useUser.mockImplementation(() => ({ user }));
  const renderPanel = () => createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
  });
  const rendered = await renderClientComponent(renderPanel(), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;

  const preReadyEmailButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.trim() === "Email");
  await act(async () => {
    preReadyEmailButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(
    rendered.container.querySelector('input[id="homepage-email-address"]'),
  ).toBeTruthy();

  authenticated = true;
  ready = true;
  user = {
    linkedAccounts: [
      {
        latest_verified_at: 1741194420,
        phone_number: "+14155552671",
        type: "phone",
      },
    ],
  };
  await rendered.rerender(renderPanel());

  expect(mocks.sendCode).not.toHaveBeenCalled();
  expect(
    rendered.container.querySelector('input[id="homepage-email-address"]'),
  ).toBeNull();
  expect(
    rendered.container
      .querySelector('[data-hosted-phone-auth="mounted"]')
      ?.getAttribute("data-hosted-phone-auth-suppressed"),
  ).toBe("no");

  const postHydrationEmailButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.trim() === "Email");
  await act(async () => {
    postHydrationEmailButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(
    rendered.container.querySelector('input[id="homepage-email-address"]'),
  ).toBeTruthy();
});

test("HostedAuthPanel discards queued Telegram when Privy hydrates an existing session", async () => {
  let authenticated = false;
  let ready = false;
  let user: { linkedAccounts?: unknown } | null = null;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated,
    logout: vi.fn(),
    ready,
  }));
  mocks.useUser.mockImplementation(() => ({ user }));
  const renderPanel = () => createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
  });
  const rendered = await renderClientComponent(renderPanel(), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;

  const telegramButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.trim() === "Telegram");
  await act(async () => {
    telegramButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.loginWithTelegram).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Connecting...");

  authenticated = true;
  ready = true;
  user = {
    linkedAccounts: [
      {
        id: "telegram-user-123",
        type: "telegram",
        username: "telegram_user",
      },
    ],
  };
  await rendered.rerender(renderPanel());

  expect(mocks.loginWithTelegram).not.toHaveBeenCalled();
  expect(rendered.container.textContent).toContain("Continue with Telegram");
  expect(rendered.container.textContent).toContain(
    "You're signed in as @telegram_user.",
  );
  expect(rendered.container.textContent).not.toContain("Telegram is ready.");
});

test("HostedAuthPanel restores phone session recovery after a queued alternate hydrates", async () => {
  let authenticated = false;
  let ready = false;
  let user: { linkedAccounts?: unknown } | null = null;
  mocks.usePrivy.mockImplementation(() => ({
    authenticated,
    logout: vi.fn(),
    ready,
  }));
  mocks.useUser.mockImplementation(() => ({ user }));
  const renderPanel = () => createElement(HostedAuthPanel, {
    methods: ["phone", "telegram", "email"],
  });
  const rendered = await renderClientComponent(renderPanel(), {
    requireButton: false,
  });
  cleanupRender = rendered.cleanup;

  const telegramButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent?.trim() === "Telegram");
  await act(async () => {
    telegramButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(
    rendered.container
      .querySelector('[data-hosted-phone-auth="mounted"]')
      ?.getAttribute("data-hosted-phone-auth-suppressed"),
  ).toBe("yes");

  authenticated = true;
  ready = true;
  user = {
    linkedAccounts: [
      {
        latest_verified_at: 1741194420,
        phone_number: "+14155552671",
        type: "phone",
      },
    ],
  };
  await rendered.rerender(renderPanel());

  expect(mocks.loginWithTelegram).not.toHaveBeenCalled();
  expect(
    rendered.container
      .querySelector('[data-hosted-phone-auth="mounted"]')
      ?.getAttribute("data-hosted-phone-auth-suppressed"),
  ).toBe("no");
  expect(rendered.container.textContent).not.toContain("Connecting...");
});

test("HostedAuthPanel keeps phone code entry mounted while an authenticated provider is not ready", async () => {
  let privyAuthenticated = false;
  let privyReady = true;
  const privyUser: {
    linkedAccounts?: unknown;
  } | null = null;
  let rerenderHarness: (() => void) | null = null;

  mocks.usePrivy.mockImplementation(() => ({
    authenticated: privyAuthenticated,
    logout: vi.fn(),
    ready: privyReady,
  }));
  mocks.useUser.mockImplementation(() => ({
    user: privyUser,
  }));

  function PanelHarness() {
    const [, setRenderVersion] = useState(0);
    rerenderHarness = () => setRenderVersion((version) => version + 1);

    return createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
    });
  }

  const { cleanup, container } = await renderClientComponent(
    createElement(PanelHarness),
  );
  cleanupRender = cleanup;

  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(mocks.hostedPhoneAuthProps?.autoSendPastedPhoneNumber).toBe(false);
  expect(mocks.hostedPhoneAuthProps?.onCodeSent).toBeTypeOf("function");

  await act(async () => {
    mocks.hostedPhoneAuthProps?.onCodeSent?.();
  });

  privyAuthenticated = true;
  privyReady = false;

  await act(async () => {
    rerenderHarness?.();
  });

  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(container.textContent).not.toContain(
    "Secure sign in is checking your existing session.",
  );
  expect(container.textContent).not.toContain("Continue with email");
});

test("HostedAuthPanel forwards an explicit homepage pasted-phone opt-in", async () => {
  const { cleanup } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      autoSendPastedPhoneNumber: true,
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  expect(mocks.hostedPhoneAuthProps?.autoSendPastedPhoneNumber).toBe(true);
});

test("HostedAuthPanel keeps a phone-less Telegram resume busy while completion is pending", async () => {
  mocks.completeHostedPrivyAuth.mockReturnValueOnce(new Promise(() => {}));

  const privyUser = {
    linkedAccounts: [
      {
        id: "telegram-user-123",
        type: "telegram",
        username: "telegram_user",
      },
    ],
  };
  const logout = vi.fn();

  mocks.usePrivy.mockReturnValue({
    authenticated: true,
    logout,
    ready: true,
  });
  mocks.useUser.mockReturnValue({
    user: privyUser,
  });

  const { cleanup, container } = await renderClientComponent(
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
    }),
  );

  const finishingButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Finishing..."),
  ) as HTMLButtonElement | undefined;
  const usePhoneButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Use phone",
  ) as HTMLButtonElement | undefined;

  expect(finishingButton).toBeTruthy();
  expect(finishingButton?.disabled).toBe(true);
  expect(finishingButton?.getAttribute("aria-busy")).toBe("true");
  expect(finishingButton?.querySelector('[data-slot="spinner"]')).toBeTruthy();
  expect(usePhoneButton?.disabled).toBe(true);
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

test("HostedAuthPanel keeps the email journey authoritative after requesting a code", async () => {
  let resolveEmailCodeRequest: (() => void) | null = null;
  mocks.sendCode.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      resolveEmailCodeRequest = resolve;
    }),
  );

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
  expect(telegramButton?.disabled).toBe(true);

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.loginWithTelegram).not.toHaveBeenCalled();

  await act(async () => {
    resolveEmailCodeRequest?.();
    await Promise.resolve();
  });

  expect(container.contains(telegramButton ?? null)).toBe(false);
});

test("HostedAuthPanel keeps auth mounted and puts completion progress on the active button", async () => {
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

  const pendingTelegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Finishing..."),
  ) as HTMLButtonElement | undefined;
  const pendingEmailButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Email",
  ) as HTMLButtonElement | undefined;

  expect(pendingTelegramButton).toBeTruthy();
  expect(pendingTelegramButton?.disabled).toBe(true);
  expect(pendingTelegramButton?.getAttribute("aria-busy")).toBe("true");
  expect(pendingTelegramButton?.querySelector('[data-slot="spinner"]')).toBeTruthy();
  expect(pendingEmailButton?.disabled).toBe(true);
  expect(container.textContent).not.toContain("Setting things up");
  expect(container.textContent).not.toContain("Keep this tab open");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(mocks.hostedPhoneAuthProps?.interactionGated).toBe(true);
});

test("HostedAuthPanel makes a started Telegram journey reject a late phone provider result", async () => {
  let resolveTelegramLogin: (() => void) | null = null;
  mocks.loginWithTelegram.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      resolveTelegramLogin = resolve;
    }),
  );

  const { cleanup, container, window } = await renderClientComponent(
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
    await Promise.resolve();
  });

  expect(mocks.loginWithTelegram).toHaveBeenCalledTimes(1);
  expect(mocks.hostedPhoneAuthProps?.interactionGated).toBe(true);

  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
    });
  });

  expect(mocks.completeHostedPrivyAuth).not.toHaveBeenCalled();

  await act(async () => {
    resolveTelegramLogin?.();
    await Promise.resolve();
    await Promise.resolve();
  });

  await vi.waitFor(() => {
    expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledTimes(1);
  });
  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledWith({
    authMethod: "telegram",
  });
  expect(container.textContent).toContain("Hosted legal consent card");
});

test("HostedAuthPanel makes a started phone request reject Telegram provider initiation", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  ) as HTMLButtonElement | undefined;

  let phoneJourneyStarted = false;
  await act(async () => {
    phoneJourneyStarted = mocks.hostedPhoneAuthProps?.onAuthStart?.() ?? false;
  });
  expect(phoneJourneyStarted).toBe(true);
  expect(telegramButton?.disabled).toBe(true);

  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.loginWithTelegram).not.toHaveBeenCalled();

  await act(async () => {
    mocks.hostedPhoneAuthProps?.onCodeSent?.();
  });
  expect(container.contains(telegramButton ?? null)).toBe(false);

  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
    });
  });

  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledTimes(1);
  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledWith({
    authMethod: "phone",
  });
  expect(container.textContent).toContain("Hosted legal consent card");
});

test("HostedAuthPanel locks every competing method while phone completion is pending", async () => {
  let resolveCompletion: (() => void) | null = null;
  mocks.completeHostedPrivyAuth.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveCompletion = () =>
        resolve({
          payload: {
            inviteCode: "invite-code",
            joinUrl: "/join/invite-code",
            stage: "active",
          },
          redirectUrl: "/home",
        });
    }),
  );

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    void mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
    });
    await Promise.resolve();
  });

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Telegram",
  ) as HTMLButtonElement | undefined;
  const emailButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Email",
  ) as HTMLButtonElement | undefined;

  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledWith({
    authMethod: "phone",
  });
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(mocks.hostedPhoneAuthProps?.interactionGated).toBe(false);
  expect(telegramButton?.disabled).toBe(true);
  expect(emailButton?.disabled).toBe(true);
  expect(container.textContent).not.toContain("Setting things up");

  await act(async () => {
    resolveCompletion?.();
    await Promise.resolve();
  });
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

  const recoveredTelegramButton = Array.from(
    container.querySelectorAll("button"),
  ).find(
    (candidate) => candidate.textContent?.trim() === "Telegram",
  ) as HTMLButtonElement | undefined;
  const recoveredEmailButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Email",
  ) as HTMLButtonElement | undefined;

  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Checkout did not return a redirect URL.");
  expect(container.textContent).not.toContain("Finishing...");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(mocks.hostedPhoneAuthProps?.interactionGated).toBe(false);
  expect(recoveredTelegramButton?.disabled).toBe(false);
  expect(recoveredEmailButton?.disabled).toBe(false);
});

test("HostedAuthPanel restores phone recovery and competing methods after phone completion fails", async () => {
  mocks.completeHostedPrivyAuth.mockRejectedValueOnce(
    new Error("Phone completion did not finish."),
  );

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
    }),
  );
  cleanupRender = cleanup;

  expect(mocks.hostedPhoneAuthProps?.onAuthenticated).toBeTypeOf("function");
  let completionError: unknown = null;

  await act(async () => {
    try {
      await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
        authMethod: "phone",
      });
    } catch (error) {
      completionError = error;
    }
  });

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Telegram",
  ) as HTMLButtonElement | undefined;
  const emailButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Email",
  ) as HTMLButtonElement | undefined;

  expect(completionError).toEqual(new Error("Phone completion did not finish."));
  expect(container.textContent).not.toContain("Phone completion did not finish.");
  expect(container.textContent).not.toContain("Setting things up");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  expect(mocks.hostedPhoneAuthProps?.interactionGated).toBe(false);
  expect(telegramButton?.disabled).toBe(false);
  expect(emailButton?.disabled).toBe(false);

  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
    });
  });

  expect(mocks.completeHostedPrivyAuth).toHaveBeenCalledTimes(2);
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
    initialStatus: launchConsentStatus,
    mode: "compact",
    preferredScope: "launch.legal",
    source: "homepage-auth-dialog",
  });
});

test("HostedAuthPanel records the launch decline and returns to auth", async () => {
  const logout = vi.fn().mockResolvedValue(undefined);
  const onViewChange = vi.fn();
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout,
    ready: true,
  });

  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      onViewChange,
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  );
  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  const declineButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Decline",
  );
  expect(declineButton).toBeTruthy();

  await act(async () => {
    declineButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(logout).toHaveBeenCalledTimes(1);
  expect(mocks.declineHostedLaunchConsent).toHaveBeenCalledWith({
    logoutPrivy: logout,
  });
  expect(mocks.logoutHostedAppSession).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Hosted legal consent card");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeTruthy();
  await vi.waitFor(() => {
    expect(onViewChange).toHaveBeenLastCalledWith("auth");
  });
});

test("HostedAuthPanel leaves the gate mounted and Decline usable when sign-out fails", async () => {
  const logout = vi.fn().mockResolvedValue(undefined);
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout,
    ready: true,
  });
  mocks.declineHostedLaunchConsent.mockRejectedValueOnce(
    new Error("Sign-out unavailable."),
  );

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  const telegramButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Telegram"),
  );
  await act(async () => {
    telegramButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  const firstDeclineButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Decline",
  );
  await act(async () => {
    firstDeclineButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Hosted legal consent card");
  });
  expect(container.textContent).not.toContain("Unable to sign out");
  const retryDeclineButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Decline",
  ) as HTMLButtonElement | undefined;
  expect(retryDeclineButton?.disabled).toBe(false);
  expect(logout).not.toHaveBeenCalled();

  await act(async () => {
    retryDeclineButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.declineHostedLaunchConsent).toHaveBeenCalledTimes(2);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Hosted legal consent card");
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
    initialStatus: launchConsentStatus,
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
  mocks.completeHostedPrivyAuth.mockResolvedValueOnce({
    payload: {
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    },
    redirectUrl: "/home",
  });
  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      onCompleted,
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  expect(mocks.hostedPhoneAuthProps?.onAuthenticated).toBeTypeOf("function");

  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
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
  expect(container.textContent).toContain("Hosted legal consent card");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeNull();

  await act(async () => {
    mocks.legalConsentCardProps?.onRequirementChange?.(false);
  });

  expect(onCompleted).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});

test("HostedAuthPanel keeps consent mounted through downstream completion retry", async () => {
  const onCompleted = vi.fn()
    .mockRejectedValueOnce(new Error("Could not finish sign in."))
    .mockResolvedValueOnce(undefined);
  mocks.completeHostedPrivyAuth.mockResolvedValueOnce({
    payload: {
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    },
    redirectUrl: "/home",
  });
  const { cleanup, container } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      onCompleted,
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
    });
  });

  await act(async () => {
    try {
      await mocks.legalConsentCardProps?.onAccepted?.();
    } catch {
      // The real consent card converts this rejection into its retryable error.
    }
  });

  expect(onCompleted).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Hosted legal consent card");

  await act(async () => {
    await mocks.legalConsentCardProps?.onAccepted?.();
  });

  expect(onCompleted).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Hosted legal consent card");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeNull();
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

test("HostedAuthPanel keeps Decline terminal when a late status result says consent is no longer required", async () => {
  const onCompleted = vi.fn();
  mocks.completeHostedPrivyAuth
    .mockResolvedValueOnce({
      payload: {
        activationPending: false,
        inviteCode: "invite-code",
        joinUrl: "/join/invite-code",
        stage: "active",
      },
      redirectUrl: "/home",
    })
    .mockResolvedValueOnce({
      payload: {
        activationPending: false,
        inviteCode: "second-invite-code",
        joinUrl: "/join/second-invite-code",
        stage: "active",
      },
      redirectUrl: "/home",
    });
  let releaseLogout: (() => void) | null = null;
  mocks.declineHostedLaunchConsent.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseLogout = () => resolve();
      }),
  );

  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HostedAuthPanel, {
      methods: ["phone", "telegram", "email"],
      onCompleted,
      requireLaunchConsentOnCompletion: true,
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
    });
  });

  expect(container.textContent).toContain("Hosted legal consent card");

  const declineButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Decline",
  );
  await act(async () => {
    declineButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.declineHostedLaunchConsent).toHaveBeenCalledTimes(1);

  // The status retry the member started before declining now resolves to a
  // fully granted status while the authoritative logout is still in flight.
  await act(async () => {
    mocks.legalConsentCardProps?.onRequirementChange?.(false);
  });

  expect(onCompleted).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();

  await act(async () => {
    releaseLogout?.();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onCompleted).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Hosted legal consent card");

  // The panel stays mounted and returns to auth after a successful decline, so
  // a member who changes their mind must be able to finish a fresh attempt.
  await act(async () => {
    await mocks.hostedPhoneAuthProps?.onAuthenticated?.({
      authMethod: "phone",
    });
  });

  expect(container.textContent).toContain("Hosted legal consent card");

  const secondContinueButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Continue"),
  );
  await act(async () => {
    secondContinueButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onCompleted).toHaveBeenCalledTimes(1);
  expect(onCompleted).toHaveBeenCalledWith({
    activationPending: false,
    inviteCode: "second-invite-code",
    joinUrl: "/join/second-invite-code",
    stage: "active",
  });
  expect(container.textContent).toContain("Hosted legal consent card");
  expect(container.querySelector('[data-hosted-phone-auth="mounted"]')).toBeNull();
});
