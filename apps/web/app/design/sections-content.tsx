import {
  BiomarkerBoundaryResultStudy,
  BiomarkerDetailStudy,
  BiomarkerIndexStudy,
  BiomarkerPreparingStateStudy,
} from "@/src/components/biomarkers/biomarker-design-studies";
import { Separator } from "@/src/components/ui/separator";
import { PersonaOnboardingStudy } from "./persona-onboarding-study";
import {
  GroupUsageFundingStudy,
  PersonalUsageCreditOwnerStudy,
} from "./group-usage-funding-study";

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
    <div className="mx-auto flex max-w-7xl flex-col gap-16 px-5 py-12 sm:px-8 lg:px-12">
      <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">
        Sections
      </h1>

      <Separator />

      <StudySection title="Persona onboarding">
        <PersonaOnboardingStudy />
      </StudySection>

      <Separator />

      <StudySection title="Group usage funding">
        <GroupUsageFundingStudy />
      </StudySection>

      <Separator />

      <StudySection title="Personal usage credit owner">
        <PersonalUsageCreditOwnerStudy />
      </StudySection>

      <Separator />

      <StudySection title="Biomarker preparing state">
        <BiomarkerPreparingStateStudy />
      </StudySection>

      <Separator />

      <StudySection title="Biomarker index">
        <BiomarkerIndexStudy />
      </StudySection>

      <Separator />

      <StudySection title="Biomarker detail">
        <BiomarkerDetailStudy />
      </StudySection>

      <Separator />

      <StudySection title="Boundary result detail">
        <BiomarkerBoundaryResultStudy />
      </StudySection>
    </div>
  );
}
