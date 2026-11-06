import { MessageCircle } from "lucide-react";

import { LINK_PAGE_PILL_CLASS } from "@/src/components/link-page/link-page-shell";

// Messages has no deep link into an existing group thread, so the way back to a
// group can only open the app itself.
export function GroupFundingOpenMessages() {
  return (
    <a className={LINK_PAGE_PILL_CLASS} href="sms:">
      <MessageCircle aria-hidden="true" className="size-5" />
      Open Messages
    </a>
  );
}
