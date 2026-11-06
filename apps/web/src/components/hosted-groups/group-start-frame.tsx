import Link from "next/link";
import { MessageCircle } from "lucide-react";

import {
  LINK_PAGE_PILL_CLASS,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";
import { Spinner } from "@/src/components/ui/spinner";
import type { HostedAuthenticationCompletionPayload } from "@/src/lib/hosted-onboarding/types";

export type HostedGroupStartScreenState =
  | "checking"
  | "conflict"
  | "failed"
  | "finish"
  | "linking"
  | "ready";

export function HostedGroupStartSignIn({
  onCompleted,
}: {
  onCompleted?: (payload: HostedAuthenticationCompletionPayload) => Promise<void> | void;
}) {
  return (
    <LinkPageSignInScreen
      detail="Create or open your account, then message Murph in the group again."
      title="Set up Murph for this group."
      {...(onCompleted ? { onCompleted } : {})}
    />
  );
}

export function HostedGroupStartScreen({
  onRetry,
  state,
}: {
  onRetry?: () => void;
  state: HostedGroupStartScreenState;
}) {
  switch (state) {
    case "checking":
      return (
        <LinkPageScreen
          below={<Spinner className="mt-[22px] size-6 text-[#EBD18B]" />}
          detail="One moment while Murph prepares group setup."
          title="Preparing Murph."
        />
      );
    case "linking":
      return (
        <LinkPageScreen
          below={<Spinner className="mt-[22px] size-6 text-[#EBD18B]" />}
          detail="One moment. Murph is linking the address that sent the group message to your account."
          title="Connecting your Messages address."
        />
      );
    case "conflict":
      return (
        <LinkPageScreen
          detail="It’s connected to a different Murph account. Log in to that account, or ask someone else in the group to message Murph."
          title="That address is already set up."
        />
      );
    case "failed":
      return (
        <LinkPageScreen
          actions={<LinkPagePill onClick={onRetry}>Try again</LinkPagePill>}
          detail="Open the latest link Murph sent, or return to the group and have someone with Murph message again."
          title="That recovery link did not work."
        />
      );
    case "finish":
      return (
        <LinkPageScreen
          actions={
            <Link className={LINK_PAGE_PILL_CLASS} href="/join">
              Finish setup
            </Link>
          }
          detail="Then go back to the group and message Murph again."
          title="Finish setting up Murph."
        />
      );
    case "ready":
      return (
        <LinkPageScreen
          actions={
            // Messages has no deep link into an existing group thread, so this
            // can only open the app itself.
            <a className={LINK_PAGE_PILL_CLASS} href="sms:">
              <MessageCircle aria-hidden="true" className="size-5" />
              Open Messages
            </a>
          }
          detail="Your next message connects the chat, and Murph will reply there."
          title="Go back to the group."
        >
          <p className="max-w-[280px] self-end rounded-[22px] bg-[#FFFCF6] px-[18px] py-3 text-[18px] font-medium leading-6 text-[#2D3436]">
            Hey Murph
          </p>
        </LinkPageScreen>
      );
  }
}
