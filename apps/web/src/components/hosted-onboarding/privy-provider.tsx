"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export function HostedPrivyProvider(input: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={input.appId}
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
