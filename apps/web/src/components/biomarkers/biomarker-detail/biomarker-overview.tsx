import { BiomarkerExperimentCard } from "./biomarker-experiment-card";
import { BiomarkerExperimentCardHero } from "./biomarker-experiment-card-hero";
import {
  BiomarkerExperimentRow,
  BiomarkerExperimentRowHeader,
} from "./biomarker-experiment-row";
import { BiomarkerPrivateTrendCard } from "./biomarker-private-trend-card";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import type { BiomarkerOverviewProjection } from "@/src/lib/health-commons/biomarker-projections";

export function BiomarkerOverview({ biomarker }: { biomarker: BiomarkerOverviewProjection }) {
  const protocols = biomarker.protocolRankings;
  const heroProtocols = protocols.slice(0, 2);
  const standardProtocols = protocols.slice(2, 5);
  const restProtocols = protocols.slice(5);

  return (
    <div className="flex flex-col gap-12 pb-12">
      <BrowserVaultProvider>
        <BiomarkerPrivateTrendCard biomarker={biomarker} />
      </BrowserVaultProvider>

      {heroProtocols.length > 0 ? (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              Experiments
            </h2>
            <p className="max-w-3xl text-sm/6 text-muted-foreground text-pretty">
              Ranked by evidence, biomarker relevance, and how cleanly it can be measured at home.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {heroProtocols.map((protocol) => (
              <BiomarkerExperimentCardHero
                key={protocol.key}
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
    <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </h3>
  );
}
