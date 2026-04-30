"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
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
        <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
          <Link
            href="/experiments"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Murph
          </Link>
          <span className="text-muted-foreground/60">→</span>
          <span className="text-muted-foreground">Biomarkers</span>
          <span className="text-muted-foreground/60">→</span>
          <span className="font-medium text-foreground">{biomarker.shortName}</span>
        </nav>

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

        <Tabs value={currentTab} className="w-full">
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          <div className="sticky top-0 z-20 -mx-6 flex items-center gap-4 bg-background/95 px-6 py-2 backdrop-blur-md md:-mx-14 md:px-14">
            <TabsList>
              <TabsTrigger
                value="overview"
                className="px-3 sm:px-5"
                nativeButton={false}
                render={<Link href={basePath} />}
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="research"
                className="px-3 sm:px-5"
                nativeButton={false}
                render={<Link href={`${basePath}/research`} />}
              >
                Research
              </TabsTrigger>
            </TabsList>
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
          <div className="pt-6">{children}</div>
        </Tabs>
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
