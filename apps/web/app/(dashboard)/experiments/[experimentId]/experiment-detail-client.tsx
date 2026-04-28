"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { ExperimentHero } from "@/src/components/experiments/experiment-detail/experiment-hero";
import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";
import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";
import { ResearchTab } from "@/src/components/experiments/experiment-detail/research-tab";
import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import {
  composeExperimentDetail,
  hasCurrentExperimentProtocolContract,
} from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";

type ExperimentDetailTab = "protocol" | "research" | "results";

export function ExperimentDetailClient({
  protocol,
}: {
  protocol: ExperimentProtocol;
}) {
  return (
    <BrowserVaultProvider>
      <ExperimentDetailClientContent protocol={protocol} />
    </BrowserVaultProvider>
  );
}

function ExperimentDetailClientContent({
  protocol,
}: {
  protocol: ExperimentProtocol;
}) {
  const router = useRouter();
  const browserVault = useBrowserVault();
  const [selectedTabState, setSelectedTabState] = useState<{
    protocolId: string;
    value: ExperimentDetailTab;
  }>({
    protocolId: protocol.id,
    value: "protocol",
  });
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
  const selectedTab = selectedTabState.protocolId === protocol.id
    ? selectedTabState.value
    : "protocol";

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

      <Tabs
        value={selectedTab}
        onValueChange={(value) => setSelectedTabState({
          protocolId: protocol.id,
          value: value as ExperimentDetailTab,
        })}
        className="w-full"
      >
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <div className="sticky top-0 z-20 -mx-6 flex items-center gap-4 bg-background/95 px-6 py-2 backdrop-blur-md md:-mx-14 md:px-14">
          <TabsList>
            <TabsTrigger value="protocol" className="px-3 sm:px-5">Protocol</TabsTrigger>
            <TabsTrigger value="research" className="px-3 sm:px-5">Research</TabsTrigger>
            <TabsTrigger value="results" className="px-3 sm:px-5">Your Results</TabsTrigger>
          </TabsList>
          <span
            aria-hidden={!isTabsSticky}
            className="ml-auto min-w-0 truncate font-serif text-sm/5 font-semibold text-foreground transition-opacity duration-150 md:text-base/6"
            style={{
              opacity: isTabsSticky ? 1 : 0,
              pointerEvents: isTabsSticky ? "auto" : "none",
            }}
          >
            {experiment.title}
          </span>
        </div>
        <TabsContent value="protocol" className="pt-4">
          <ProtocolTab
            experiment={experiment}
            onJumpToResearch={() =>
              setSelectedTabState({ protocolId: protocol.id, value: "research" })
            }
          />
        </TabsContent>
        <TabsContent value="research" className="pt-4">
          <ResearchTab experiment={experiment} />
        </TabsContent>
        <TabsContent value="results" className="pt-4">
          <ResultsTab
            experiment={experiment}
            privateRunError={browserVault.error}
            privateRunStatus={browserVault.status}
            onPrivateRunRetry={browserVault.refresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
