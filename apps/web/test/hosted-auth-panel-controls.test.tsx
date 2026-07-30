import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  completeHostedPrivyAuth: vi.fn(),
  isMobile: false,
  loginWithCode: vi.fn(),
  loginWithTelegram: vi.fn(),
  privyReady: false,
  sendCode: vi.fn(),
}));

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
  useLoginWithSms() {
    return {
      loginWithCode: mocks.loginWithCode,
      sendCode: mocks.sendCode,
    };
  },
  useLoginWithTelegram() {
    return {
      login: mocks.loginWithTelegram,
      state: { status: "initial" },
    };
  },
  usePrivy() {
    return {
      authenticated: false,
      logout: vi.fn(),
      ready: mocks.privyReady,
    };
  },
  useUser() {
    return {
      user: null,
    };
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-completion", () => ({
  completeHostedPrivyAuth: mocks.completeHostedPrivyAuth,
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: () => mocks.isMobile,
}));

import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isMobile = false;
  mocks.privyReady = false;
  mocks.loginWithCode.mockResolvedValue(undefined);
  mocks.loginWithTelegram.mockResolvedValue(undefined);
  mocks.sendCode.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("HostedAuthPanel releases the real phone controls at Telegram's trusted-click handoff", async () => {
  const renderPanel = () => createElement(HostedAuthPanelHarness);
  const rendered = await renderClientComponent(renderPanel(), {
    matchMedia: createDesktopMatchMedia(),
    requireButton: false,
  });

  try {
    const phoneInput = readPhoneInput(rendered.container);
    const countryTrigger = readCountryTrigger(rendered.container);
    const telegramButton = readButton(rendered.container, "Telegram");

    expect(phoneInput.disabled).toBe(false);
    expect(countryTrigger.disabled).toBe(false);
    expect(telegramButton.disabled).toBe(false);

    await act(async () => {
      telegramButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(readButton(rendered.container, "Connecting...").disabled).toBe(true);
    expect(phoneInput.disabled).toBe(true);
    expect(countryTrigger.disabled).toBe(true);
    expect(mocks.loginWithTelegram).not.toHaveBeenCalled();

    mocks.privyReady = true;
    installTelegramLoginWidget(rendered.window);
    await rendered.rerender(renderPanel());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const continueButton = readButton(rendered.container, "Continue");
    expect(continueButton.disabled).toBe(false);
    expect(continueButton.textContent).toContain("Continue with Telegram");
    expect(rendered.container.textContent).toContain(
      "Telegram is ready. Continue to open sign in.",
    );
    expect(phoneInput.disabled).toBe(false);
    expect(countryTrigger.disabled).toBe(false);
    expect(mocks.loginWithTelegram).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("HostedAuthPanel keeps real phone controls enabled for their own queued send", async () => {
  const renderPanel = () => createElement(HostedAuthPanelHarness);
  const rendered = await renderClientComponent(renderPanel(), {
    matchMedia: createDesktopMatchMedia(),
    requireButton: false,
  });

  try {
    const phoneInput = readPhoneInput(rendered.container);
    const countryTrigger = readCountryTrigger(rendered.container);
    const phoneForm = phoneInput.closest("form");
    expect(phoneForm).not.toBeNull();

    await act(async () => {
      setInputValue(rendered.window, phoneInput, "4155552671");
      phoneForm?.dispatchEvent(
        new rendered.window.Event("submit", {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(readButton(rendered.container, "Sending code...").disabled).toBe(true);
    expect(phoneInput.disabled).toBe(false);
    expect(countryTrigger.disabled).toBe(false);
    expect(mocks.sendCode).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("HostedAuthPanel disables the real mobile country trigger while Telegram waits", async () => {
  mocks.isMobile = true;
  const rendered = await renderClientComponent(
    createElement(HostedAuthPanelHarness),
    { requireButton: false },
  );

  try {
    const countryTrigger = readCountryTrigger(rendered.container);
    const telegramButton = readButton(rendered.container, "Telegram");
    expect(countryTrigger.disabled).toBe(false);

    await act(async () => {
      telegramButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(readButton(rendered.container, "Connecting...").disabled).toBe(true);
    expect(countryTrigger.disabled).toBe(true);
  } finally {
    await rendered.cleanup();
  }
});

function HostedAuthPanelHarness() {
  if (typeof window !== "undefined") {
    vi.stubGlobal("Element", window.Element);
    vi.stubGlobal("FormData", TestFormData);
  }

  return createElement(HostedAuthPanel, {
    methods: ["phone", "telegram"] as const,
  });
}

class TestFormData {
  readonly form: HTMLFormElement | undefined;

  constructor(form?: HTMLFormElement) {
    this.form = form;
  }

  get(name: string): string | null {
    const field = (
      this.form?.querySelector(`[name="${name}"]`)
      ?? document.querySelector(`[name="${name}"]`)
    );

    return field instanceof window.HTMLInputElement ? field.value : null;
  }
}

function readPhoneInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[name="phone-number"][type="tel"]',
  );
  expect(input).not.toBeNull();
  if (!input) throw new Error("Expected the real phone input.");
  return input;
}

function readCountryTrigger(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Country or region,"]',
  );
  expect(button).not.toBeNull();
  if (!button) throw new Error("Expected the real country trigger.");
  return button;
}

function readButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  if (!button) throw new Error(`Expected a button containing "${label}".`);
  return button;
}

function installTelegramLoginWidget(targetWindow: Window & typeof globalThis) {
  Reflect.set(targetWindow, "Telegram", {
    Login: {
      auth: vi.fn(),
    },
  });
}

function createDesktopMatchMedia(): typeof window.matchMedia {
  return vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

function setInputValue(
  targetWindow: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
) {
  const valueDescriptor = Object.getOwnPropertyDescriptor(
    targetWindow.HTMLInputElement.prototype,
    "value",
  );
  valueDescriptor?.set?.call(input, value);
  input.dispatchEvent(new targetWindow.Event("input", { bubbles: true }));
  input.dispatchEvent(new targetWindow.Event("change", { bubbles: true }));
}
