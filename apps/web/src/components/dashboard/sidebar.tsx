"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy, useUser } from "@privy-io/react-auth";
import { ChevronsUpDown } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";
import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import type {
  SidebarAccountStatus,
  SidebarAccountStatusTone,
  SidebarDeviceSyncStatusResponse,
} from "@/src/lib/device-sync/sidebar-status";
import { cn } from "@/src/lib/utils";

const navItems = [
  {
    label: "Biomarkers",
    href: "/biomarkers/resting-heart-rate",
    matchPrefix: "/biomarkers",
  },
  { label: "Experiments", href: "/experiments" },
  { label: "Settings", href: "/settings" },
];

const sidebarThemeStyle = {
  "--sidebar": "transparent",
  "--sidebar-foreground": "rgba(255, 255, 255, 0.85)",
  "--sidebar-accent": "rgba(255, 255, 255, 0.1)",
  "--sidebar-accent-foreground": "#ffffff",
  "--sidebar-border": "rgba(255, 255, 255, 0.1)",
  "--sidebar-ring": "rgba(255, 255, 255, 0.3)",
} as CSSProperties;

function BrandMark() {
  return (
    <Link href="/experiments" className="flex items-center px-2 py-1">
      <Image
        src="/logo-dark.svg"
        alt="Murph"
        width={197}
        height={44}
        className="h-6 w-auto"
        priority
      />
    </Link>
  );
}

function SidebarAuthActions() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  return (
    <div className="-mx-2 border-t border-white/10 px-4 py-5">
      <div className="mb-4 flex flex-col gap-2">
        <p className="font-serif text-base font-medium leading-snug tracking-tight text-white">
          Experiments tailored to you
        </p>
        <p className="text-[13px] leading-relaxed text-white/60">
          Discover what actually makes you healthier. Connect your data and track your progress.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-9 w-full rounded-2xl bg-[#5a6e32] text-sm font-medium text-white hover:bg-[#7a8c6e]"
        onClick={() => setAuthDialogOpen(true)}
      >
        Log in or sign up
      </Button>
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-stone-900">
              Log in or sign up
            </DialogTitle>
            <DialogDescription>
              Discover what actually makes you healthier.
            </DialogDescription>
          </DialogHeader>
          {authDialogOpen ? (
            <HostedAuthPanel
              methods={["phone", "telegram", "email"]}
              showLegalNotice
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountMenu() {
  const { user } = useUser();
  const { logout } = usePrivy();
  const [deviceSyncStatusState, setDeviceSyncStatusState] =
    useState<{ status: SidebarAccountStatus | null; userKey: string } | null>(null);
  const userKey = user?.id ?? null;

  const primaryLabel =
    user?.email?.address ?? user?.phone?.number ?? "Account";
  const initials =
    primaryLabel.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "M";
  const deviceSyncStatus =
    deviceSyncStatusState?.userKey === userKey ? deviceSyncStatusState.status : null;

  useEffect(() => {
    if (!userKey) {
      return;
    }

    const activeUserKey = userKey;
    let cancelled = false;

    async function loadDeviceSyncStatus() {
      try {
        const response =
          await requestHostedOnboardingJson<SidebarDeviceSyncStatusResponse>({
            url: "/api/settings/device-sync/sidebar-status",
          });

        if (!cancelled) {
          setDeviceSyncStatusState({
            status: response.status,
            userKey: activeUserKey,
          });
        }
      } catch {
        if (!cancelled) {
          setDeviceSyncStatusState(null);
        }
      }
    }

    void loadDeviceSyncStatus();

    return () => {
      cancelled = true;
    };
  }, [userKey]);

  if (!user) {
    return <SidebarAuthActions />;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="h-auto py-2 text-white/80 hover:bg-white/5 hover:text-white data-popup-open:bg-white/5"
              />
            }
          >
            <Avatar className="size-8 border border-white/15">
              <AvatarFallback className="bg-white/5 text-[0.6875rem] font-medium text-white/80">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-xs font-medium text-white/90">
                {primaryLabel}
              </span>
              {deviceSyncStatus ? (
                <span className="mt-0.5 flex items-center gap-1.5 text-[0.6875rem] text-white/50">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      accountStatusDotClass(deviceSyncStatus.tone),
                    )}
                  />
                  <span className="truncate">{deviceSyncStatus.message}</span>
                </span>
              ) : null}
            </div>
            <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-white/50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-56">
            <DropdownMenuItem onClick={() => void logout()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function accountStatusDotClass(tone: SidebarAccountStatusTone): string {
  if (tone === "attention") {
    return "bg-[#c4a882]";
  }

  if (tone === "connected") {
    return "bg-[#7a8c6e]";
  }

  return "bg-white/30";
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <ShadcnSidebar
      collapsible="offcanvas"
      className={cn(
        "bg-linear-to-b from-[#2d3436] via-[#3a2e24] to-[#2a1f16]",
        "[&_[data-slot=sidebar-inner]]:bg-transparent",
        "group-data-[side=left]:[&_[data-slot=sidebar-container]]:border-r-0",
      )}
      style={sidebarThemeStyle}
    >
      <SidebarHeader className="pt-7 pb-6">
        <BrandMark />
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarMenu className="gap-1">
          {navItems.map((item) => {
            const activePrefix = item.matchPrefix ?? item.href;
            const isActive =
              pathname === item.href || pathname.startsWith(activePrefix);

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={isActive}
                  className={cn(
                    "rounded-lg text-white/60 hover:bg-white/5 hover:text-white/80",
                    "data-active:bg-white/10 data-active:text-white",
                  )}
                  render={<Link href={item.href}>{item.label}</Link>}
                />
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="pb-4">
        <AccountMenu />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
