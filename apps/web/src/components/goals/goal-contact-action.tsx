import { ArrowRight } from "lucide-react";

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
      actionLabel="Do this with Murph"
      className={cn(buttonVariants({ size: "xl" }), "w-full sm:w-auto")}
      option={option}
    >
      Do this with Murph
      <ArrowRight data-icon="inline-end" aria-hidden="true" />
    </MurphContactLink>
  );
}
