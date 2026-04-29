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

  return (
    <BrowserVaultProvider>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 pt-8 pb-10 md:px-12 lg:px-16 lg:pt-10">
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

        <Tabs value={currentTab} className="w-full">
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          <div className="sticky top-0 z-20 -mx-6 flex items-center gap-4 bg-background/95 px-6 py-2 backdrop-blur-md md:-mx-12 md:px-12 lg:-mx-16 lg:px-16">
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
          <div className="pt-8">{children}</div>
        </Tabs>
      </div>
    </BrowserVaultProvider>
  );
}
