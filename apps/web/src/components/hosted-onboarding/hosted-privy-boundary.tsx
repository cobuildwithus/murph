import type { ReactNode } from "react";

import {
  requireHostedPrivyClientAppId,
  resolveHostedPrivyClientId,
} from "@/src/lib/hosted-onboarding/landing";

import { HostedPrivyProvider } from "./privy-provider";

export function HostedPrivyBoundary({ children, legacyApprovalRequired = true }: {
  children: ReactNode;
  legacyApprovalRequired?: boolean;
}) {
  if (!legacyApprovalRequired) return children;
  const privyAppId = requireHostedPrivyClientAppId();
  const privyClientId = resolveHostedPrivyClientId();

  return (
    <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
      {children}
    </HostedPrivyProvider>
  );
}
