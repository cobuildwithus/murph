import { resolveBiomarkerAnalysis } from "@/src/lib/biomarkers/biomarker-analysis";
import type { BiomarkerResearchProjection } from "@/src/lib/health-commons/biomarker-projections";
import { cn } from "@/src/lib/utils";

const STUDY_TYPE_LABELS: Record<"observational" | "RCT" | "meta-analysis", string> = {
  observational: "Observational",
  RCT: "Randomized trial",
  "meta-analysis": "Meta-analysis",
};

export function BiomarkerEvidenceRow({
  biomarker,
}: {
  biomarker: Pick<BiomarkerResearchProjection, "routeId">;
}) {
  const profile = resolveBiomarkerAnalysis(biomarker.routeId);
  const evidence = profile?.evidence;
  if (!evidence) return null;

  return (
    <section className="rounded-xl border border-secondary/25 bg-card/90 p-7">
      <div className="flex flex-col gap-5">
        <blockquote className="max-w-3xl">
          <p className="font-serif text-[19px]/8 italic text-foreground text-pretty">
            {"“"}{evidence.quote}{"”"}
          </p>
          <footer className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            — {evidence.attribution}
          </footer>
        </blockquote>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <Stat value={String(evidence.studies)} label="studies" />
          <Sep />
          <Stat value={evidence.participants.toLocaleString()} label="participants" />
          <Sep />
          <Stat value={STUDY_TYPE_LABELS[evidence.studyType]} label="design" />
          <Sep />
          <Rating value={evidence.rating} max={5} />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-foreground tabular-nums">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Sep() {
  return <span aria-hidden="true" className="text-border">·</span>;
}

function Rating({ value, max }: { value: number; max: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${value} of ${max} evidence rating`}
    >
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", i < value ? "bg-primary" : "bg-border")}
        />
      ))}
    </span>
  );
}
