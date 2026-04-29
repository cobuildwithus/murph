import { BiomarkerExperimentCard } from "./biomarker-experiment-card";
import { BiomarkerPrivateTrendCard } from "./biomarker-private-trend-card";
import { resolveBiomarkerAbout } from "@/src/lib/biomarkers/biomarker-about";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

export function BiomarkerOverview({ biomarker }: { biomarker: BiomarkerPageModel }) {
  const about = resolveBiomarkerAbout(biomarker.routeId);
  const eyebrowParts = [
    biomarker.categories[0] ? formatCategoryEyebrow(biomarker.categories[0]) : null,
    biomarker.unit,
  ].filter((part): part is string => Boolean(part));
  const hasExperiments = biomarker.protocolRankings.length > 0;

  return (
    <div className="flex flex-col gap-14 pb-12">
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3.5">
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

          {about ? (
            <div className="grid gap-x-8 gap-y-6 pt-2 md:grid-cols-3">
              <AboutColumn eyebrow="Why it matters" body={about.whyItMatters} />
              <AboutColumn eyebrow="How it's measured" body={about.howItsMeasured} />
              <AboutColumn eyebrow="What moves it" body={about.whatMovesIt} />
            </div>
          ) : null}
        </div>

        <BiomarkerPrivateTrendCard biomarker={biomarker} />
      </section>

      {hasExperiments ? (
        <section className="flex flex-col gap-5">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-5">
              Experiments that may move {biomarker.shortName}
            </span>
            <p className="text-sm/6 text-muted-foreground text-pretty">
              Ranked by evidence, biomarker relevance, and how cleanly it can be measured at home.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
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

function AboutColumn({ eyebrow, body }: { eyebrow: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
        {eyebrow}
      </span>
      <p className="max-w-[42ch] text-[15px]/6.5 text-foreground text-pretty">{body}</p>
    </div>
  );
}

function formatCategoryEyebrow(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join(" ");
}
