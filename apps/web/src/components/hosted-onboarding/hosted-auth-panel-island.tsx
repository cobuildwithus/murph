"use client";

import type { ComponentProps } from "react";

import { HostedAuthPanel } from "./hosted-auth-panel";
import { HostedPrivyProvider } from "./privy-provider";

type HostedAuthPanelIslandProps = ComponentProps<typeof HostedAuthPanel>;

export function HostedAuthPanelIsland(props: HostedAuthPanelIslandProps) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  if (!appId) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        Sign in is not configured yet.
      </div>
    );
  }

  return (
    <HostedPrivyProvider appId={appId} clientId={clientId}>
      <HostedAuthPanel {...props} />
    </HostedPrivyProvider>
  );
}
