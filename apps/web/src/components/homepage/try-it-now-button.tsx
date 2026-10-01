import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { LandingAuthDialogButton } from "@/app/auth-controls";
import { buttonVariants } from "@/src/components/ui/button";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { cn } from "@/src/lib/utils";

// Same treatment as the "Ask Murph to help" button on the goal guides: the xl
// primary button with the Murph mark leading and an arrow trailing.
const TRY_IT_NOW_BUTTON_CLASS = cn(
  buttonVariants({ size: "xl" }),
  "w-full sm:w-auto",
);

function MurphMark() {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className="h-6 w-auto brightness-0 invert"
      height={24}
      src="/icons/murph-mark.svg"
      width={36}
    />
  );
}

function TrailingArrow() {
  return <ArrowRight aria-hidden="true" data-icon="inline-end" />;
}

export function TryItNowButton({
  authenticated,
  label = "Try it now",
}: {
  authenticated: boolean;
  label?: string;
}) {
  if (authenticated) {
    return (
      <Link
        className={TRY_IT_NOW_BUTTON_CLASS}
        href={HOSTED_APP_HOME_PATH}
        prefetch={false}
      >
        <MurphMark />
        {label}
        <TrailingArrow />
      </Link>
    );
  }

  return (
    <LandingAuthDialogButton
      buttonClassName={TRY_IT_NOW_BUTTON_CLASS}
      buttonLabel={label}
      leadingIcon={<MurphMark />}
      requireLaunchConsentOnCompletion
      trailingIcon={<TrailingArrow />}
    />
  );
}
