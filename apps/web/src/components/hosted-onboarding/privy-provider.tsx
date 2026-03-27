"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

import { hasHostedPrivyClientConfig, resolveHostedPrivyClientAppId } from "@/src/lib/hosted-onboarding/landing";

const PRIVY_APP_ID = resolveHostedPrivyClientAppId() ?? "";

export { hasHostedPrivyClientConfig };

export function HostedPrivyProvider(input: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          walletChainType: "ethereum-only",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          showWalletUIs: false,
        },
      }}
    >
      {input.children}
    </PrivyProvider>
  );
}
