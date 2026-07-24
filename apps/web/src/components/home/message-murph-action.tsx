import { ArrowRight } from "lucide-react";

import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactAuthButton } from "@/src/components/murph/murph-contact-auth-button";
import { AuthButton } from "@/src/components/ui/auth-button";
import { cn } from "@/src/lib/utils";
import { getOnboardingStepActionClass } from "./onboarding-steps";

export const MESSAGE_MURPH_CONTACT_BODY = "Hey Murph, do your thing";

export const MESSAGE_MURPH_CONTACT_SUBJECT = "Hey Murph, do your thing";

export function MessageMurphActionFallback() {
  return (
    <button
      type="button"
      className={cn(getOnboardingStepActionClass(true), "opacity-70")}
      disabled
      aria-busy="true"
    >
      Message
      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </button>
  );
}

export async function MessageMurphContactAction() {
  const option = await resolveHostedMurphContactOption({
    message: {
      body: MESSAGE_MURPH_CONTACT_BODY,
      subject: MESSAGE_MURPH_CONTACT_SUBJECT,
    },
  });

  if (!option) {
    return (
      <AuthButton
        aria-label="Set up a way to message Murph"
        className={getOnboardingStepActionClass(true)}
        size="unstyled"
        variant="unstyled"
      >
        Message
        <ArrowRight
          data-icon="inline-end"
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </AuthButton>
    );
  }

  return (
    <MurphContactAuthButton
      actionLabel="Message Murph"
      className={getOnboardingStepActionClass(true)}
      option={option}
    >
      Message
      <ArrowRight
        data-icon="inline-end"
        className="transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </MurphContactAuthButton>
  );
}
