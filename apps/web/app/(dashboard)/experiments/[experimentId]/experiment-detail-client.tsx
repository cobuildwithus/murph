"use client";

import { useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { ExperimentHero } from "@/src/components/experiments/experiment-detail/experiment-hero";
import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";
import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";
import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";

type ExperimentDetailTab = "protocol" | "results";

export function ExperimentDetailClient({
  protocol,
}: {
  protocol: ExperimentProtocol;
}) {
  const browserVault = useBrowserVault();
  const [selectedTabState, setSelectedTabState] = useState<{
    protocolId: string;
    value: ExperimentDetailTab;
  }>({
    protocolId: protocol.id,
    value: "protocol",
  });
  const privateRun = useMemo(
    () => resolveBrowserVaultExperimentRun({
      protocol,
      snapshot: browserVault.snapshot,
    }),
    [browserVault.snapshot, protocol],
  );
  const experiment = useMemo(
    () => composeExperimentDetail({ protocol, privateRun }),
    [privateRun, protocol],
  );
  const selectedTab = selectedTabState.protocolId === protocol.id
    ? selectedTabState.value
    : "protocol";

  return (
    <div className="flex flex-col gap-8">
      {experiment.status !== "finished" && (
        <ExperimentHero image={experiment.image} title={experiment.title} />
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
        <TabsList>
          <TabsTrigger value="protocol">Protocol</TabsTrigger>
          <TabsTrigger value="results">Your Results</TabsTrigger>
        </TabsList>
        <TabsContent value="protocol" className="pt-4">
          <ProtocolTab experiment={experiment} />
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
