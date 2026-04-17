"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/src/lib/utils";

const navItems = [
  { label: "Overview", href: "/overview", icon: "◆" },
  { label: "Experiments", href: "/experiments", icon: "●" },
  { label: "Signals", href: "/signals", icon: "◇" },
  { label: "History", href: "/history", icon: "○" },
  { label: "Settings", href: "/settings", icon: "◈" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-[170px] shrink-0 flex-col justify-between bg-gradient-to-b from-[#2d3436] via-[#3a2e24] to-[#2a1f16] px-4 py-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-5">
          <Link href="/overview" className="flex items-center gap-2.5 px-2">
            <div className="flex size-7 items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-white">
              M
            </div>
            <span className="font-serif text-sm font-semibold text-white">
              Murph
            </span>
          </Link>
          <div className="h-px bg-white/10" />
        </div>

        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/overview" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-white/10 font-semibold text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white/80"
                )}
              >
                <span className="text-[10px]">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2 px-3">
        <div className="size-2 rounded-full bg-green-400" />
        <span className="text-xs text-white/50">Oura connected</span>
      </div>
    </aside>
  );
}
