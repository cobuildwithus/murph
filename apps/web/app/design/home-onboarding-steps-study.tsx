import { ArrowRight } from "lucide-react";

import {
  getOnboardingStepActionClass,
  OnboardingSteps,
} from "@/src/components/home/onboarding-steps";

function StudyAction({
  children,
  primary = false,
}: {
  children: string;
  primary?: boolean;
}) {
  return (
    <a
      className={getOnboardingStepActionClass(primary)}
      href="/screenshots/home"
    >
      {children}
      <ArrowRight className="size-4" />
    </a>
  );
}

export function HomeOnboardingStepsStudy() {
  return (
    <div
      data-design-section="home-onboarding-steps"
      id="home-onboarding-steps"
      inert
    >
      <OnboardingSteps
        messageMurphAction={<StudyAction primary>Message</StudyAction>}
        uploadLabsAction={<StudyAction>Sync</StudyAction>}
      />
    </div>
  );
}
