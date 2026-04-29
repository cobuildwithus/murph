import { SectionLabel } from "@/src/components/ui/section-label";
import { resolveBiomarkerAbout } from "@/src/lib/biomarkers/biomarker-about";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

export function BiomarkerAbout({ biomarker }: { biomarker: BiomarkerPageModel }) {
  const about = resolveBiomarkerAbout(biomarker.routeId);

  if (!about) {
    return (
      <section className="flex flex-col gap-4">
        <SectionLabel>About</SectionLabel>
        <p className="max-w-3xl text-[15px]/7 text-muted-foreground">{biomarker.summary}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <SectionLabel>About</SectionLabel>
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-3">
        <AboutColumn eyebrow="Why it matters" body={about.whyItMatters} />
        <AboutColumn eyebrow="How it's measured" body={about.howItsMeasured} />
        <AboutColumn eyebrow="What moves it" body={about.whatMovesIt} />
      </div>
    </section>
  );
}

function AboutColumn({ eyebrow, body }: { eyebrow: string; body: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
        {eyebrow}
      </span>
      <p className="text-[15px]/6.5 text-foreground text-pretty">{body}</p>
    </div>
  );
}
