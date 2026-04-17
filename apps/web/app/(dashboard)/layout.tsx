import type { ReactNode } from "react";

import { Sidebar } from "@/src/components/dashboard/sidebar";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <BrowserVaultProvider>
      <style>{`#global-footer { display: none; }`}</style>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-background px-6 py-8 md:px-14 md:py-10">
          {children}
        </main>
      </div>
    </BrowserVaultProvider>
  );
}
