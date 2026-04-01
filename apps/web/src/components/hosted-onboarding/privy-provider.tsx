"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

import {
  HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE,
  HOSTED_PRIVY_EMBEDDED_WALLET_CREATE_ON_LOGIN,
  HOSTED_PRIVY_SHOW_WALLET_UIS,
  HOSTED_PRIVY_WALLET_CHAIN_APPEARANCE,
} from "@/src/lib/hosted-onboarding/privy-shared";

export function HostedPrivyProvider(input: { appId: string; children: ReactNode; clientId?: string | null }) {
  return (
    <PrivyProvider
      appId={input.appId}
      {...(input.clientId ? { clientId: input.clientId } : {})}
      config={{
        appearance: {
          walletChainType: HOSTED_PRIVY_WALLET_CHAIN_APPEARANCE,
        },
        embeddedWallets: {
          [HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE]: {
            createOnLogin: HOSTED_PRIVY_EMBEDDED_WALLET_CREATE_ON_LOGIN,
          },
          showWalletUIs: HOSTED_PRIVY_SHOW_WALLET_UIS,
        },
      }}
    >
      {input.children}
    </PrivyProvider>
  );
}
