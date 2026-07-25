import {
  BiomarkerBoundaryResultStudy,
  BiomarkerDetailStudy,
  BiomarkerIndexStudy,
  BiomarkerPreparingStateStudy,
  BiomarkerReferenceContextStudy,
} from "@/src/components/biomarkers/biomarker-design-studies";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { DEFAULT_MURPH_HEADSHOT } from "@/src/components/homepage/murph-headshot-avatar";
import { PersonasSection } from "@/src/components/homepage/personas-section";
import { SecurityTeaserSection } from "@/src/components/homepage/security-teaser-section";
import { Separator } from "@/src/components/ui/separator";
import { AccountExitReasonStudy } from "./account-exit-reason-study";
import { ConnectSourceCardStudy } from "./connect-source-card-study";
import { FamilyInviteJoinStudy } from "./family-invite-join-study";
import { GroupJoinStudy } from "./group-join-study";
import { GrowthScorecardStudy } from "./growth-scorecard-study";
import { HomeLoadStateStudy } from "./home-load-state-study";
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

      <StudySection title="Homepage security and privacy">
        <SecurityTeaserSection />
      </StudySection>

      <Separator />

      <StudySection title="Homepage experiment flow">
        <HowItWorksSection />
      </StudySection>

      <Separator />

      <StudySection title="Homepage personas">
        <PersonasSection murphHeadshotSrc={DEFAULT_MURPH_HEADSHOT} />
      </StudySection>

      <Separator />

      <StudySection title="Persona onboarding">
        <PersonaOnboardingStudy />
      </StudySection>

      <Separator />

      <StudySection title="Family plan invite acceptance">
        <FamilyInviteJoinStudy />
      </StudySection>

      <Separator />

      <StudySection title="Connect source card actions">
        <ConnectSourceCardStudy />
      </StudySection>

      <Separator />

      <StudySection title="Account deletion exit reason">
        <AccountExitReasonStudy />
      </StudySection>

      <Separator />

      <StudySection title="Home partial-load recovery">
        <HomeLoadStateStudy />
      </StudySection>

      <Separator />

      <StudySection title="Group join actions">
        <GroupJoinStudy />
      </StudySection>

      <Separator />

      <StudySection title="Group usage funding and top-up follow-up">
        <GroupUsageFundingStudy />
      </StudySection>

      <Separator />

      <StudySection title="Personal usage credit states">
        <PersonalUsageCreditOwnerStudy />
      </StudySection>

      <Separator />

      <StudySection title="Ops weekly growth compass">
        <GrowthScorecardStudy />
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

      <StudySection title="Biomarker result detail">
        <BiomarkerDetailStudy />
      </StudySection>

      <Separator />

      <StudySection title="Biomarker reference context">
        <BiomarkerReferenceContextStudy />
      </StudySection>

      <Separator />

      <StudySection title="Boundary result detail">
        <BiomarkerBoundaryResultStudy />
      </StudySection>
    </div>
  );
}
