"use client";

import { MurphContactActionButton } from "@/src/components/murph/murph-contact-action-button";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function ComputerHandoffReplyAction({
  options,
}: {
  options: MurphContactOption[];
}) {
  return (
    <MurphContactActionButton
      actionLabel="Reply to Murph"
      className="w-full sm:w-auto"
      options={options}
      pickerDescription="Pick how you want to reply."
    />
  );
}
