import Link from "next/link";

import {
  LINK_PAGE_PILL_CLASS,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";

export function JoinInviteCheckoutPausedScreen({ href }: { href: string }) {
  return (
    <LinkPageScreen
      actions={
        <Link className={LINK_PAGE_PILL_CLASS} href={href}>
          Return to invite
        </Link>
      }
      announceDetail={false}
      detail="Your phone number is still verified. Come back whenever you want to finish."
      title="Checkout paused."
    />
  );
}
