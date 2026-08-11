"use client";

import { SidebarPrimaryNavigation } from "@/src/components/dashboard/sidebar";
import { SidebarProvider } from "@/src/components/ui/sidebar";

export function DashboardSidebarStudy() {
  return (
    <div
      className="w-full max-w-72 overflow-hidden rounded-3xl bg-linear-to-br from-[#2d3436] via-[#3a2e24] to-[#2a1f16] p-4"
      data-design-component="dashboard-primary-navigation"
      id="dashboard-primary-navigation-component"
      inert
    >
      <SidebarProvider
        className="min-h-0 bg-transparent"
        style={
          {
            "--sidebar": "transparent",
            "--sidebar-foreground": "rgba(255, 255, 255, 0.85)",
            "--sidebar-accent": "rgba(255, 255, 255, 0.1)",
            "--sidebar-accent-foreground": "#ffffff",
            "--sidebar-ring": "rgba(255, 255, 255, 0.3)",
          } as React.CSSProperties
        }
      >
        <SidebarPrimaryNavigation pathname="/home" />
      </SidebarProvider>
    </div>
  );
}
