import type { ReactNode } from "react";

import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import { getHostedBrowserVaultPageAuthority } from "@/src/lib/hosted-onboarding/page-auth";

export default async function DashboardTemplate({
  children,
}: {
  children: ReactNode;
}) {
  const authority = await getHostedBrowserVaultPageAuthority();

  // Templates refresh their server result for each dashboard navigation. The
  // module warm store keeps the authorized decrypted client across remounts.
  return (
    <BrowserVaultProvider
      authorized={authority.authorized}
      memberId={authority.memberId}
    >
      {children}
    </BrowserVaultProvider>
  );
}
