import {
  BiomarkerBoundaryResultStudy,
  BiomarkerDetailStudy,
  BiomarkerIndexStudy,
  BiomarkerPreparingStateStudy,
  BiomarkerReferenceContextStudy,
} from "@/src/components/biomarkers/biomarker-design-studies";
import { AsksGridSection } from "@/src/components/homepage/asks-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import { HeroClocksIn } from "@/src/components/homepage/hero-clocks-in";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { DEFAULT_MURPH_HEADSHOT } from "@/src/components/homepage/murph-headshot-avatar";
import { PersonasSection } from "@/src/components/homepage/personas-section";
import { SecurityTeaserSection } from "@/src/components/homepage/security-teaser-section";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { TogetherSection } from "@/src/components/homepage/together-section";
import { ModelProviderSecuritySection } from "@/src/components/security/model-provider-security-section";
import { HostedAssistantModelSettings } from "@/src/components/settings/hosted-assistant-model-settings";
import { Separator } from "@/src/components/ui/separator";
import { AccountDeletionMaintenanceStudy } from "./account-deletion-maintenance-study";
import { AccountExitReasonStudy } from "./account-exit-reason-study";
import { ChangelogArchiveStudy } from "./changelog-archive-study";
import { ClubsPageStudy } from "./clubs-page-study";
import {
  AppleHealthRelaySetupStudy,
  ConnectSourceCardStudy,
  ZeppAppleHealthSetupStudy,
} from "./connect-source-card-study";
import { DataExportFlowStudy } from "./data-export-study";
import { FamilyInviteJoinStudy } from "./family-invite-join-study";
import { GroupJoinStudy } from "./group-join-study";
import { GroupStartStudy } from "./group-start-study";
import { GroupMemberPlanStudy } from "./group-member-plan-study";
import { GrowthScorecardStudy } from "./growth-scorecard-study";
import { HealthDataConsentWithdrawalFlowStudy } from "./health-data-consent-study";
import { HomeLoadStateStudy } from "./home-load-state-study";
import { HomeOnboardingStepsStudy } from "./home-onboarding-steps-study";
import { HomepageAuthWarmRuntimeStudy } from "./homepage-auth-warm-runtime-study";
import { JoinFamilyBillingRecoveryStudy } from "./join-family-billing-recovery-study";
import { PersonaOnboardingStudy } from "./persona-onboarding-study";
import { PulseTrialBillingContinuationStudy } from "./pulse-trial-billing-continuation-study";
import { SettingsAuthRequiredStudy } from "./settings-auth-required-study";
import { SettingsCustomInferenceStudy } from "./settings-custom-inference-study";
import { StructuredReviewResultsStudy } from "./structured-review-results-study";
import {
  GroupUsageFundingStudy,
  PersonalUsageCreditOwnerStudy,
} from "./group-usage-funding-study";
import { ExperimentResultsShareStudy } from "./experiment-results-share-study";
import { EnvironmentProgressStudy } from "./environment-progress-study";
import { EnvironmentPrintStudy } from "./environment-print-study";

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
    <div
      className="mx-auto flex max-w-7xl flex-col gap-16 px-5 py-12 sm:px-8 lg:px-12"
      data-design-section="catalog-navigation"
    >
      <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">
        Sections
      </h1>

      <Separator />

      <StudySection title="Homepage solo-first hero">
        <div
          id="homepage-solo-first-hero"
          data-design-section="homepage-solo-first-hero"
          className="-mx-5 sm:-mx-8 lg:-mx-12"
          inert
        >
          <HeroClocksIn
            authenticated={false}
            contactInfo={{
              phone: "+15555550100",
              telegram: "murph_test_bot",
            }}
            messengerChannel="imessage"
            murphHeadshotSrc={DEFAULT_MURPH_HEADSHOT}
          />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Homepage authentication readiness and phone handoff">
        <HomepageAuthWarmRuntimeStudy />
      </StudySection>

      <Separator />

      <StudySection title="Homepage security and privacy">
        <SecurityTeaserSection />
      </StudySection>

      <Separator />

      <StudySection title="Homepage model provider FAQ">
        <div
          data-design-section="homepage-model-provider-faq"
          className="-mx-5 sm:-mx-8 lg:-mx-12"
          inert
        >
          <FaqSection veniceAvailable />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Security model provider choice">
        <div
          data-design-section="security-model-provider-choice"
          className="-mx-5 sm:-mx-8 lg:-mx-12"
          inert
        >
          <ModelProviderSecuritySection />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Settings model choice with provider usage disclosure">
        <div
          id="settings-model-provider-save-controls"
          data-design-section="settings-compact-provider-control"
          className="max-w-5xl"
          inert
        >
          <HostedAssistantModelSettings
            canUpgradeToEdge={false}
            configurationAvailable
            customInferenceAvailable
            initialDormantSolPreference={false}
            initialModel="gpt-5.6-terra"
            initialProvider="venice"
            solAvailable
            veniceAvailable
          />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Settings custom inference routing and endpoint">
        <SettingsCustomInferenceStudy />
      </StudySection>

      <Separator />

      <StudySection title="Settings health data consent withdrawal and return">
        <HealthDataConsentWithdrawalFlowStudy />
      </StudySection>

      <Separator />

      <StudySection title="Settings retained data export">
        <DataExportFlowStudy />
      </StudySection>

      <Separator />

      <StudySection title="Environment progressive voice capture">
        <EnvironmentProgressStudy />
      </StudySection>

      <Separator />

      <StudySection title="Private Environment print report">
        <EnvironmentPrintStudy />
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

      <StudySection title="Homepage feature cards">
        <div
          id="homepage-feature-cards"
          data-design-section="homepage-feature-cards"
          className="-mx-5 sm:-mx-8 lg:-mx-12"
          inert
        >
          <TogetherSection />
          <AsksGridSection />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Homepage footer">
        <div
          data-design-section="homepage-footer"
          className="-mx-5 sm:-mx-8 lg:-mx-12"
          inert
        >
          <SiteFooter id="design-site-footer-preview" />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Clubs profiles, iMessage, and wearables">
        <ClubsPageStudy />
      </StudySection>

      <Separator />

      <StudySection title="Changelog archive edition">
        <div data-design-section="changelog-archive">
          <ChangelogArchiveStudy />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Persona onboarding with stacked tone samples">
        <div data-design-section="persona-onboarding">
          <PersonaOnboardingStudy />
        </div>
      </StudySection>

      <Separator />

      <StudySection title="Family plan invite acceptance">
        <FamilyInviteJoinStudy />
      </StudySection>

      <Separator />

      <StudySection title="Family billing recovery on Join">
        <JoinFamilyBillingRecoveryStudy />
      </StudySection>

      <Separator />

      <StudySection title="Connect source actions and disconnect lifecycle">
        <ConnectSourceCardStudy />
      </StudySection>

      <Separator />

      <StudySection title="Zepp/Amazfit Apple Health setup">
        <ZeppAppleHealthSetupStudy />
      </StudySection>

      <Separator />

      <StudySection title="Apple Health relay wearable setup">
        <AppleHealthRelaySetupStudy />
      </StudySection>

      <Separator />

      <StudySection title="Account deletion exit reason">
        <AccountExitReasonStudy />
      </StudySection>

      <Separator />

      <StudySection title="Settings sign-in required">
        <SettingsAuthRequiredStudy />
      </StudySection>

      <Separator />

      <StudySection title="Pulse billing return confirmation">
        <PulseTrialBillingContinuationStudy />
      </StudySection>

      <Separator />

      <StudySection title="Core member plan">
        <GroupMemberPlanStudy />
      </StudySection>

      <Separator />

      <StudySection title="Account deletion during migration maintenance">
        <AccountDeletionMaintenanceStudy />
      </StudySection>

      <Separator />

      <StudySection title="Home partial-load recovery">
        <HomeLoadStateStudy />
      </StudySection>

      <Separator />

      <StudySection title="Home onboarding steps">
        <HomeOnboardingStepsStudy />
      </StudySection>

      <Separator />

      <StudySection title="Group join invites, sharing, and setup recovery">
        <GroupJoinStudy />
      </StudySection>

      <Separator />

      <StudySection title="Unknown iMessage group setup and recovery">
        <GroupStartStudy />
      </StudySection>

      <Separator />

      <StudySection title="Group sponsorship and mobile one-time contribution">
        <GroupUsageFundingStudy />
      </StudySection>

      <Separator />

      <StudySection title="Overall AI usage, purchase reset, Family owner action, credits, and referrals">
        <PersonalUsageCreditOwnerStudy />
      </StudySection>

      <Separator />

      <StudySection title="Private experiment results share">
        <ExperimentResultsShareStudy />
      </StudySection>

      <Separator />

      <StudySection title="Private structured-review result">
        <StructuredReviewResultsStudy />
      </StudySection>

      <Separator />

      <StudySection title="Ops weekly growth compass with message-volume history and retention-limited sender evidence">
        <div inert>
          <GrowthScorecardStudy />
        </div>
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
