import type { ReactNode } from "react";

import { HostedPrivyBoundary } from "@/src/components/hosted-onboarding/hosted-privy-boundary";
import { HostedPrivyResourceHints } from "@/src/components/hosted-onboarding/hosted-privy-resource-hints";
import { resolveHostedPrivyResourceHintOrigins } from "@/src/lib/hosted-onboarding/landing";

export default function JoinLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <HostedPrivyResourceHints origins={resolveHostedPrivyResourceHintOrigins()} />
      <HostedPrivyBoundary>{children}</HostedPrivyBoundary>
    </>
  );
}
