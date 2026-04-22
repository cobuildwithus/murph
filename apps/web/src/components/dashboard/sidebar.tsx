"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy, useUser } from "@privy-io/react-auth";
import { ChevronsUpDown } from "lucide-react";
import type { CSSProperties } from "react";

import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { cn } from "@/src/lib/utils";

const navItems = [
  { label: "Overview", href: "/overview" },
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
    <Link href="/overview" className="flex items-center gap-2.5 px-2 py-1">
      <div className="flex size-7 items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-white">
        M
      </div>
      <span className="font-serif text-sm font-semibold text-white">
        Murph
      </span>
    </Link>
  );
}

function OuraStatus() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <div className="size-2 rounded-full bg-green-400" />
      <span className="text-xs text-white/50">Oura connected</span>
    </div>
  );
}

function AccountMenu() {
  const { user } = useUser();
  const { logout } = usePrivy();

  const primaryLabel =
    user?.email?.address ?? user?.phone?.number ?? "Account";
  const initials = primaryLabel.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "M";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="text-white/80 hover:bg-white/5 hover:text-white data-popup-open:bg-white/5"
              />
            }
          >
            <Avatar className="size-7 border border-white/15">
              <AvatarFallback className="bg-white/5 text-[0.6875rem] font-medium text-white/80">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-xs leading-tight">
              <span className="truncate font-medium text-white/90">
                {primaryLabel}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-3.5 text-white/50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">
                {primaryLabel}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
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
      <SidebarHeader className="pt-7 pb-3">
        <BrandMark />
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarMenu className="gap-1">
          {navItems.map((item) => {
            const activePrefix = item.matchPrefix ?? item.href;
            const isActive =
              pathname === item.href ||
              (activePrefix !== "/overview" &&
                pathname.startsWith(activePrefix));

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

      <SidebarFooter className="gap-2 border-t border-white/10 pt-2">
        <OuraStatus />
        <AccountMenu />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
