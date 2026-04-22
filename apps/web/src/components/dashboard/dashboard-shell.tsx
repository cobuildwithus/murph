import type { ReactNode } from "react";

import { Sidebar } from "@/src/components/dashboard/sidebar";
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
          <header className="flex md:hidden items-center gap-2 bg-linear-to-r from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-4 py-3">
            <SidebarTrigger className="text-white/80 hover:bg-white/5 hover:text-white" />
            <span className="font-serif text-sm font-semibold text-white">
              Murph
            </span>
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
