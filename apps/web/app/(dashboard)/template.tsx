import type { ReactNode } from "react";

import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";

export default function DashboardTemplate({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <BrowserVaultProvider>
      {children}
    </BrowserVaultProvider>
  );
}
