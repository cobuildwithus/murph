import type { ReactNode } from "react";

import { Sidebar } from "@/src/components/dashboard/sidebar";
import { SIDEBAR_BRAND_GRADIENT } from "@/src/components/dashboard/theme";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/src/components/ui/sidebar";
import { cn } from "@/src/lib/utils";

export function DashboardShell({
  children,
  padded = true,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <>
      <style>{`#global-footer { display: none; }`}</style>
      <SidebarProvider>
        <Sidebar />
        <SidebarInset className="bg-background">
          <header
            className={cn(
              "grid md:hidden grid-cols-[auto_1fr_auto] items-center px-4 py-3",
              SIDEBAR_BRAND_GRADIENT,
            )}
          >
            <SidebarTrigger className="text-white/80 hover:bg-white/5 hover:text-white" />
            <div className="flex justify-center">
              <img src="/logo-dark.svg" alt="Murph" className="h-5" />
            </div>
            <div className="size-7" aria-hidden="true" />
          </header>
          <main
            className={cn(
              "flex-1 overflow-y-auto",
              padded && "px-6 py-8 md:px-14 md:py-10",
            )}
          >
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}
