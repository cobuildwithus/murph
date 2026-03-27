import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  privyProvider: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: mocks.privyProvider,
}));

vi.mock("@/src/lib/hosted-onboarding/landing", () => ({
  hasHostedPrivyClientConfig: () => true,
  resolveHostedPrivyClientAppId: () => "cm_app_123",
}));

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";

describe("HostedPrivyProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("configures automatic embedded wallet creation for users without wallets", () => {
    const element = HostedPrivyProvider({ children: null });

    expect(element.type).toBe(mocks.privyProvider);
    expect(element.props).toEqual(
      expect.objectContaining({
        appId: "cm_app_123",
        config: {
          appearance: {
            walletChainType: "ethereum-only",
          },
          embeddedWallets: {
            ethereum: {
              createOnLogin: "users-without-wallets",
            },
            showWalletUIs: false,
          },
        },
      }),
    );
  });
});
