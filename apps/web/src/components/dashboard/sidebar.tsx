"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MenuIcon } from "lucide-react";

import { Sheet, SheetContent, SheetTrigger } from "@/src/components/ui/sheet";
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

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const activePrefix = item.matchPrefix ?? item.href;
        const isActive =
          pathname === item.href ||
          (activePrefix !== "/overview" && pathname.startsWith(activePrefix));

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-white/10 font-semibold text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white/80"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function BrandMark() {
  return (
    <Link href="/overview" className="flex items-center gap-2.5 px-2">
      <div className="flex size-7 items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-white">
        M
      </div>
      <span className="font-serif text-sm font-semibold text-white">
        Murph
      </span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <aside className="hidden md:flex w-[170px] shrink-0 flex-col justify-between bg-gradient-to-b from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-4 py-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-5">
            <BrandMark />
            <div className="h-px bg-white/10" />
          </div>
          <NavList pathname={pathname} />
        </div>

        <div className="flex items-center gap-2 px-3">
          <div className="size-2 rounded-full bg-green-400" />
          <span className="text-xs text-white/50">Oura connected</span>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <header className="flex md:hidden items-center justify-between bg-gradient-to-r from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-5 py-3.5">
          <BrandMark />
          <SheetTrigger
            render={
              <button
                type="button"
                aria-label="Open navigation"
                className="inline-flex size-9 items-center justify-center rounded-lg border border-white/15 text-white/80 transition-colors hover:bg-white/5"
              >
                <MenuIcon className="size-4" />
              </button>
            }
          />
        </header>
        <SheetContent
          side="left"
          className="w-[240px] border-r border-white/10 bg-gradient-to-b from-[#2d3436] via-[#3a2e24] to-[#2a1f16] p-5 text-white"
        >
          <div className="mt-6 flex flex-col gap-5">
            <NavList
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
