import { createElement, useState } from "react";
import { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"a".repeat(130)}` as `0x${string}`;

const mocks = vi.hoisted(() => ({
  ensureExistingFactor: vi.fn(),
  startAuthentication: vi.fn(),
  requestJson: vi.fn(),
  signMessage: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: mocks.startAuthentication }));

vi.mock("@privy-io/react-auth", () => ({
  useSignMessage: () => ({
    signMessage: mocks.signMessage,
  }),
}));

vi.mock("@/src/components/sensitive-actions/use-passkey-wallet-mfa", () => ({
  usePasskeyWalletMfa: () => ({
    ensureExistingFactor: mocks.ensureExistingFactor,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestJson,
}));

import { LegacyWalletApprovalProvider } from "@/src/components/sensitive-actions/legacy-wallet-approval-provider";
import { useSensitiveActionAuthorization } from "@/src/components/sensitive-actions/use-sensitive-action-authorization";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestJson.mockImplementation(async ({ url }: { url: string }) =>
    url.endsWith("/authenticate") ? { method: "wallet", privyUserId: "synthetic-legacy-user" } : { configured: false });
});

test("uses the hydrated signer when wallet setup finishes after the first click", async () => {
  const setup = deferred<{ address: string; walletIndex: number }>();
  const preHydrationSigner = vi.fn();
  const hydratedSigner = vi.fn().mockResolvedValue({ signature: SIGNATURE });
  mocks.ensureExistingFactor.mockReturnValue(setup.promise);
  mocks.signMessage = preHydrationSigner;
  const rendered = await renderClientComponent(createElement(LegacyWalletApprovalProvider, null, createElement(AuthorizationHarness, { version: 1 })));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  mocks.signMessage = hydratedSigner;
  await rendered.rerender(createElement(LegacyWalletApprovalProvider, null, createElement(AuthorizationHarness, { version: 2 })));

  await act(async () => {
    setup.resolve({ address: WALLET_ADDRESS, walletIndex: 0 });
    await setup.promise;
  });

  expect(mocks.ensureExistingFactor).toHaveBeenCalledWith("synthetic-legacy-user");
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
  mocks.ensureExistingFactor.mockResolvedValue({ address: WALLET_ADDRESS, walletIndex: 0 });
  mocks.signMessage = vi.fn(() => new Promise(() => {}));
  const rendered = await renderClientComponent(createElement(LegacyWalletApprovalProvider, null, createElement(AuthorizationHarness, { version: 1 })));

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

test("uses the first-party passkey without a legacy SDK provider", async () => {
  mocks.requestJson.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith("/authenticate")) return { method: "passkey", options: { challenge: "synthetic" } };
    throw new Error("Status temporarily unavailable");
  });
  mocks.startAuthentication.mockResolvedValue({ id: "synthetic-credential" });
  const rendered = await renderClientComponent(createElement(AuthorizationHarness, { version: 1 }));
  await act(async () => { rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
  expect(readResult(rendered.container)).toBe("resolved:passkey");
  expect(mocks.ensureExistingFactor).not.toHaveBeenCalled();
  expect(mocks.signMessage).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("does not fall back to a wallet after passkey cancellation", async () => {
  mocks.requestJson.mockResolvedValue({ method: "passkey", options: { challenge: "synthetic" }, configured: true });
  mocks.startAuthentication.mockRejectedValue(new Error("Passkey canceled"));
  const rendered = await renderClientComponent(createElement(AuthorizationHarness, { version: 1 }));
  await act(async () => { rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true })); });
  expect(readResult(rendered.container)).toBe("error:Passkey canceled");
  expect(mocks.ensureExistingFactor).not.toHaveBeenCalled();
  expect(mocks.signMessage).not.toHaveBeenCalled();
  await rendered.cleanup();
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
          }).then((proof) => {
            setResult(proof.method === "passkey" ? "resolved:passkey" : `resolved:${proof.signature}`);
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
