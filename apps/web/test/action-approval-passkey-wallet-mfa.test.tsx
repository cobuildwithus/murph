import { createElement, useState } from "react";
import { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const PRIMARY_ADDRESS = "0x1111111111111111111111111111111111111111";

const mocks = vi.hoisted(() => ({
  createWallet: vi.fn(),
  loginWithPasskey: vi.fn(),
  login: vi.fn(),
  setupUser: vi.fn(),
  logout: vi.fn(),
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
  useLoginWithPasskey: () => ({ loginWithPasskey: mocks.loginWithPasskey }),
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
    logout: mocks.logout,
    login: mocks.login,
    user: mocks.privy.user,
  }),
  useWallets: () => ({
    ready: mocks.wallets.ready,
    wallets: mocks.wallets.wallets,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({ requestHostedOnboardingJson: mocks.setupUser }));

import { usePasskeyWalletMfa } from "@/src/components/sensitive-actions/use-passkey-wallet-mfa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setupUser.mockResolvedValue({ legacyUserId: "synthetic-legacy-user" });
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

function PasskeySetupHarness({ expectedUserId }: { expectedUserId?: string }) {
  const setup = usePasskeyWalletMfa();
  const [result, setResult] = useState("idle");

  return createElement(
    "div",
    null,
    createElement(
      "button",
      {
        onClick: () => {
          void (expectedUserId ? setup.ensureExistingFactor(expectedUserId) : setup.ensureConfigured())
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
    id: "synthetic-legacy-user",
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


test("legacy migration restores the existing passkey without creating new factor state", async () => {
  mocks.privy.ready = true;
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness, { expectedUserId: "synthetic-legacy-user" }));
  await act(async () => { rendered.button.click(); });
  expect(mocks.loginWithPasskey).toHaveBeenCalledOnce();
  mocks.privy.user = configuredPrivyUser();
  mocks.wallets.ready = true;
  mocks.wallets.wallets = [connectedPrivyWallet(PRIMARY_ADDRESS)];
  await rendered.rerender(createElement(PasskeySetupHarness, { expectedUserId: "synthetic-legacy-user" }));
  await act(async () => { await delay(75); });
  expect(readResult(rendered.container)).toBe(`resolved:${PRIMARY_ADDRESS}`);
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();
  expect(mocks.initEnrollmentWithPasskey).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("a different restored account cannot provide the requested legacy factor", async () => {
  mocks.privy.ready = true;
  mocks.privy.user = { ...configuredPrivyUser(), id: "synthetic-other-user" };
  mocks.loginWithPasskey.mockRejectedValueOnce(new Error("Passkey canceled"));
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness, { expectedUserId: "synthetic-legacy-user" }));
  await act(async () => { rendered.button.click(); });
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(readResult(rendered.container)).toBe("error:Passkey canceled");
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("a missing legacy factor is never silently created during migration", async () => {
  mocks.privy.ready = true;
  mocks.privy.user = { id: "synthetic-legacy-user", linkedAccounts: [], mfaMethods: [] };
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness, { expectedUserId: "synthetic-legacy-user" }));
  await act(async () => { rendered.button.click(); });
  expect(readResult(rendered.container)).toContain("existing secure approval could not be verified");
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();
  expect(mocks.initEnrollmentWithPasskey).not.toHaveBeenCalled();
  await rendered.cleanup();
});


test("legacy restoration rechecks account identity after wallet hydration", async () => {
  mocks.privy.ready = true;
  mocks.privy.user = configuredPrivyUser();
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness, { expectedUserId: "synthetic-legacy-user" }));
  await act(async () => { rendered.button.click(); });
  mocks.privy.user = { ...configuredPrivyUser(), id: "synthetic-other-user" };
  mocks.wallets.ready = true;
  mocks.wallets.wallets = [connectedPrivyWallet(PRIMARY_ADDRESS)];
  await rendered.rerender(createElement(PasskeySetupHarness, { expectedUserId: "synthetic-legacy-user" }));
  await act(async () => { await delay(75); });
  expect(readResult(rendered.container)).toBe("error:Your secure approval account changed. Try again.");
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();
  await rendered.cleanup();
});


function LegacySetupLoginHarness() {
  const setup = usePasskeyWalletMfa();
  return createElement("div", null,
    createElement("button", { onClick: () => void setup.loginForSetup() }, "Verify existing sign-in"),
    createElement("p", { "data-result": "true" }, setup.error ?? "idle"),
  );
}

test("legacy setup opens only its SDK login after reading the current Murph binding", async () => {
  mocks.privy.ready = true;
  mocks.privy.user = { ...configuredPrivyUser(), id: "synthetic-other-user" };
  const rendered = await renderClientComponent(createElement(LegacySetupLoginHarness));
  await act(async () => { rendered.button.click(); });
  expect(mocks.setupUser).toHaveBeenCalledWith({ url: "/api/settings/approval-passkeys" });
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(mocks.login).toHaveBeenCalledWith({ loginMethods: ["email", "sms", "telegram", "passkey"] });
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("first-party factor ownership prevents legacy setup login", async () => {
  mocks.privy.ready = true;
  mocks.setupUser.mockResolvedValueOnce({ legacyUserId: null });
  const rendered = await renderClientComponent(createElement(LegacySetupLoginHarness));
  await act(async () => { rendered.button.click(); });
  expect(readResult(rendered.container)).toContain("Use your current Murph passkey settings");
  expect(mocks.login).not.toHaveBeenCalled();
  expect(mocks.logout).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("legacy setup rejects a different SDK account before creating any factor state", async () => {
  mocks.privy.ready = true;
  mocks.privy.user = { id: "synthetic-other-user", linkedAccounts: [], mfaMethods: [] };
  const rendered = await renderClientComponent(createElement(PasskeySetupHarness));
  await act(async () => { rendered.button.click(); });
  expect(readResult(rendered.container)).toContain("Use the same account as your Murph sign-in");
  expect(mocks.linkWithPasskey).not.toHaveBeenCalled();
  expect(mocks.createWallet).not.toHaveBeenCalled();
  expect(mocks.initEnrollmentWithPasskey).not.toHaveBeenCalled();
  await rendered.cleanup();
});
