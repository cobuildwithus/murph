import { Check as CheckIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  FamilyInviteSignInButton,
  FamilyInviteWebAcceptButton,
  type FamilyInviteWebAcceptInitialState,
} from "@/src/components/family/family-invite-accept-client";
import {
  JoinInviteEyebrow,
  type JoinInviteEyebrowTone,
} from "@/src/components/hosted-onboarding/join-invite-eyebrow";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent } from "@/src/components/ui/card";
import { PageHeader } from "@/src/components/ui/page-header";
import type { HostedFamilyInviteAcceptanceView } from "@/src/lib/hosted-onboarding/family-plan";

export type FamilyInviteView = HostedFamilyInviteAcceptanceView | null;

/**
 * The right-hand invite content shared by the live `/family/accept/[inviteCode]`
 * page and the design study. It is a pure presentation of an acceptance view, so
 * both callers render identical copy and CTA branching. The caller supplies the
 * shell, whether the visitor is authenticated, and the resolved Messages accept
 * link (both computed from server-only inputs on the live page).
 */
export function FamilyInviteScreen(input: {
  authenticated: boolean;
  messagesAcceptHref: string | null;
  view: FamilyInviteView;
  webAcceptInitialState?: FamilyInviteWebAcceptInitialState;
}): ReactNode {
  return (
    <div className="flex w-full flex-col gap-6">{renderInvite(input)}</div>
  );
}

function renderInvite(input: {
  authenticated: boolean;
  messagesAcceptHref: string | null;
  view: FamilyInviteView;
  webAcceptInitialState?: FamilyInviteWebAcceptInitialState;
}): ReactNode {
  const { view } = input;

  if (!view) {
    return (
      <InviteMessage
        eyebrow="Link no longer works"
        tone="danger"
        title="This invite isn't valid"
        body="This family invite is no longer available. Ask the person who invited you to send a new one."
      />
    );
  }

  if (view.status === "expired") {
    return (
      <InviteMessage
        eyebrow="Link no longer works"
        tone="danger"
        title="This invite has expired"
        body="Ask the plan owner to send you a fresh family invite."
      />
    );
  }

  if (view.status === "revoked") {
    return (
      <InviteMessage
        eyebrow="Link no longer works"
        tone="danger"
        title="This invite was canceled"
        body="Ask the plan owner for a new invite."
      />
    );
  }

  if (view.status === "accepted") {
    return (
      <InviteMessage
        eyebrow="Murph Family"
        title="This invite was already used"
        body="If that was you, open Murph to continue."
        action={
          <Button
            render={<Link href="/home" prefetch={false} />}
            nativeButton={false}
            size="xl"
          >
            Open Murph
          </Button>
        }
      />
    );
  }

  if (!view.groupActive) {
    return (
      <InviteMessage
        eyebrow="Almost ready"
        title="This family plan isn't active yet"
        body="Ask the plan owner to finish setting up billing, then open this invite again."
      />
    );
  }

  if (!view.seatAvailable) {
    return (
      <InviteMessage
        eyebrow="Family is full"
        title="This family plan is full"
        body="The plan has no open paid seats. Ask the owner to add a Family seat."
      />
    );
  }

  const inviter = view.groupDisplayName ?? "Your family plan owner";
  const isFullyUnbound = !view.isPhoneBound && !view.isEmailBound && !view.isTelegramBound;
  const webBindingLabel =
    isFullyUnbound
      ? "your phone number or email address"
      : view.isEmailBound && view.isPhoneBound
        ? "phone number or email address"
        : view.isEmailBound
          ? "email address"
          : "phone number";

  return (
    <>
      <PageHeader
        eyebrow={<JoinInviteEyebrow label="Murph Family" tone="default" />}
        title={`${inviter} invited you to Murph Family`}
        description="Join to get your own private Murph account, paid for by your family plan."
      />

      <Card size="sm">
        <CardContent>
          <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
            <FeatureRow>They pay for your Murph access.</FeatureRow>
            <FeatureRow>You get your own private Murph account.</FeatureRow>
            <FeatureRow>
              {"They can't see your messages, health data, or vault."}
            </FeatureRow>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {renderAcceptCta({
          authenticated: input.authenticated,
          messagesAcceptHref: input.messagesAcceptHref,
          view,
          webBindingLabel,
          webSignInDescription: isFullyUnbound
            ? "Sign in with your own phone number or email address. We'll bring you back here."
            : undefined,
          ...(input.webAcceptInitialState
            ? { webAcceptInitialState: input.webAcceptInitialState }
            : {}),
        })}
      </div>
    </>
  );
}

function renderAcceptCta(input: {
  authenticated: boolean;
  messagesAcceptHref: string | null;
  view: NonNullable<FamilyInviteView>;
  webAcceptInitialState?: FamilyInviteWebAcceptInitialState;
  webBindingLabel: string;
  webSignInDescription?: string;
}): ReactNode {
  const { view } = input;
  const isFullyUnbound = !view.isPhoneBound && !view.isEmailBound && !view.isTelegramBound;
  const webSignInDescriptionProps = input.webSignInDescription
    ? { description: input.webSignInDescription }
    : {};
  const webAcceptInitialStateProps = input.webAcceptInitialState
    ? { initialState: input.webAcceptInitialState }
    : {};
  const unboundTelegramInviteLink = isFullyUnbound && view.telegramInviteUrl ? (
    <Button
      render={<a href={view.telegramInviteUrl} />}
      nativeButton={false}
      size="sm"
      variant="link"
      className="h-auto w-fit p-0 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      Continue in Telegram
    </Button>
  ) : null;

  // Already signed in with an acceptable identity: one tap, no re-verification.
  if (input.authenticated && view.webAcceptable) {
    if (input.messagesAcceptHref) {
      return (
        <>
          <FamilyInviteWebAcceptButton
            inviteCode={view.inviteCode}
            {...webAcceptInitialStateProps}
          />
          <Button
            render={<a href={input.messagesAcceptHref} />}
            nativeButton={false}
            size="xl"
            variant="secondary"
          >
            Continue in Messages
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            {isFullyUnbound
              ? "Joining by text works from the phone you use to send the message."
              : "Joining by text works from the phone this invite was sent to."}
          </p>
          {unboundTelegramInviteLink}
        </>
      );
    }

    return unboundTelegramInviteLink ? (
      <>
        <FamilyInviteWebAcceptButton
          inviteCode={view.inviteCode}
          {...webAcceptInitialStateProps}
        />
        {unboundTelegramInviteLink}
      </>
    ) : (
      <FamilyInviteWebAcceptButton
        inviteCode={view.inviteCode}
        {...webAcceptInitialStateProps}
      />
    );
  }

  // Phone-bound or unbound-by-text: accept in Messages by sending the token.
  if (input.messagesAcceptHref) {
    return (
      <>
        <Button
          render={<a href={input.messagesAcceptHref} />}
          nativeButton={false}
          size="xl"
        >
          Continue in Messages
        </Button>
        {view.webAcceptable ? (
          <FamilyInviteSignInButton
            bindingLabel={input.webBindingLabel}
            variant="link"
            {...webSignInDescriptionProps}
          />
        ) : null}
        {unboundTelegramInviteLink}
      </>
    );
  }

  // Email-bound (or a phone invite with no reachable Murph line): sign in on the
  // web with the identity the invite was sent to.
  if (view.webAcceptable) {
    return (
      <>
        <FamilyInviteSignInButton
          bindingLabel={input.webBindingLabel}
          {...webSignInDescriptionProps}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {input.webSignInDescription ??
            `Use the ${input.webBindingLabel} this invite was sent to.`}
        </p>
        {unboundTelegramInviteLink}
      </>
    );
  }

  // Telegram-bound invites only: continue in Telegram.
  if (view.telegramInviteUrl) {
    return (
      <>
        <Button render={<a href={view.telegramInviteUrl} />} nativeButton={false} size="xl">
          Continue in Telegram
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          Open this in Telegram to join, so Murph can confirm it&apos;s you.
        </p>
      </>
    );
  }

  return (
    <p className="text-sm text-pretty text-muted-foreground">
      Open this invite from the chat where you received it to join.
    </p>
  );
}

function FeatureRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function InviteMessage(props: {
  action?: ReactNode;
  body: string;
  eyebrow: string;
  title: string;
  tone?: JoinInviteEyebrowTone;
}) {
  return (
    <>
      <PageHeader
        eyebrow={<JoinInviteEyebrow label={props.eyebrow} tone={props.tone ?? "default"} />}
        title={props.title}
        description={props.body}
      />
      {props.action ? <div className="flex flex-col gap-2">{props.action}</div> : null}
    </>
  );
}
