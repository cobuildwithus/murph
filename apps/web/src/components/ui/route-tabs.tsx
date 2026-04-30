"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLAnchorElement | null>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const active = tabRefs.current.get(currentValue);
      if (active) {
        setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
      }
    };

    measure();

    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [currentValue, tabs]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative flex items-center", className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === currentValue;
        return (
          <Link
            key={tab.value}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.value, node);
              else tabRefs.current.delete(tab.value);
            }}
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
          </Link>
        );
      })}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -bottom-px h-[2px] bg-primary transition-[left,width] duration-300 ease-out [view-transition-name:route-tabs-indicator]",
          indicator ? "opacity-100" : "opacity-0",
        )}
        style={
          indicator
            ? { left: `${indicator.left}px`, width: `${indicator.width}px` }
            : undefined
        }
      />
    </div>
  );
}
