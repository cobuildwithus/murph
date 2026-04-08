"use client";

import type { PropsWithChildren } from "react";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";

export function Providers({
  children,
  privyAppId,
  privyClientId,
}: PropsWithChildren<{ privyAppId: string; privyClientId?: string | null }>) {
  return (
    <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
      {children}
    </HostedPrivyProvider>
  );
}
