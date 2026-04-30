import { BiomarkerExperimentCard } from "./biomarker-experiment-card";
import { BiomarkerExperimentCardHero } from "./biomarker-experiment-card-hero";
import {
  BiomarkerExperimentRow,
  BiomarkerExperimentRowHeader,
} from "./biomarker-experiment-row";
import { BiomarkerTrendDetail } from "./biomarker-trend-detail";
import { mockExperimentsCompletedForBiomarker } from "@/src/lib/biomarkers/biomarker-mock-trend";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

export function BiomarkerOverview({ biomarker }: { biomarker: BiomarkerPageModel }) {
  const protocols = biomarker.protocolRankings;
  const heroProtocols = protocols.slice(0, 2);
  const standardProtocols = protocols.slice(2, 5);
  const restProtocols = protocols.slice(5);
  const experimentsCompleted = mockExperimentsCompletedForBiomarker(biomarker.routeId);

  return (
    <div className="flex flex-col gap-12 pb-12">
      <BiomarkerTrendDetail biomarker={biomarker} />

      {heroProtocols.length > 0 ? (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                Experiments that may move your {biomarker.shortName}
              </h2>
              {experimentsCompleted > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                  {experimentsCompleted} completed
                </span>
              ) : null}
            </div>
            <p className="max-w-3xl text-sm/6 text-muted-foreground text-pretty">
              Ranked by evidence, biomarker relevance, and how cleanly it can be measured at home.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {heroProtocols.map((protocol) => (
              <BiomarkerExperimentCardHero
                key={protocol.key}
                biomarker={biomarker}
                protocol={protocol}
              />
            ))}
          </div>

          {standardProtocols.length > 0 ? (
            <div className="flex flex-col gap-4 pt-2">
              <SubHeading>Also worth a look</SubHeading>
              <div className="grid gap-4 lg:grid-cols-3">
                {standardProtocols.map((protocol) => (
                  <BiomarkerExperimentCard
                    key={protocol.key}
                    biomarker={biomarker}
                    protocol={protocol}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {restProtocols.length > 0 ? (
            <div className="flex flex-col gap-4 pt-2">
              <SubHeading>More options to explore</SubHeading>
              <div className="overflow-hidden rounded-xl border border-border/60 bg-card/90 divide-y divide-border/60">
                <BiomarkerExperimentRowHeader />
                {restProtocols.map((protocol) => (
                  <BiomarkerExperimentRow
                    key={protocol.key}
                    biomarker={biomarker}
                    protocol={protocol}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function SubHeading({ children }: { children: string }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}
