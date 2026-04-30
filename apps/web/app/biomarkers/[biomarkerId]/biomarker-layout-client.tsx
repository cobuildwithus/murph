"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { RouteTabs } from "@/src/components/ui/route-tabs";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

type BiomarkerDetailTab = "overview" | "research";

export function BiomarkerLayoutClient({
  biomarker,
  children,
}: {
  biomarker: BiomarkerPageModel;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [isTabsSticky, setIsTabsSticky] = useState(false);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsTabsSticky(!entry.isIntersecting),
      { rootMargin: "0px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const basePath = `/biomarkers/${biomarker.routeId}`;
  const currentTab: BiomarkerDetailTab = pathname === `${basePath}/research`
    ? "research"
    : "overview";

  const eyebrowParts = [
    biomarker.categories[0] ? formatCategoryEyebrow(biomarker.categories[0]) : null,
    biomarker.unit,
  ].filter((part): part is string => Boolean(part));

  return (
    <BrowserVaultProvider>
      <div className="flex flex-col gap-7">
        <div className="flex items-start justify-between gap-6">
          <div className="flex max-w-3xl flex-col gap-3.5">
            {eyebrowParts.length > 0 && (
              <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-5">
                {eyebrowParts.join(" · ")}
              </span>
            )}
            <h1 className="max-w-[24ch] font-serif text-3xl font-semibold tracking-tight text-foreground text-balance sm:text-[38px]">
              {biomarker.title}
            </h1>
            <p className="max-w-[56ch] text-[16px] text-muted-foreground text-pretty">
              {biomarker.summary}
            </p>
          </div>
          <Link
            href="/experiments"
            className="mt-1 inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
            All biomarkers
          </Link>
        </div>

        <div className="w-full">
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          <div className="sticky top-0 z-20 -mx-6 bg-background/95 px-6 backdrop-blur-md md:-mx-14 md:px-14">
            <div className="flex items-center gap-4 border-b border-border">
              <RouteTabs
                ariaLabel="Biomarker tabs"
                currentValue={currentTab}
                tabs={[
                  { value: "overview", label: "Overview", href: basePath },
                  { value: "research", label: "Research", href: `${basePath}/research` },
                ]}
              />
              <span
                aria-hidden={!isTabsSticky}
                className="ml-auto hidden min-w-0 truncate font-serif text-sm/5 font-semibold text-foreground transition-opacity duration-150 md:block md:text-base/6"
                style={{
                  opacity: isTabsSticky ? 1 : 0,
                  pointerEvents: isTabsSticky ? "auto" : "none",
                }}
              >
                {biomarker.title}
              </span>
            </div>
          </div>
          <div className="pt-6">{children}</div>
        </div>
      </div>
    </BrowserVaultProvider>
  );
}

function formatCategoryEyebrow(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join(" ");
}
