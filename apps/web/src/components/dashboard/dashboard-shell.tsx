import { Suspense, type ReactNode } from "react";
import Image from "next/image";

import { DashboardOnboardingRecoveryRedirect } from "@/src/components/dashboard/dashboard-onboarding-recovery";
import { Sidebar } from "@/src/components/dashboard/sidebar";
import {
  SidebarChatWithMurphAction,
  SidebarChatWithMurphFallback,
} from "@/src/components/dashboard/sidebar-chat-action";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/src/components/ui/sidebar";
import type { HostedSidebarAuthSnapshot } from "@/src/lib/hosted-onboarding/sidebar-auth";
import { cn } from "@/src/lib/utils";

export function DashboardShell({
  children,
  padded = true,
  sidebarAuth,
}: {
  children: ReactNode;
  padded?: boolean;
  sidebarAuth?: HostedSidebarAuthSnapshot;
}) {
  const requiresDashboardRecovery = sidebarAuth?.requiresDashboardRecovery === true;
  const recoveryRedirect = (
    <DashboardOnboardingRecoveryRedirect enabled={requiresDashboardRecovery} />
  );

  return (
    <SidebarProvider>
      <Sidebar
        initialAuth={sidebarAuth}
        chatAction={(
          <Suspense fallback={<SidebarChatWithMurphFallback />}>
            <SidebarChatWithMurphAction />
          </Suspense>
        )}
      />
      <SidebarInset className="bg-background">
        <header className="grid lg:hidden grid-cols-[auto_1fr_auto] items-center bg-linear-to-b from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-4 py-3">
          <SidebarTrigger className="text-white/80 hover:bg-white/5 hover:text-white" />
          <div className="flex justify-center">
            <Image
              src="/logo-dark.svg"
              alt="Murph"
              width={197}
              height={44}
              className="h-5 w-auto"
              preload
            />
          </div>
          <div className="size-7" aria-hidden="true" />
        </header>
        <main
          className={cn(
            "flex-1",
            padded && "px-4 py-8 md:px-14 md:py-10",
          )}
        >
          {requiresDashboardRecovery ? recoveryRedirect : children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
