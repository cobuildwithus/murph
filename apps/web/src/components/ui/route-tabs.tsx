"use client";

import Link from "next/link";

import { cn } from "@/src/lib/utils";

export interface RouteTab {
  value: string;
  label: string;
  href: string;
}

interface RouteTabsProps {
  tabs: readonly RouteTab[];
  currentValue: string;
  className?: string;
  ariaLabel?: string;
}

export function RouteTabs({
  tabs,
  currentValue,
  className,
  ariaLabel,
}: RouteTabsProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("relative min-w-0 overflow-x-auto", className)}
    >
      <div className="flex min-w-max items-center">
        {tabs.map((tab) => {
          const isActive = tab.value === currentValue;
          return (
            <Link
              key={tab.value}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              data-tab-value={tab.value}
              data-active={isActive ? "" : undefined}
              className={cn(
                "relative inline-flex min-h-11 items-center justify-center whitespace-nowrap px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5",
                isActive
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-primary [view-transition-name:route-tabs-indicator]"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
