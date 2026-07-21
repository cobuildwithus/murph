import {
  BiomarkerDetailStudy,
  BiomarkerIndexStudy,
} from "@/src/components/biomarkers/biomarker-design-studies";
import { Separator } from "@/src/components/ui/separator";

function StudySection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SectionsContent() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-12 sm:px-10 lg:px-16">
      <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">
        Sections
      </h1>

      <Separator />

      <StudySection title="Biomarker index">
        <BiomarkerIndexStudy />
      </StudySection>

      <Separator />

      <StudySection title="Biomarker detail">
        <BiomarkerDetailStudy />
      </StudySection>
    </div>
  );
}
