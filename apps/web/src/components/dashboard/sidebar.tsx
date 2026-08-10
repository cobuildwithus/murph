"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ChevronsUpDown,
  FlaskConical,
  Home,
  Leaf,
} from "lucide-react";
import {
  useEffect,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactElement,
} from "react";

import { BrandMark } from "@/src/components/ui/brand-mark";

import { logoutHostedAppSession } from "@/src/components/hosted-onboarding/hosted-app-session-client";
import { HostedPrivyLogout } from "@/src/components/hosted-onboarding/hosted-privy-logout";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  useSidebar,
} from "@/src/components/ui/sidebar";
import {
  anonymousHostedSidebarAuthSnapshot,
  type HostedSidebarAuthSnapshot,
} from "@/src/lib/hosted-onboarding/sidebar-auth";
import type {
  SidebarAccountStatus,
  SidebarAccountStatusTone,
  SidebarDeviceSyncStatusResponse,
} from "@/src/lib/device-sync/sidebar-status";
import { cn } from "@/src/lib/utils";
import {
  SIDEBAR_NAV_ICON_CLASS,
  SIDEBAR_NAV_ITEM_CLASS,
} from "./sidebar-nav-classes";

const navItems: {
  label: string;
  href: string;
  matchPrefix?: string;
  icon?: ElementType;
}[] = [
  { label: "Home", href: "/home", icon: Home },
  {
    label: "Environment",
    href: "/environment",
    matchPrefix: "/environment",
    icon: Leaf,
  },
  {
    label: "Biomarkers",
    href: "/biomarkers",
    matchPrefix: "/biomarkers",
    icon: Activity,
  },
  { label: "Experiments", href: "/experiments", icon: FlaskConical },
];

const sidebarThemeStyle = {
  "--sidebar": "transparent",
  "--sidebar-foreground": "rgba(255, 255, 255, 0.85)",
  "--sidebar-accent": "rgba(255, 255, 255, 0.1)",
  "--sidebar-accent-foreground": "#ffffff",
  "--sidebar-border": "rgba(255, 255, 255, 0.1)",
  "--sidebar-ring": "rgba(255, 255, 255, 0.3)",
} as CSSProperties;


function SidebarAuthActions() {
  const { openAuthDialog } = useAuth();

  return (
    <div className="-mx-2 border-t border-white/10 px-4 py-5">
      <div className="mb-4 flex flex-col gap-2">
        <p className="font-serif text-base font-medium leading-snug tracking-tight text-white">
          Experiments tailored to you
        </p>
        <p className="text-[13px] leading-relaxed text-white/60">
          See what actually works for you. Connect your health data and track your progress.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-9 w-full rounded-2xl bg-[#5a6e32] text-sm font-medium text-white hover:bg-[#7a8c6e]"
        onClick={openAuthDialog}
      >
        Log in or sign up
      </Button>
    </div>
  );
}

function AccountMenu({
  initialAuth,
}: {
  initialAuth: HostedSidebarAuthSnapshot;
}) {
  const router = useRouter();
  const [deviceSyncStatusState, setDeviceSyncStatusState] =
    useState<{ status: SidebarAccountStatus | null; userKey: string } | null>(null);
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [privyLogoutPending, setPrivyLogoutPending] = useState(false);
  const hasAccount = initialAuth.authenticated;
  const userKey = hasAccount ? "app-session" : null;

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

  if (!hasAccount) {
    return <SidebarAuthActions />;
  }

  async function handleSignOut() {
    if (signOutPending) {
      return;
    }

    setSignOutError(null);
    setSignOutPending(true);

    try {
      await logoutHostedAppSession();
      // The sidebar lives outside the Privy provider, so mount a one-shot
      // Privy logout island to clear the Privy client session before the
      // refresh; otherwise sign-out leaves a stale Privy session behind.
      setPrivyLogoutPending(true);
    } catch {
      setSignOutError("Sign out did not finish. Try again.");
      setSignOutPending(false);
    }
  }

  function handlePrivyLogoutDone() {
    setPrivyLogoutPending(false);
    setSignOutPending(false);
    router.refresh();
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  aria-label="Open user menu"
                  className="h-auto py-3 text-white/80 hover:bg-white/5 hover:text-white data-popup-open:bg-white/5 md:py-2"
                />
              }
            >
              <Avatar className="size-10 border border-white/15 md:size-8">
                <AvatarFallback className="bg-white/5 text-[0.6875rem] font-medium text-white/80">
                  M
                </AvatarFallback>
              </Avatar>
              {deviceSyncStatus ? (
                <div className="grid flex-1 text-left leading-tight">
                  <span className="flex items-center gap-1.5 text-[0.6875rem] text-white/50">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        accountStatusDotClass(deviceSyncStatus.tone),
                      )}
                    />
                    <span className="truncate">{deviceSyncStatus.message}</span>
                  </span>
                </div>
              ) : null}
              <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-white/50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="min-w-56">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link href="/connect" />}>
                  Devices
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/settings" />}>
                  Settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={signOutPending}
                  onClick={() => void handleSignOut()}
                >
                  {signOutPending ? "Signing out..." : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      {privyLogoutPending ? <HostedPrivyLogout onDone={handlePrivyLogoutDone} /> : null}
      {signOutError ? (
        <p
          className="mt-2 px-2 text-[0.6875rem] leading-snug text-[#f0c6b0]"
          role="alert"
        >
          {signOutError}
        </p>
      ) : null}
    </>
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

export function Sidebar({
  chatAction,
  initialAuth = anonymousHostedSidebarAuthSnapshot,
}: {
  chatAction?: ReactElement;
  initialAuth?: HostedSidebarAuthSnapshot;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <ShadcnSidebar
      collapsible="offcanvas"
      className={cn(
        "bg-linear-to-br from-[#2d3436] via-[#3a2e24] to-[#2a1f16]",
        "[&_[data-slot=sidebar-inner]]:bg-transparent",
        "group-data-[side=left]:[&_[data-slot=sidebar-container]]:border-r-0",
      )}
      style={sidebarThemeStyle}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 100% 30%, rgba(180, 130, 70, 0.15), transparent 60%)",
        }}
      />
      <SidebarHeader className="pt-7 pb-6">
        <BrandMark />
      </SidebarHeader>

      <SidebarContent className="justify-center px-2">
        <SidebarMenu className="mb-12 gap-3 md:gap-3">
          {navItems.map((item) => {
            const activePrefix = item.matchPrefix ?? item.href;
            const isActive =
              pathname === item.href || pathname.startsWith(activePrefix);
            const Icon = item.icon;

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={isActive}
                  size="lg"
                  className={SIDEBAR_NAV_ITEM_CLASS}
                  render={
                    <Link href={item.href}>
                      {Icon ? <Icon className={SIDEBAR_NAV_ICON_CLASS} /> : null}
                      {item.label}
                    </Link>
                  }
                />
              </SidebarMenuItem>
            );
          })}
          {chatAction}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="pb-4">
        <AccountMenu initialAuth={initialAuth} />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
