import { createElement, useState } from "react";
import { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const PRIMARY_ADDRESS = "0x1111111111111111111111111111111111111111";

const mocks = vi.hoisted(() => ({
  createWallet: vi.fn(),
  initEnrollmentWithPasskey: vi.fn(),
  linkWithPasskey: vi.fn(),
  privy: {
    ready: false,
    user: null as unknown,
  },
  submitEnrollmentWithPasskey: vi.fn(),
  wallets: {
    ready: false,
    wallets: [] as unknown[],
  },
}));

vi.mock("@privy-io/react-auth", () => ({
  useCreateWallet: () => ({
    createWallet: mocks.createWallet,
  }),
  useLinkWithPasskey: () => ({
    linkWithPasskey: mocks.linkWithPasskey,
  }),
  useMfaEnrollment: () => ({
    initEnrollmentWithPasskey: mocks.initEnrollmentWithPasskey,
    submitEnrollmentWithPasskey: mocks.submitEnrollmentWithPasskey,
  }),
  usePrivy: () => ({
    ready: mocks.privy.ready,
    user: mocks.privy.user,
  }),
  useWallets: () => ({
    ready: mocks.wallets.ready,
    wallets: mocks.wallets.wallets,
  }),
}));

import { usePasskeyWalletMfa } from "@/src/components/sensitive-actions/use-passkey-wallet-mfa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.privy.ready = false;
  mocks.privy.user = null;
  mocks.wallets.ready = false;
  mocks.wallets.wallets = [];
});

test("keeps the first approval setup click alive while Privy finishes loading", async () => {
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(rendered.button.textContent).toBe("Loading secure approval…");
  expect(readResult(rendered.container)).toBe("idle");

  mocks.privy.ready = true;
  mocks.privy.user = configuredPrivyUser();
  mocks.wallets.ready = true;
  mocks.wallets.wallets = [connectedPrivyWallet(PRIMARY_ADDRESS)];
  await rendered.rerender(createElement(PasskeySetupHarness));

  await act(async () => {
    await delay(75);
  });

  expect(readResult(rendered.container)).toBe(`resolved:${PRIMARY_ADDRESS}`);
  expect(rendered.container.textContent).not.toContain("still loading");
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("waits for the matching connected embedded wallet before resolving the first click", async () => {
  mocks.privy.ready = true;
  mocks.privy.user = configuredPrivyUser();
  mocks.wallets.ready = false;
  mocks.wallets.wallets = [connectedPrivyWallet(PRIMARY_ADDRESS)];
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await act(async () => {
    await delay(75);
  });

  expect(rendered.button.textContent).toBe("Loading secure approval…");
  expect(readResult(rendered.container)).toBe("idle");

  mocks.wallets.ready = true;
  mocks.wallets.wallets = [
    {
      address: PRIMARY_ADDRESS,
      linked: true,
      walletClientType: "metamask",
    },
    {
      address: PRIMARY_ADDRESS,
      linked: false,
      walletClientType: "privy",
    },
    connectedPrivyWallet("0x2222222222222222222222222222222222222222"),
  ];
  await rendered.rerender(createElement(PasskeySetupHarness));

  await act(async () => {
    await delay(75);
  });

  expect(readResult(rendered.container)).toBe("idle");

  mocks.wallets.wallets = [connectedPrivyWallet(PRIMARY_ADDRESS.toUpperCase())];
  await rendered.rerender(createElement(PasskeySetupHarness));

  await act(async () => {
    await delay(75);
  });

  expect(readResult(rendered.container)).toBe(`resolved:${PRIMARY_ADDRESS}`);
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("times out the first approval setup click if Privy never finishes loading", async () => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness));

  try {
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    expect(rendered.button.textContent).toBe("Loading secure approval…");
    expect(readResult(rendered.container)).toBe("idle");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_050);
    });

    expect(readResult(rendered.container)).toBe(
      "error:Secure approval is still loading. Try again in a moment.",
    );
    expect(rendered.button.textContent).toBe("Start");
    expect(mocks.createWallet).not.toHaveBeenCalled();
    expect(mocks.linkWithPasskey).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

test("stops waiting when Privy finishes loading without an authenticated user", async () => {
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(rendered.button.textContent).toBe("Loading secure approval…");
  expect(readResult(rendered.container)).toBe("idle");

  mocks.privy.ready = true;
  mocks.privy.user = null;
  await rendered.rerender(createElement(PasskeySetupHarness));

  await act(async () => {
    await delay(75);
  });

  expect(readResult(rendered.container)).toBe(
    "error:Sign in on this device to continue.",
  );
  expect(rendered.button.textContent).toBe("Start");
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();

  await rendered.cleanup();
});

function PasskeySetupHarness() {
  const setup = usePasskeyWalletMfa();
  const [result, setResult] = useState("idle");

  return createElement(
    "div",
    null,
    createElement(
      "button",
      {
        onClick: () => {
          void setup.ensureConfigured()
            .then((wallet) => {
              setResult(`resolved:${wallet.address}`);
            })
            .catch((caught: unknown) => {
              setResult(caught instanceof Error ? `error:${caught.message}` : "error");
            });
        },
        type: "button",
      },
      setup.pendingLabel ?? "Start",
    ),
    createElement("p", { "data-result": "true" }, result),
  );
}

function configuredPrivyUser() {
  return {
    linkedAccounts: [
      {
        address: PRIMARY_ADDRESS,
        chainType: "ethereum",
        connectorType: "embedded",
        type: "wallet",
        walletClientType: "privy",
        walletIndex: 0,
      },
      {
        credentialId: "credential-a",
        type: "passkey",
      },
    ],
    mfaMethods: ["passkey"],
  };
}

function connectedPrivyWallet(address: string) {
  return {
    address,
    linked: true,
    walletClientType: "privy",
  };
}

function readResult(container: HTMLElement): string {
  return container.querySelector("[data-result='true']")?.textContent ?? "";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
