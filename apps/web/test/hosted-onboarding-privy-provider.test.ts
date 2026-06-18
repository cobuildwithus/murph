import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  privyProvider: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: mocks.privyProvider,
}));

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";

describe("HostedPrivyProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps embedded wallet creation off during auth", () => {
    const element = HostedPrivyProvider({ appId: "cm_app_123", children: null });

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
              createOnLogin: "off",
            },
            showWalletUIs: false,
          },
        },
      }),
    );
  });
});
