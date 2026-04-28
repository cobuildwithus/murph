"use client";

import type { ReactNode } from "react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { ExperimentHero } from "@/src/components/experiments/experiment-detail/experiment-hero";
import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import {
  composeExperimentDetail,
  hasCurrentExperimentProtocolContract,
} from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";

type ExperimentDetailTab = "protocol" | "research" | "results";

export function ExperimentLayoutClient({
  protocol,
  children,
}: {
  protocol: ExperimentProtocol;
  children: ReactNode;
}) {
  return (
    <BrowserVaultProvider>
      <ExperimentLayoutInner protocol={protocol}>{children}</ExperimentLayoutInner>
    </BrowserVaultProvider>
  );
}

function ExperimentLayoutInner({
  protocol,
  children,
}: {
  protocol: ExperimentProtocol;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const browserVault = useBrowserVault();
  const hasCurrentProtocolContract = hasCurrentExperimentProtocolContract(protocol);

  useEffect(() => {
    if (!hasCurrentProtocolContract) {
      startTransition(() => {
        router.refresh();
      });
    }
  }, [hasCurrentProtocolContract, router]);

  const privateRun = useMemo(
    () => resolveBrowserVaultExperimentRun({
      client: browserVault.client,
      protocol,
    }),
    [browserVault.client, protocol],
  );
  const experiment = useMemo(
    () => composeExperimentDetail({ protocol, privateRun }),
    [privateRun, protocol],
  );

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

  if (!hasCurrentProtocolContract) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-secondary/25 bg-card/90 px-6 py-8 text-sm text-muted-foreground">
        Refreshing experiment…
      </div>
    );
  }

  const basePath = `/experiments/${protocol.id}`;
  const currentTab: ExperimentDetailTab = pathname === `${basePath}/research`
    ? "research"
    : pathname === `${basePath}/results`
      ? "results"
      : "protocol";

  return (
    <div className="flex flex-col gap-8">
      {experiment.status !== "finished" && (
        <div className="-mt-4 md:-mt-6">
          <ExperimentHero image={experiment.image} />
        </div>
      )}

      <ExperimentHeader
        title={experiment.title}
        category={experiment.category}
        durationDays={experiment.durationDays}
        evidenceLevel={experiment.evidenceLevel}
        evidenceLabel={experiment.evidenceLabel}
        matchPercent={experiment.matchPercent}
        status={experiment.status}
        day={experiment.day}
        dateRange={experiment.dateRange}
        baselineDays={experiment.baselineDays}
        completionPercent={experiment.completionPercent}
        description={experiment.description}
      />

      <Tabs value={currentTab} className="w-full">
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <div className="sticky top-0 z-20 -mx-6 flex items-center gap-4 bg-background/95 px-6 py-2 backdrop-blur-md md:-mx-14 md:px-14">
          <TabsList>
            <TabsTrigger
              value="protocol"
              className="px-3 sm:px-5"
              nativeButton={false}
              render={<Link href={basePath} />}
            >
              Protocol
            </TabsTrigger>
            <TabsTrigger
              value="research"
              className="px-3 sm:px-5"
              nativeButton={false}
              render={<Link href={`${basePath}/research`} />}
            >
              Research
            </TabsTrigger>
            <TabsTrigger
              value="results"
              className="px-3 sm:px-5"
              nativeButton={false}
              render={<Link href={`${basePath}/results`} />}
            >
              Your Results
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
            {experiment.title}
          </span>
        </div>
        <div className="pt-4">{children}</div>
      </Tabs>
    </div>
  );
}
