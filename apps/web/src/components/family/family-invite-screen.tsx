import { Check as CheckIcon, MessageCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  FamilyInviteSignInButton,
  FamilyInviteWebAcceptScreen,
  type FamilyInviteWebAcceptInitialState,
} from "@/src/components/family/family-invite-accept-client";
import {
  LINK_PAGE_LINK_CLASS,
  LINK_PAGE_PILL_CLASS,
  LinkPageScreen,
  LinkPageTicket,
} from "@/src/components/link-page/link-page-shell";
import type { HostedFamilyInviteAcceptanceView } from "@/src/lib/hosted-onboarding/family-plan";

export type FamilyInviteView = HostedFamilyInviteAcceptanceView | null;

/**
 * The invite content shared by the live `/family/accept/[inviteCode]` page and
 * the design study. It is a pure presentation of an acceptance view, so both
 * callers render identical copy and CTA branching. The caller supplies the
 * frame, whether the visitor is authenticated, and the resolved Messages accept
 * link (both computed from server-only inputs on the live page).
 */
export function FamilyInviteScreen(input: {
  authenticated: boolean;
  messagesAcceptHref: string | null;
  view: FamilyInviteView;
  webAcceptInitialState?: FamilyInviteWebAcceptInitialState;
}): ReactNode {
  const { view } = input;
  const closed = readClosedInvite(view);

  if (closed || !view) {
    return (
      <LinkPageScreen
        actions={view?.status === "accepted" ? (
          <Link className={LINK_PAGE_PILL_CLASS} href="/home" prefetch={false}>
            Open Murph
          </Link>
        ) : undefined}
        detail={closed?.detail}
        title={closed?.title ?? ""}
      />
    );
  }

  return <FamilyInviteOpenScreen {...input} view={view} />;
}

/** Why this invite can't be accepted, in the order those reasons apply. */
function readClosedInvite(view: FamilyInviteView): { detail: string; title: string } | null {
  if (!view) {
    return {
      detail: "This family invite is no longer available. Ask the person who invited you to send a new one.",
      title: "This invite isn't valid.",
    };
  }
  if (view.status === "expired") {
    return {
      detail: "Ask the plan owner to send you a fresh family invite.",
      title: "This invite has expired.",
    };
  }
  if (view.status === "revoked") {
    return { detail: "Ask the plan owner for a new invite.", title: "This invite was canceled." };
  }
  if (view.status === "accepted") {
    return {
      detail: "If that was you, open Murph to continue.",
      title: "This invite was already used.",
    };
  }
  if (!view.groupActive) {
    return {
      detail: "Ask the plan owner to finish setting up billing, then open this invite again.",
      title: "This family plan isn't active yet.",
    };
  }
  if (!view.seatAvailable) {
    return {
      detail: "The plan has no open paid seats. Ask the owner to add a Family seat.",
      title: "This family plan is full.",
    };
  }
  return null;
}

/** Which identity the invite was sent to, for the web sign-in path. */
function readWebBinding(view: NonNullable<FamilyInviteView>) {
  const isFullyUnbound = !view.isPhoneBound && !view.isEmailBound && !view.isTelegramBound;
  if (isFullyUnbound) {
    return {
      description: "Sign in with your own phone number or email address. We'll bring you back here.",
      isFullyUnbound,
      label: "your phone number or email address",
    };
  }
  const label = view.isEmailBound && view.isPhoneBound
    ? "phone number or email address"
    : view.isEmailBound
      ? "email address"
      : "phone number";
  return { description: undefined, isFullyUnbound, label };
}

function FamilyInviteOpenScreen(input: {
  authenticated: boolean;
  messagesAcceptHref: string | null;
  view: NonNullable<FamilyInviteView>;
  webAcceptInitialState?: FamilyInviteWebAcceptInitialState;
}): ReactNode {
  const { view } = input;
  const inviter = view.groupDisplayName ?? "Your family plan owner";
  const title = `${inviter} invited you to Murph Family.`;
  const {
    description: webSignInDescription,
    isFullyUnbound,
    label: webBindingLabel,
  } = readWebBinding(view);
  const webSignInDescriptionProps = webSignInDescription
    ? { description: webSignInDescription }
    : {};
  const unboundTelegramInviteLink = isFullyUnbound && view.telegramInviteUrl ? (
    <a className={LINK_PAGE_LINK_CLASS} href={view.telegramInviteUrl}>
      Continue in Telegram
    </a>
  ) : null;
  const invite = (
    <>
      <LinkPageTicket
        className="mt-0"
        kicker="Murph Family"
        title="Your seat is paid for"
      />
      <FamilyInvitePromises />
    </>
  );

  // Already signed in with an acceptable identity: one tap, no re-verification.
  if (input.authenticated && view.webAcceptable) {
    return (
      <FamilyInviteWebAcceptScreen
        inviteCode={view.inviteCode}
        secondaryActions={
          <>
            {input.messagesAcceptHref ? (
              <a className={LINK_PAGE_LINK_CLASS} href={input.messagesAcceptHref}>
                Continue in Messages
              </a>
            ) : null}
            {unboundTelegramInviteLink}
          </>
        }
        title={title}
        {...(input.webAcceptInitialState
          ? { initialState: input.webAcceptInitialState }
          : {})}
      >
        {invite}
      </FamilyInviteWebAcceptScreen>
    );
  }

  // Phone-bound or unbound-by-text: accept in Messages by sending the token.
  if (input.messagesAcceptHref) {
    return (
      <LinkPageScreen
        actions={
          <>
            <a className={LINK_PAGE_PILL_CLASS} href={input.messagesAcceptHref}>
              <MessageCircle aria-hidden="true" className="size-5" />
              Continue in Messages
            </a>
            {view.webAcceptable ? (
              <FamilyInviteSignInButton
                bindingLabel={webBindingLabel}
                variant="link"
                {...webSignInDescriptionProps}
              />
            ) : null}
            {unboundTelegramInviteLink}
          </>
        }
        announceDetail={false}
        detail={
          isFullyUnbound
            ? "Joining by text works from the phone you use to send the message."
            : "Joining by text works from the phone this invite was sent to."
        }
        title={title}
      >
        {invite}
      </LinkPageScreen>
    );
  }

  // Email-bound (or a phone invite with no reachable Murph line): sign in on the
  // web with the identity the invite was sent to.
  if (view.webAcceptable) {
    return (
      <LinkPageScreen
        actions={
          <>
            <FamilyInviteSignInButton
              bindingLabel={webBindingLabel}
              {...webSignInDescriptionProps}
            />
            {unboundTelegramInviteLink}
          </>
        }
        announceDetail={false}
        detail={webSignInDescription ?? `Use the ${webBindingLabel} this invite was sent to.`}
        title={title}
      >
        {invite}
      </LinkPageScreen>
    );
  }

  // Telegram-bound invites only: continue in Telegram.
  if (view.telegramInviteUrl) {
    return (
      <LinkPageScreen
        actions={
          <a className={LINK_PAGE_PILL_CLASS} href={view.telegramInviteUrl}>
            Continue in Telegram
          </a>
        }
        announceDetail={false}
        detail="Open this in Telegram to join, so Murph can confirm it's you."
        title={title}
      >
        {invite}
      </LinkPageScreen>
    );
  }

  return (
    <LinkPageScreen
      announceDetail={false}
      detail="Open this invite from the chat where you received it to join."
      title={title}
    >
      {invite}
    </LinkPageScreen>
  );
}

function FamilyInvitePromises() {
  return (
    <ul className="mt-[22px] flex flex-col gap-2">
      <FamilyInvitePromise>They pay for your Murph access.</FamilyInvitePromise>
      <FamilyInvitePromise>You get your own private Murph account.</FamilyInvitePromise>
      <FamilyInvitePromise>
        {"They can't see your messages, health data, or vault."}
      </FamilyInvitePromise>
    </ul>
  );
}

function FamilyInvitePromise({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-base font-medium leading-[22px] text-[#FFFCF6]/85">
      <CheckIcon
        aria-hidden="true"
        className="mt-[3px] size-4 shrink-0 text-[#D9B969]"
        strokeWidth={2.5}
      />
      <span>{children}</span>
    </li>
  );
}
