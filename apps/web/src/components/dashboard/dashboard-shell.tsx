import type { ReactNode } from "react";

import { Sidebar } from "@/src/components/dashboard/sidebar";
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
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <main
          className={cn(
            "flex-1 overflow-y-auto bg-background",
            padded && "px-6 py-8 md:px-14 md:py-10",
          )}
        >
          {children}
        </main>
      </div>
    </>
  );
}
