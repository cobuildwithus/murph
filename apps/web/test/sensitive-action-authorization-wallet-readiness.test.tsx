import { createElement, useState } from "react";
import { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"a".repeat(130)}` as `0x${string}`;

const mocks = vi.hoisted(() => ({
  ensureConfigured: vi.fn(),
  signMessage: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useSignMessage: () => ({
    signMessage: mocks.signMessage,
  }),
}));

vi.mock("@/src/components/sensitive-actions/use-passkey-wallet-mfa", () => ({
  usePasskeyWalletMfa: () => ({
    ensureConfigured: mocks.ensureConfigured,
  }),
}));

import { useSensitiveActionAuthorization } from "@/src/components/sensitive-actions/use-sensitive-action-authorization";

beforeEach(() => {
  vi.clearAllMocks();
});

test("uses the hydrated signer when wallet setup finishes after the first click", async () => {
  const setup = deferred<{ address: string; walletIndex: number }>();
  const preHydrationSigner = vi.fn();
  const hydratedSigner = vi.fn().mockResolvedValue({ signature: SIGNATURE });
  mocks.ensureConfigured.mockReturnValue(setup.promise);
  mocks.signMessage = preHydrationSigner;
  const rendered = await renderClientComponent(createElement(AuthorizationHarness, { version: 1 }));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  mocks.signMessage = hydratedSigner;
  await rendered.rerender(createElement(AuthorizationHarness, { version: 2 }));

  await act(async () => {
    setup.resolve({ address: WALLET_ADDRESS, walletIndex: 0 });
    await setup.promise;
  });

  expect(preHydrationSigner).not.toHaveBeenCalled();
  expect(hydratedSigner).toHaveBeenCalledWith(
    { message: "Approve the requested action" },
    { address: WALLET_ADDRESS },
  );
  expect(readResult(rendered.container)).toBe(`resolved:${SIGNATURE}`);

  await rendered.cleanup();
});

test("times out a Privy signing request that never settles", async () => {
  vi.useFakeTimers();
  mocks.ensureConfigured.mockResolvedValue({ address: WALLET_ADDRESS, walletIndex: 0 });
  mocks.signMessage = vi.fn(() => new Promise(() => {}));
  const rendered = await renderClientComponent(createElement(AuthorizationHarness, { version: 1 }));

  try {
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(60_050);
    });

    expect(readResult(rendered.container)).toBe(
      "error:Secure approval timed out. Try again.",
    );
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

function AuthorizationHarness({ version }: { version: number }) {
  const authorization = useSensitiveActionAuthorization();
  const [result, setResult] = useState("idle");

  return createElement(
    "div",
    { "data-version": version },
    createElement(
      "button",
      {
        onClick: () => {
          void authorization.signChallenge({
            expiresAt: "2099-01-01T00:00:00.000Z",
            message: "Approve the requested action",
            token: "sac_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }).then(({ signature }) => {
            setResult(`resolved:${signature}`);
          }).catch((caught: unknown) => {
            setResult(caught instanceof Error ? `error:${caught.message}` : "error");
          });
        },
        type: "button",
      },
      "Approve",
    ),
    createElement("p", { "data-result": "true" }, result),
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function readResult(container: HTMLElement): string {
  return container.querySelector("[data-result='true']")?.textContent ?? "";
}
