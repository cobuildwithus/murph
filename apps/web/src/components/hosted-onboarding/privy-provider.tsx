"use client";

import { PrivyProvider, usePrivy, useUser } from "@privy-io/react-auth";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import {
  HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE,
  HOSTED_PRIVY_EMBEDDED_WALLET_CREATE_ON_LOGIN,
  HOSTED_PRIVY_SHOW_WALLET_UIS,
  HOSTED_PRIVY_WALLET_CHAIN_APPEARANCE,
} from "@/src/lib/hosted-onboarding/privy-shared";
import {
  logHostedPrivySessionDebug,
  sanitizeHostedPrivyDebugPath,
  summarizeHostedPrivyLinkedAccounts,
} from "./privy-session-debug";

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
      <HostedPrivySessionDebugProbe />
      {input.children}
    </PrivyProvider>
  );
}

function HostedPrivySessionDebugProbe() {
  const pathname = usePathname();
  const { authenticated, ready } = usePrivy();
  const { user } = useUser();
  const accountSummary = summarizeHostedPrivyLinkedAccounts(user);
  const linkedAccountTypesKey = accountSummary.linkedAccountTypes.join(",");
  const route = pathname ? sanitizeHostedPrivyDebugPath(pathname) : null;
  const initialSnapshotRef = useRef({
    authenticated,
    linkedAccountCount: accountSummary.linkedAccountCount,
    linkedAccountTypes: accountSummary.linkedAccountTypes,
    ready,
    route,
  });

  useEffect(() => {
    const initialSnapshot = initialSnapshotRef.current;
    logHostedPrivySessionDebug("provider:mount", {
      authenticated: initialSnapshot.authenticated,
      linkedAccountCount: initialSnapshot.linkedAccountCount,
      linkedAccountTypes: initialSnapshot.linkedAccountTypes,
      ready: initialSnapshot.ready,
      route: initialSnapshot.route,
    });

    return () => {
      logHostedPrivySessionDebug("provider:unmount", {
        authenticated: initialSnapshot.authenticated,
        linkedAccountCount: initialSnapshot.linkedAccountCount,
        linkedAccountTypes: initialSnapshot.linkedAccountTypes,
        ready: initialSnapshot.ready,
        route: initialSnapshot.route,
      });
    };
  }, []);

  useEffect(() => {
    logHostedPrivySessionDebug("provider:state", {
      authenticated,
      hasUser: accountSummary.hasUser,
      linkedAccountCount: accountSummary.linkedAccountCount,
      linkedAccountTypes: linkedAccountTypesKey ? linkedAccountTypesKey.split(",") : [],
      ready,
      route,
    });
  }, [
    accountSummary.hasUser,
    accountSummary.linkedAccountCount,
    authenticated,
    linkedAccountTypesKey,
    ready,
    route,
  ]);

  return null;
}
