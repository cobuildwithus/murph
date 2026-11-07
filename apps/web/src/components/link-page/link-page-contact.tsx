"use client";

import { MessageCircleIcon } from "lucide-react";

import { LINK_PAGE_PILL_CLASS } from "@/src/components/link-page/link-page-shell";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

/** The way back to the chat: Messages, or whichever channel the member uses. */
export function LinkPageContactPill({ option }: { option: MurphContactOption }) {
  return (
    <MurphContactLink
      actionLabel="Reply to Murph"
      className={LINK_PAGE_PILL_CLASS}
      option={option}
    >
      <MessageCircleIcon aria-hidden="true" className="size-5 shrink-0" />
      Open {option.label}
    </MurphContactLink>
  );
}
