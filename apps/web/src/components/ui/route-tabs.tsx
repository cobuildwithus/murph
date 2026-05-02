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
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative flex items-center", className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === currentValue;
        return (
          <Link
            key={tab.value}
            href={tab.href}
            data-tab-value={tab.value}
            data-active={isActive ? "" : undefined}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "relative inline-flex items-center justify-center whitespace-nowrap px-3 py-2.5 text-sm transition-colors sm:px-5",
              isActive
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {isActive ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] bg-primary [view-transition-name:route-tabs-indicator]"
              />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
