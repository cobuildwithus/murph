"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { ExperimentHero } from "@/src/components/experiments/experiment-detail/experiment-hero";
import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";
import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";
import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import type { Experiment } from "@/src/types/experiments";

export function ExperimentDetailClient({
  experiment,
}: {
  experiment: Experiment;
}) {
  return (
    <div className="flex flex-col gap-8">
      {(experiment.status === "active" || experiment.status === "upcoming") && (
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
        defaultValue={experiment.status === "upcoming" ? "protocol" : "results"}
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
          <ResultsTab experiment={experiment} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
