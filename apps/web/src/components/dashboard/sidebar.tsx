"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, ChevronsUpDown, FlaskConical, Home } from "lucide-react";
import {
  useEffect,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactElement,
} from "react";

import { logoutHostedAppSession } from "@/src/components/hosted-onboarding/hosted-app-session-client";
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

function BrandMark() {
  const r0 = { "--dot-delay": "0s", "--dot-scale": "1.12" } as CSSProperties;
  const r1 = { "--dot-delay": "0.08s", "--dot-scale": "1.08" } as CSSProperties;
  const r2 = { "--dot-delay": "0.16s", "--dot-scale": "1.12", "--dot-opacity": "0.4", "--dot-opacity-peak": "0.7" } as CSSProperties;
  const r3 = { "--dot-delay": "0.24s", "--dot-scale": "1.08", "--dot-opacity": "0.2", "--dot-opacity-peak": "0.55" } as CSSProperties;

  return (
    <Link href="/home" aria-label="Murph" className="group/brand flex items-center px-2 py-1">
      <svg fill="none" viewBox="0 0 197 44" xmlns="http://www.w3.org/2000/svg" className="h-6 w-auto">
        <g>
          {/* Ring 3 — outer */}
          <circle className="brand-dot" style={r3} cx="6.5" cy="5.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="16.5" cy="5.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="48.5" cy="5.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="58.5" cy="5.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="4.5" cy="15.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="14.5" cy="15.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="50.5" cy="15.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="60.5" cy="15.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="2" cy="27.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="63" cy="27.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="6.5" cy="38.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="16.5" cy="38.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="48.5" cy="38.5" fill="#5c6b4f" r="2"/>
          <circle className="brand-dot" style={r3} cx="58.5" cy="38.5" fill="#5c6b4f" r="2"/>
          {/* Ring 2 — mid */}
          <circle className="brand-dot" style={r2} cx="27" cy="5.5" fill="#c4956a" r="2.5"/>
          <circle className="brand-dot" style={r2} cx="38" cy="5.5" fill="#c4956a" r="2.5"/>
          <circle className="brand-dot" style={r2} cx="12.5" cy="27.5" fill="#c4956a" r="2.5"/>
          <circle className="brand-dot" style={r2} cx="52.5" cy="27.5" fill="#c4956a" r="2.5"/>
          <circle className="brand-dot" style={r2} cx="27" cy="38.5" fill="#c4956a" r="2.5"/>
          <circle className="brand-dot" style={r2} cx="38" cy="38.5" fill="#c4956a" r="2.5"/>
          {/* Ring 1 — inner */}
          <circle className="brand-dot" style={r1} cx="26" cy="15.5" fill="#a07a4e" r="3.5"/>
          <circle className="brand-dot" style={r1} cx="39" cy="15.5" fill="#a07a4e" r="3.5"/>
          {/* Ring 0 — center */}
          <circle className="brand-dot" style={r0} cx="25" cy="27.5" fill="#c4956a" r="4"/>
          <circle className="brand-dot" style={r0} cx="39.5" cy="27.5" fill="#c4956a" r="4.5"/>
        </g>
        <path d="m8.48-16.24v13.36q0 .56.16.81.16.25.49.38l.64.18q.58.23.58.72 0 .79-1.01.79h-6.95q-.5 0-.73-.2-.24-.2-.24-.54 0-.27.16-.46.15-.19.49-.31l.72-.18q.32-.13.48-.38.15-.25.15-.81v-10.31q0-.47-.13-.67-.14-.2-.45-.25l-.95-.07q-.32-.08-.47-.24-.14-.16-.14-.41 0-.31.17-.49.17-.18.66-.36l3.34-1.22q.69-.25 1.1-.36.42-.11.79-.11.56 0 .85.31.29.32.29.82zm.18 3.39-.72.63-.83-.85.7-.63q2.29-2.09 3.96-2.92 1.68-.84 3.17-.84 2.32 0 3.71 1.48 1.38 1.47 1.38 3.96v9.09q0 .59.18.85.17.26.51.39l.61.18q.56.25.56.72 0 .79-.99.79h-6.82q-1.01 0-1.01-.79 0-.49.56-.72l.68-.18q.36-.13.51-.4.16-.27.16-.84v-8.36q0-1.58-.75-2.36-.75-.79-2.04-.79-.81 0-1.7.38-.88.38-1.83 1.21zm11.54 0-.72.63-.81-.85.68-.63q2.23-2.01 3.83-2.89 1.59-.87 3.03-.87 2.21 0 3.45 1.48 1.23 1.49 1.48 3.96l1.01 9.09q.07.59.21.86.13.27.47.38l.63.18q.34.12.51.31.16.19.16.46 0 .34-.24.54-.23.2-.73.2h-7.02q-1.01 0-1.01-.79 0-.49.56-.72l.68-.18q.36-.13.54-.4.18-.27.13-.84l-.94-8.36q-.18-1.56-.8-2.35-.62-.8-1.85-.8-.72 0-1.53.41-.81.4-1.72 1.18zm27.81 10.26v-.88l-.17-.08v-9.64q0-.45-.13-.66-.14-.21-.44-.26l-.96-.07q-.32-.08-.46-.24-.15-.16-.15-.41 0-.29.17-.48.17-.19.66-.35l3.35-1.22q.68-.26 1.1-.37.43-.12.79-.12.56 0 .85.31.3.32.3.84v13.34q0 .56.15.82.16.26.48.37l.68.18q.35.11.51.29.16.19.16.48 0 .34-.23.54-.24.2-.76.2h-3.62q-.97 0-1.63-.73-.65-.73-.65-1.86zm-11.51-2.41v-8.19q0-.45-.14-.66-.14-.21-.45-.26l-.95-.07q-.33-.08-.47-.24-.15-.16-.15-.41 0-.29.18-.48.18-.19.65-.35l3.37-1.22q.7-.27 1.11-.38.42-.11.72-.11.6 0 .9.31.29.32.29.84v10.48q0 1.58.76 2.36.75.79 2.05.79.79 0 1.69-.39.9-.39 1.86-1.2l.72-.63.82.85-.7.63q-2.27 2.09-3.96 2.93-1.69.85-3.18.85-2.31 0-3.71-1.49-1.41-1.48-1.41-3.96zm27.24-4.63-.63.09q0-2.61.74-4.37.73-1.77 1.94-2.66 1.21-.89 2.59-.89 1.71 0 2.65.97.93.97.93 2.79 0 1.62-.66 2.41-.67.8-1.73.8-1.08 0-1.64-.58-.56-.58-.56-1.6v-.65q-.01-.58-.27-.86-.25-.27-.82-.27-.63 0-1.22.52-.58.52-.95 1.58-.37 1.06-.37 2.72zm-.29-6.59.29 4.09v9.23q0 .52.21.77.2.24.74.33l1.55.23q.41.08.62.27.21.2.21.54 0 .36-.26.56-.26.2-.75.2h-8.41q-.5 0-.73-.2-.24-.2-.24-.54 0-.27.16-.46.17-.19.51-.31l.7-.18q.32-.11.48-.37.15-.26.15-.82v-10.28q0-.47-.13-.66-.14-.2-.45-.26l-.95-.07q-.32-.07-.47-.23-.14-.16-.14-.42 0-.3.18-.48.18-.18.65-.36l3.27-1.19q.88-.34 1.3-.44.41-.1.65-.1.39 0 .59.26.2.26.27.89zm16.2-.02v2.02l.22.43v19.3q0 .56.15.82.15.26.48.35l.95.2q.36.1.52.29.16.19.16.48 0 .34-.24.54-.24.2-.76.2h-7.37q-.5 0-.73-.2-.24-.2-.24-.54 0-.27.16-.46.17-.19.51-.31l.7-.18q.32-.11.48-.37.15-.26.15-.82v-18.72q0-.45-.13-.65-.14-.2-.45-.25l-.95-.07q-.32-.08-.47-.24-.14-.16-.14-.41 0-.31.17-.47.17-.16.66-.36l3.15-1.24q.64-.27 1.07-.37.42-.1.74-.1.62 0 .91.31.3.32.3.82zm-.83 4.52-.79-1.02q1.42-2.24 3.28-3.48 1.85-1.24 4.12-1.24 2.12 0 3.8 1.08 1.67 1.08 2.63 3 .97 1.91.97 4.42 0 2.86-1.15 4.97-1.14 2.12-3.1 3.28-1.96 1.16-4.39 1.16-2.15 0-3.8-1.01-1.66-1.01-2.74-2.91l1.24-1.05q.89 1.48 1.99 2.2 1.11.72 2.39.72 1.24 0 2.2-.72.97-.72 1.52-2.24.56-1.52.56-3.86 0-2.2-.54-3.64-.54-1.44-1.48-2.15-.95-.71-2.15-.71-1.3 0-2.44.78-1.15.78-2.12 2.42zm22.84-13.89v22.73q0 .56.17.81.16.25.48.38l.65.18q.58.23.58.72 0 .79-1.01.79h-6.95q-.5 0-.74-.2-.23-.2-.23-.54 0-.27.15-.46.15-.19.51-.31l.71-.18q.32-.13.47-.38.16-.25.16-.81v-19.71q0-.45-.14-.65-.13-.2-.44-.25l-.95-.07q-.33-.09-.47-.25-.15-.17-.15-.42 0-.29.18-.47.17-.18.65-.36l3.35-1.22q.68-.25 1.1-.37.41-.12.79-.12.56 0 .85.32.28.31.28.84zm.18 12.76-.72.63-.82-.85.7-.63q2.27-2.03 3.89-2.9 1.62-.86 3.07-.86 2.22 0 3.44 1.48 1.23 1.49 1.5 3.96l1 9.09q.06.59.2.86.15.27.49.38l.63.18q.34.12.5.31.16.19.16.46 0 .34-.23.54-.23.2-.76.2h-7.02q-.99 0-.99-.79 0-.49.56-.72l.69-.18q.34-.13.53-.4.19-.27.11-.84l-.93-8.36q-.18-1.56-.8-2.35-.62-.8-1.83-.8-.76 0-1.59.4-.84.4-1.78 1.19z" fill="#faf8f4" transform="translate(81 35.2)"/>
      </svg>
    </Link>
  );
}

function SidebarAuthActions() {
  const { openAuthDialog } = useAuth();

  return (
    <div className="-mx-2 border-t border-white/10 px-4 py-5">
      <div className="mb-4 flex flex-col gap-2">
        <p className="font-serif text-base font-medium leading-snug tracking-tight text-white">
          Experiments tailored to you
        </p>
        <p className="text-[13px] leading-relaxed text-white/60">
          Discover what actually makes you healthier. Sync your signals and track your progress.
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
      router.refresh();
    } catch {
      setSignOutError("Sign out did not finish. Try again.");
    } finally {
      setSignOutPending(false);
    }
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
