import { ArrowRight } from "lucide-react";

import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactAuthButton } from "@/src/components/murph/murph-contact-auth-button";
import { AuthButton } from "@/src/components/ui/auth-button";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
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
      Sync
      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </button>
  );
}

export async function UploadLabsMurphContactAction() {
  const [auth, option] = await Promise.all([
    getHostedPageAuthSnapshot(),
    resolveHostedMurphContactOption({
      message: {
        body: UPLOAD_LABS_CONTACT_BODY,
        subject: UPLOAD_LABS_CONTACT_SUBJECT,
      },
    }),
  ]);

  if (!option) {
    return (
      <AuthButton
        aria-label="Sync labs with Murph"
        className={getOnboardingStepActionClass(false)}
        disabled={auth.authenticated}
        size="unstyled"
        variant="unstyled"
      >
        Sync
        <ArrowRight
          data-icon="inline-end"
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </AuthButton>
    );
  }

  return (
    <MurphContactAuthButton
      actionLabel="Sync labs with Murph"
      className={getOnboardingStepActionClass(false)}
      option={option}
    >
      Sync
      <ArrowRight
        data-icon="inline-end"
        className="transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </MurphContactAuthButton>
  );
}
