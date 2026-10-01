import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { MurphChatAction } from "@/src/components/murph/murph-chat-action";

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
      prefetch={false}
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
      <div id="home-onboarding-complete" className="mt-8" data-design-section="home-onboarding-complete">
        <OnboardingSteps
          showDeviceStep={false}
          hideLabsStep
          emptyStateAction={
            <MurphChatAction authenticated options={[
              { kind: "text", label: "Messages", href: "sms:+15550100001" },
              { kind: "email", label: "Email", href: "mailto:example@example.test" },
            ]} />
          }
        />
      </div>
    </div>
  );
}
