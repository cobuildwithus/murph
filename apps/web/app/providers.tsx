"use client";

import type { PropsWithChildren } from "react";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";

export function Providers({
  bypassPrivyProvider = false,
  children,
  privyAppId,
  privyClientId,
}: PropsWithChildren<{
  bypassPrivyProvider?: boolean;
  privyAppId?: string | null;
  privyClientId?: string | null;
}>) {
  if (bypassPrivyProvider || !privyAppId) {
    return children;
  }

  return (
    <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
      {children}
    </HostedPrivyProvider>
  );
}
