import { ArrowRight } from "lucide-react";
import Link from "next/link";

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
    <Link
      className={getOnboardingStepActionClass(primary)}
      href="/screenshots/home"
    >
      {children}
      <ArrowRight className="size-4" />
    </Link>
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
