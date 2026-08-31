import { ArrowRight } from "lucide-react";
import Image from "next/image";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { buttonVariants } from "@/src/components/ui/button";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

export function GoalContactAction({
  option,
}: {
  option: MurphContactOption;
}) {
  return (
    <MurphContactLink
      actionLabel="Build my plan with Murph"
      className={cn(buttonVariants({ size: "xl" }), "w-full sm:w-auto")}
      option={option}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="h-6 w-auto brightness-0 invert"
        height={24}
        src="/icons/murph-mark.svg"
        width={36}
      />
      Build my plan
      <ArrowRight data-icon="inline-end" aria-hidden="true" />
    </MurphContactLink>
  );
}
