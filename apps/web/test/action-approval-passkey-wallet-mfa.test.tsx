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
}));

import { usePasskeyWalletMfa } from "@/src/components/sensitive-actions/use-passkey-wallet-mfa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.privy.ready = false;
  mocks.privy.user = null;
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

function readResult(container: HTMLElement): string {
  return container.querySelector("[data-result='true']")?.textContent ?? "";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
