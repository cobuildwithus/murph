import { ArrowRight } from "lucide-react";

import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { cn } from "@/src/lib/utils";
import { getOnboardingStepActionClass } from "./onboarding-steps";

export const UPLOAD_LABS_CONTACT_BODY =
  "Here are some lab reports I want you to check out:";

export const UPLOAD_LABS_CONTACT_SUBJECT = "Lab reports for Murph";

export function UploadLabsActionFallback() {
  return (
    <button
      type="button"
      className={cn(getOnboardingStepActionClass(false), "opacity-70")}
      disabled
      aria-busy="true"
    >
      Upload labs
      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </button>
  );
}

export async function UploadLabsMurphContactAction() {
  const option = await resolveHostedMurphContactOption({
    message: {
      body: UPLOAD_LABS_CONTACT_BODY,
      subject: UPLOAD_LABS_CONTACT_SUBJECT,
    },
  });

  if (!option) {
    return <UploadLabsActionFallback />;
  }

  return (
    <MurphContactLink
      actionLabel="Upload labs to Murph"
      className={getOnboardingStepActionClass(false)}
      option={option}
    >
      Upload labs
      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </MurphContactLink>
  );
}
