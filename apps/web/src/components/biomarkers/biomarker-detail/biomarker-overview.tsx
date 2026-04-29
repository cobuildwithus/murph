import { SectionLabel } from "@/src/components/ui/section-label";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

import { BiomarkerAbout } from "./biomarker-about";
import { BiomarkerExperimentCard } from "./biomarker-experiment-card";

export function BiomarkerOverview({ biomarker }: { biomarker: BiomarkerPageModel }) {
  const hasExperiments = biomarker.protocolRankings.length > 0;

  return (
    <div className="flex flex-col gap-12 pb-12">
      <BiomarkerAbout biomarker={biomarker} />

      {hasExperiments ? (
        <section className="flex flex-col gap-5">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <SectionLabel>Experiments that may move {biomarker.shortName}</SectionLabel>
            <p className="text-sm/6 text-muted-foreground">
              Ranked by evidence, biomarker relevance, and how cleanly it can be measured at home.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {biomarker.protocolRankings.map((protocol, index) => (
              <BiomarkerExperimentCard
                key={protocol.key}
                biomarker={biomarker}
                protocol={protocol}
                rank={index + 1}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
